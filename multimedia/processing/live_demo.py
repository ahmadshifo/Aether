"""Explicit synthetic decoded-frame source, never real camera observations."""

from datetime import UTC, datetime
import time

import numpy as np

from database.validation import as_uuid
from .live_stream import LiveFrame, StreamState


class SyntheticFrameSource:
    def __init__(self, session_id):
        self.session_id = as_uuid(session_id, "session_id")
        self.state = StreamState.DISCONNECTED
        self.decoded = 0

    def frames(self, stop):
        self.state = StreamState.CONNECTED
        rng = np.random.default_rng(42)
        sharp = rng.integers(0, 256, (96, 128, 3), dtype=np.uint8)
        changed = rng.integers(0, 256, (96, 128, 3), dtype=np.uint8)
        scenes = [sharp, sharp, np.full_like(sharp, 128), changed]
        start = time.monotonic()
        while not stop.is_set():
            now = time.monotonic()
            self.decoded += 1
            yield LiveFrame(self.session_id, self.decoded, scenes[int(now - start) % 4].copy(), datetime.now(UTC), now, 1)
            if stop.wait(1 / 15):
                break

    def snapshot(self):
        return {"state": str(self.state), "decoded_frames": self.decoded, "invalid_frames": 0,
                "connection_attempts": int(self.decoded > 0), "successful_reconnections": 0,
                "dimensions": [128, 96], "source": "synthetic_mock_frames"}

    def close(self):
        self.state = StreamState.STOPPED
