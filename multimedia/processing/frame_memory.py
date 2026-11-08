"""Short-term frame memory in the multimedia server's RAM (not the phone, not the database).

Live sessions keep only their recent useful frames (blurred, JPEG-compressed) for `window_seconds`.
Nothing here is analyzed by AI or written to MySQL/RustFS. A frame is stored permanently only when
the AI backend reports it as evidence for an answer (POST /api/v1/frames/keep). Everything else is
forgotten automatically; a service restart also forgets it.
"""

import threading
from collections import deque
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import cv2
import numpy as np

from .image_utils import encode_jpeg

# Mean grey-level change (0-255) between two small thumbnails below which the camera saw the same view.
# A still or covered camera makes the video repeat one frame exactly; real changes are far above this.
DUPLICATE_DIFFERENCE = 2.0
# Mean grey level (0-255) below which a frame shows almost nothing (lens covered, phone face down).
DARK_BRIGHTNESS = 30.0
# A working camera never gives the exact same picture for long: sensor noise changes it a little every frame.
# Exactly the same picture for this many seconds means the video froze (the phone keeps sending its last frame).
FROZEN_SECONDS = 5.0


def _thumbnail(image: np.ndarray) -> np.ndarray:
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY if image.shape[2] == 4 else cv2.COLOR_BGR2GRAY)
    return cv2.resize(image, (32, 18), interpolation=cv2.INTER_AREA).astype(np.float32)


@dataclass(frozen=True)
class MemoryFrame:
    frame_id: UUID
    session_id: UUID
    captured_at: datetime
    frame_index: int
    timestamp_ms: float
    jpeg: bytes = field(repr=False)
    # Same shape as stored records, so search and API code can treat both alike.
    caption: str = ""
    ocr_text: str = ""
    objects: tuple = ()
    brightness: float = 255.0
    signature: np.ndarray | None = field(default=None, repr=False, compare=False)
    identical_since: datetime | None = None  # start of the current run of exactly identical pictures

    @property
    def too_dark(self) -> bool:
        return self.brightness < DARK_BRIGHTNESS

    @property
    def frozen(self) -> bool:
        return self.identical_since is not None and (self.captured_at - self.identical_since).total_seconds() >= FROZEN_SECONDS

    @property
    def frame(self) -> np.ndarray:
        return cv2.imdecode(np.frombuffer(self.jpeg, np.uint8), cv2.IMREAD_COLOR)

    @property
    def source_frame_index(self) -> int:
        return self.frame_index

    @property
    def video_timestamp_ms(self) -> int:
        return int(self.timestamp_ms)


class FrameMemory:
    def __init__(self, window_seconds: float = 120.0, max_per_session: int = 150,
                 clock=lambda: datetime.now(UTC)):
        self.window = timedelta(seconds=window_seconds)
        self.max_per_session = int(max_per_session)
        self.clock = clock
        self._sessions: dict[UUID, deque] = {}
        self._lock = threading.Lock()

    def _prune(self, now):
        cutoff = now - self.window
        for session_id in list(self._sessions):
            frames = self._sessions[session_id]
            while frames and frames[0].captured_at < cutoff:
                frames.popleft()
            if not frames:
                del self._sessions[session_id]

    def add(self, session_id, image: np.ndarray, captured_at: datetime, frame_index: int = 0,
            timestamp_ms: float = 0.0) -> MemoryFrame:
        captured_at = datetime.fromisoformat(captured_at) if isinstance(captured_at, str) else captured_at
        captured_at, session_id = captured_at.astimezone(UTC), UUID(str(session_id))
        thumbnail = _thumbnail(image)
        with self._lock:
            self._prune(self.clock())
            frames = self._sessions.setdefault(session_id, deque(maxlen=self.max_per_session))
            last = frames[-1] if frames else None
            if (last is not None and last.signature is not None
                    and float(np.abs(thumbnail - last.signature).mean()) < DUPLICATE_DIFFERENCE):
                # Same view as the previous frame: refresh its time instead of keeping a copy, so an
                # answer never gets the same picture several times as different evidence.
                exact = bool(np.array_equal(thumbnail, last.signature))
                item = replace(last, captured_at=captured_at, frame_index=int(frame_index),
                               timestamp_ms=float(timestamp_ms),
                               identical_since=(last.identical_since or last.captured_at) if exact else None)
                frames[-1] = item
                return item
            item = MemoryFrame(uuid4(), session_id, captured_at, int(frame_index), float(timestamp_ms),
                               encode_jpeg(image), brightness=float(thumbnail.mean()), signature=thumbnail)
            frames.append(item)
        return item

    def frames(self, session_id, since: datetime | None = None) -> list[MemoryFrame]:
        """Newest first."""
        with self._lock:
            self._prune(self.clock())
            items = list(self._sessions.get(UUID(str(session_id)), ()))
        if since is not None:
            items = [item for item in items if item.captured_at >= since]
        return items[::-1]

    def get(self, frame_id) -> MemoryFrame | None:
        frame_id = UUID(str(frame_id))
        with self._lock:
            self._prune(self.clock())
            for frames in self._sessions.values():
                for item in frames:
                    if item.frame_id == frame_id:
                        return item
        return None

    def count(self) -> int:
        with self._lock:
            self._prune(self.clock())
            return sum(len(frames) for frames in self._sessions.values())
