"""Deterministic duplicate detection tests without external services."""

import subprocess
import sys
from datetime import UTC, datetime

import cv2
import numpy as np
import pytest

from processing.duplicate_filter import (
    DuplicateFilter, DuplicateResult, are_duplicates, calculate_dhash,
    calculate_pixel_difference, compare_frames, hamming_distance, main,
)
from processing.frame_extractor import FrameExtractor
from processing.quality_filter import evaluate_quality


@pytest.fixture
def image():
    image = np.full((128, 160, 3), 30, dtype=np.uint8)
    cv2.rectangle(image, (10, 10), (80, 110), (210, 210, 210), -1)
    cv2.putText(image, "A", (95, 80), cv2.FONT_HERSHEY_SIMPLEX,
                1.5, (130, 130, 130), 3)
    return image


def test_identical_images_and_result_types(image):
    result = compare_frames(image, image.copy())
    assert isinstance(result, DuplicateResult)
    assert type(result.hash_distance) is int
    assert type(result.pixel_difference) is float
    assert type(result.hash_threshold) is int
    assert type(result.pixel_threshold) is float
    assert type(result.is_duplicate) is bool
    assert result.hash_distance == result.pixel_difference == 0
    assert result.hash_threshold == 6 and result.pixel_threshold == 12
    assert result.is_duplicate and not result.accepted
    assert are_duplicates(image, image.copy())


def test_slight_brightness_change(image):
    modified = cv2.add(image, np.full_like(image, 3))
    assert calculate_pixel_difference(image, modified) == pytest.approx(3)
    assert are_duplicates(image, modified, hash_threshold=0, pixel_threshold=3)


def test_different_structures_not_duplicates(image):
    other = np.full_like(image, 230)
    cv2.circle(other, (80, 64), 45, (10, 10, 10), -1)
    result = compare_frames(image, other)
    assert not result.is_duplicate
    assert result.hash_distance > 0
    assert result.pixel_difference > 12


def test_dhash_deterministic_and_64_bit(image):
    value = calculate_dhash(image)
    assert type(value) is int
    assert 0 <= value < 1 << 64
    assert value == calculate_dhash(image.copy())


def test_dhash_known_horizontal_gradients_and_bit_order():
    ascending = np.tile(np.arange(9, dtype=np.uint8), (8, 1))
    assert calculate_dhash(ascending) == 0
    assert calculate_dhash(ascending[:, ::-1]) == (1 << 64) - 1
    single = np.zeros((8, 9), dtype=np.uint8)
    single[0, 0] = 255
    assert calculate_dhash(single) == 1 << 63


@pytest.mark.parametrize("first, second, expected", [
    (0, 0, 0), (0, (1 << 64) - 1, 64), (0b1010, 0b1100, 2),
    (np.uint64(15), 0, 4),
])
def test_hamming_distance(first, second, expected):
    assert hamming_distance(first, second) == expected
    assert hamming_distance(second, first) == expected


@pytest.mark.parametrize("bad, exception", [
    (-1, ValueError), (1 << 64, ValueError), (1.5, TypeError),
    (True, TypeError), ("0", TypeError),
])
def test_invalid_hash_values(bad, exception):
    with pytest.raises(exception, match="hash1"):
        hamming_distance(bad, 0)
    with pytest.raises(exception, match="hash2"):
        hamming_distance(0, bad)


def test_pixel_difference_extremes_prevent_unsigned_wrap():
    black = np.zeros((16, 20), dtype=np.uint8)
    white = np.full((30, 50), 255, dtype=np.uint8)
    assert calculate_pixel_difference(black, black) == 0
    assert calculate_pixel_difference(black, white) == 255
    assert calculate_pixel_difference(white, black) == 255
    # Flat images collide under dHash; pixel comparison must preserve the change.
    assert calculate_dhash(black) == calculate_dhash(white)
    assert not are_duplicates(black, white)


def test_both_thresholds_and_inclusive_boundary(image):
    modified = cv2.bitwise_not(image)
    measured = compare_frames(image, modified)
    assert measured.hash_distance > 0 and measured.pixel_difference > 0
    assert are_duplicates(image, modified, measured.hash_distance, measured.pixel_difference)
    assert not are_duplicates(image, modified, measured.hash_distance - 1, measured.pixel_difference)
    assert not are_duplicates(image, modified, measured.hash_distance, measured.pixel_difference - 0.01)


def test_grayscale_bgr_bgra_equivalence(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    bgra = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = 0
    for other in (gray, bgra):
        assert calculate_dhash(other) == calculate_dhash(image)
        assert calculate_pixel_difference(image, other) == 0
        assert are_duplicates(image, other, 0, 0)


def test_different_dimensions_and_noncontiguous_input():
    small = np.zeros((128, 128), dtype=np.uint8)
    small[:, 64:] = 200
    larger = np.repeat(np.repeat(small, 2, axis=0), 2, axis=1)
    assert are_duplicates(small, larger, 0, 0)
    sliced = larger[:, ::2]
    assert compare_frames(sliced, sliced.copy()).is_duplicate


@pytest.mark.parametrize("bad, exception, message", [
    (None, TypeError, "NumPy"), ("image.png", TypeError, "NumPy"),
    ([[0, 1]], TypeError, "NumPy"),
    (np.empty((0, 4), dtype=np.uint8), ValueError, "empty"),
    (np.zeros((4,), dtype=np.uint8), ValueError, "grayscale"),
    (np.zeros((4, 4, 1), dtype=np.uint8), ValueError, "grayscale"),
    (np.zeros((4, 4, 2), dtype=np.uint8), ValueError, "grayscale"),
    (np.zeros((2, 2, 2, 3), dtype=np.uint8), ValueError, "grayscale"),
    (np.full((4, 4), np.nan), TypeError, "uint8"),
    (np.full((4, 4), np.inf), TypeError, "uint8"),
    (np.full((4, 4), -1, dtype=np.int16), TypeError, "uint8"),
    (np.full((4, 4), 300, dtype=np.uint16), TypeError, "uint8"),
    (np.zeros((4, 4), dtype=bool), TypeError, "uint8"),
])
def test_invalid_images(image, bad, exception, message):
    with pytest.raises(exception, match=message):
        calculate_dhash(bad)
    with pytest.raises(exception, match=message):
        calculate_pixel_difference(image, bad)
    with pytest.raises(exception, match=message):
        compare_frames(bad, image)


@pytest.mark.parametrize("kwargs, exception", [
    ({"hash_threshold": -1}, ValueError), ({"hash_threshold": 65}, ValueError),
    ({"hash_threshold": 1.5}, TypeError), ({"hash_threshold": float("nan")}, TypeError),
    ({"hash_threshold": float("inf")}, TypeError), ({"hash_threshold": True}, TypeError),
    ({"pixel_threshold": -1}, ValueError), ({"pixel_threshold": float("nan")}, ValueError),
    ({"pixel_threshold": float("inf")}, ValueError), ({"pixel_threshold": "12"}, TypeError),
    ({"pixel_threshold": True}, TypeError),
    pytest.param({"pixel_threshold": 10 ** 400}, ValueError, id="pixel-overflow"),
])
def test_invalid_thresholds(image, kwargs, exception):
    with pytest.raises(exception, match="threshold"):
        compare_frames(image, image, **kwargs)
    with pytest.raises(exception, match="threshold"):
        DuplicateFilter(**kwargs)


def test_input_preservation(image):
    other = cv2.bitwise_not(image)
    originals = image.copy(), other.copy()
    image.flags.writeable = False
    other.flags.writeable = False
    compare_frames(image, other)
    calculate_dhash(image)
    calculate_pixel_difference(image, other)
    detector = DuplicateFilter()
    detector.check(image)
    detector.check(other)
    np.testing.assert_array_equal(image, originals[0])
    np.testing.assert_array_equal(other, originals[1])


def test_first_frame_repeats_new_scene_and_reset(image):
    detector = DuplicateFilter()
    other = cv2.bitwise_not(image)
    first = detector.check(image)
    assert first.accepted and not first.is_duplicate
    assert first.hash_distance is None and first.pixel_difference is None
    assert detector.check(image).is_duplicate
    assert detector.check(image).is_duplicate
    assert detector.check(other).accepted
    assert detector.check(other).is_duplicate
    detector.reset()
    fresh = detector.check(other)
    assert fresh.accepted and fresh.hash_distance is None


def test_rejected_frames_do_not_replace_reference():
    detector = DuplicateFilter(pixel_threshold=10)
    frames = [np.full((20, 20, 3), value, dtype=np.uint8) for value in (100, 108, 116, 124)]
    assert detector.check(frames[0]).accepted
    assert detector.check(frames[1]).is_duplicate
    result = detector.check(frames[2])
    assert result.pixel_difference == 16
    assert result.accepted
    assert detector.check(frames[3]).is_duplicate


def test_reference_is_independent_of_caller_mutation(image):
    original = image.copy()
    detector = DuplicateFilter(0, 0)
    detector.check(image)
    image[:] = 0
    assert detector.check(original).is_duplicate


def test_invalid_frame_does_not_change_state(image):
    detector = DuplicateFilter()
    with pytest.raises(TypeError):
        detector.check(None)
    assert detector.check(image).accepted
    with pytest.raises(ValueError):
        detector.check(np.empty((0, 0), dtype=np.uint8))
    assert detector.check(image).is_duplicate


def test_text_change_under_conservative_thresholds():
    images = []
    for label in ("ROOM 205", "ROOM 206"):
        image = np.full((128, 320, 3), 230, dtype=np.uint8)
        cv2.putText(image, label, (10, 80), cv2.FONT_HERSHEY_SIMPLEX,
                    1.4, (20, 20, 20), 3)
        images.append(image)
    result = compare_frames(*images)
    assert result.pixel_difference > 0
    # Calibrate below the actual change; this is no guarantee for other text.
    assert not are_duplicates(*images, hash_threshold=64,
                              pixel_threshold=result.pixel_difference / 2)


def test_task3_task4_compatibility_and_metadata(tmp_path, image):
    path = tmp_path / "repeats.avi"
    other = cv2.bitwise_not(image)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (160, 128))
    assert writer.isOpened()
    try:
        for scene in (image, image, image, other, other, image):
            for _ in range(10):
                writer.write(scene)
    finally:
        writer.release()
    capture = cv2.VideoCapture(str(path))
    try:
        assert capture.isOpened() and capture.read()[0]
    finally:
        capture.release()
    detector = DuplicateFilter()
    decisions = []
    with FrameExtractor(path, recording_start=datetime(2020, 1, 1, tzinfo=UTC)) as extractor:
        for frame in extractor.extract_frames():
            metadata = (frame.source_video, frame.frame_index, frame.timestamp_ms, frame.captured_at)
            pixels = frame.frame.copy()
            assert evaluate_quality(frame.frame).sharpness_score > 0
            decisions.append(detector.check(frame.frame).accepted)
            assert metadata == (frame.source_video, frame.frame_index, frame.timestamp_ms, frame.captured_at)
            np.testing.assert_array_equal(frame.frame, pixels)
    assert decisions == [True, False, False, True, False, True]


@pytest.mark.parametrize("different, expected", [(False, "Yes"), (True, "No")])
def test_module_cli(tmp_path, image, different, expected):
    first, second = tmp_path / "a.png", tmp_path / "b.png"
    assert cv2.imwrite(str(first), image)
    assert cv2.imwrite(str(second), cv2.bitwise_not(image) if different else image)
    result = subprocess.run([sys.executable, "-m", "processing.duplicate_filter",
                             "--image-a", str(first), "--image-b", str(second),
                             "--hash-threshold", "0", "--pixel-threshold", "0"],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert f"Duplicate: {expected}" in result.stdout
    assert "Hash threshold: 0" in result.stdout
    assert "Pixel threshold: 0.00" in result.stdout
    assert "Analysis completed successfully" in result.stdout


def test_cli_invalid_path(tmp_path, capsys):
    path = str(tmp_path / "missing.png")
    assert main(["--image-a", path, "--image-b", path]) == 1
    assert "Image file not found" in capsys.readouterr().err


def test_cli_invalid_second_path(tmp_path, image, capsys):
    path = tmp_path / "valid.png"
    assert cv2.imwrite(str(path), image)
    assert main(["--image-a", str(path), "--image-b", str(tmp_path / "missing.png")]) == 1
    assert "Image file not found" in capsys.readouterr().err


def test_cli_unreadable_image(tmp_path, capsys):
    path = tmp_path / "bad.png"
    path.write_bytes(b"corrupted image")
    assert main(["--image-a", str(path), "--image-b", str(path)]) == 1
    assert "Cannot read image" in capsys.readouterr().err


def test_cli_invalid_threshold(capsys):
    assert main(["--image-a", "a.png", "--image-b", "b.png", "--hash-threshold", "65"]) == 1
    assert "hash_threshold" in capsys.readouterr().err
