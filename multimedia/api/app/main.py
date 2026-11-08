"""Member 3: FastAPI entry point for the frame listing, image retrieval, search and health endpoints.

On startup it also starts live ingestion: when a phone publishes `live/<session_id>` to MediaMTX,
frames are read over RTSP, filtered, face-blurred and kept in RAM for 2 minutes (no AI calls, no
database). Frames are saved and analyzed only when an answer used them (POST /api/v1/frames/keep).
Switches in api/.env (default on):
  MULTIMEDIA_INGEST       read live video from MediaMTX
  MULTIMEDIA_FACE_BLUR    blur faces with YuNet before frames are kept anywhere
  MULTIMEDIA_AI_ANALYSIS  OCR/caption/embedding when saving, and meaning-based history search
"""

import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import dotenv_values
from fastapi import FastAPI

MULTIMEDIA_ROOT = Path(__file__).resolve().parents[2]
if str(MULTIMEDIA_ROOT) not in sys.path:
    sys.path.insert(0, str(MULTIMEDIA_ROOT))  # uvicorn runs from multimedia/api; packages live one level up.

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("multimedia.api")


def _switch(name: str, default: str = "on") -> bool:
    values = dotenv_values(MULTIMEDIA_ROOT / "api" / ".env", interpolate=False)
    value = os.environ.get(name, values.get(name, default)) or default
    return value.strip().lower() not in ("off", "false", "0", "no")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from processing.frame_memory import FrameMemory
    from processing.pipeline import build_analyzer, build_watcher
    from .search_service import SearchService

    analysis = _switch("MULTIMEDIA_AI_ANALYSIS")
    memory = FrameMemory()
    executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="keep")
    database = repository = watcher = embedder = None
    app.state.ingest = "off"
    app.state.memory, app.state.keeper = memory, executor.submit
    try:
        from database.connection import Database
        from database.repository import FrameRepository
        database = Database()
        database.check()
        repository = FrameRepository.from_database(database)
    except Exception as error:
        log.error("Saved frames unavailable (history, timeline and keep will answer 503): %s", error)
    if analysis:
        from processing.embedding_service import EmbeddingService
        embedder = EmbeddingService()
    app.state.repository = repository
    app.state.analyzer = build_analyzer(repository, analysis) if repository is not None else None
    app.state.search = SearchService(repository, memory, embedder)
    if _switch("MULTIMEDIA_INGEST"):
        try:
            watcher = build_watcher(memory, blur=_switch("MULTIMEDIA_FACE_BLUR")).start()
            app.state.ingest = "on"
            log.info("Live ingestion on: watching MediaMTX for live/<session_id> streams")
        except Exception as error:
            app.state.ingest = "error"
            log.error("Live ingestion not started: %s", error)
    app.state.watcher = watcher
    yield
    if watcher is not None:
        watcher.stop()
    executor.shutdown(wait=True)
    if database is not None:
        database.close()


app = FastAPI(title="Multimedia Memory Service", lifespan=lifespan)

from .routes import install_error_handlers, router  # noqa: E402  (needs sys.path set above)

app.include_router(router)
install_error_handlers(app)


@app.get("/health")
def health():
    watcher = getattr(app.state, "watcher", None)
    storage = getattr(app.state, "repository", None) is not None
    return {
        "status": "online" if storage and app.state.ingest != "error" else "error",
        "storage": "online" if storage else "error",
        "ingest": app.state.ingest,
        "mediamtx": None if watcher is None else watcher.mediamtx_reachable,
        "live_sessions": [] if watcher is None else [str(s) for s in watcher.active],
        "frames_in_memory": app.state.memory.count(),
    }
