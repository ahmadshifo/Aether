from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from starlette.datastructures import UploadFile
from .audio import convert, MAX_AUDIO
from .errors import VoiceError
from .schemas import SynthesizeRequest, Transcription
from .security import account

router = APIRouter(prefix="/api/v1/voice")


@router.post("/transcribe", response_model=Transcription, openapi_extra={"requestBody": {
    "required": True, "content": {"multipart/form-data": {"schema": {
        "type": "object", "required": ["audio", "language"], "properties": {
            "audio": {"type": "string", "format": "binary", "description": "Up to 4 MiB and 30 seconds"},
            "language": {"type": "string", "enum": ["en", "ar", "fr"]}}}}}}})
async def transcribe(request: Request, user: str = Depends(account)):
    async with request.app.state.quota.claim(user):
        try:
            async with request.form(max_files=1, max_fields=1, max_part_size=4096) as form:
                language, audio = form.get("language"), form.get("audio")
                if language not in ("en", "ar", "fr") or not isinstance(audio, UploadFile) or set(form) != {"audio", "language"}:
                    raise VoiceError(422, "voice_request", "Provide audio and language (en, ar, or fr).")
                data = await audio.read(MAX_AUDIO + 1)
        except VoiceError:
            raise
        except Exception:
            raise VoiceError(422, "voice_request", "Invalid multipart recording.") from None
        if not request.app.state.settings.groq_key:
            raise VoiceError(503, "voice_unconfigured", "Set GROQ_API_KEY on the voice server.")
        wav = await convert(data, request.app.state.settings.ffmpeg)
        text = await request.app.state.provider.transcribe(wav, language)
        return Transcription(text=text, language=language)


@router.post("/synthesize", response_class=Response, responses={200: {"content": {"audio/mpeg": {}}}},
             openapi_extra={"requestBody": {"required": True, "content": {"application/json": {"schema": SynthesizeRequest.model_json_schema()}}}})
async def synthesize(request: Request, user: str = Depends(account)):
    try:
        body = SynthesizeRequest.model_validate(await request.json())
    except ValueError:
        raise VoiceError(422, "voice_request", "Provide 1–1200 characters and language (en, ar, or fr).") from None
    async with request.app.state.quota.claim(user):
        if not request.app.state.settings.audio_ready:
            raise VoiceError(503, "voice_audio_unavailable", "FFmpeg is not available on the voice server.")
        wav = await request.app.state.provider.synthesize(body.text, body.language)
        mp3 = await convert(wav, request.app.state.settings.ffmpeg, mp3=True)
        return Response(mp3, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
