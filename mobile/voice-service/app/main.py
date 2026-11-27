import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.routes import router, MAX_BODY
from app.speech_provider import VoiceError, provider

@asynccontextmanager
async def lifespan(app):
    threading.Thread(target=provider.load, daemon=True).start()
    yield

app = FastAPI(title="Aether Local Voice", lifespan=lifespan)
app.include_router(router)

class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_BODY:
                return await JSONResponse({"error": {"code": "request_too_large", "message": "Maximum upload is 2 MiB."}}, status_code=413)(scope, receive, send)
            if not message.get("more_body", False):
                break
        delivered = False
        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}
        await self.app(scope, replay, send)

app.add_middleware(BodyLimit)

@app.exception_handler(VoiceError)
async def voice_error(request: Request, error: VoiceError):
    return JSONResponse({"error": {"code": error.code, "message": error.message}}, status_code=error.status)

@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    return JSONResponse({"error": {"code": "invalid_request", "message": "Check text, lang and speed."}}, status_code=422)

@app.exception_handler(Exception)
async def inference_error(request: Request, error: Exception):
    return JSONResponse({"error": {"code": "voice_failed", "message": "Local voice could not complete this request."}}, status_code=503)
