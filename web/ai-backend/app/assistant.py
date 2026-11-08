"""Member 2: select latest/recent/history search, evaluate retrieved evidence and enforce safe short answers.

For now there is no vision model: the assistant finds the frames that show what the question is
about, answers honestly that it cannot describe them yet, and marks the answer uncertain. The
frames are still kept as evidence, so the question, answer and images appear in the history.
When the OpenAI vision step is added, only `describe()` changes.
"""

import logging
import re
from dataclasses import dataclass

from app.memory_client import MemoryClient, MemoryUnavailable

log = logging.getLogger("ai.assistant")

# Words that point back in time. Anything else is about what is in front of the user now.
HISTORY_WORDS = re.compile(r"\b(earlier|before|today|ago|remember|this morning|where (did|was)|previously)\b|"
                           r"(سابق|سابقا|سابقًا|اليوم|تذكر|أين كان|من قبل)", re.IGNORECASE)
RECENT_WORDS = re.compile(r"\b(just|passed|last|recently|a moment|behind me|went by)\b|"
                          r"(للتو|مررت|قبل قليل|خلفي|الأخير)", re.IGNORECASE)
LIMITS = {"latest": 2, "recent": 3, "history": 3}

ANSWERS = {
    "en": {
        "frames": "I saved what your camera saw, but I can't describe it yet because the AI isn't connected.",
        "none": "I can't see anything from your camera right now. Check that the camera is on, then ask again.",
        "offline": "I can't reach the camera memory right now. Please try again in a moment.",
    },
    "ar": {
        "frames": "حفظتُ ما رأته الكاميرا، لكن لا يمكنني وصفه بعد لأن الذكاء الاصطناعي غير متصل.",
        "none": "لا أرى شيئًا من الكاميرا الآن. تأكّد من تشغيل الكاميرا ثم اسأل مرة أخرى.",
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


def find_evidence(memory: MemoryClient, session_id: str, question: str) -> tuple[str, list[dict]]:
    """Frames for the question. A mode that finds nothing falls back to the last 2 minutes."""
    mode = choose_mode(question)
    frames = memory.search(session_id, question, mode, LIMITS[mode])
    if not frames and mode != "recent":
        mode, frames = "recent", memory.search(session_id, question, "recent", LIMITS["recent"])
    return mode, frames


def describe(question: str, language: str, frames: list[dict]) -> tuple[str, bool]:
    """No vision model yet: never invent what the frames show."""
    return ANSWERS[language]["frames" if frames else "none"], True


def answer(question: str, language: str, session_id: str, memory: MemoryClient | None = None) -> Answer:
    memory = memory or MemoryClient()
    try:
        mode, frames = find_evidence(memory, session_id, question)
    except MemoryUnavailable as error:
        log.warning("Answering without evidence: %s", error)
        return Answer(ANSWERS[language]["offline"], True, [], "none")
    text, uncertain = describe(question, language, frames)
    return Answer(text, uncertain, [frame["frame_id"] for frame in frames], mode)
