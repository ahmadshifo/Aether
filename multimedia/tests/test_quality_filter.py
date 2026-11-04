"""Deterministic sharpness tests with synthetic images and a temporary video."""

import math
import subprocess
import sys
from datetime import UTC, datetime

import cv2
import numpy as np
import pytest

from processing.frame_extractor import FrameExtractor
from processing.quality_filter import (
    QualityResult, calculate_sharpness, evaluate_quality, is_blurry, main,
)


@pytest.fixture
def sharp_image():
    image = np.zeros((128, 160, 3), dtype=np.uint8)
    cv2.rectangle(image, (10, 10), (70, 110), (255, 255, 255), 2)
    cv2.putText(image, "TEST", (20, 70), cv2.FONT_HERSHEY_SIMPLEX, 1,
                (0, 255, 255), 2)
    for x in range(90, 150, 8):
        cv2.line(image, (x, 10), (x, 115), (255, 0, 0), 2)
    return image


def test_sharp_image_has_positive_finite_score(sharp_image):
    score = calculate_sharpness(sharp_image)
    assert isinstance(score, float)
    assert math.isfinite(score) and score > 0


def test_blur_reduces_score_and_calibrated_classification(sharp_image):
    blurred = cv2.GaussianBlur(sharp_image, (15, 15), 0)
    sharp_score = calculate_sharpness(sharp_image)
    blurred_score = calculate_sharpness(blurred)
    assert 0 <= blurred_score < sharp_score
    threshold = (sharp_score + blurred_score) / 2
    assert evaluate_quality(sharp_image, threshold).accepted
    assert not is_blurry(sharp_image, threshold)
    assert evaluate_quality(blurred, threshold).is_blurry
    assert not evaluate_quality(blurred, threshold).accepted


def test_threshold_changes_and_equality(sharp_image):
    score = calculate_sharpness(sharp_image)
    assert not is_blurry(sharp_image, score / 2)
    assert not is_blurry(sharp_image, score)
    assert is_blurry(sharp_image, score + 1)


def test_grayscale_matches_color_conversion(sharp_image):
    gray = cv2.cvtColor(sharp_image, cv2.COLOR_BGR2GRAY)
    assert calculate_sharpness(gray) == pytest.approx(calculate_sharpness(sharp_image))


def test_bgra_matches_bgr_and_ignores_alpha(sharp_image):
    bgra = cv2.cvtColor(sharp_image, cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = np.arange(bgra.shape[1], dtype=np.uint8)
    assert calculate_sharpness(bgra) == pytest.approx(calculate_sharpness(sharp_image))


@pytest.mark.parametrize("shape", [(0,), (0, 10), (10, 0, 3)])
def test_empty_arrays_rejected(shape):
    with pytest.raises(ValueError, match="empty"):
        calculate_sharpness(np.empty(shape, dtype=np.uint8))


@pytest.mark.parametrize("image", [None, "image.jpg", [[0, 1]], 5])
def test_invalid_types_rejected(image):
    with pytest.raises(TypeError, match="NumPy array"):
        calculate_sharpness(image)


@pytest.mark.parametrize("shape", [(), (10,), (4, 4, 1), (4, 4, 2), (4, 4, 5), (2, 2, 2, 3)])
def test_invalid_dimensions_rejected(shape):
    with pytest.raises(ValueError, match="grayscale"):
        calculate_sharpness(np.zeros(shape, dtype=np.uint8))


@pytest.mark.parametrize("image", [
    np.full((4, 4), float("nan")), np.full((4, 4), float("inf")),
    np.full((4, 4), -1, dtype=np.int16), np.zeros((4, 4), dtype=np.uint16),
    np.zeros((4, 4), dtype=bool), np.full((4, 4), "bad", dtype=object),
])
def test_unsupported_pixel_data_rejected(image):
    with pytest.raises(TypeError, match="uint8"):
        calculate_sharpness(image)


@pytest.mark.parametrize("format", ["gray", "bgr", "bgra"])
def test_original_pixels_preserved(sharp_image, format):
    image = sharp_image
    if format == "gray":
        image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    elif format == "bgra":
        image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    original = image.copy()
    image.flags.writeable = False
    evaluate_quality(image)
    np.testing.assert_array_equal(image, original)


def test_noncontiguous_image(sharp_image):
    image = sharp_image[:, ::2]
    assert calculate_sharpness(image) == pytest.approx(calculate_sharpness(image.copy()))


@pytest.mark.parametrize("threshold", [
    -1, float("nan"), float("inf"), -float("inf"),
    pytest.param(10 ** 400, id="overflow"),
])
def test_invalid_numeric_thresholds(sharp_image, threshold):
    with pytest.raises(ValueError, match="threshold"):
        evaluate_quality(sharp_image, threshold)


@pytest.mark.parametrize("threshold", [None, "100", True, 1 + 2j, [100]])
def test_invalid_threshold_types(sharp_image, threshold):
    with pytest.raises(TypeError, match="threshold"):
        is_blurry(sharp_image, threshold)


def test_result_format_and_constant_image():
    image = np.full((20, 20, 3), 127, dtype=np.uint8)
    result = evaluate_quality(image)
    assert isinstance(result, QualityResult)
    assert type(result.sharpness_score) is float
    assert type(result.threshold) is float
    assert type(result.is_blurry) is bool
    assert type(result.accepted) is bool
    assert result.sharpness_score == 0
    assert result.threshold == 100
    assert result.is_blurry and not result.accepted
    assert evaluate_quality(image, threshold=0).accepted


def test_task3_integration_and_metadata_preservation(tmp_path, sharp_image):
    path = tmp_path / "quality.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (160, 128))
    assert writer.isOpened()
    try:
        for _ in range(20):
            writer.write(sharp_image)
    finally:
        writer.release()
    capture = cv2.VideoCapture(str(path))
    try:
        assert capture.isOpened() and capture.read()[0]
    finally:
        capture.release()
    start = datetime(2020, 1, 1, tzinfo=UTC)
    count = 0
    with FrameExtractor(path, recording_start=start) as extractor:
        for extracted in extractor.extract_frames():
            metadata = (extracted.source_video, extracted.frame_index,
                        extracted.timestamp_ms, extracted.captured_at)
            pixels = extracted.frame.copy()
            image = extracted.frame
            result = evaluate_quality(image)
            assert result.sharpness_score > 0
            assert metadata == (extracted.source_video, extracted.frame_index,
                                extracted.timestamp_ms, extracted.captured_at)
            assert extracted.frame is image
            np.testing.assert_array_equal(extracted.frame, pixels)
            count += 1
    assert count == 2


def test_module_cli_with_custom_threshold(tmp_path, sharp_image):
    path = tmp_path / "sharp.png"
    assert cv2.imwrite(str(path), sharp_image)
    result = subprocess.run([sys.executable, "-m", "processing.quality_filter",
                             "--image", str(path), "--threshold", "0"],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "Resolution: 160x128" in result.stdout
    assert "Threshold: 0.00" in result.stdout
    assert "Blurry: No" in result.stdout
    assert "Accepted: Yes" in result.stdout
    assert "Analysis completed successfully" in result.stdout


def test_cli_default_threshold(tmp_path, sharp_image, capsys):
    path = tmp_path / "sharp.png"
    assert cv2.imwrite(str(path), sharp_image)
    assert main(["--image", str(path)]) == 0
    assert "Threshold: 100.00" in capsys.readouterr().out


def test_cli_missing_path(tmp_path, capsys):
    assert main(["--image", str(tmp_path / "missing.png")]) == 1
    assert "Error: Image file not found" in capsys.readouterr().err


@pytest.mark.parametrize("content", [b"", b"invalid image"])
def test_cli_unreadable_image(tmp_path, capsys, content):
    path = tmp_path / "invalid.png"
    path.write_bytes(content)
    assert main(["--image", str(path)]) == 1
    assert "Error: Cannot read image" in capsys.readouterr().err


def test_cli_invalid_threshold(tmp_path, capsys):
    assert main(["--image", str(tmp_path / "missing.png"), "--threshold", "-1"]) == 1
    assert "threshold" in capsys.readouterr().err
