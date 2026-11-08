"""Interruptible RTSP acquisition. Native VideoCapture lives in an owned child."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
import math
import multiprocessing as mp
import os
import queue
import threading
import time
from uuid import UUID, uuid4

import numpy as np

from database.validation import as_uuid
from .live_settings import StreamSettings


class StreamState(StrEnum):
    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    RECONNECTING = "RECONNECTING"
    STOPPING = "STOPPING"
    STOPPED = "STOPPED"
    FAILED = "FAILED"


class StreamError(RuntimeError):
    pass


@dataclass(frozen=True)
class LiveFrame:
    session_id: UUID
    sequence: int
    image: np.ndarray = field(repr=False, compare=False)
    arrived_at: datetime
    monotonic_time: float
    segment: int


def _open_capture(cv2, url, settings):
    """Native timeouts are optional; subprocess watchdog is always mandatory."""
    backend = cv2.CAP_FFMPEG
    params = []
    for name, seconds in (("CAP_PROP_OPEN_TIMEOUT_MSEC", settings.open_timeout_seconds),
                          ("CAP_PROP_READ_TIMEOUT_MSEC", settings.read_timeout_seconds)):
        value = getattr(cv2, name, None)
        if value is not None:
            params.extend([value, max(1, int(seconds * 1000))])
    capture = None
    try:
        capture = cv2.VideoCapture(url, backend, params) if params else cv2.VideoCapture(url, backend)
        if capture.isOpened():
            return capture, bool(params)
    except Exception:
        pass
    if capture is not None:
        capture.release()
    # Some FFmpeg builds reject the open-only timeout properties. Do not switch
    # to an arbitrary backend/transport; retain the killable process watchdog.
    capture = cv2.VideoCapture(url, backend)
    if not capture.isOpened():
        capture.release()
        raise StreamError("RTSP connection could not be opened or decoded.")
    return capture, False


def _capture_worker(url, settings, frames, control, decoded, invalid, stop):
    """Spawn target: acquisition only, never DB/AI, no credentials in stderr."""
    capture = None
    try:
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        os.environ["OPENCV_LOG_LEVEL"] = "SILENT"
        os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"
        # Native FFmpeg errors can contain authenticated URLs. Silence only this
        # dedicated child; send safe diagnostic codes through the control pipe.
        with open(os.devnull, "w") as devnull:
            os.dup2(devnull.fileno(), 2)
        import cv2
        from .image_utils import validate_image
        set_level = getattr(cv2, "setLogLevel", None)
        if callable(set_level):
            set_level(0)
        if not cv2.videoio_registry.hasBackend(cv2.CAP_FFMPEG):
            raise StreamError("FFmpeg backend unavailable.")
        capture, native_timeouts = _open_capture(cv2, url, settings)
        control.send(("opened", native_timeouts))
        failures = 0
        while not stop.is_set():
            success, image = capture.read()
            try:
                if not success:
                    raise ValueError()
                validate_image(image)
                if image.nbytes > 64 * 1024 * 1024:
                    raise ValueError()
            except (ValueError, TypeError):
                with invalid.get_lock():
                    invalid.value += 1
                failures += 1
                if failures >= 3:
                    raise StreamError("No valid decoded frames.")
                continue
            failures = 0
            with decoded.get_lock():
                decoded.value += 1
                sequence = decoded.value
            item = (sequence, image, datetime.now(UTC), time.monotonic())
            # Latest-only acquisition mailbox, independent of analysis queue.
            try:
                frames.put_nowait(item)
            except queue.Full:
                try:
                    frames.get_nowait()
                except queue.Empty:
                    pass
                try:
                    frames.put_nowait(item)
                except queue.Full:
                    pass
    except Exception as error:
        try:
            control.send(("failed", type(error).__name__))
        except (OSError, EOFError):
            pass
    finally:
        if capture is not None:
            capture.release()
        frames.cancel_join_thread()
        control.close()


class IsolatedCapture:
    """Small bounded IPC mailbox; parent can kill a stalled native read/open."""
    def __init__(self, url, settings):
        self.settings = settings
        context = mp.get_context("spawn")
        self.frames = context.Queue(maxsize=1)
        self.control, writer = context.Pipe(duplex=False)
        self.decoded = context.Value("Q", 0)
        self.invalid = context.Value("Q", 0)
        self.stop_event = context.Event()
        self.process = context.Process(target=_capture_worker, args=(url, settings, self.frames, writer,
                                      self.decoded, self.invalid, self.stop_event), daemon=True)
        self.process.start()
        writer.close()
        self.native_timeouts = None
        self.failure_code = None
        self.closed = False

    @property
    def decoded_count(self):
        return self.decoded.value

    @property
    def invalid_count(self):
        return self.invalid.value

    def open(self, stop):
        deadline = time.monotonic() + self.settings.open_timeout_seconds
        while not stop.is_set() and time.monotonic() < deadline:
            if self.control.poll(.05):
                try:
                    event, value = self.control.recv()
                except EOFError:
                    break
                if event == "opened":
                    self.native_timeouts = value
                    return
                self.failure_code = value
                break
            if not self.process.is_alive():
                break
        raise StreamError(f"RTSP connection failed, timed out, or was cancelled ({self.failure_code or 'deadline'}); private details suppressed.")

    def read(self, stop):
        deadline = time.monotonic() + self.settings.read_timeout_seconds
        while not stop.is_set() and time.monotonic() < deadline:
            try:
                return self.frames.get(timeout=.05)
            except queue.Empty:
                if not self.process.is_alive():
                    break
                if self.control.poll():
                    try:
                        event, _ = self.control.recv()
                    except EOFError:
                        break
                    if event == "failed":
                        break
        raise StreamError("No fresh decoded RTSP frame before the read deadline.")

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.stop_event.set()
        self.process.join(.2)
        if self.process.is_alive():
            self.process.terminate()
            self.process.join(1)
        if self.process.is_alive():
            self.process.kill()
            self.process.join(1)
        self.control.close()
        self.frames.cancel_join_thread()
        self.frames.close()
        self.process.close()


class RTSPFrameSource:
    """Same session across bounded reconnects; receiver arrival, not camera time."""
    def __init__(self, session_id=None, *, settings=None, host=None, port=None,
                 capture_factory=IsolatedCapture, clock=time.monotonic):
        self.session_id = as_uuid(uuid4() if session_id is None else session_id, "session_id")
        self.settings = settings if settings is not None else StreamSettings.from_env()
        self._url = self.settings.build_url(self.session_id, host=host, port=port)
        self._factory, self._clock = capture_factory, clock
        self._capture = None
        self._stop = threading.Event()
        self._lock = threading.RLock()
        self.state = StreamState.DISCONNECTED
        self.connection_attempts = self.successful_reconnections = self.segment = 0
        self._decoded = self._invalid = 0
        self.last_error = None
        self.last_arrival = None
        self.dimensions = None
        self.native_timeouts = None
        self._last_sequence = 0
        self._last_monotonic = None

    def __repr__(self):
        return f"RTSPFrameSource(session_id={self.session_id}, state={self.state})"

    def snapshot(self):
        with self._lock:
            return {"state": str(self.state), "connection_attempts": self.connection_attempts,
                    "successful_reconnections": self.successful_reconnections,
                    "decoded_frames": self._decoded + (self._capture.decoded_count if self._capture else 0),
                    "invalid_frames": self._invalid + (self._capture.invalid_count if self._capture else 0),
                    "last_arrival_at": self.last_arrival.isoformat().replace("+00:00", "Z") if self.last_arrival else None,
                    "dimensions": self.dimensions, "native_timeouts": self.native_timeouts,
                    "timeout_strategy": "isolated_process_watchdog", "last_error": self.last_error}

    def _disconnect(self):
        with self._lock:
            capture, self._capture = self._capture, None
        if capture is not None:
            capture.close()
            with self._lock:
                self._decoded += capture.decoded_count
                self._invalid += capture.invalid_count

    def connect(self, stop_event=None):
        stop = self._stop if stop_event is None else stop_event
        if stop.is_set() or self._stop.is_set():
            raise StreamError("Stream source is stopped.")
        self._disconnect()
        self.state = StreamState.CONNECTING if self.segment == 0 else StreamState.RECONNECTING
        self.connection_attempts += 1
        try:
            capture = self._factory(self._url, self.settings)
            with self._lock:
                self._capture = capture
            capture.open(stop)
            self.native_timeouts = capture.native_timeouts
            if self.segment:
                self.successful_reconnections += 1
            self.segment += 1
            self.state = StreamState.CONNECTED
            self.last_error = None
        except Exception:
            self._disconnect()
            self.state = StreamState.DISCONNECTED
            self.last_error = "connection_failed"
            raise StreamError("RTSP connection unavailable; URL and provider details suppressed.") from None

    def frames(self, stop_event=None):
        stop = self._stop if stop_event is None else stop_event
        retries = 0
        delay = self.settings.reconnect_initial_seconds
        try:
            while not stop.is_set() and not self._stop.is_set():
                if self.state != StreamState.CONNECTED:
                    if self.connection_attempts:
                        if retries >= self.settings.max_reconnect_attempts:
                            self.state = StreamState.FAILED
                            raise StreamError("RTSP reconnect budget exhausted.")
                        self.state = StreamState.RECONNECTING
                        if stop.wait(delay):
                            break
                        retries += 1
                        delay = min(delay * 2, self.settings.reconnect_max_seconds)
                    try:
                        self.connect(stop)
                    except StreamError:
                        continue
                try:
                    sequence, image, arrival, monotonic = self._capture.read(stop)
                    if self._stop.is_set() or stop.is_set():
                        break
                    # Validate injected backends too. Never manufacture frames on failure.
                    from .image_utils import validate_image
                    from database.validation import as_utc
                    validate_image(image)
                    if image.nbytes > 64 * 1024 * 1024 or isinstance(monotonic, bool) or not math.isfinite(monotonic) or monotonic < 0 or (self._last_monotonic is not None and monotonic < self._last_monotonic):
                        raise ValueError()
                    index = self._decoded + sequence
                    if index <= self._last_sequence:
                        raise ValueError()
                    self._last_sequence = index
                    self._last_monotonic = monotonic
                    self.last_arrival = as_utc(arrival, "arrival")
                    self.dimensions = [int(image.shape[1]), int(image.shape[0])]
                    delay = self.settings.reconnect_initial_seconds
                    yield LiveFrame(self.session_id, index, image, self.last_arrival, monotonic, self.segment)
                except Exception:
                    if stop.is_set() or self._stop.is_set():
                        break
                    self.last_error = "read_or_decode_failed"
                    self._disconnect()
                    self.state = StreamState.RECONNECTING
        finally:
            self.close()

    def close(self):
        failed = self.state == StreamState.FAILED
        self._stop.set()
        self.state = StreamState.STOPPING
        self._disconnect()
        self.state = StreamState.FAILED if failed else StreamState.STOPPED
