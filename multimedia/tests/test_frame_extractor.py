"""Offline frame extraction tests using temporary, readable MJPG videos."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from processing.frame_extractor import FrameExtractor, main, save_frame
from processing.video_reader import VideoReader


@pytest.fixture
def make_video(tmp_path):
    def create(fps=10.0, count=60):
        path = tmp_path / f"sample_{fps}_{count}.avi"
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (64, 48))
        assert writer.isOpened(), "Cannot create MJPG test video"
        try:
            for index in range(count):
                writer.write(np.full((48, 64, 3), index % 256, dtype=np.uint8))
        finally:
            writer.release()
        capture = cv2.VideoCapture(str(path))
        try:
            assert capture.isOpened()
            success, image = capture.read()
            assert success and image.shape == (48, 64, 3)
        finally:
            capture.release()
        return path
    return create


@pytest.fixture
def video_path(make_video):
    return make_video()


def test_valid_extraction_and_images(video_path):
    with FrameExtractor(video_path) as extractor:
        frames = list(extractor.extract_frames())
    assert len(frames) == 6
    assert extractor.frames_extracted == 6
    for extracted in frames:
        assert extracted.source_video == str(video_path)
        assert isinstance(extracted.frame, np.ndarray)
        assert extracted.frame.shape == (48, 64, 3)
        assert extracted.frame.dtype == np.uint8
        assert extracted.frame.mean() == pytest.approx(extracted.frame_index, abs=2)
        assert extracted.captured_at is None


@pytest.mark.parametrize("interval, indices", [
    (0.5, list(range(0, 60, 5))), (1, list(range(0, 60, 10))),
    (2, [0, 20, 40]), (10, [0]),
])
def test_sampling_intervals(video_path, interval, indices):
    with FrameExtractor(video_path, interval) as extractor:
        frames = list(extractor.extract_frames())
    assert [item.frame_index for item in frames] == indices
    timestamps = [item.timestamp_ms for item in frames]
    assert timestamps == pytest.approx([index * 100 for index in indices])
    assert timestamps[0] == 0
    assert all(later > earlier for earlier, later in zip(timestamps, timestamps[1:]))


def test_save_jpegs(video_path, tmp_path):
    output = tmp_path / "images"
    with FrameExtractor(video_path) as extractor:
        for extracted in extractor.extract_frames():
            path = save_frame(extracted, output)
            assert path.name == f"frame_{extracted.frame_index:06d}.jpg"
            assert cv2.imread(str(path)).shape == (48, 64, 3)
    assert len(list(output.glob("*.jpg"))) == 6


def test_extraction_does_not_save(video_path, tmp_path):
    before = set(tmp_path.iterdir())
    with FrameExtractor(video_path) as extractor:
        list(extractor.extract_frames())
    assert set(tmp_path.iterdir()) == before


def test_maximum_sample_count(video_path):
    with FrameExtractor(video_path, max_frames=5) as extractor:
        frames = list(extractor.extract_frames())
        assert len(frames) == 5
        assert frames[-1].frame_index == 40
        assert extractor.reader.frames_read == 41
        assert extractor.reader.capture is None


def test_invalid_path(tmp_path):
    with pytest.raises(FileNotFoundError, match="Video file not found"):
        with FrameExtractor(tmp_path / "missing.mp4"):
            pass


@pytest.mark.parametrize("interval", [0, -1, float("nan"), float("inf")])
def test_invalid_interval(video_path, interval):
    with pytest.raises(ValueError, match="interval"):
        FrameExtractor(video_path, interval)


@pytest.mark.parametrize("limit", [0, -1, 1.5, True])
def test_invalid_maximum(video_path, limit):
    with pytest.raises(ValueError, match="max_frames"):
        FrameExtractor(video_path, max_frames=limit)


@pytest.mark.parametrize("content, message", [(b"", "empty"), (b"corrupted", "Cannot open")])
def test_empty_or_invalid_video(tmp_path, content, message):
    path = tmp_path / "invalid.mp4"
    path.write_bytes(content)
    with pytest.raises(ValueError, match=message):
        with FrameExtractor(path):
            pass


def test_success_releases_capture(video_path):
    with FrameExtractor(video_path) as extractor:
        capture = extractor.reader.capture
        list(extractor.extract_frames())
        assert not capture.isOpened()
    assert extractor.reader.capture is None


def test_processing_error_releases_capture(video_path):
    with pytest.raises(RuntimeError, match="Processing failed"):
        with FrameExtractor(video_path) as extractor:
            capture = extractor.reader.capture
            for extracted in extractor.extract_frames():
                raise RuntimeError("Processing failed")
    assert not capture.isOpened()


def test_decode_error_releases_capture(video_path):
    with FrameExtractor(video_path) as extractor:
        capture = extractor.reader.capture
        with patch.object(extractor.reader, "read_frame", side_effect=cv2.error("Decode failed")):
            with pytest.raises(cv2.error, match="Decode failed"):
                list(extractor.extract_frames())
        assert not capture.isOpened()


def test_early_break_releases_capture(video_path):
    with FrameExtractor(video_path) as extractor:
        capture = extractor.reader.capture
        for extracted in extractor.extract_frames():
            break
    assert not capture.isOpened()


@pytest.mark.parametrize("fps", [None, 0, float("nan"), float("inf")])
def test_unknown_fps_is_rejected_and_released(video_path, fps):
    extractor = FrameExtractor(video_path)
    with patch.object(extractor.reader, "get_metadata", return_value={"fps": fps}):
        with pytest.raises(ValueError, match="FPS"):
            with extractor:
                pass
    assert extractor.reader.capture is None


def test_noninteger_fps_without_sampling_drift(make_video):
    path = make_video(fps=29.97, count=301)
    with FrameExtractor(path) as extractor:
        fps = extractor.metadata["fps"]
        assert fps == pytest.approx(29.97, abs=0.01)
        frames = list(extractor.extract_frames())
    assert [item.frame_index for item in frames] == [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300]
    for target, extracted in enumerate(frames):
        assert extracted.timestamp_ms == pytest.approx(extracted.frame_index / fps * 1000)
        assert target * 1000 <= extracted.timestamp_ms + 1e-6
        assert extracted.timestamp_ms - target * 1000 < 1000 / fps


def test_fractional_frame_step_does_not_round_repeatedly(make_video):
    path = make_video(fps=7.5, count=40)
    with FrameExtractor(path) as extractor:
        frames = list(extractor.extract_frames())
    assert [item.frame_index for item in frames] == [0, 8, 15, 23, 30, 38]


def test_sampling_faster_than_video_has_no_duplicates(video_path):
    with FrameExtractor(video_path, interval=0.01) as extractor:
        frames = list(extractor.extract_frames())
    assert [item.frame_index for item in frames] == list(range(60))


def test_end_of_video_and_reader_compatibility(video_path):
    with FrameExtractor(video_path, max_frames=100) as extractor:
        assert isinstance(extractor.reader, VideoReader)
        frames = list(extractor.extract_frames())
        assert extractor.reader.frames_read == 60
    assert frames[-1].frame_index == 50
    with VideoReader(video_path) as reader:
        assert sum(1 for _ in reader.read_frames()) == 60


def test_explicit_recording_start_converts_to_utc(video_path):
    start = datetime(2020, 1, 2, 3, 0, tzinfo=timezone(timedelta(hours=2)))
    with FrameExtractor(video_path, recording_start=start) as extractor:
        frames = list(extractor.extract_frames())
    assert frames[0].captured_at == "2020-01-02T01:00:00Z"
    assert frames[1].captured_at == "2020-01-02T01:00:01Z"
    assert frames[1].timestamp_ms == 1000


def test_naive_recording_start_rejected(video_path):
    with pytest.raises(ValueError, match="timezone"):
        FrameExtractor(video_path, recording_start=datetime(2020, 1, 2))


def test_save_failure_releases_capture(video_path, tmp_path):
    with pytest.raises(OSError, match="Could not save JPEG"):
        with FrameExtractor(video_path) as extractor:
            capture = extractor.reader.capture
            with patch("processing.frame_extractor.cv2.imwrite", return_value=False):
                for extracted in extractor.extract_frames():
                    save_frame(extracted, tmp_path / "output")
    assert not capture.isOpened()


def test_cli(video_path, tmp_path, capsys):
    output = tmp_path / "output"
    assert main(["--video", str(video_path), "--interval", "0.5",
                 "--max-frames", "5", "--output", str(output)]) == 0
    text = capsys.readouterr().out
    assert "Resolution: 64x48" in text
    assert "Frame 20 - 2000.000 ms" in text
    assert "Total extracted frames: 5" in text
    assert "Extraction completed" in text
    assert len(list(output.glob("*.jpg"))) == 5


@pytest.mark.parametrize("arguments, message", [
    ([], "Video file not found"), (["--interval", "0"], "interval"),
    (["--recording-start", "2020-01-02T00:00:00"], "timezone"),
])
def test_cli_invalid_inputs(tmp_path, capsys, arguments, message):
    assert main(["--video", str(tmp_path / "missing.mp4"), *arguments]) == 1
    assert message in capsys.readouterr().err
