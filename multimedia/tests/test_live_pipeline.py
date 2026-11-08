"""Offline live orchestration over real Task 13 analysis, synthetic frames only."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
import json
import queue
import threading
import time
from unittest.mock import Mock, patch
from uuid import uuid4

import numpy as np
import pytest

from database.errors import DatabaseConnectionError, ImageStorageError, RepositoryError
from processing.live_demo import SyntheticFrameSource
from processing.live_runner import LiveMultimediaRunner, MonotonicSampler, main
from processing.live_settings import LiveSettings
from processing.live_stream import LiveFrame, StreamState
from processing.ocr_service import OCRRateLimitError
from processing.pipeline import MultimediaPipeline
from processing.pipeline_demo import MockOCR, MockVision, MockEmbedding

NOW = datetime(2026, 11, 7, tzinfo=UTC)


@pytest.fixture(autouse=True)
def forbid_network():
    with patch("pymysql.connect", side_effect=AssertionError("No MySQL")), \
         patch("httpx.HTTPTransport.handle_request", side_effect=AssertionError("No paid calls")):
        yield


class Clock:
    def __init__(self):
        self.now = 10.

    def __call__(self):
        return self.now


@pytest.fixture
def parts():
    sid = uuid4()
    source = Mock(session_id=sid, state=StreamState.DISCONNECTED)
    source.snapshot.return_value = {"state": "DISCONNECTED", "decoded_frames": 0}
    ocr, vision, embedding = Mock(wraps=MockOCR()), Mock(wraps=MockVision()), Mock(wraps=MockEmbedding())
    repository = Mock()
    repository.save_frame.side_effect = lambda *a, **kw: uuid4()
    pipeline = MultimediaPipeline(ocr_service=ocr, vision_service=vision, embedding_service=embedding,
        repository=repository, mocked=True)
    clock = Clock()
    runner = LiveMultimediaRunner(stream_source=source, pipeline=pipeline, clock=clock, dry_run=False)
    return runner, source, pipeline, ocr, vision, embedding, repository, clock


def frame(runner, index=1, stamp=10., image=None):
    if image is None:
        image = np.random.default_rng(index).integers(0, 256, (48, 64, 3), dtype=np.uint8)
    return LiveFrame(runner.session_id, index, image, NOW + timedelta(seconds=stamp), stamp, 1)


@pytest.mark.parametrize("changes", [{"sample_interval_seconds": .5}, {"queue_size": 0}, {"queue_size": 11},
    {"queue_size": True}, {"duration_seconds": 0}, {"duration_seconds": float("nan")},
    {"max_accepted_frames": 0}, {"max_candidate_age_seconds": 11}, {"max_consecutive_failures": 0}])
def test_invalid_runner_settings(changes):
    with pytest.raises(ValueError):
        replace(LiveSettings(), **changes)


def test_initialization_and_session_mismatch(parts):
    runner, source, pipeline, *_ = parts
    assert runner.snapshot()["queue_capacity"] == 3
    assert runner.processing.capture_time_basis == "receiver_arrival_utc"
    with pytest.raises(ValueError):
        LiveMultimediaRunner(stream_source=source, pipeline=pipeline, session_id=uuid4())


def test_sampler_uses_monotonic_intervals_not_fps_or_utc():
    sampler = MonotonicSampler(1)
    assert [sampler.accept(t) for t in [1., 1.01, 1.9, 2., 2.1, 10.]] == [True, False, False, True, False, True]


@pytest.mark.parametrize("value", [-1, True, float("nan"), float("inf")])
def test_sampler_invalid_time(value):
    with pytest.raises(ValueError):
        MonotonicSampler().accept(value)


def test_sampler_rejects_clock_regression():
    sampler = MonotonicSampler()
    sampler.accept(2)
    with pytest.raises(ValueError):
        sampler.accept(1)


def test_actual_pipeline_image_metadata_utc_and_null_video_time(parts):
    runner, _, pipeline, ocr, vision, embedding, repository, _ = parts
    candidate = frame(runner)
    runner._analyze_frame(candidate)
    ocr.extract_text.assert_called_once_with(candidate.image)
    vision.analyze_image.assert_called_once_with(candidate.image)
    embedding.embed_frame.assert_called_once_with(ocr_text="MOCK ROOM 205\nغرفة ٢٠٥",
        objects=["synthetic sign"], caption="MOCK scene description; no real visual analysis.")
    args, kwargs = repository.save_frame.call_args
    assert args[0] == runner.session_id and args[1] == candidate.arrived_at and args[2] is candidate.image
    assert kwargs["source_frame_index"] == 1 and kwargs["video_timestamp_ms"] is None
    assert len(kwargs["embedding"]) == 1536 and kwargs["embedding_model"] == "text-embedding-3-small"
    report = runner.snapshot()
    assert report["processing"]["saved_frames"] == 1 and len(report["processing"]["frame_ids"]) == 1
    assert report["processing"]["outcomes"][0]["video_timestamp_ms"] is None
    assert report["last_saved_at"] and report["last_processing_latency_seconds"] == 0


def test_blurry_selection_no_cloud_or_storage(parts):
    runner, _, _, ocr, vision, embedding, repository, _ = parts
    runner._analyze_frame(frame(runner, image=np.full((48, 64, 3), 128, dtype=np.uint8)))
    assert runner.processing.rejection_reasons == {"blurry": 1}
    for service, method in [(ocr, "extract_text"), (vision, "analyze_image"), (embedding, "embed_frame"), (repository, "save_frame")]:
        getattr(service, method).assert_not_called()


def test_static_duplicate_rejected_after_first_frame(parts):
    runner, _, _, ocr, _, _, repository, clock = parts
    candidate = frame(runner)
    runner._analyze_frame(candidate)
    clock.now = 11
    runner._analyze_frame(replace(candidate, sequence=2, monotonic_time=11))
    assert runner.processing.rejection_reasons == {"duplicate": 1}
    assert repository.save_frame.call_count == ocr.extract_text.call_count == 1


def test_selector_state_and_periodic_gaps_are_reused(parts):
    runner, _, _, _, _, _, repository, clock = parts
    candidate = frame(runner)
    runner._analyze_frame(candidate)
    clock.now = 20
    runner._analyze_frame(replace(candidate, sequence=2, monotonic_time=20))
    assert runner.processing.outcomes[-1].selection_reason == "periodic_frame"
    assert repository.save_frame.call_count == 2


def test_full_queue_drops_oldest_and_stays_bounded(parts):
    runner = parts[0]
    for index in range(1, 8):
        runner._offer(frame(runner, index=index))
        assert runner.queue.qsize() <= 3
    assert runner.counters.queue_dropped_frames == 4
    assert [runner.queue.get_nowait().sequence for _ in range(3)] == [5, 6, 7]


def test_acquisition_sampling_and_backpressure_do_not_call_analysis(parts):
    runner, source, _, ocr, *_ = parts
    source.frames.return_value = iter([frame(runner, i + 1, 10 + i / 10) for i in range(50)])
    runner._acquire()
    assert runner.counters.sampled_frames == 5
    assert runner.queue.qsize() == 3 and runner.counters.queue_dropped_frames == 2
    assert runner.acquisition_done.is_set()
    ocr.extract_text.assert_not_called()


@pytest.mark.parametrize("stamp", [4.9, 10.1])
def test_stale_or_future_monotonic_candidate_never_analyzed(parts, stamp):
    runner = parts[0]
    runner._analyze_frame(frame(runner, stamp=stamp))
    assert runner.counters.stale_dropped_frames == 1 and runner.counters.frames_sent_to_analysis == 0
    assert runner.processing.saved_frames == 0


def test_slow_analysis_latency_remains_receiver_age(parts):
    runner, _, _, ocr, _, _, _, clock = parts
    def slow(image):
        clock.now += 12
        return MockOCR().extract_text(image)
    ocr.extract_text.side_effect = slow
    candidate = frame(runner)
    runner._analyze_frame(candidate)
    assert runner.snapshot()["last_processing_latency_seconds"] == 12
    assert runner.processing.saved_frames == 1
    # Persisted capture stays the original arrival; Task 11 latest will exclude
    # it after ten seconds, rather than replacing capture time with completion.
    assert parts[6].save_frame.call_args.args[1] == candidate.arrived_at


@pytest.mark.parametrize("stage", ["ocr", "vision", "embedding", "storage"])
def test_transient_stage_failure_no_fabrication_and_recovers(parts, stage):
    runner, _, _, ocr, vision, embedding, repository, clock = parts
    method = {"ocr": ocr.extract_text, "vision": vision.analyze_image,
              "embedding": embedding.embed_frame, "storage": repository.save_frame}[stage]
    good = method._mock_wraps
    if stage == "storage":
        method.side_effect = [RepositoryError("private"), uuid4()]
    else:
        counter = 0
        def once(*args, **kwargs):
            nonlocal counter
            counter += 1
            if counter == 1:
                raise RuntimeError("private recognized text/API key")
            return good(*args, **kwargs)
        method.side_effect = once
    runner._analyze_frame(frame(runner, 1))
    clock.now = 11
    runner._analyze_frame(frame(runner, 2, 11))
    assert runner.processing.failed_frames == runner.processing.saved_frames == 1
    assert runner.state != StreamState.FAILED
    assert "private recognized text" not in json.dumps(runner.snapshot())


def test_persistent_ordinary_errors_fail_explicitly(parts):
    runner, _, _, ocr, _, _, repository, clock = parts
    ocr.extract_text.side_effect = RuntimeError("private")
    for index in range(3):
        clock.now = 10 + index
        runner._analyze_frame(frame(runner, index + 1, clock.now))
    assert runner.state == StreamState.FAILED and runner.stop_event.is_set()
    assert runner.processing.failed_frames == 3
    repository.save_frame.assert_not_called()


@pytest.mark.parametrize("error", [OCRRateLimitError("quota"), DatabaseConnectionError("private")])
def test_fatal_infrastructure_failure(parts, error):
    runner = parts[0]
    if isinstance(error, OCRRateLimitError):
        parts[3].extract_text.side_effect = error
    else:
        parts[6].save_frame.side_effect = error
    runner._analyze_frame(frame(runner))
    assert runner.state == StreamState.FAILED and runner.processing.saved_frames == 0


def test_image_write_error_counted(parts):
    parts[6].save_frame.side_effect = ImageStorageError("private")
    parts[0]._analyze_frame(frame(parts[0]))
    assert parts[0].processing.stage_counts["storage"]["failures"] == 1


def test_no_persistence_mode(parts):
    runner = parts[0]
    runner.dry_run = True
    runner._analyze_frame(frame(runner))
    parts[6].save_frame.assert_not_called()
    assert runner.processing.analyzed_frames == 1 and runner.processing.saved_frames == 0


def test_maximum_accepted_frames_stops(parts):
    runner = parts[0]
    runner.settings = replace(runner.settings, max_accepted_frames=1)
    runner._analyze_frame(frame(runner))
    assert runner.stop_event.is_set() and runner.processing.selected_frames == 1


def test_duplicate_in_process_runner_prevented_and_released(parts):
    runner, source, pipeline, *_ = parts
    other = LiveMultimediaRunner(stream_source=source, pipeline=pipeline)
    runner._reserve()
    try:
        with pytest.raises(RuntimeError, match="already active"):
            other.start()
    finally:
        with runner._registry_lock:
            runner._registry.discard(runner.session_id)


def test_real_thread_start_duration_and_clean_shutdown():
    sid = uuid4()
    pipeline = MultimediaPipeline(ocr_service=MockOCR(), vision_service=MockVision(), embedding_service=MockEmbedding(), mocked=True)
    runner = LiveMultimediaRunner(stream_source=SyntheticFrameSource(sid), pipeline=pipeline,
        settings=LiveSettings(duration_seconds=.2), dry_run=True)
    result = runner.run()
    assert result["state"] == "STOPPED" and result["decoded_frames"] > 0
    assert result["processing"]["analyzed_frames"] == 1
    assert all(not worker.is_alive() for worker in runner._workers)
    assert sid not in runner._registry and result["queue_depth"] == 0


def test_explicit_stop_and_background_wait():
    sid = uuid4()
    pipeline = MultimediaPipeline(ocr_service=MockOCR(), vision_service=MockVision(), embedding_service=MockEmbedding(), mocked=True)
    runner = LiveMultimediaRunner(stream_source=SyntheticFrameSource(sid), pipeline=pipeline)
    runner.start()
    runner.stop()
    runner.stop()
    assert runner.wait(3)["state"] == "STOPPED"
    assert all(not worker.is_alive() for worker in runner._workers)


def test_source_failure_ends_without_inventing_frames(parts):
    runner, source, *_ = parts
    source.frames.side_effect = RuntimeError("private RTSP credentials")
    result = runner.run()
    assert result["state"] == "FAILED" and result["processing"]["saved_frames"] == 0
    assert result["error_stage"] == "acquisition"


def test_shutdown_discards_pending_without_counting_saved(parts):
    runner, source, *_ = parts
    for index in range(3):
        runner._offer(frame(runner, index + 1))
    runner.stop()
    result = runner.run()
    assert result["shutdown_dropped_frames"] == 3 and result["processing"]["saved_frames"] == 0


def test_cli_synthetic_no_db_and_no_paid_calls(capsys):
    with patch("database.connection.Database", side_effect=AssertionError("No DB construction")):
        assert main(["--offline-demo", "--dry-run", "--duration-seconds", ".15"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["processing"]["mocked"] and report["processing"]["dry_run"]
    assert report["processing"]["saved_frames"] == 0 and report["source"] == "synthetic_mock_frames"


@pytest.mark.parametrize("args", [[], ["--offline-demo", "--live"], ["--offline-demo", "--execute", "--dry-run"]])
def test_cli_argument_validation(args):
    with pytest.raises(SystemExit):
        main(args)


@pytest.mark.parametrize("extra", [["--queue-size", "0"], ["--duration-seconds", "-1"],
    ["--interval", "nan"], ["--interval", ".5"], ["--host", "127.0.0.1"]])
def test_cli_invalid_configuration_safe(extra):
    assert main(["--offline-demo", *extra]) == 1


def test_duration_without_any_frame_is_failure(parts):
    runner, source, *_ = parts
    runner.clock = time.monotonic
    runner.settings = replace(runner.settings, duration_seconds=.1)
    def no_frames(stop):
        while not stop.wait(.01):
            pass
        return
        yield
    source.frames.side_effect = no_frames
    result = runner.run()
    assert result["state"] == "FAILED" and result["error_type"] == "NoDecodedFrames"
    assert result["stop_reason"] == "duration_limit"


def test_operational_details_bounded(parts):
    runner, _, _, _, _, _, _, clock = parts
    runner.settings = replace(runner.settings, max_accepted_frames=200)
    for index in range(105):
        clock.now = 10 + index
        runner._analyze_frame(frame(runner, index + 1, clock.now))
    report = runner.snapshot()
    assert report["processing"]["saved_frames"] == 105
    assert len(report["processing"]["frame_ids"]) == len(report["processing"]["outcomes"]) == 100
    assert report["processing"]["details_truncated"] is True
