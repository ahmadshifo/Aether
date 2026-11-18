"""Captions and object labels for saved frames with Google Gemini (the free key the AI backend uses too).

Used when there is no OpenAI key: same VisionResult and the same instructions as VisionService, so the
pipeline, database and dashboard don't change. Settings in multimedia/api/.env:
- GEMINI_API_KEY               the Google AI Studio key (never commit it)
- GEMINI_MODEL                 default gemini-3.1-flash-lite
- GEMINI_CAPTION_MIN_SECONDS   at most one caption request per this many seconds (default 60), because the
                               free daily quota is shared with the answers the assistant gives

A caption is a nice-to-have on a saved frame, never a reason to lose it: when Gemini is skipped (too soon),
busy, out of quota or unreachable, analyze_image returns an empty, uncertain result and the frame is still saved.
"""

import base64
import json
import logging
import threading
import time
import urllib.error
import urllib.request

import cv2
import numpy as np

from .object_detector import VISUAL_INSTRUCTIONS, VisionResult, normalize_objects

log = logging.getLogger("multimedia.gemini")
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3.1-flash-lite"
SCHEMA = {"type": "OBJECT", "properties": {"objects": {"type": "ARRAY", "items": {"type": "STRING"}},
                                           "caption": {"type": "STRING"}, "uncertain": {"type": "BOOLEAN"}},
          "required": ["objects", "caption", "uncertain"]}
MAX_SIDE = 1024  # plenty for a caption, and a smaller upload


def to_jpeg(image: np.ndarray) -> bytes:
    """The frame as JPEG bytes, scaled down so its longer side is at most MAX_SIDE."""
    height, width = image.shape[:2]
    scale = MAX_SIDE / max(height, width)
    if scale < 1:
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise ValueError("Could not encode the frame as JPEG.")
    return jpeg.tobytes()


def build_request(jpeg: bytes, thinking: bool = True) -> dict:
    config = {"temperature": 0.2, "maxOutputTokens": 400, "responseMimeType": "application/json",
              "responseSchema": SCHEMA}
    if thinking:
        config["thinkingConfig"] = {"thinkingLevel": "minimal"}
    return {"systemInstruction": {"parts": [{"text": VISUAL_INSTRUCTIONS}]},
            "contents": [{"role": "user", "parts": [
                {"text": "Identify visible objects and describe this scene."},
                {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpeg).decode()}}]}],
            "generationConfig": config}


def parse_response(body: dict, model: str) -> VisionResult:
    """VisionResult from Gemini's JSON reply. Raises ValueError when it has no usable result."""
    candidates = body.get("candidates") or []
    if not candidates:
        raise ValueError("Gemini gave no result")
    text = "".join(part.get("text", "") for part in (candidates[0].get("content") or {}).get("parts", [])
                   if not part.get("thought"))
    data = json.loads(text)
    objects = data.get("objects", [])
    if not isinstance(objects, list):
        raise ValueError("objects is not a list")
    return VisionResult(normalize_objects([str(label) for label in objects]), str(data.get("caption", "")).strip(),
                        model, bool(data.get("uncertain", True)))


class GeminiVisionService:
    """analyze_image(image) -> VisionResult, like VisionService. post is injectable for tests."""

    def __init__(self, api_key: str, model: str | None = None, min_seconds: float = 60.0,
                 timeout_seconds: float = 20.0, post=None, clock=time.monotonic):
        if not api_key or not api_key.strip():
            raise ValueError("GEMINI_API_KEY is missing.")
        self._key = api_key.strip()
        self.model = (model or DEFAULT_MODEL).strip()
        self.min_seconds, self.timeout = float(min_seconds), float(timeout_seconds)
        self._post, self._clock = post or self._http_post, clock
        self._last = None
        self._lock = threading.Lock()
        self._thinking = True

    def _skipped(self) -> VisionResult:
        return VisionResult(objects=[], caption="", model="none", uncertain=True)

    def _due(self) -> bool:
        """True (and the clock restarts) when enough time has passed since the last caption request."""
        with self._lock:
            now = self._clock()
            if self._last is not None and now - self._last < self.min_seconds:
                return False
            self._last = now
            return True

    def analyze_image(self, image: np.ndarray) -> VisionResult:
        if not self._due():
            return self._skipped()
        try:
            jpeg = to_jpeg(image)
            try:
                body = self._post(build_request(jpeg, self._thinking))
            except urllib.error.HTTPError as error:
                detail = error.read().decode(errors="replace")[:300]
                if not (error.code == 400 and self._thinking and "thinking" in detail.lower()):
                    raise
                self._thinking = False  # this model doesn't take a thinking setting: ask again without it
                body = self._post(build_request(jpeg, False))
            return parse_response(body, self.model)
        except urllib.error.HTTPError as error:
            reason = "quota reached" if error.code == 429 else f"HTTP {error.code}"
            log.warning("Saved frame without a caption (Gemini: %s)", reason)
        except Exception as error:
            log.warning("Saved frame without a caption (%s)", type(error).__name__)
        return self._skipped()

    def _http_post(self, body: dict) -> dict:
        request = urllib.request.Request(API.format(model=self.model), data=json.dumps(body).encode(), method="POST",
                                         headers={"Content-Type": "application/json", "x-goog-api-key": self._key})
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.load(response)
