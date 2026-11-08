"""Member 2: select latest/recent/history search, evaluate retrieved evidence and enforce safe short answers.

For now there is no vision model: the assistant finds the frames that show what the question is
about, answers honestly that it cannot describe them yet, and marks the answer uncertain. The
frames are still kept as evidence, so the question, answer and images appear in the history.
When the OpenAI vision step is added, only `describe()` changes.
"""

import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from app.memory_client import MemoryClient, MemoryUnavailable

log = logging.getLogger("ai.assistant")

# Words that point back in time. Anything else is about what is in front of the user now.
HISTORY_WORDS = re.compile(r"\b(earlier|before|today|ago|remember|this morning|where (did|was)|previously)\b|"
                           r"(سابق|سابقا|سابقًا|اليوم|تذكر|أين كان|من قبل)", re.IGNORECASE)
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
    },
    "ar": {
        "frames": "حفظتُ ما رأته الكاميرا، لكن لا يمكنني وصفه بعد لأن الذكاء الاصطناعي غير متصل.",
        "none": "لا أرى شيئًا من الكاميرا بعد. إذا ضغطت «ابدأ» للتو، انتظر قليلًا ثم اسأل مرة أخرى.",
        "offline": "لا يمكنني الوصول إلى ذاكرة الكاميرا الآن. حاول مرة أخرى بعد قليل.",
    },
}


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


def describe(question: str, language: str, frames: list[dict]) -> tuple[str, bool]:
    """No vision model yet: never invent what the frames show."""
    return ANSWERS[language]["frames" if frames else "none"], True


def answer(question: str, language: str, session_id: str, memory: MemoryClient | None = None,
           asked_at: datetime | None = None, wait: float | None = None) -> Answer:
    memory = memory or MemoryClient()
    try:
        mode, frames = find_evidence(memory, session_id, question, asked_at or datetime.now(UTC),
                                     AFTER_SECONDS if wait is None else wait,
                                     startup=STARTUP_SECONDS if wait is None else 0.0)
    except MemoryUnavailable as error:
        log.warning("Answering without evidence: %s", error)
        return Answer(ANSWERS[language]["offline"], True, [], "none")
    text, uncertain = describe(question, language, frames)
    return Answer(text, uncertain, [frame["frame_id"] for frame in frames], mode)
