"""Automatic live ingestion: the phone presses Start and the server does the rest.

Built on Task 14's LiveMultimediaRunner and RTSPFrameSource (capture subprocess, reconnects, bounded
queue) and Task 13's MultimediaPipeline (selection, OCR, vision, embedding, storage):

    MediaMTX live/<session_id> --(auto-detected)--> LiveMultimediaRunner
        each sampled frame (1/s) --> YuNet face blur --> FrameMemory (RAM, last 2 minutes)
        every LIVE_SAVE_EVERY_SECONDS --> MultimediaPipeline (skip blurry/duplicate, analyze, save 24 h)
    POST /api/v1/frames/keep --> the frames an answer used are analyzed and saved too

Without API keys (or with MULTIMEDIA_AI_ANALYSIS=off) the pipeline uses "no-AI" services that return
empty text and an uncertain empty caption: frames and images are still stored, nothing is invented.
"""

import json
import logging
import os
import re
import threading
import urllib.request
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from dotenv import dotenv_values

from processing.object_detector import VisionResult
from processing.ocr_service import OCRResult
from processing.pipeline import FrameOutcome, MultimediaPipeline

log = logging.getLogger("multimedia.live")
ENV_FILE = Path(__file__).resolve().parents[1] / "api" / ".env"
LIVE_PATH = re.compile(r"^live/([0-9a-fA-F-]{36})$")


def setting(name: str, default: str) -> str:
    try:
        values = dotenv_values(ENV_FILE, interpolate=False)
    except Exception:
        values = {}
    value = os.environ.get(name, values.get(name, default))
    return default if value is None else str(value).strip()


def switch(name: str, default: str = "on") -> bool:
    return setting(name, default).lower() not in ("off", "false", "0", "no")


# ---------- analysis services ----------

class NoAIOCR:
    def extract_text(self, image):
        return OCRResult(text="", model="none", has_text=False, raw_markdown="")


class NoAIVision:
    def analyze_image(self, image):
        return VisionResult(objects=[], caption="", model="none", uncertain=True)


class NoAIEmbedding:
    def embed_frame(self, ocr_text=None, objects=None, caption=None):
        return None  # Never reached: empty metadata skips embedding.

    def embed_query(self, query):
        raise RuntimeError("No embedding service without an OpenAI key.")


def ai_available() -> bool:
    return (switch("MULTIMEDIA_AI_ANALYSIS") and bool(setting("OPENAI_API_KEY", ""))
            and bool(setting("MISTRAL_API_KEY", "")))


def analysis_services():
    """(ocr, vision, embedding, real) — real pretrained services only when both keys are configured."""
    if ai_available():
        from processing.embedding_service import EmbeddingService
        from processing.object_detector import VisionService
        from processing.ocr_service import OCRService
        return OCRService(), VisionService(), EmbeddingService(), True
    return NoAIOCR(), NoAIVision(), NoAIEmbedding(), False


# ---------- per-session pipeline ----------

class CombinedLivePipeline:
    """What LiveMultimediaRunner calls for every sampled frame."""

    def __init__(self, inner: MultimediaPipeline, memory, blurrer=None, save_every_seconds: float = 15.0,
                 clock=lambda: datetime.now(UTC)):
        self.inner, self.memory, self.blurrer = inner, memory, blurrer
        self.save_every = float(save_every_seconds)
        self.clock = clock
        self.selector = inner.selector  # the runner resets it per session
        self.mocked = inner.mocked
        self._last_save = None
        self.faces_blurred = 0

    def process_live_frame(self, image, session_id, *, captured_at, source_frame_index, elapsed_ms, dry_run=False):
        if self.blurrer is not None:
            try:
                image, faces = self.blurrer.blur(image)
                self.faces_blurred += faces
            except Exception as error:
                # Fail safe: a frame whose faces could not be checked is never kept or sent anywhere.
                return FrameOutcome(source_frame_index, None, status="failed", error_stage="face_blur",
                                    error_type=type(error).__name__)
        remembered = self.memory.add(session_id, image, captured_at, source_frame_index, elapsed_ms)
        if getattr(remembered, "frozen", False):
            # The phone keeps sending one unchanged picture: saving it again would only store copies.
            return FrameOutcome(source_frame_index, None, selection_reason="frozen_video")
        now = self.clock()
        if self._last_save is not None and (now - self._last_save).total_seconds() < self.save_every:
            return FrameOutcome(source_frame_index, None, selection_reason="kept_in_memory")
        outcome = self.inner.process_live_frame(image, session_id, captured_at=captured_at,
                                                source_frame_index=source_frame_index, elapsed_ms=elapsed_ms,
                                                dry_run=dry_run)
        if outcome.frame_id:
            self._last_save = now
        return outcome


def keep_frames(inner: MultimediaPipeline, frames) -> list[str]:
    """Analyze and save frames an answer used, under their memory frame_id (no duplicate/blur filter:
    the answer already relied on them). An AI failure stores empty metadata rather than losing the image."""
    from database.errors import DuplicateFrameError
    from processing.caption_service import get_caption
    from processing.embedding_service import build_frame_description
    saved = []
    for item in frames:
        image = item.frame
        text, objects, caption, vector, model = "", [], "", None, None
        try:
            text = inner.ocr.extract_text(image).text
        except Exception as error:
            log.warning("Kept frame without OCR (%s)", type(error).__name__)
        try:
            vision = inner.vision.analyze_image(image)
            objects, caption = list(vision.objects), get_caption(vision)
        except Exception as error:
            log.warning("Kept frame without vision (%s)", type(error).__name__)
        if build_frame_description(text, objects, caption):
            try:
                result = inner.embedding.embed_frame(ocr_text=text, objects=objects, caption=caption)
                if result is not None:
                    vector, model = result.embedding, result.model
            except Exception as error:
                log.warning("Kept frame without embedding (%s)", type(error).__name__)
        try:
            inner.repository.save_frame(item.session_id, item.captured_at, image, ocr_text=text, objects=objects,
                                        caption=caption, embedding=vector, embedding_model=model,
                                        frame_id=item.frame_id, source_frame_index=item.frame_index)
            saved.append(str(item.frame_id))
        except DuplicateFrameError:
            saved.append(str(item.frame_id))
        except Exception as error:
            log.error("Kept frame %s was not saved (%s)", item.frame_id, type(error).__name__)
    return saved


# ---------- automatic start/stop ----------

def live_sessions(api_url: str | None = None, timeout: float = 2.0) -> set[UUID]:
    """Session IDs whose `live/<id>` stream is publishing in MediaMTX (API enabled by npm start)."""
    base = (api_url or setting("MEDIAMTX_API_URL", "http://127.0.0.1:9997")).rstrip("/")
    with urllib.request.urlopen(f"{base}/v3/paths/list?itemsPerPage=1000", timeout=timeout) as response:
        items = json.load(response).get("items") or []
    sessions = set()
    for item in items:
        match = LIVE_PATH.match(str(item.get("name", "")))
        if match and item.get("ready"):
            try:
                sessions.add(UUID(match.group(1)))
            except ValueError:
                pass
    return sessions


class LiveIngestManager:
    """Polls MediaMTX; one LiveMultimediaRunner per publishing session, stopped when the stream ends."""

    def __init__(self, make_runner, poll_seconds: float = 2.0, list_sessions=live_sessions):
        self.make_runner, self.poll_seconds, self.list_sessions = make_runner, poll_seconds, list_sessions
        self.active = {}
        self.mediamtx_reachable = False
        self._stop = threading.Event()
        self._thread = None

    @staticmethod
    def _running(runner) -> bool:
        thread = getattr(runner, "_coordinator", None)
        return thread is not None and thread.is_alive()

    def poll_once(self):
        try:
            live = self.list_sessions()
            self.mediamtx_reachable = True
        except Exception:
            self.mediamtx_reachable = False
            live = set()
        for session_id, runner in list(self.active.items()):
            if not self._running(runner):
                del self.active[session_id]  # finished or failed: restarted below if still live
            elif session_id not in live:
                runner.stop("stream_ended")
        for session_id in live - set(self.active):
            try:
                self.active[session_id] = self.make_runner(session_id).start()
                log.info("Session %s: live ingestion started", session_id)
            except Exception as error:
                log.error("Session %s: live ingestion could not start (%s)", session_id, type(error).__name__)

    def _loop(self):
        while not self._stop.is_set():
            self.poll_once()
            self._stop.wait(self.poll_seconds)

    def start(self):
        self._thread = threading.Thread(target=self._loop, name="aether-live-watcher", daemon=True)
        self._thread.start()
        return self

    def stop(self, timeout: float = 10.0):
        self._stop.set()
        for runner in self.active.values():
            runner.stop("shutdown")
        for runner in self.active.values():
            try:
                runner.wait(timeout)
            except Exception:
                pass
        if self._thread is not None:
            self._thread.join(timeout)


def build_live(repository, memory):
    """(manager, inner pipeline) wired from api/.env; the manager is not started yet."""
    from processing.face_blur import FaceBlurrer
    from processing.live_runner import LiveMultimediaRunner
    from processing.live_settings import LiveSettings, StreamSettings
    from processing.live_stream import RTSPFrameSource
    ocr, vision, embedding, real = analysis_services()
    blurrer = FaceBlurrer() if switch("MULTIMEDIA_FACE_BLUR") else None
    save_every = float(setting("LIVE_SAVE_EVERY_SECONDS", "15"))
    # A phone session runs until Stop; the Task 14 test limits are for the manual runner only.
    live_settings = replace(LiveSettings.from_env(), duration_seconds=86400, max_accepted_frames=10000)
    stream_settings = StreamSettings.from_env()
    keeper = MultimediaPipeline(ocr_service=ocr, vision_service=vision, embedding_service=embedding,
                                repository=repository, mocked=not real)

    def make_runner(session_id):
        inner = MultimediaPipeline(ocr_service=ocr, vision_service=vision, embedding_service=embedding,
                                   repository=repository, mocked=not real)
        pipeline = CombinedLivePipeline(inner, memory, blurrer, save_every)
        return LiveMultimediaRunner(stream_source=RTSPFrameSource(session_id, settings=stream_settings),
                                    pipeline=pipeline, settings=live_settings, dry_run=False)

    log.info("Live ingestion ready (AI analysis: %s, face blur: %s, save every %ss)",
             "on" if real else "off", "on" if blurrer else "off", save_every)
    return LiveIngestManager(make_runner), keeper
