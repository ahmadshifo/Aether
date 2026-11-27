"""In-memory transport. No UploadFile: its multipart spool can write to disk."""
import asyncio
import os
from email import policy
from email.parser import BytesParser
from typing import get_args
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from app.schemas import Language, SynthesizeRequest, TtsRequest
from app.speech_provider import VoiceError, provider

router = APIRouter()
MAX_BODY = 2 * 1024 * 1024

async def bounded_body(request):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY:
            raise VoiceError("request_too_large", "Audio upload exceeds 2 MiB.", 413)
        body.extend(chunk)
    return bytes(body)

def parse_audio(body, content_type, lang):
    if content_type.startswith("multipart/form-data"):
        message = BytesParser(policy=policy.default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + body)
        if not message.is_multipart():
            raise VoiceError("invalid_audio", "Invalid multipart audio.", 422)
        fields = {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if name in fields or name not in ("audio", "lang"):
                raise VoiceError("invalid_request", "Send one audio and one lang field.", 422)
            fields[name] = part.get_payload(decode=True)
        body = fields.get("audio", b"")
        try:
            lang = fields.get("lang", b"en").decode("ascii")
        except (UnicodeError, AttributeError):
            lang = None
    elif content_type.split(";")[0] not in ("audio/wav", "audio/x-wav", "audio/m4a", "audio/mp4", "audio/mpeg", "audio/webm", "application/octet-stream"):
        raise VoiceError("unsupported_audio", "Send audio or multipart/form-data.", 415)
    if lang not in get_args(Language) or not body:
        raise VoiceError("invalid_request", "Provide audio and lang en, ar or fr.", 422)
    return body, lang

@router.post("/api/v1/voice/tts")
async def tts(body: TtsRequest):
    if provider.role != "tts":
        raise VoiceError("wrong_service", "Use the voice gateway on port 8001.", 404)
    audio = await asyncio.to_thread(provider.tts, body.text, body.lang, body.speed)
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})

@router.post("/api/v1/voice/synthesize", include_in_schema=False)
async def synthesize(body: SynthesizeRequest):
    return await tts(TtsRequest(text=body.text, lang=body.language))

@router.post("/api/v1/voice/stt")
async def stt(request: Request):
    body = await bounded_body(request)
    content_type = request.headers.get("content-type", "")
    lang = request.query_params.get("lang", "en")
    if provider.role == "tts":
        parse_audio(body, content_type, lang)
        try:
            async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
                result = await client.post(os.getenv("STT_URL", "http://voice-stt:8001") + "/api/v1/voice/stt",
                    params={"lang": lang}, content=body, headers={"Content-Type": content_type})
            return Response(result.content, status_code=result.status_code,
                            media_type="application/json", headers={"Cache-Control": "no-store"})
        except httpx.HTTPError:
            raise VoiceError("stt_unavailable", "Local transcription is unavailable.") from None
    audio, lang = parse_audio(body, content_type, lang)
    text = await asyncio.to_thread(provider.stt, audio, lang)
    return JSONResponse({"text": text, "lang": lang}, headers={"Cache-Control": "no-store"})

@router.get("/health", include_in_schema=False)
@router.get("/api/v1/voice/health")
async def health():
    ready = provider.model is not None
    stt_ready = ready if provider.role == "stt" else False
    if provider.role == "tts":
        try:
            async with httpx.AsyncClient(timeout=2, trust_env=False) as client:
                result = await client.get(os.getenv("STT_URL", "http://voice-stt:8001") + "/api/v1/voice/health")
                stt_ready = result.status_code == 200
        except httpx.HTTPError:
            pass
    return JSONResponse({"status": "ready" if ready and stt_ready else "loading",
        "role": provider.role, "model_ready": ready, "stt_ready": stt_ready,
        "model_failed": provider.failed, "languages": ["en", "ar", "fr"], "audio_storage": "memory_only"},
        status_code=200 if ready and stt_ready else 503, headers={"Cache-Control": "no-store"})
