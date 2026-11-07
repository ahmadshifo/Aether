"""Canonical FastAPI entry point; importing the app never connects externally."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from threading import Lock

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.errors import LOGGER, error_response, install_handlers
from api.routes import router
from api.settings import ApiSettings


def create_app(settings=None, *, clock=None) -> FastAPI:
    settings = ApiSettings.from_env() if settings is None else settings

    @asynccontextmanager
    async def lifespan(application):
        try:
            yield
        finally:
            if application.state.database is not None:
                application.state.database.close()
                application.state.database = None

    application = FastAPI(title="Aether Multimedia API", version="1.0.0", lifespan=lifespan,
                          description="Private frame search, timeline and JPEG retrieval. Sign in through the existing account service; owned sessions are required. /health is process liveness only.")
    application.state.settings = settings
    application.state.clock = (lambda: datetime.now(UTC)) if clock is None else clock
    application.state.database = None
    application.state.database_lock = Lock()
    install_handlers(application)

    @application.middleware("http")
    async def safe_responses(request, call_next):
        try:
            response = await call_next(request)
        except Exception as error:
            # Never stringify the exception: it can contain SQL parameters,
            # provider bodies, request values or private paths.
            LOGGER.error("Multimedia request failed (%s).", type(error).__name__)
            response = error_response(500, "internal_error", "An internal service error occurred.")
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    # Outermost user middleware keeps CORS headers on controlled error responses.
    application.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_credentials=True,
                               allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Accept"])
    application.include_router(router)
    return application


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=app.state.settings.host, port=app.state.settings.port)
