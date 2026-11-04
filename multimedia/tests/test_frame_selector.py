"""Offline behavior tests for quality, duplicate, and periodic selection."""

import gc
import subprocess
import sys
import weakref
from dataclasses import asdict
from datetime import UTC, datetime
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from processing.duplicate_filter import DuplicateFilter
from processing.frame_extractor import ExtractedFrame, FrameExtractor
from processing.frame_selector import FrameSelector, SelectionStats, main
from processing.quality_filter import evaluate_quality


@pytest.fixture
def scenes():
    sharp = np.full((128, 160, 3), 30, dtype=np.uint8)
    cv2.rectangle(sharp, (10, 10), (80, 110), (210, 210, 210), -1)
    cv2.putText(sharp, "A", (95, 80), cv2.FONT_HERSHEY_SIMPLEX,
                1.5, (130, 130, 130), 3)
    other = cv2.bitwise_not(sharp)
    blurred = cv2.GaussianBlur(sharp, (15, 15), 0)
    threshold = (evaluate_quality(sharp).sharpness_score + evaluate_quality(blurred).sharpness_score) / 2
    return sharp, other, blurred, threshold


def frame(image, timestamp=0, index=0):
    return ExtractedFrame("test.avi", index, timestamp, image, "2020-01-01T00:00:00Z")


def test_first_clear_frame_and_quality_boundary(scenes):
    sharp, _, _, _ = scenes
    score = evaluate_quality(sharp).sharpness_score
    selector = FrameSelector(sharpness_threshold=score)
    result = selector.evaluate(frame(sharp))
    assert result.accepted and result.reason == "first_frame"
    assert result.sharpness_score == score
    assert result.is_duplicate is None
    assert result.hash_distance is None and result.pixel_difference is None
    assert selector.last_accepted_timestamp_ms == 0


def test_blurry_before_first_clear_frame(scenes):
    sharp, _, blurred, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold)
    result = selector.evaluate(frame(blurred))
    assert result.reason == "blurry" and not result.accepted
    assert result.is_blurry and result.is_duplicate is None
    assert result.hash_distance is None and result.pixel_difference is None
    assert selector.last_accepted_timestamp_ms is None
    assert selector.evaluate(frame(sharp, 1000)).reason == "first_frame"


def test_duplicate_then_new_scene(scenes):
    sharp, other, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold)
    selector.evaluate(frame(sharp))
    duplicate = selector.evaluate(frame(sharp.copy(), 1000))
    assert duplicate.reason == "duplicate" and not duplicate.accepted
    assert duplicate.is_duplicate and duplicate.hash_distance == duplicate.pixel_difference == 0
    changed = selector.evaluate(frame(other, 2000))
    assert changed.reason == "new_scene" and changed.accepted
    assert changed.is_duplicate is False


@pytest.mark.parametrize("timestamp, reason", [
    (9999, "duplicate"), (10000, "periodic_frame"), (10001, "periodic_frame"),
])
def test_inclusive_max_gap_in_milliseconds(scenes, timestamp, reason):
    sharp, _, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=10)
    selector.evaluate(frame(sharp))
    result = selector.evaluate(frame(sharp, timestamp))
    assert result.reason == reason
    assert result.accepted == (reason == "periodic_frame")
    assert result.is_duplicate is True


def test_fractional_gap_and_disabled_coverage(scenes):
    sharp, _, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=0.5)
    selector.evaluate(frame(sharp, 200))
    assert selector.evaluate(frame(sharp, 699)).reason == "duplicate"
    assert selector.evaluate(frame(sharp, 700)).reason == "periodic_frame"
    disabled = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=None)
    disabled.evaluate(frame(sharp))
    assert disabled.evaluate(frame(sharp, 1000000)).reason == "duplicate"


def test_quality_not_bypassed_and_blurry_does_not_update_reference(scenes):
    sharp, other, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=1)
    selector.evaluate(frame(sharp))
    blurry_other = cv2.GaussianBlur(other, (15, 15), 0)
    assert selector.evaluate(frame(blurry_other, 2000)).reason == "blurry"
    assert selector.last_accepted_timestamp_ms == 0
    result = selector.evaluate(frame(sharp, 2001))
    assert result.reason == "periodic_frame"
    assert result.hash_distance == 0 and result.pixel_difference == 0


def test_rejected_duplicates_do_not_replace_reference(scenes):
    sharp, _, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=None)
    selector.evaluate(frame(sharp))
    assert selector.evaluate(frame(cv2.add(sharp, np.full_like(sharp, 8)), 100)).reason == "duplicate"
    changed = selector.evaluate(frame(cv2.add(sharp, np.full_like(sharp, 16)), 200))
    assert changed.reason == "new_scene"
    assert changed.pixel_difference == 16


def test_periodic_acceptance_updates_reference_and_timer(scenes):
    sharp, _, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=1)
    selector.evaluate(frame(sharp))
    shifted = cv2.add(sharp, np.full_like(sharp, 8))
    assert selector.evaluate(frame(shifted, 1000)).reason == "periodic_frame"
    further = cv2.add(sharp, np.full_like(sharp, 16))
    result = selector.evaluate(frame(further, 1100))
    assert result.reason == "duplicate" and result.pixel_difference == 8
    assert selector.evaluate(frame(further, 1999)).reason == "duplicate"
    assert selector.evaluate(frame(further, 2000)).reason == "periodic_frame"


def test_new_scene_takes_priority_over_periodic_coverage(scenes):
    sharp, other, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=1)
    selector.evaluate(frame(sharp))
    assert selector.evaluate(frame(other, 10000)).reason == "new_scene"


def test_reset_clears_reference_timestamps_and_statistics(scenes):
    sharp, other, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold)
    selector.evaluate(frame(sharp, 3000))
    selector.evaluate(frame(other, 4000))
    selector.reset()
    assert selector.stats == SelectionStats()
    assert selector.last_accepted_timestamp_ms is None
    assert selector.evaluate(frame(other, 0)).reason == "first_frame"


def test_original_frame_and_pixels_preserved(scenes):
    sharp, _, _, threshold = scenes
    extracted = frame(sharp, 1234, 25)
    before = (extracted.source_video, extracted.frame_index, extracted.timestamp_ms, extracted.captured_at)
    pixels = sharp.copy()
    sharp.flags.writeable = False
    selector = FrameSelector(sharpness_threshold=threshold)
    result = selector.evaluate(extracted)
    assert before == (extracted.source_video, extracted.frame_index, extracted.timestamp_ms, extracted.captured_at)
    assert before == (result.source_video, result.frame_index, result.timestamp_ms, result.captured_at)
    assert extracted.frame is sharp
    np.testing.assert_array_equal(sharp, pixels)


@pytest.mark.parametrize("timestamp, exception", [
    (-1, ValueError), (float("nan"), ValueError), (float("inf"), ValueError),
    (None, TypeError), ("1000", TypeError), (True, TypeError),
    pytest.param(10 ** 400, ValueError, id="timestamp-overflow"),
])
def test_invalid_timestamps_do_not_change_state(scenes, timestamp, exception):
    sharp, _, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold)
    selector.evaluate(frame(sharp))
    before = selector.stats
    with pytest.raises(exception, match="timestamp_ms"):
        selector.evaluate(frame(sharp, timestamp))
    assert selector.stats == before
    assert selector.evaluate(frame(sharp, 100)).reason == "duplicate"


def test_out_of_order_including_rejected_frames_and_equal_timestamps(scenes):
    sharp, _, blurred, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold)
    selector.evaluate(frame(sharp, 100))
    assert selector.evaluate(frame(sharp, 100)).reason == "duplicate"
    selector.evaluate(frame(blurred, 1000))
    before = selector.stats
    with pytest.raises(ValueError, match="monotonically"):
        selector.evaluate(frame(sharp, 999))
    assert selector.stats == before
    assert selector.evaluate(frame(sharp, 1000)).reason == "duplicate"


@pytest.mark.parametrize("image, exception", [
    (None, TypeError), (np.empty((0, 0), dtype=np.uint8), ValueError),
    (np.full((4, 4), np.nan), TypeError),
])
def test_invalid_images_do_not_advance_time_or_statistics(scenes, image, exception):
    sharp, _, _, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold)
    selector.evaluate(frame(sharp))
    before = selector.stats
    with pytest.raises(exception):
        selector.evaluate(frame(image, 2000))
    assert selector.stats == before
    assert selector.evaluate(frame(sharp, 1000)).reason == "duplicate"


def test_wrong_frame_type():
    with pytest.raises(TypeError, match="ExtractedFrame"):
        FrameSelector().evaluate({"frame": None})


@pytest.mark.parametrize("kwargs, exception", [
    ({"sharpness_threshold": -1}, ValueError), ({"sharpness_threshold": float("nan")}, ValueError),
    ({"sharpness_threshold": True}, TypeError), ({"sharpness_threshold": "100"}, TypeError),
    ({"hash_threshold": 65}, ValueError), ({"hash_threshold": 1.5}, TypeError),
    ({"pixel_threshold": -1}, ValueError), ({"pixel_threshold": float("inf")}, ValueError),
    ({"max_gap_seconds": 0}, ValueError), ({"max_gap_seconds": -1}, ValueError),
    ({"max_gap_seconds": float("nan")}, ValueError), ({"max_gap_seconds": float("inf")}, ValueError),
    ({"max_gap_seconds": True}, TypeError), ({"max_gap_seconds": "10"}, TypeError),
])
def test_invalid_configuration(kwargs, exception):
    with pytest.raises(exception):
        FrameSelector(**kwargs)


def test_statistics_for_mixed_sequence(scenes):
    sharp, other, blurred, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=3)
    sequence = [sharp, sharp, blurred, other, other,
                cv2.GaussianBlur(other, (15, 15), 0), other, other]
    results = [selector.evaluate(frame(image, index * 1000, index * 10))
               for index, image in enumerate(sequence)]
    assert [result.reason for result in results] == [
        "first_frame", "duplicate", "blurry", "new_scene",
        "duplicate", "blurry", "periodic_frame", "duplicate",
    ]
    assert asdict(selector.stats) == dict(
        total_evaluated=8, accepted=3, rejected=5, blurry=2, duplicates=3,
        first_frames=1, periodic_frames=1, new_scenes=1,
    )
    stats = selector.stats
    assert stats.total_evaluated == stats.accepted + stats.rejected
    assert stats.accepted == stats.first_frames + stats.new_scenes + stats.periodic_frames
    assert stats.rejected == stats.blurry + stats.duplicates
    stats.accepted = 999
    assert selector.stats.accepted == 3


def test_reuses_quality_and_duplicate_filters(scenes):
    sharp, _, blurred, threshold = scenes
    selector = FrameSelector(sharpness_threshold=threshold)
    with patch("processing.frame_selector.evaluate_quality", wraps=evaluate_quality) as quality:
        with patch.object(selector._duplicate_filter, "check", wraps=selector._duplicate_filter.check) as duplicate:
            selector.evaluate(frame(sharp))
            selector.evaluate(frame(blurred, 1000))
            result = selector.evaluate(frame(sharp, 2000))
    assert quality.call_count == 3
    assert duplicate.call_count == 2  # Blurry images never reach the duplicate filter.
    assert result.sharpness_score == evaluate_quality(sharp, threshold).sharpness_score


def test_explicit_duplicate_reference_update_is_validated(scenes):
    sharp, other, _, _ = scenes
    detector = DuplicateFilter()
    detector.check(sharp)
    with pytest.raises(TypeError):
        detector.set_reference(None)
    assert detector.check(sharp).is_duplicate
    detector.set_reference(other)
    assert detector.check(other.copy()).is_duplicate


@pytest.fixture
def video_path(tmp_path):
    from scripts.generate_selection_video import main as generate_video
    path = tmp_path / "selection.avi"
    assert generate_video(["--output", str(path)]) == 0
    return path


def test_extractor_integration_and_video_decisions(video_path):
    selector = FrameSelector(max_gap_seconds=3)
    with FrameExtractor(video_path, recording_start=datetime(2020, 1, 1, tzinfo=UTC)) as extractor:
        results = [selector.evaluate(extracted) for extracted in extractor.extract_frames()]
    assert [result.frame_index for result in results] == list(range(0, 80, 10))
    assert [result.timestamp_ms for result in results] == list(range(0, 8000, 1000))
    assert [result.reason for result in results] == [
        "first_frame", "duplicate", "blurry", "new_scene",
        "duplicate", "blurry", "periodic_frame", "duplicate",
    ]
    assert results[-1].captured_at == "2020-01-01T00:00:07Z"
    assert selector.stats.total_evaluated == 8 and selector.stats.accepted == 3


def test_module_cli_and_only_accepted_jpegs(video_path, tmp_path):
    output = tmp_path / "accepted"
    result = subprocess.run([
        sys.executable, "-m", "processing.frame_selector", "--video", str(video_path),
        "--interval", "1", "--sharpness-threshold", "100", "--hash-threshold", "6",
        "--pixel-threshold", "12", "--max-gap", "3", "--output", str(output),
    ], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    for text in ("Total evaluated: 8", "Accepted: 3", "Rejected: 5", "Blurry: 2",
                 "Duplicates: 3", "Periodic frames: 1", "New scenes: 1", "Selection completed"):
        assert text in result.stdout
    assert sorted(path.name for path in output.glob("*.jpg")) == [
        "frame_000000.jpg", "frame_000030.jpg", "frame_000060.jpg",
    ]
    for path in output.glob("*.jpg"):
        assert cv2.imread(str(path)).shape == (128, 160, 3)


def test_cli_disable_coverage_and_no_implicit_storage(video_path, tmp_path, capsys):
    before = set(tmp_path.iterdir())
    assert main(["--video", str(video_path), "--max-gap", "none"]) == 0
    output = capsys.readouterr().out
    assert "Accepted: 2" in output and "Periodic frames: 0" in output
    assert set(tmp_path.iterdir()) == before


@pytest.mark.parametrize("arguments, message", [
    ([], "Video file not found"), (["--interval", "0"], "interval"),
    (["--sharpness-threshold", "-1"], "sharpness_threshold"),
    (["--hash-threshold", "65"], "hash_threshold"),
    (["--max-gap", "0"], "max_gap_seconds"),
])
def test_cli_invalid_inputs(tmp_path, arguments, message, capsys):
    assert main(["--video", str(tmp_path / "missing.avi"), *arguments]) == 1
    assert message in capsys.readouterr().err


def test_saving_failure_releases_video(video_path, tmp_path, monkeypatch, capsys):
    extractor = FrameExtractor(video_path)
    monkeypatch.setattr("processing.frame_selector.FrameExtractor", lambda *args, **kwargs: extractor)
    with patch("processing.frame_selector.save_frame", side_effect=OSError("Save failed")):
        assert main(["--video", str(video_path), "--output", str(tmp_path / "output")]) == 1
    assert "Save failed" in capsys.readouterr().err
    assert extractor.reader.capture is None


def test_many_repeated_frames_processed_without_retaining_images(tmp_path, scenes):
    sharp, _, _, threshold = scenes
    path = tmp_path / "long.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (160, 128))
    assert writer.isOpened()
    try:
        for _ in range(300):
            writer.write(sharp)
    finally:
        writer.release()
    selector = FrameSelector(sharpness_threshold=threshold, max_gap_seconds=None)
    previous = None
    with FrameExtractor(path, interval=0.1) as extractor:
        for extracted in extractor.extract_frames():
            if previous is not None:
                assert previous() is None, "A previous full-size frame was retained"
            selector.evaluate(extracted)
            previous = weakref.ref(extracted.frame)
    del extracted
    gc.collect()
    assert previous() is None
    assert selector.stats.total_evaluated == 300
    assert selector.stats.accepted == 1 and selector.stats.duplicates == 299
