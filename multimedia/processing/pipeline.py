"""Member 3: orchestrate frame extraction, quality filtering, face blurring, memory and persistence.

Live flow (no AI calls, no database):
    MediaMTX RTSP -> RTSPFrameSource (1 frame/s) -> FrameSelector (skip blurry/duplicate)
    -> FaceBlurrer (YuNet) -> FrameMemory (RAM, last 2 minutes)

Saving flow (only for frames an answer used, via POST /api/v1/frames/keep):
    FrameMemory -> Mistral OCR + one OpenAI vision call + text embedding -> FrameRepository
    (MySQL row + JPEG in RustFS or on disk)

StreamWatcher asks MediaMTX's local API which `live/<session_id>` streams are publishing and runs
one SessionIngest per stream, so the phone needs no extra call: starting the camera is enough.
"""

import json
import logging
import os
import re
import threading
import urllib.request
from dataclasses import dataclass
from uuid import UUID

from .frame_selector import FrameSelector
from .video_source import RTSPFrameSource, rtsp_url_for

log = logging.getLogger("multimedia.pipeline")
LIVE_PATH = re.compile(r"^live/([0-9a-fA-F-]{36})$")
DEFAULT_MEDIAMTX_API = "http://127.0.0.1:9997"


@dataclass
class IngestStats:
    sampled: int = 0
    accepted: int = 0
    remembered: int = 0
    faces_blurred: int = 0
    dropped_blur_failed: int = 0


class FrameAnalyzer:
    """Runs the pretrained services on one frame and saves it. A failed service leaves its field
    empty instead of losing the frame; nothing is invented."""

    def __init__(self, repository, ocr=None, vision=None, embedder=None):
        self.repository = repository
        self.ocr, self.vision, self.embedder = ocr, vision, embedder

    def analyze_and_save(self, session_id: UUID, frame, frame_id=None) -> UUID:
        image = frame.frame
        ocr_text, objects, caption, embedding, model = "", [], "", None, None
        if self.ocr is not None:
            try:
                ocr_text = self.ocr.extract_text(image).text
            except Exception as error:
                log.warning("OCR skipped for a frame: %s", type(error).__name__)
        if self.vision is not None:
            try:
                result = self.vision.analyze_image(image)
                objects, caption = list(result.objects), result.caption
            except Exception as error:
                log.warning("Vision skipped for a frame: %s", type(error).__name__)
        if self.embedder is not None:
            try:
                result = self.embedder.embed_frame(ocr_text, objects, caption)
                if result is not None:
                    embedding, model = result.embedding, result.model
            except Exception as error:
                log.warning("Embedding skipped for a frame: %s", type(error).__name__)
        return self.repository.save_frame(
            session_id, frame.captured_at, image, ocr_text, objects, caption, embedding, model,
            frame_id=frame_id, source_frame_index=frame.frame_index, video_timestamp_ms=frame.timestamp_ms)


class SessionIngest:
    """One reader thread per live session: select useful frames, blur faces, remember them in RAM."""

    def __init__(self, session_id, memory, source=None, selector=None, blurrer=None, interval: float = 1.0):
        self.session_id = UUID(str(session_id))
        self.memory = memory
        self.source = source or RTSPFrameSource(rtsp_url_for(self.session_id), interval)
        self.selector = selector or FrameSelector()
        self.blurrer = blurrer
        self.stats = IngestStats()
        self._thread = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self):
        self._thread = threading.Thread(target=self._read, name=f"read-{self.session_id}", daemon=True)
        self._thread.start()
        return self

    def stop(self):
        self.source.stop()

    def join(self, timeout=None):
        if self._thread is not None:
            self._thread.join(timeout)

    def _remember(self, frame):
        image = frame.frame
        if self.blurrer is not None:
            try:
                image, faces = self.blurrer.blur(image)
                self.stats.faces_blurred += faces
            except Exception as error:
                # Fail safe: a frame whose faces could not be checked is never kept.
                self.stats.dropped_blur_failed += 1
                log.warning("Session %s: frame dropped, face blur failed (%s)", self.session_id, type(error).__name__)
                return
        self.memory.add(self.session_id, image, frame.captured_at, frame.frame_index, frame.timestamp_ms)
        self.stats.remembered += 1

    def _read(self):
        try:
            with self.source as source:
                log.info("Session %s: reading live video", self.session_id)
                for frame in source.frames():
                    self.stats.sampled += 1
                    if self.selector.evaluate(frame).accepted:
                        self.stats.accepted += 1
                        self._remember(frame)
        except Exception as error:
            log.warning("Session %s: video reading stopped (%s)", self.session_id, type(error).__name__)
        log.info("Session %s: stopped; %s", self.session_id, self.stats)


def live_sessions(api_url: str | None = None, timeout: float = 2.0) -> set[UUID]:
    """Session IDs whose `live/<id>` stream is currently publishing in MediaMTX."""
    base = (api_url or os.environ.get("MEDIAMTX_API_URL") or DEFAULT_MEDIAMTX_API).rstrip("/")
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


class StreamWatcher:
    """Starts ingestion when a phone starts publishing and stops it when the stream ends."""

    def __init__(self, make_ingest, poll_seconds: float = 2.0, list_sessions=live_sessions):
        self.make_ingest = make_ingest
        self.poll_seconds = poll_seconds
        self.list_sessions = list_sessions
        self.active: dict[UUID, SessionIngest] = {}
        self._stop = threading.Event()
        self._thread = None
        self.mediamtx_reachable = False

    def poll_once(self):
        try:
            live = self.list_sessions()
            self.mediamtx_reachable = True
        except Exception:
            if self.mediamtx_reachable:
                log.warning("MediaMTX API is not reachable; waiting for the video server.")
            self.mediamtx_reachable = False
            live = set()
        for session_id, ingest in list(self.active.items()):
            if not ingest.running:
                del self.active[session_id]
            elif session_id not in live:
                ingest.stop()
        for session_id in live - set(self.active):
            self.active[session_id] = self.make_ingest(session_id).start()

    def _loop(self):
        while not self._stop.is_set():
            self.poll_once()
            self._stop.wait(self.poll_seconds)

    def start(self):
        self._thread = threading.Thread(target=self._loop, name="stream-watcher", daemon=True)
        self._thread.start()
        return self

    def stop(self, timeout: float = 5.0):
        self._stop.set()
        for ingest in self.active.values():
            ingest.stop()
        for ingest in self.active.values():
            ingest.join(timeout)
        if self._thread is not None:
            self._thread.join(timeout)


def build_analyzer(repository, analysis: bool = True) -> FrameAnalyzer:
    """Real services from api/.env; with analysis=False frames are saved without AI calls."""
    ocr = vision = embedder = None
    if analysis:
        from .embedding_service import EmbeddingService
        from .object_detector import VisionService
        from .ocr_service import OCRService
        ocr, vision, embedder = OCRService(), VisionService(), EmbeddingService()
    return FrameAnalyzer(repository, ocr, vision, embedder)


def build_watcher(memory, blur: bool = True) -> StreamWatcher:
    blurrer = None
    if blur:
        from .face_blur import FaceBlurrer
        blurrer = FaceBlurrer()
    return StreamWatcher(lambda session_id: SessionIngest(session_id, memory, blurrer=blurrer))
