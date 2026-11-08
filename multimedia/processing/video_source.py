"""Member 3: one frame-reading interface for a local MP4 test video or Member 1's MediaMTX RTSP stream.

Both sources yield Task 3 ExtractedFrame objects, so FrameSelector and the pipeline do not care
where frames come from. Live frames are timed with the wall clock (ms since the stream opened)
and stamped with a UTC capture time.
"""

import math
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import cv2
from dotenv import dotenv_values

from .frame_extractor import ExtractedFrame, FrameExtractor

ENV_FILE = Path(__file__).resolve().parents[1] / "api" / ".env"
DEFAULT_RTSP_TEMPLATE = "rtsp://localhost:8554/live/SESSION_ID"

# TCP keeps RTSP frames intact on Wi-Fi; UDP drops packets and smears images.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")


def rtsp_url_for(session_id) -> str:
    """The processor URL from media-v1.yaml: rtsp://MEDIA_HOST:8554/live/{session_id}."""
    session = str(UUID(str(session_id)))
    template = os.environ.get("RTSP_STREAM_URL")
    if not template:
        try:
            template = dotenv_values(ENV_FILE, interpolate=False).get("RTSP_STREAM_URL")
        except Exception:
            template = None
    template = template or DEFAULT_RTSP_TEMPLATE
    if "SESSION_ID" not in template:
        raise ValueError("RTSP_STREAM_URL must contain SESSION_ID, e.g. rtsp://localhost:8554/live/SESSION_ID.")
    return template.replace("SESSION_ID", session)


def _utc_iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class RTSPFrameSource:
    """Reads a live RTSP stream and yields about one frame per `interval` seconds.

    Every frame is read (so the decoder never falls behind), but only sampled frames are yielded.
    Iteration ends when the phone stops publishing (several failed reads in a row) or `stop()`
    is called from another thread.
    """

    def __init__(self, url: str, interval: float = 1.0, max_failed_reads: int = 50,
                 open_timeout_seconds: float = 10.0, capture_factory=None):
        if not math.isfinite(interval) or interval <= 0:
            raise ValueError("interval must be a finite positive number of seconds.")
        self.url = url
        self.interval = float(interval)
        self.max_failed_reads = int(max_failed_reads)
        self.open_timeout_ms = int(open_timeout_seconds * 1000)
        self._capture_factory = capture_factory or self._open_capture
        self._capture = None
        self._stopped = False
        self.frames_read = 0
        self.frames_yielded = 0

    def _open_capture(self, url):
        return cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, self.open_timeout_ms,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC, self.open_timeout_ms,
        ])

    def stop(self):
        self._stopped = True

    def release(self):
        if self._capture is not None:
            self._capture.release()
            self._capture = None

    def __enter__(self):
        self._capture = self._capture_factory(self.url)
        if self._capture is None or not self._capture.isOpened():
            self.release()
            raise ConnectionError("Could not open the RTSP stream; is the phone publishing to MediaMTX?")
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.release()

    def frames(self):
        if self._capture is None:
            raise RuntimeError("Use RTSPFrameSource inside a with block.")
        started = time.monotonic()
        next_due = 0.0
        failures = 0
        while not self._stopped:
            ok, image = self._capture.read()
            if not ok or image is None:
                failures += 1
                if failures >= self.max_failed_reads:
                    return
                time.sleep(0.02)
                continue
            failures = 0
            index = self.frames_read
            self.frames_read += 1
            elapsed = time.monotonic() - started
            if elapsed + 1e-9 < next_due:
                continue
            next_due = (math.floor(elapsed / self.interval) + 1) * self.interval
            self.frames_yielded += 1
            yield ExtractedFrame(self.url, index, elapsed * 1000, image, _utc_iso(datetime.now(UTC)))


class LocalVideoSource:
    """The same interface over a local MP4 (Task 3), for tests and demos without a phone."""

    def __init__(self, path, interval: float = 1.0, recording_start: datetime | None = None):
        self._extractor = FrameExtractor(path, interval, recording_start=recording_start or datetime.now(UTC))

    def stop(self):
        self._extractor.max_frames = self._extractor.frames_extracted or 1

    def __enter__(self):
        self._extractor.__enter__()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self._extractor.__exit__(exc_type, exc_value, traceback)

    def frames(self):
        yield from self._extractor.extract_frames()
