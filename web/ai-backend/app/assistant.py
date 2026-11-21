"""Member 2: select latest/recent/history search, evaluate retrieved evidence and enforce safe short answers.

Questions about the past ("what did I ask earlier?", "where did I see my keys?") are answered from the
user's own last 24 hours instead (app/history_answer.py: past questions and answers plus saved frame captions).

For everything else the assistant finds the frames that show what the question is about (one from just before the question,
one from a few seconds after), sends them to the vision AI (app/vision_provider.py, Google Gemini) and
returns one short answer. Without frames, or when the AI is not set up or fails, it says so honestly and
marks the answer uncertain; it never answers from nothing. The frames are kept as evidence either way, so
the question, answer and images appear in the history.
"""

import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from app import depth as metric_depth
from app import history_answer, vision_provider
from app.memory_client import MemoryClient, MemoryUnavailable
from app.summary import topic_of
from app.vision_provider import VisionUnavailable

log = logging.getLogger("ai.assistant")

# Words that point back in time. Anything else is about what is in front of the user now.
# A bare "before" or "today" is not enough: "what's before me?", "is a car coming before I cross?" and
# "read today's menu" are about the camera now. Past questions still match "did I ...", "earlier", "ago"...
HISTORY_WORDS = re.compile(
    r"\b(earlier|ago|remember|this morning|yesterday|last time|previously|where (did|was)|before (that|now)|"
    r"did i (ask|see|leave|put)|what did you (say|tell)|did you (say|tell)|have i (seen|asked|been)|"
    r"my (history|questions)|last question)\b|"
    r"(سابق|سابقا|سابقًا|تذكر|أين كان|من قبل|مبارح|امبارح|البارحة|شو سألت|ماذا سألت|وين حطيت|وين شفت|أين رأيت|شو قلتلي|ماذا قلت لي)|"
    r"(tout à l'heure|plus tôt|hier|auparavant|tout a l'heure|où ai-je|qu'est-ce que j'ai|"
    r"tu m'as dit|je t'ai demandé|j'ai demandé|ce matin)", re.IGNORECASE)
RECENT_WORDS = re.compile(r"\b(just|passed|last|recently|a moment|behind me|went by)\b|"
                          r"(للتو|مررت|قبل قليل|خلفي|الأخير)", re.IGNORECASE)
LIMITS = {"latest": 2, "recent": 3, "history": 3}
# "What's in front of me" waits this long after the question, so the camera can settle on what the user
# means and the answer sees the view from after the question as well as just before it.
AFTER_SECONDS = float(os.getenv("ASK_AFTER_SECONDS", "3"))
LATEST_POOL = 10  # latest frames looked at when choosing one from after and one from before the question
# Right after Start the first frames need several seconds to arrive (stream online, then picked up and read).
# If none are there yet, keep checking this much longer before saying the camera shows nothing.
STARTUP_SECONDS = float(os.getenv("ASK_STARTUP_WAIT_SECONDS", "8"))
CHECK_EVERY = 1.0

ANSWERS = {
    "en": {
        "frames": "I saved what your camera saw, but I can't describe it yet because the AI isn't connected.",
        "none": "I can't see anything from your camera yet. If you just pressed Start, wait a moment and ask again.",
        "offline": "I can't reach the camera memory right now. Please try again in a moment.",
        "quota": "I've reached today's limit for answers. Please try again later.",
        "failed": "I couldn't get an answer right now. Please ask again in a moment.",
        "cane": "Please keep using your cane or guide.",
    },
    "ar": {
        "frames": "حفظتُ ما رأته الكاميرا، لكن لا يمكنني وصفه بعد لأن الذكاء الاصطناعي غير متصل.",
        "none": "لا أرى شيئًا من الكاميرا بعد. إذا ضغطت «ابدأ» للتو، انتظر قليلًا ثم اسأل مرة أخرى.",
        "offline": "لا يمكنني الوصول إلى ذاكرة الكاميرا الآن. حاول مرة أخرى بعد قليل.",
        "quota": "وصلتُ إلى الحد اليومي للإجابات. حاول مرة أخرى لاحقًا.",
        "failed": "لم أتمكن من الحصول على إجابة الآن. اسأل مرة أخرى بعد قليل.",
        "cane": "استمر في استخدام عصاك أو مرشدك.",
    },
    "fr": {
        "frames": "J'ai enregistré ce que la caméra a vu, mais je ne peux pas encore le décrire car l'IA n'est pas connectée.",
        "none": "Je ne vois encore rien de la caméra. Si vous venez d'appuyer sur Démarrer, attendez un instant et redemandez.",
        "offline": "Je n'arrive pas à joindre la mémoire de la caméra. Réessayez dans un instant.",
        "quota": "J'ai atteint la limite de réponses pour aujourd'hui. Réessayez plus tard.",
        "failed": "Je n'ai pas pu obtenir de réponse. Redemandez dans un instant.",
        "cane": "Continuez à utiliser votre canne ou votre guide.",
    },
}
# Words showing the answer already reminds the user to keep their cane or guide.
CANE_WORDS = re.compile(r"cane|guide|عصا|مرشد|canne", re.IGNORECASE)


@dataclass(frozen=True)
class Answer:
    text: str
    uncertain: bool
    evidence_frame_ids: list[str]
    mode: str


def choose_mode(question: str) -> str:
    if HISTORY_WORDS.search(question):
        return "history"
    if RECENT_WORDS.search(question):
        return "recent"
    return "latest"


def _captured(frame: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(frame["captured_at"]).replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return None


def before_and_after(frames: list[dict], asked_at: datetime, limit: int) -> list[dict]:
    """The newest view from after the question, then the last view from before it, then any newer others."""
    dated = sorted(((when, frame) for frame in frames if (when := _captured(frame)) is not None),
                   key=lambda pair: pair[0], reverse=True)
    after = next((frame for when, frame in dated if when > asked_at), None)
    before = next((frame for when, frame in dated if when <= asked_at), None)
    chosen = [frame for frame in (after, before) if frame is not None]
    for _, frame in dated:
        if len(chosen) >= limit:
            break
        if frame not in chosen:
            chosen.append(frame)
    return chosen[:limit]


def find_evidence(memory: MemoryClient, session_id: str, question: str, asked_at: datetime | None = None,
                  wait: float = 0.0, sleep=time.sleep, startup: float = 0.0,
                  clock=time.monotonic) -> tuple[str, list[dict]]:
    """Frames for the question. A mode that finds nothing falls back to the last 2 minutes."""
    mode = choose_mode(question)
    if mode == "latest":
        asked_at = asked_at or datetime.now(UTC)
        if wait > 0:
            sleep(wait)
        deadline = clock() + startup
        while True:
            frames = before_and_after(memory.search(session_id, question, mode, LATEST_POOL), asked_at, LIMITS[mode])
            if frames or clock() >= deadline:
                break
            sleep(CHECK_EVERY)  # the session's first frames have not arrived yet
    else:
        frames = memory.search(session_id, question, mode, LIMITS[mode])
    if not frames and mode != "recent":
        mode, frames = "recent", memory.search(session_id, question, "recent", LIMITS["recent"])
    return mode, frames


def _pictures(memory: MemoryClient, frames: list[dict], now: datetime) -> list[tuple[bytes, float]]:
    """The frames' JPEGs with how many seconds ago each was taken. A frame that is already gone is skipped."""
    pictures = []
    for frame in frames:
        jpeg = memory.image(frame["frame_id"])
        when = _captured(frame)
        if jpeg:
            pictures.append((jpeg, max(0.0, (now - when).total_seconds()) if when else 0.0))
    return pictures


def describe(question: str, language: str, frames: list[dict], memory: MemoryClient | None = None,
             now: datetime | None = None, measured: tuple[bytes, str] | None = None) -> tuple[str, bool]:
    """One short answer about the frames, or an honest message when that isn't possible."""
    copy = ANSWERS[language]
    if not frames:
        return copy["none"], True
    if memory is None or not vision_provider.configured():
        return copy["frames"], True
    try:
        pictures = _pictures(memory, frames, now or datetime.now(UTC))
    except MemoryUnavailable as error:
        log.warning("Frame images unavailable: %s", error)
        return copy["offline"], True
    if not pictures:
        return copy["none"], True
    try:
        text, uncertain = vision_provider.ask(question, language, pictures, measured) if measured else \
            vision_provider.ask(question, language, pictures)
    except VisionUnavailable as error:
        log.warning("Vision AI unavailable: %s", error)
        return copy["quota" if error.reason == "quota" else "failed"], True
    # Questions about walking or obstacles always end with the cane reminder (the AI never says "it's safe").
    if topic_of(question) == "safety" and not CANE_WORDS.search(text):
        text = f"{text} {copy['cane']}"
    return text, uncertain


def camera_blocked(memory: MemoryClient, session_id: str) -> bool:
    """True while the live picture is almost black (a finger or object over the lens, phone face down).
    Such frames are never used as evidence, so without this the user would only hear "I can't see anything"."""
    try:
        return bool((memory.live_state(session_id) or {}).get("dark_since"))
    except (MemoryUnavailable, AttributeError):
        return False


def answer(question: str, language: str, session_id: str, memory: MemoryClient | None = None,
           asked_at: datetime | None = None, wait: float | None = None, user_id: str | None = None,
           depth: metric_depth.DepthSnapshot | None = None) -> Answer:
    memory = memory or MemoryClient()
    # "Ask my history": a question about the past is answered from the user's own last 24 hours.
    if user_id and choose_mode(question) == "history":
        return history_answer.answer(question, language, user_id, memory)
    if metric_depth.asks_distance(question):
        text, uncertain = metric_depth.answer(question, language, depth, asked_at or datetime.now(UTC))
        # The private measurement image is transient; linking a different saved frame would mislabel the evidence.
        return Answer(text, uncertain, [], "depth")
    try:
        mode, frames = find_evidence(memory, session_id, question, asked_at or datetime.now(UTC),
                                     AFTER_SECONDS if wait is None else wait,
                                     startup=STARTUP_SECONDS if wait is None else 0.0)
    except MemoryUnavailable as error:
        log.warning("Answering without evidence: %s", error)
        return Answer(ANSWERS[language]["offline"], True, [], "none")
    # A question about what is in front of the user right now, while the lens is covered: say so instead of
    # describing older pictures from before it was covered.
    if mode in ("latest", "recent") and camera_blocked(memory, session_id):
        return Answer(vision_provider.BLOCKED[language], True, [frame["frame_id"] for frame in frames], mode)
    # "What's in front of me?" with a fresh depth snapshot: the answer also says how far the centre object is.
    measured = metric_depth.measured_picture(question, language, depth, asked_at or datetime.now(UTC)) \
        if mode == "latest" else None
    text, uncertain = describe(question, language, frames, memory, measured=measured) if measured else \
        describe(question, language, frames, memory)
    return Answer(text, uncertain, [frame["frame_id"] for frame in frames], mode)
