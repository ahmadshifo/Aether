"""Member 2: ask a vision AI (Google Gemini) about the real camera frames and get one short, safe answer.

The assistant (app/assistant.py) finds the frames; this module sends them with the question and returns
(answer text, uncertain). It never answers without pictures, and the instructions below forbid guessing,
identifying people, or saying that a path is safe.

Settings (web/ai-backend/.env):
- GEMINI_API_KEY   the key from Google AI Studio (never commit it)
- GEMINI_MODEL     default gemini-3.1-flash-lite (fast and cheap; free tier about 15 a minute, 500 a day)
- AI_PROVIDER      gemini (the only one wired up today)

Errors raise VisionUnavailable with a reason the assistant turns into an honest spoken message:
"no_key" (not set up), "quota" (free-tier limit reached), "failed" (network or AI error).
"""

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.request

log = logging.getLogger("ai.vision")

# The phone waits 20 s for an answer and the assistant first waits about 3 s for the frames, so the AI gets at
# most this long in total (retries included); after that the user hears "I couldn't get an answer".
BUDGET_SECONDS = 13.0
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# What the user hears when the lens is covered (the assistant also says it without asking the AI).
BLOCKED = {
    "en": "There is something blocking my view. Please remove it from the front of the camera.",
    "ar": "هناك شيء يحجب رؤيتي. أبعده من أمام الكاميرا من فضلك.",
    "fr": "Quelque chose bloque ma vue. Retirez-le de devant la caméra, s'il vous plaît.",
}
LANGUAGE_NAMES = {"en": "English", "ar": "Arabic (simple, Levantine-friendly Modern Standard Arabic)", "fr": "French"}

INSTRUCTIONS = """You are Aether, a visual assistant for a blind or low-vision person. They hold a phone camera
and ask you about what it sees. You get their question and one to three camera pictures, each labelled with
when it was taken. Faces in the pictures are blurred on purpose.

Answer rules:
- Answer in {language}, in one to three short spoken sentences (at most 45 words). No lists, no markdown.
- Only say what is clearly visible in the pictures. Never invent or guess objects, text, amounts or colours.
- Be specific, not vague. For each important thing say:
  where it is from the user's point of view (on your left, on your right, straight ahead, near, far), and
  its state when it matters: a door is open, closed or half open; a chair is upright, tipped over or in the
  way; a drawer or window is open or closed; a light or screen is on or off; a cup is full or empty;
  stairs go up or down. Say "a closed door straight ahead", not just "a door".
- Distances only as rough estimates ("about two steps", "about 2 metres"), never exact.
- Reading: read the important text word for word. If it is too small, blurry or cut off, say so and suggest
  moving the phone closer or holding it steady.
- Money: name the currency and the value only if the note or coin is clearly visible.
- Colours: name the main colour simply (dark blue, light grey) and mention patterns.
- Finding an object: say where it is in the picture, or that you can't see it. For older pictures, say when
  they were taken ("about two minutes ago").
- Obstacles and walking: mention steps, edges, doors, poles, people, vehicles and objects in the way. Never
  say a path, crossing or stairs are safe; describe what you see and let the user decide.
- People: you may say "a person" and what they are doing; never guess who they are, their age, gender,
  ethnicity or mood from their face.
- If a picture is almost black or covered (a finger, hand or object over the lens), answer exactly:
  "{blocked}" and set uncertain to true.
- If the pictures are blurry or don't show what was asked, say that plainly and suggest how to point the
  camera, and set uncertain to true.
- Set uncertain to true whenever you are not sure; false only when the answer is clearly visible."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {"answer": {"type": "STRING"}, "uncertain": {"type": "BOOLEAN"}},
    "required": ["answer", "uncertain"],
}


class VisionUnavailable(RuntimeError):
    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason


def configured() -> bool:
    return os.getenv("AI_PROVIDER", "gemini").strip().lower() == "gemini" and bool(os.getenv("GEMINI_API_KEY", "").strip())


def _when(seconds: float) -> str:
    """How long before the answer a picture was taken, in words the model can repeat."""
    if seconds <= 1:
        return "just now"
    if seconds < 90:
        return f"{round(seconds)} seconds ago"
    if seconds < 90 * 60:
        return f"about {round(seconds / 60)} minutes ago"
    return f"about {round(seconds / 3600)} hours ago"


def build_request(question: str, language: str, pictures: list[tuple[bytes, float]], thinking: bool = True) -> dict:
    """The Gemini request body. pictures: (JPEG bytes, seconds since it was taken), newest first."""
    parts = [{"text": f"Question: {question.strip()}"}]
    for number, (jpeg, seconds) in enumerate(pictures, start=1):
        parts.append({"text": f"Picture {number}, taken {_when(seconds)}:"})
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpeg).decode()}})
    config = {"temperature": 0.2, "maxOutputTokens": 300, "responseMimeType": "application/json",
              "responseSchema": SCHEMA}
    if thinking:
        config["thinkingConfig"] = {"thinkingLevel": "minimal"}  # short answers: keep it fast and cheap
    return {
        "systemInstruction": {"parts": [{"text": INSTRUCTIONS.format(language=LANGUAGE_NAMES.get(language, "English"),
                                                                 blocked=BLOCKED.get(language, BLOCKED["en"]))}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": config,
    }


def parse_response(body: dict) -> tuple[str, bool]:
    """(answer, uncertain) from Gemini's reply. Raises VisionUnavailable when there is no usable answer."""
    candidates = body.get("candidates") or []
    if not candidates:
        reason = (body.get("promptFeedback") or {}).get("blockReason", "no answer")
        raise VisionUnavailable("failed", f"blocked: {reason}")
    text = "".join(part.get("text", "") for part in (candidates[0].get("content") or {}).get("parts", [])
                   if not part.get("thought"))
    try:
        data = json.loads(text)
        answer = str(data["answer"]).strip()
    except (ValueError, KeyError, TypeError):
        raise VisionUnavailable("failed", "unreadable answer") from None
    if not answer:
        raise VisionUnavailable("failed", "empty answer")
    return answer, bool(data.get("uncertain", True))


def _post(model: str, key: str, body: dict, timeout: float) -> dict:
    request = urllib.request.Request(API.format(model=model), data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def ask(question: str, language: str, pictures: list[tuple[bytes, float]]) -> tuple[str, bool]:
    """One short answer about the pictures, in the user's language."""
    if not configured():
        raise VisionUnavailable("no_key")
    key, model = os.environ["GEMINI_API_KEY"].strip(), os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite").strip()
    thinking, deadline = True, time.monotonic() + BUDGET_SECONDS
    for attempt in range(3):
        left = deadline - time.monotonic()
        if left < 2:
            break
        try:
            return parse_response(_post(model, key, build_request(question, language, pictures, thinking), left))
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            if error.code == 429:
                raise VisionUnavailable("quota", detail) from None
            if error.code == 400 and thinking and "thinking" in detail.lower():
                thinking = False  # this model doesn't take a thinking setting: ask again without it
                continue
            if error.code in (500, 502, 503, 504) and attempt < 2:
                continue  # Google's side was busy: one quick retry
            log.warning("Gemini answered %s: %s", error.code, detail)
            raise VisionUnavailable("failed", f"HTTP {error.code}") from None
        except (urllib.error.URLError, OSError, ValueError) as error:
            log.warning("Gemini request failed: %s", error)
            raise VisionUnavailable("failed", type(error).__name__) from None
        except VisionUnavailable as error:
            log.warning("Gemini gave no usable answer: %s", error)
            raise
    raise VisionUnavailable("failed", "no answer after retries")
