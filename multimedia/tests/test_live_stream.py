"""Offline RTSP settings/recovery/IPC tests, never contact a stream server."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
import multiprocessing as mp
from pathlib import Path
import subprocess
import sys
import threading
import time
from unittest.mock import MagicMock, Mock, patch
from uuid import UUID, uuid4

import numpy as np
import pytest

from processing.live_settings import LiveSettings, StreamSettings
from processing.live_stream import IsolatedCapture, RTSPFrameSource, StreamError, StreamState, _open_capture

NOW = datetime(2026, 11, 7, tzinfo=UTC)


class FakeCapture:
    def __init__(self, items=(), open_error=False):
        self.items = iter(items)
        self.open_error = open_error
        self.decoded_count = self.invalid_count = 0
        self.native_timeouts = True
        self.closed = False

    def open(self, stop):
        if self.open_error:
            raise RuntimeError("private RTSP password")

    def read(self, stop):
        item = next(self.items, StreamError("disconnected"))
        if isinstance(item, Exception):
            raise item
        self.decoded_count += 1
        image, stamp = item
        return self.decoded_count, image, NOW + timedelta(seconds=stamp), float(stamp)

    def close(self):
        self.closed = True


@pytest.fixture
def image():
    return np.full((48, 64, 3), 128, dtype=np.uint8)


def make_source(captures, **settings):
    factory = Mock(side_effect=captures)
    source = RTSPFrameSource(uuid4(), settings=StreamSettings(reconnect_initial_seconds=.01,
        reconnect_max_seconds=.02, **settings), capture_factory=factory)
    return source, factory


@pytest.mark.parametrize("sid", [str(uuid4()), uuid4(), None])
def test_valid_uuid_and_generation(sid):
    source = RTSPFrameSource(sid, settings=StreamSettings())
    assert isinstance(source.session_id, UUID)
    assert source.snapshot()["connection_attempts"] == 0


@pytest.mark.parametrize("sid", ["", "not-a-uuid", "../private", 3, False])
def test_invalid_session_rejected(sid):
    with pytest.raises(ValueError):
        RTSPFrameSource(sid, settings=StreamSettings())


def test_trusted_url_template_host_port_and_credentials_not_repr():
    sid = uuid4()
    settings = StreamSettings("rtsp://reader:p%40ss@media.example:9554/live/{session_id}")
    assert settings.build_url(sid) == f"rtsp://reader:p%40ss@media.example:9554/live/{sid}"
    assert settings.build_url(sid, host="127.0.0.1", port=8554) == f"rtsp://reader:p%40ss@127.0.0.1:8554/live/{sid}"
    source = RTSPFrameSource(sid, settings=settings)
    assert "p%40ss" not in repr(settings) + repr(source) + str(source.snapshot())


def test_ipv6_and_fixed_session_validation():
    sid = uuid4()
    assert StreamSettings("rtsp://[::1]:8554/live/SESSION_ID").build_url(sid) == f"rtsp://[::1]:8554/live/{sid}"
    settings = StreamSettings(f"rtsp://localhost:8554/live/{sid}")
    with pytest.raises(ValueError):
        settings.build_url(uuid4())


@pytest.mark.parametrize("url", ["http://localhost/live/SESSION_ID", "rtsp://localhost/other/SESSION_ID",
    "rtsp://localhost/live/../../x", "rtsp://localhost/live/SESSION_ID?token=private", "rtsp://localhost/live/SESSION_ID#x",
    "rtsp://localhost:99999/live/SESSION_ID", "rtsp://localhost/live/not-uuid", "rtsp://user@localhost/live/SESSION_ID"])
def test_invalid_template_redacted(url):
    with pytest.raises(ValueError) as error:
        StreamSettings(url)
    assert "token=private" not in str(error.value)


@pytest.mark.parametrize("change", [{"read_timeout_seconds": 0}, {"open_timeout_seconds": float("inf")},
    {"reconnect_initial_seconds": 10, "reconnect_max_seconds": 1}, {"max_reconnect_attempts": -1},
    {"transport": "udp"}, {"max_reconnect_attempts": True}])
def test_invalid_stream_settings(change):
    with pytest.raises(ValueError):
        replace(StreamSettings(), **change)


def test_connect_does_not_read_until_iteration(image):
    capture = FakeCapture([(image, 1)])
    source, factory = make_source([capture])
    source.connect()
    assert source.state == StreamState.CONNECTED and capture.decoded_count == 0
    iterator = source.frames()
    frame = next(iterator)
    assert frame.session_id == source.session_id and frame.sequence == 1
    assert frame.arrived_at == NOW + timedelta(seconds=1) and frame.arrived_at.tzinfo == UTC
    assert frame.image is image and source.dimensions == [64, 48]
    iterator.close()
    assert capture.closed and source.state == StreamState.STOPPED


def test_failed_connect_safe_and_released():
    capture = FakeCapture(open_error=True)
    source, _ = make_source([capture])
    with pytest.raises(StreamError) as error:
        source.connect()
    assert "password" not in str(error.value) and capture.closed
    assert source.state == StreamState.DISCONNECTED


def test_reconnect_preserves_uuid_sequence_fresh_times_and_dimensions(image):
    first = FakeCapture([(image, 1)])
    second = FakeCapture([(np.zeros((72, 96, 3), dtype=np.uint8), 4)])
    source, factory = make_source([first, second], max_reconnect_attempts=2)
    iterator = source.frames()
    a, b = next(iterator), next(iterator)
    assert a.session_id == b.session_id == source.session_id
    assert a.sequence == 1 and b.sequence == 2 and b.arrived_at > a.arrived_at
    assert b.segment == 2 and source.successful_reconnections == 1
    assert source.dimensions == [96, 72] and first.closed
    assert factory.call_args_list[0].args[0] == factory.call_args_list[1].args[0]
    iterator.close()
    assert second.closed and source.snapshot()["decoded_frames"] == 2


@pytest.mark.parametrize("bad", [None, np.empty((0, 0, 3), dtype=np.uint8), np.ones((4, 4, 3), dtype=float), np.ones((4, 4, 2), dtype=np.uint8)])
def test_invalid_image_never_yielded(bad):
    capture = FakeCapture([(bad, 1)])
    source, _ = make_source([capture], max_reconnect_attempts=0)
    with pytest.raises(StreamError, match="budget"):
        list(source.frames())
    assert source.state == StreamState.FAILED and capture.closed


def test_corrupt_read_no_fabricated_frame():
    capture = FakeCapture([RuntimeError("private URL")])
    source, _ = make_source([capture], max_reconnect_attempts=0)
    with pytest.raises(StreamError):
        list(source.frames())
    assert source.snapshot()["decoded_frames"] == 0


def test_reconnection_backoff_bounded_and_eventual_recovery(image):
    captures = [FakeCapture(open_error=True) for _ in range(4)] + [FakeCapture([(image, 2)])]
    source, _ = make_source(captures, max_reconnect_attempts=4)
    stop = Mock()
    stop.is_set.return_value = False
    stop.wait.return_value = False
    iterator = source.frames(stop)
    assert next(iterator).image is image
    assert [call.args[0] for call in stop.wait.call_args_list] == [.01, .02, .02, .02]
    assert source.connection_attempts == 5
    iterator.close()


def test_cancellation_during_reconnect():
    source, _ = make_source([FakeCapture(open_error=True)], max_reconnect_attempts=8)
    stop = Mock()
    stop.is_set.return_value = False
    stop.wait.return_value = True
    assert list(source.frames(stop)) == []
    assert source.connection_attempts == 1 and source.state == StreamState.STOPPED


def test_permanent_failure_budget():
    source, _ = make_source([FakeCapture(open_error=True) for _ in range(3)], max_reconnect_attempts=2)
    with pytest.raises(StreamError, match="budget"):
        list(source.frames())
    assert source.connection_attempts == 3 and source.state == StreamState.FAILED


def test_repeated_close_is_safe():
    source, factory = make_source([])
    source.close()
    source.close()
    factory.assert_not_called()
    with pytest.raises(StreamError):
        source.connect()


def test_native_timeout_properties_attempted():
    cv = Mock(CAP_FFMPEG=1900, CAP_PROP_OPEN_TIMEOUT_MSEC=53, CAP_PROP_READ_TIMEOUT_MSEC=54)
    capture = Mock(isOpened=Mock(return_value=True))
    cv.VideoCapture.return_value = capture
    assert _open_capture(cv, "private", StreamSettings()) == (capture, True)
    assert cv.VideoCapture.call_args.args == ("private", 1900, [53, 5000, 54, 10000])


def test_unsupported_native_properties_use_watchdog_fallback():
    cv = Mock(CAP_FFMPEG=1900, CAP_PROP_OPEN_TIMEOUT_MSEC=53, CAP_PROP_READ_TIMEOUT_MSEC=54)
    rejected, working = Mock(isOpened=Mock(return_value=False)), Mock(isOpened=Mock(return_value=True))
    cv.VideoCapture.side_effect = [rejected, working]
    assert _open_capture(cv, "private", StreamSettings()) == (working, False)
    rejected.release.assert_called_once()
    assert cv.VideoCapture.call_args.args == ("private", 1900)


def _stalled_capture_worker(url, settings, frames, control, decoded, invalid, stop):
    control.send(("opened", False))
    while True:
        time.sleep(10)


def test_real_isolated_stalled_read_can_be_terminated_without_network(monkeypatch):
    import processing.live_stream as module
    monkeypatch.setattr(module, "_capture_worker", _stalled_capture_worker)
    capture = IsolatedCapture("never-used", StreamSettings(open_timeout_seconds=5, read_timeout_seconds=.1))
    stop = threading.Event()
    pid = capture.process.pid
    try:
        capture.open(stop)
        with pytest.raises(StreamError):
            capture.read(stop)
    finally:
        start = time.monotonic()
        capture.close()
    assert time.monotonic() - start < 3
    assert not any(child.pid == pid for child in mp.active_children())
    capture.close()


def test_import_has_no_capture_or_process_start():
    code = "from unittest.mock import patch\nwith patch('cv2.VideoCapture', side_effect=AssertionError('network')), patch('multiprocessing.process.BaseProcess.start', side_effect=AssertionError('process')):\n import processing.live_stream, processing.live_runner\n"
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_environment_precedence_and_stricter_sampling(monkeypatch):
    monkeypatch.setenv("RTSP_STREAM_URL", "rtsp://configured.example:9554/live/SESSION_ID")
    monkeypatch.setenv("PIPELINE_SAMPLE_INTERVAL_SECONDS", "3")
    monkeypatch.setenv("LIVE_SAMPLE_INTERVAL_SECONDS", "1")
    assert "configured.example:9554" in StreamSettings.from_env().build_url(uuid4())
    assert LiveSettings.from_env().sample_interval_seconds == 3


def _run_worker(images, clock_step):
    """Runs the capture worker over fake decoded images; returns (control messages, frames handed on)."""
    from types import SimpleNamespace
    from processing.live_stream import _capture_worker
    stop, items, now = threading.Event(), iter(images), [0.0]
    capture = Mock()
    def read():
        try:
            return True, next(items)
        except StopIteration:
            stop.set()
            return True, images[-1]
    capture.read.side_effect = read
    def monotonic():
        now[0] += clock_step
        return now[0]
    fake_cv = SimpleNamespace(CAP_FFMPEG=1900, videoio_registry=Mock(hasBackend=Mock(return_value=True)))
    frames, control = Mock(), Mock()
    decoded, invalid = MagicMock(value=0), MagicMock(value=0)
    with patch.dict("os.environ"), patch.dict(sys.modules, {"cv2": fake_cv}), patch("os.dup2"), \
         patch("processing.live_stream.time.monotonic", side_effect=monotonic), \
         patch("processing.live_stream._open_capture", return_value=(capture, False)):
        _capture_worker("private", StreamSettings(), frames, control, decoded, invalid, stop)
    return [call.args[0] for call in control.send.call_args_list], frames.put_nowait.call_count


def test_capture_worker_reconnects_when_the_picture_stops_changing(image):
    # 15 fps of the exact same decoded picture, as when the reader misses the phone's video size change.
    messages, handed_on = _run_worker([image.copy() for _ in range(80)], clock_step=1 / 15)
    assert messages[0] == ("opened", False)
    assert messages[-1] == ("failed", "StreamError")
    assert handed_on < 80


def test_capture_worker_keeps_a_live_picture_flowing(image):
    rng = np.random.default_rng(1)
    noisy = [np.clip(image.astype(np.int16) + rng.integers(-2, 3, image.shape), 0, 255).astype(np.uint8)
             for _ in range(80)]
    messages, handed_on = _run_worker(noisy, clock_step=1 / 15)
    assert ("failed", "StreamError") not in messages
    assert handed_on >= 80


def test_capture_worker_tolerates_missing_log_level_api(monkeypatch, image):
    from types import SimpleNamespace
    from processing.live_stream import _capture_worker
    stop = threading.Event()
    capture = Mock()
    def read():
        stop.set()
        return True, image
    capture.read.side_effect = read
    fake_cv = SimpleNamespace(CAP_FFMPEG=1900, videoio_registry=Mock(hasBackend=Mock(return_value=True)))
    frames, control = Mock(), Mock()
    decoded, invalid = MagicMock(value=0), MagicMock(value=0)
    with patch.dict("os.environ"), patch.dict(sys.modules, {"cv2": fake_cv}), patch("os.dup2"), \
         patch("processing.live_stream._open_capture", return_value=(capture, False)):
        _capture_worker("private", StreamSettings(), frames, control, decoded, invalid, stop)
    assert control.send.call_args_list[0].args[0] == ("opened", False)
    frames.put_nowait.assert_called_once()
    capture.release.assert_called_once()
