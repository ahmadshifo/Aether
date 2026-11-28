"""Member 2: FastAPI server for /api/v1/ask, /api/v1/questions and the dashboard status API."""

from contextlib import asynccontextmanager
import asyncio
from contextlib import suppress
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.auth import ApiError, init_db, router as auth_router
from app.depth import MAX_ASK_BYTES
from app.history import init_history_table, router as history_router
from app.routes import router as ask_router
from app.alerts import router as alerts_router
from app.caregiver import init_caregiver_tables, router as caregiver_router
from app.safety import init_safety_tables, router as safety_router
from app.status import router as status_router
from app.streams import router as streams_router
from app.summary import router as summary_router
from app.voice import router as voice_router
from app.live_voice import router as live_voice_router, init_calls, maintain_calls, calls, end


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    init_history_table()
    init_safety_tables()
    init_caregiver_tables()
    init_calls()
    maintenance = asyncio.create_task(maintain_calls())
    try:
        yield
    finally:
        maintenance.cancel()
        with suppress(asyncio.CancelledError):
            await maintenance
        for call in list(calls.values()):
            await end(call, 'server_stopped')


app = FastAPI(title="Web AI Service", lifespan=lifespan)


class BoundAskBody:
    """Timestamp before reading the body/auth and bound snapshot memory, including chunked uploads."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != "/api/v1/ask" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        scope.setdefault("state", {})["ask_arrival"] = datetime.now(UTC)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > MAX_ASK_BYTES:
                response = JSONResponse({"error": {"code": "request_too_large", "message": "Question payload too large."}},
                                        status_code=413)
                return await response(scope, receive, send)
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        async def replay():
            nonlocal body
            if body is None:
                return await receive()
            message = {"type": "http.request", "body": bytes(body), "more_body": False}
            body = None
            return message
        return await self.app(scope, replay, send)


app.add_middleware(BoundAskBody)
app.include_router(auth_router)
app.include_router(streams_router)
app.include_router(history_router)
app.include_router(status_router)
app.include_router(ask_router)
app.include_router(safety_router)
app.include_router(summary_router)
app.include_router(alerts_router)
app.include_router(caregiver_router)
app.include_router(voice_router)
app.include_router(live_voice_router)


@app.exception_handler(ApiError)
async def api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
    field = ".".join(str(part) for part in exc.errors()[0]["loc"][1:]) or "body"
    return JSONResponse(
        {"error": {"code": "invalid_request", "message": f"Missing or invalid field: {field}."}}, status_code=422
    )
