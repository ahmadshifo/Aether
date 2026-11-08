"""Canonical FastAPI entry point; importing the app never connects externally."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from threading import Lock

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.errors import LOGGER, error_response, install_handlers
from api.routes import router
from api.settings import ApiSettings


def _start_live(application):
    """Phone streams are read automatically (processing/live_service.py). Failures never stop the API."""
    from database.connection import Database
    from database.repository import FrameRepository
    from processing.live_service import build_live
    import logging
    # Show "live ingestion started/stopped" lines in the npm start terminal (uvicorn leaves the root logger bare).
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        with application.state.database_lock:
            if application.state.database is None:
                application.state.database = Database()
        repository = FrameRepository.from_database(application.state.database)
        manager, keeper = build_live(repository, application.state.memory)
        application.state.keeper = keeper
        application.state.live = manager.start()
        LOGGER.info("Live ingestion on: watching MediaMTX for live/<session_id> streams.")
    except Exception as error:
        LOGGER.error("Live ingestion not started (%s).", type(error).__name__)


def create_app(settings=None, *, clock=None, live=None) -> FastAPI:
    from processing.frame_memory import FrameMemory
    from processing.live_service import switch
    # The service itself reads phone streams; tests that pass their own settings do not.
    live = (settings is None and switch("MULTIMEDIA_INGEST")) if live is None else live
    settings = ApiSettings.from_env() if settings is None else settings

    @asynccontextmanager
    async def lifespan(application):
        if live:
            _start_live(application)
        try:
            yield
        finally:
            if application.state.live is not None:
                application.state.live.stop()
                application.state.live = None
            if application.state.database is not None:
                application.state.database.close()
                application.state.database = None

    application = FastAPI(title="Aether Multimedia API", version="1.0.0", lifespan=lifespan,
                          description="Private frame search, timeline and JPEG retrieval. Sign in through the existing account service; owned sessions are required. /health is process liveness only.")
    application.state.settings = settings
    application.state.clock = (lambda: datetime.now(UTC)) if clock is None else clock
    application.state.database = None
    application.state.database_lock = Lock()
    # Live frames (blurred) for 2 minutes; only frames saved by the pipeline or /frames/keep reach MySQL.
    application.state.memory = FrameMemory()
    application.state.live = None
    application.state.keeper = None
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
