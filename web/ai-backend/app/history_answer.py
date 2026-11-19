"""Member 2: "Ask my history": answer a question about the past from the user's own saved records.

Questions like "what did I ask earlier?", "where did I see my keys?" or "what did you tell me about the door?"
(assistant.choose_mode -> "history") are answered from:
- the account's questions and answers of the last 24 hours (the questions table, with the area when saved), and
- what the camera saved in that time: each saved frame's caption, objects and read text (Member 3's frame
  timeline, GET /api/v1/frames, which checks the same login cookie and only returns unexpired frames).

The log goes to the same AI as camera questions (Gemini, text only, no pictures), which must answer only from
it and say plainly when it isn't there. The frames it used become the answer's evidence, so the dashboard
shows them next to the answer. Nothing new is stored here.
"""

import json
import logging
from contextlib import closing
from datetime import UTC, datetime, timedelta

from app import vision_provider
from app.auth import _connect
from app.memory_client import MemoryUnavailable
from app.vision_provider import VisionUnavailable, _when

log = logging.getLogger("ai.history_answer")

WINDOW = timedelta(hours=24)
MAX_QUESTIONS = 40
MAX_SESSIONS = 6
FRAMES_PER_SESSION = 60
MAX_FRAMES = 120

ANSWERS = {
    "en": {"empty": "I don't have anything saved from the last 24 hours yet, so I can't answer that.",
           "no_ai": "I can't look through your history right now because the AI isn't connected."},
    "ar": {"empty": "لا يوجد شيء محفوظ من آخر 24 ساعة بعد، لذلك لا أستطيع الإجابة.",
           "no_ai": "لا يمكنني البحث في سجلك الآن لأن الذكاء الاصطناعي غير متصل."},
    "fr": {"empty": "Je n'ai encore rien d'enregistré des dernières 24 heures, je ne peux donc pas répondre.",
           "no_ai": "Je ne peux pas parcourir votre historique pour l'instant car l'IA n'est pas connectée."},
}

INSTRUCTIONS = """You are Aether, a visual assistant for a blind or low-vision person. They are asking about the
past. You get their question and a log of what happened in the last 24 hours, newest first:
- lines starting with Q are questions they asked you and the answer you gave (with the area, when known);
- lines starting with F1, F2, ... are pictures the camera saved: what was seen, objects, and any text read.
Each line says how long ago it happened.

Answer rules:
- Answer in {language}, in one to three short spoken sentences (at most 50 words). No lists, no markdown.
- Use only the log. Never invent objects, places, text or times that are not in it.
- Say when it happened in plain words, like "about 20 minutes ago".
- If the log doesn't contain the answer, say you don't have it in the last 24 hours and suggest asking the
  camera now. Set uncertain to true.
- Never say where something is now: only where it was seen and when. Things may have moved.
- People: never guess who someone is.
- In "frames", list the ids (like "F3") of the pictures your answer relies on, at most 3. Empty if none.
- Set uncertain to true whenever the log is unclear; false only when the log clearly answers the question."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {"answer": {"type": "STRING"}, "uncertain": {"type": "BOOLEAN"},
                   "frames": {"type": "ARRAY", "items": {"type": "STRING"}}},
    "required": ["answer", "uncertain", "frames"],
}


def _naive_utc(moment: datetime) -> datetime:
    return moment.astimezone(UTC).replace(tzinfo=None) if moment.tzinfo else moment


def past_questions(user_id: str, now: datetime) -> list[dict]:
    """The account's questions and answers from the last 24 hours, newest first."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT asked_at, question, answer, location_label FROM questions "
                    "WHERE user_id = %s AND asked_at >= %s ORDER BY asked_at DESC LIMIT %s",
                    (user_id, _naive_utc(now - WINDOW), MAX_QUESTIONS))
        return list(cur.fetchall())


def recent_sessions(user_id: str, now: datetime) -> list[str]:
    """The account's camera sessions that started in the last 24 hours, newest first."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT session_id FROM sessions WHERE user_id = %s AND started_at >= %s "
                    "ORDER BY started_at DESC LIMIT %s", (user_id, _naive_utc(now - WINDOW), MAX_SESSIONS))
        return [row["session_id"] for row in cur.fetchall()]


def saved_frames(memory, session_ids: list[str]) -> list[dict]:
    """Saved frames that say something (a caption, objects or read text), newest first."""
    frames = []
    for session_id in session_ids:
        try:
            frames += memory.timeline(session_id, FRAMES_PER_SESSION)
        except MemoryUnavailable as error:
            log.warning("Saved frames unavailable for history: %s", error)
            break
    useful = [f for f in frames if (f.get("caption") or "").strip() or f.get("objects") or (f.get("ocr_text") or "").strip()]
    useful.sort(key=lambda f: str(f.get("captured_at", "")), reverse=True)
    return useful[:MAX_FRAMES]


def _ago(moment, now: datetime) -> str:
    if isinstance(moment, str):
        moment = datetime.fromisoformat(moment.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)  # MySQL keeps UTC without a zone
    return _when(max(0.0, (now - moment).total_seconds()))


def _short(text, limit: int = 300) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def build_log(questions: list[dict], frames: list[dict], now: datetime) -> tuple[str, dict[str, str]]:
    """The text log for the AI, and which frame_id each F-number stands for."""
    lines, refs = [], {}
    for row in questions:
        place = f" in {_short(row['location_label'], 80)}" if row.get("location_label") else ""
        lines.append(f"Q, {_ago(row['asked_at'], now)}{place}: they asked \"{_short(row['question'])}\"; "
                     f"you answered \"{_short(row['answer'])}\"")
    for number, frame in enumerate(frames, start=1):
        ref = f"F{number}"
        refs[ref] = frame["frame_id"]
        parts = [f"{ref}, {_ago(frame['captured_at'], now)}:"]
        if (frame.get("caption") or "").strip():
            parts.append(f"saw {_short(frame['caption']).rstrip('.')}.")
        if frame.get("objects"):
            parts.append("Objects: " + ", ".join(_short(label, 40) for label in frame["objects"][:12]) + ".")
        if (frame.get("ocr_text") or "").strip():
            parts.append(f"Text read: \"{_short(frame['ocr_text'], 200)}\".")
        lines.append(" ".join(parts))
    return "\n".join(lines), refs


def build_request(question: str, language: str, log_text: str, thinking: bool = True) -> dict:
    config = {"temperature": 0.2, "maxOutputTokens": 300, "responseMimeType": "application/json", "responseSchema": SCHEMA}
    if thinking:
        config["thinkingConfig"] = {"thinkingLevel": "minimal"}
    return {
        "systemInstruction": {"parts": [{"text": INSTRUCTIONS.format(
            language=vision_provider.LANGUAGE_NAMES.get(language, "English"))}]},
        "contents": [{"role": "user", "parts": [{"text": f"Question: {question.strip()}\n\nLog:\n{log_text}"}]}],
        "generationConfig": config,
    }


def parse_response(body: dict, refs: dict[str, str]) -> tuple[str, bool, list[str]]:
    """(answer, uncertain, evidence frame_ids). Unknown frame references are dropped."""
    text, uncertain = vision_provider.parse_response(body)
    candidates = body.get("candidates") or [{}]
    raw = "".join(part.get("text", "") for part in (candidates[0].get("content") or {}).get("parts", [])
                  if not part.get("thought"))
    try:
        named = json.loads(raw).get("frames") or []
    except (ValueError, AttributeError):
        named = []
    evidence = []
    for ref in named if isinstance(named, list) else []:
        frame_id = refs.get(str(ref).strip().upper())
        if frame_id and frame_id not in evidence:
            evidence.append(frame_id)
    return text, uncertain, evidence[:3]


def answer(question: str, language: str, user_id: str, memory, now: datetime | None = None):
    """An assistant.Answer for a question about the past, in history mode."""
    from app.assistant import ANSWERS as CAMERA_ANSWERS, Answer  # imported here: assistant imports this module

    now = now or datetime.now(UTC)
    copy = ANSWERS[language]
    if not vision_provider.configured():
        return Answer(copy["no_ai"], True, [], "history")
    questions = past_questions(user_id, now)
    frames = saved_frames(memory, recent_sessions(user_id, now))
    if not questions and not frames:
        return Answer(copy["empty"], True, [], "history")
    log_text, refs = build_log(questions, frames, now)
    try:
        text, uncertain, evidence = vision_provider.generate(
            lambda thinking: build_request(question, language, log_text, thinking),
            lambda body: parse_response(body, refs))
    except VisionUnavailable as error:
        log.warning("History answer unavailable: %s", error)
        return Answer(CAMERA_ANSWERS[language]["quota" if error.reason == "quota" else "failed"], True, [], "history")
    return Answer(text, uncertain, evidence, "history")
