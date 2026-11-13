from collections import defaultdict, deque
from contextlib import asynccontextmanager
import time
import httpx
from fastapi import Request
from starlette.responses import JSONResponse
from .errors import VoiceError


async def account(request: Request) -> str:
    config = request.app.state.settings
    if request.headers.get("x-aether-voice") != "1" or request.headers.get("origin") not in (None, *config.origins):
        raise VoiceError(403, "voice_origin", "The voice request origin is not allowed.")
    cookie = request.headers.get("cookie", "")
    if not cookie:
        raise VoiceError(401, "not_authenticated", "Log in to Aether to use API voice.")
    try:
        # A fresh client prevents cookies from one user's request leaking into another.
        async with httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False,
                                     transport=request.app.state.auth_transport) as client:
            response = await client.get(f"{config.auth_origin}/api/v1/auth/me", headers={"Cookie": cookie})
        if response.status_code in (401, 403):
            raise VoiceError(401, "not_authenticated", "Log in to Aether again.")
        if response.status_code != 200:
            raise ValueError()
        user = response.json()["user"]["user_id"]
        if not isinstance(user, str) or not user:
            raise ValueError()
        return user
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise VoiceError(503, "voice_auth_unavailable", "The account server is unavailable.") from None


class Quota:
    def __init__(self):
        self.requests = defaultdict(deque)
        self.active = 0

    @asynccontextmanager
    async def claim(self, user):
        now = time.monotonic()
        for key in list(self.requests):
            while self.requests[key] and self.requests[key][0] < now - 60:
                self.requests[key].popleft()
            if not self.requests[key]:
                del self.requests[key]
        if self.active >= 2 or len(self.requests[user]) >= 10:
            raise VoiceError(429, "voice_quota", "Too many voice requests. Wait a minute.", 60)
        self.requests[user].append(now)
        self.active += 1
        try:
            yield
        finally:
            self.active -= 1


class BodyLimit:
    """Bound the raw body before multipart parsing, including chunked uploads."""
    def __init__(self, app, limit=4 * 1024 * 1024 + 8192):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.limit:
                response = JSONResponse({"error": {"code": "voice_audio_size", "message": "Request too large."}}, 413)
                return await response(scope, receive, send)
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
        await self.app(scope, replay, send)
