from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import Settings
from .errors import VoiceError
from .routes import router
from .security import BodyLimit, Quota
from .speech_provider import SpeechProvider


def create_app(settings: Settings | None = None, *, provider_transport=None, auth_transport=None):
    config = settings or Settings.load()
    app = FastAPI(title="Aether Voice Service", version="1.0.0")
    app.state.settings = config
    app.state.provider = SpeechProvider(config, provider_transport)
    app.state.auth_transport = auth_transport
    app.state.quota = Quota()
    app.add_middleware(BodyLimit)
    app.add_middleware(CORSMiddleware, allow_origins=list(config.origins), allow_credentials=True,
                       allow_methods=["POST", "GET"], allow_headers=["Content-Type", "X-Aether-Voice"])

    @app.exception_handler(VoiceError)
    async def voice_error(_request: Request, error: VoiceError):
        headers = {"Cache-Control": "no-store"}
        if error.retry_after:
            headers["Retry-After"] = str(error.retry_after)
        return JSONResponse({"error": {"code": error.code, "message": error.message}}, error.status, headers=headers)

    @app.get("/health")
    async def health():
        ready = config.audio_ready
        return {"service": "aether-voice", "status": "ok", "languages": ["en", "ar", "fr"],
                "configured": bool(config.groq_key and config.gemini_key and ready),
                "stt": {"provider": "groq", "model": config.stt_model, "configured": bool(config.groq_key)},
                "tts": {"provider": "gemini", "model": config.tts_model, "configured": bool(config.gemini_key)},
                "audio_ready": ready, "provider_verified": False}

    app.include_router(router)
    return app


app = create_app()
