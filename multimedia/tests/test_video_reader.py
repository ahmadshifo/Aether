"""Offline tests using a temporary, independently verified MJPG video."""

from unittest.mock import Mock, patch

import cv2
import numpy as np
import pytest

from processing.video_reader import VideoReader, main


@pytest.fixture
def video_path(tmp_path):
    path = tmp_path / "sample.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10.0, (64, 48))
    assert writer.isOpened(), "OpenCV could not create the MJPG test fixture"
    try:
        for index in range(20):
            writer.write(np.full((48, 64, 3), index * 10, dtype=np.uint8))
    finally:
        writer.release()
    capture = cv2.VideoCapture(str(path))
    try:
        assert capture.isOpened(), "Generated test video could not be opened"
        success, frame = capture.read()
        assert success and frame.shape == (48, 64, 3)
    finally:
        capture.release()
    return path


def test_valid_video(video_path):
    with VideoReader(video_path) as reader:
        assert reader.capture.isOpened()
        assert reader.read_frame() is not None


def test_metadata(video_path):
    with VideoReader(video_path) as reader:
        metadata = reader.get_metadata()
        assert metadata["width"] == 64
        assert metadata["height"] == 48
        assert metadata["fps"] == pytest.approx(10.0)
        assert metadata["frame_count"] == 20
        assert metadata["duration"] == pytest.approx(2.0)


def test_reading_frames(video_path):
    with VideoReader(video_path) as reader:
        previous_mean = -1
        for frame in reader.read_frames():
            assert isinstance(frame, np.ndarray)
            assert frame.shape == (48, 64, 3)
            assert frame.dtype == np.uint8
            assert frame.mean() > previous_mean
            previous_mean = frame.mean()
        assert reader.frames_read == 20


def test_end_of_video_releases_capture(video_path):
    reader = VideoReader(video_path).open()
    capture = reader.capture
    while reader.read_frame() is not None:
        pass
    assert reader.frames_read == 20
    assert not capture.isOpened()
    assert reader.capture is None
    reader.release()  # Cleanup is idempotent.


def test_invalid_path(tmp_path):
    with pytest.raises(FileNotFoundError, match="Video file not found"):
        VideoReader(tmp_path / "missing.mp4").open()


def test_processing_error_releases_capture(video_path):
    with pytest.raises(RuntimeError, match="Processing failed"):
        with VideoReader(video_path) as reader:
            capture = reader.capture
            for frame in reader.read_frames():
                raise RuntimeError("Processing failed")
    assert not capture.isOpened()
    assert reader.capture is None


def test_early_break_releases_capture(video_path):
    with VideoReader(video_path) as reader:
        capture = reader.capture
        for frame in reader.read_frames():
            break
    assert not capture.isOpened()


@pytest.mark.parametrize("limit, expected", [(10, 10), (30, 20)])
def test_maximum_frame_limit(video_path, limit, expected):
    with VideoReader(video_path) as reader:
        capture = reader.capture
        assert sum(1 for _ in reader.read_frames(limit)) == expected
        assert reader.frames_read == expected
        assert not capture.isOpened()


@pytest.mark.parametrize("content, message", [(b"", "empty"), (b"invalid video", "Cannot open")])
def test_empty_or_corrupted_file(tmp_path, content, message):
    path = tmp_path / "invalid.mp4"
    path.write_bytes(content)
    reader = VideoReader(path)
    with pytest.raises(ValueError, match=message):
        reader.open()
    assert reader.capture is None


def test_failed_open_releases_capture(video_path):
    capture = Mock()
    capture.isOpened.return_value = False
    with patch("processing.video_reader.cv2.VideoCapture", return_value=capture):
        with pytest.raises(ValueError, match="Cannot open"):
            VideoReader(video_path).open()
    capture.release.assert_called_once()


def test_read_error_releases_capture(video_path):
    capture = Mock()
    capture.read.side_effect = cv2.error("Decode failed")
    with patch("processing.video_reader.cv2.VideoCapture", return_value=capture):
        reader = VideoReader(video_path).open()
        with pytest.raises(cv2.error, match="Decode failed"):
            reader.read_frame()
    capture.release.assert_called_once()


@pytest.mark.parametrize("fps, count", [(0, 20), (float("nan"), 20), (10, 0), (10, float("inf"))])
def test_unknown_metadata_has_no_duration(video_path, fps, count):
    capture = Mock()
    properties = {cv2.CAP_PROP_FRAME_WIDTH: 64, cv2.CAP_PROP_FRAME_HEIGHT: 48,
                  cv2.CAP_PROP_FPS: fps, cv2.CAP_PROP_FRAME_COUNT: count}
    capture.get.side_effect = properties.__getitem__
    with patch("processing.video_reader.cv2.VideoCapture", return_value=capture):
        with VideoReader(video_path) as reader:
            assert reader.get_metadata()["duration"] is None


@pytest.mark.parametrize("limit", [0, -1])
def test_invalid_limit_releases_capture(video_path, limit):
    reader = VideoReader(video_path).open()
    capture = reader.capture
    with pytest.raises(ValueError, match="positive integer"):
        list(reader.read_frames(limit))
    assert not capture.isOpened()


def test_cli(video_path, capsys):
    assert main(["--video", str(video_path), "--max-frames", "10"]) == 0
    output = capsys.readouterr().out
    assert "Width: 64" in output
    assert "Frames successfully read: 10" in output
    assert "Video released successfully" in output


def test_cli_invalid_path(tmp_path, capsys):
    assert main(["--video", str(tmp_path / "missing.mp4")]) == 1
    assert "Error: Video file not found" in capsys.readouterr().err
