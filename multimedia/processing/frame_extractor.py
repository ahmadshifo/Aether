"""Sample a local video incrementally, with optional JPEG output."""

import argparse
import math
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import numpy as np

from .video_reader import VideoReader


@dataclass
class ExtractedFrame:
    source_video: str
    frame_index: int
    timestamp_ms: float
    frame: np.ndarray
    captured_at: str | None = None


class FrameExtractor:
    """Use in a with block to release resources on early breaks and errors.

    Select the first frame at or after each interval, starting at frame zero.
    Timestamps are index / FPS, appropriate for constant-frame-rate video.
    Variable-frame-rate video may have approximate timings. Missing FPS is
    rejected rather than guessed. Intervals below one frame return each frame
    once, without duplicating images.
    """

    def __init__(self, video_path: str | Path, interval: float = 1.0,
                 max_frames: int | None = None,
                 recording_start: datetime | None = None):
        if not math.isfinite(interval) or interval <= 0:
            raise ValueError("interval must be a finite positive number of seconds.")
        if max_frames is not None and (type(max_frames) is not int or max_frames <= 0):
            raise ValueError("max_frames must be a positive integer.")
        if recording_start is not None:
            if recording_start.utcoffset() is None:
                raise ValueError("recording_start must include a timezone.")
            recording_start = recording_start.astimezone(UTC)
        self.reader = VideoReader(video_path)
        self.interval = interval
        self.max_frames = max_frames
        self.recording_start = recording_start
        self.metadata = None
        self.frames_extracted = 0

    def __enter__(self):
        try:
            self.reader.open()
            self.metadata = self.reader.get_metadata()
            fps = self.metadata["fps"]
            if fps is None or not math.isfinite(fps) or fps <= 0:
                raise ValueError("A finite positive video FPS is required for sampling.")
            if not math.isfinite(self.interval * fps):
                raise ValueError("interval is too large for this video FPS.")
            self.frames_extracted = 0
        except Exception:
            self.reader.release()
            raise
        return self

    def extract_frames(self):
        """Yield selected frames; close the reader on exhaustion or failure."""
        try:
            if self.metadata is None or self.reader.capture is None:
                raise RuntimeError("Use FrameExtractor inside a with block.")
            fps = self.metadata["fps"]
            frame_step = self.interval * fps
            next_index = 0
            while self.max_frames is None or self.frames_extracted < self.max_frames:
                image = self.reader.read_frame()
                if image is None:
                    break
                index = self.reader.frames_read - 1
                if index < next_index:
                    continue
                timestamp_ms = index / fps * 1000
                captured_at = None
                if self.recording_start is not None:
                    captured_at = (self.recording_start + timedelta(milliseconds=timestamp_ms)).isoformat().replace("+00:00", "Z")
                self.frames_extracted += 1
                # Compute each target from its ordinal, avoiding rounded-step drift.
                # The tolerance avoids moving an exact integer target one frame ahead.
                next_index = max(index + 1, math.ceil(self.frames_extracted * frame_step - 1e-9))
                yield ExtractedFrame(str(self.reader.video_path), index,
                                     timestamp_ms, image, captured_at)
        finally:
            self.reader.release()

    def __exit__(self, exc_type, exc_value, traceback):
        self.reader.release()


def save_frame(extracted: ExtractedFrame, output_dir: str | Path) -> Path:
    """Optionally save one selected frame as JPEG; extraction never saves it."""
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"frame_{extracted.frame_index:06d}.jpg"
    if not cv2.imwrite(str(destination), extracted.frame):
        raise OSError(f"Could not save JPEG: {destination}")
    return destination


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, help="Local video path")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between samples (default: 1)")
    parser.add_argument("--output", help="Optional directory for JPEG images")
    parser.add_argument("--max-frames", type=int, help="Maximum number of sampled images")
    parser.add_argument("--recording-start", help="Actual recording start as ISO 8601 with timezone")
    args = parser.parse_args(argv)
    try:
        recording_start = datetime.fromisoformat(args.recording_start) if args.recording_start else None
        with FrameExtractor(args.video, args.interval, args.max_frames, recording_start) as extractor:
            metadata = extractor.metadata
            print("Video opened successfully")
            print(f"Video source: {args.video}")
            print(f"Resolution: {metadata['width']}x{metadata['height']}")
            print(f"FPS: {metadata['fps']}")
            print(f"Sampling interval: {args.interval:g} seconds")
            print("\nExtracting frames...")
            for extracted in extractor.extract_frames():
                print(f"Frame {extracted.frame_index} - {extracted.timestamp_ms:.3f} ms")
                if extracted.captured_at is not None:
                    print(f"  UTC timestamp: {extracted.captured_at}")
                if args.output is not None:
                    save_frame(extracted, args.output)
            print(f"Total extracted frames: {extractor.frames_extracted}")
        if args.output is not None:
            print(f"Images saved successfully to: {Path(args.output).resolve()}")
        print("Extraction completed; video released successfully")
        return 0
    except (OSError, ValueError, RuntimeError, OverflowError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
