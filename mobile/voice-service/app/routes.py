"""Member 1: POST /api/v1/voice/synthesize reads a text aloud (MP3), and GET /health says if Azure is set up.

The dashboard's AI History player (web/dashboard/src/services/voiceClient.js) posts {text, language} through
its Vite proxy and plays the MP3. The service listens on 127.0.0.1 only (scripts/start.mjs), so only this
computer can spend the Azure quota. Errors are JSON in the same {"error": {code, message}} shape as the other
services, and never include the key or Azure's reply.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response

from app import speech_provider
from app.schemas import SynthesizeRequest

router = APIRouter()


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


@router.post("/api/v1/voice/synthesize", response_model=None)
def synthesize(body: SynthesizeRequest) -> Response:
    text = " ".join(body.text.split())
    if not text:
        return _error(422, "empty_text", "There is no text to read.")
    try:
        audio = speech_provider.synthesize(text, body.language)
    except speech_provider.SpeechUnavailable as error:
        if error.reason == "not_configured":
            return _error(503, "voice_not_configured", "Azure Speech is not set up in mobile/voice-service/.env.")
        return _error(502, "voice_failed", "Azure Speech could not read this answer right now.")
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "azure_speech": speech_provider.configured()}
