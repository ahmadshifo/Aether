"""Authenticated same-origin proxy to the local, loopback-only voice service."""
import os
import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from app.auth import ApiError, signed_in_user_id

router = APIRouter()
MAX_BODY = 2 * 1024 * 1024


@router.api_route("/api/v1/voice/{operation}", methods=["GET", "POST"])
async def voice(operation: str, request: Request, response: Response, user_id: str = Depends(signed_in_user_id)):
    if (operation == "health" and request.method != "GET") or (operation in ("tts", "stt", "synthesize") and request.method != "POST"):
        raise ApiError(405, "method_not_allowed", "Unsupported voice method.")
    if operation not in ("health", "tts", "stt", "synthesize"):
        raise ApiError(404, "not_found", "Unknown voice operation.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY:
            raise ApiError(413, "request_too_large", "Audio upload exceeds 2 MiB.")
        body.extend(chunk)
    origin = os.getenv("VOICE_SERVICE_URL", "http://127.0.0.1:8001").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=65, trust_env=False, follow_redirects=False) as client:
            async with client.stream(request.method, f"{origin}/api/v1/voice/{operation}",
                params={"lang": request.query_params.get("lang", "en")}, content=bytes(body),
                headers={"Content-Type": request.headers.get("content-type", "application/json")}) as upstream:
                payload = bytearray()
                async for chunk in upstream.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > 16 * 1024 * 1024:
                        raise ApiError(502, "voice_failed", "Voice response exceeded the size limit.")
                if upstream.status_code not in (200, 400, 413, 415, 422, 429, 503):
                    raise ApiError(503, "voice_unavailable", "Local voice is unavailable. Use device voice.")
                result = Response(bytes(payload), status_code=upstream.status_code,
                    media_type=upstream.headers.get("content-type", "application/json"),
                    headers={"Cache-Control": "no-store"})
                result.raw_headers.extend((key, value) for key, value in response.raw_headers if key.lower() == b"set-cookie")
                return result
    except httpx.HTTPError:
        raise ApiError(503, "voice_unavailable", "Local voice is unavailable. Use device voice.") from None
