"""Read a local video sequentially with OpenCV, without displaying a window."""

import argparse
import math
import sys
from pathlib import Path

import cv2
import numpy as np


class VideoReader:
    """Use as a context manager so processing errors also release the video."""

    def __init__(self, video_path: str | Path):
        self.video_path = Path(video_path)
        self.capture = None
        self.frames_read = 0

    def open(self):
        """Validate and open a local file. Calling again starts a new reading."""
        self.release()
        self.frames_read = 0
        if not self.video_path.is_file():
            raise FileNotFoundError(f"Video file not found: {self.video_path}")
        if self.video_path.stat().st_size == 0:
            raise ValueError(f"Video file is empty: {self.video_path}")

        try:
            self.capture = cv2.VideoCapture(str(self.video_path))
            if not self.capture.isOpened():
                raise ValueError(f"Cannot open video: {self.video_path}")
        except Exception:
            self.release()
            raise
        return self

    def get_metadata(self) -> dict:
        """Return available metadata; unknown values and duration are None."""
        if self.capture is None or not self.capture.isOpened():
            raise RuntimeError("Open the video before retrieving metadata.")

        def positive_value(property_id):
            value = self.capture.get(property_id)
            return value if math.isfinite(value) and value > 0 else None

        width = positive_value(cv2.CAP_PROP_FRAME_WIDTH)
        height = positive_value(cv2.CAP_PROP_FRAME_HEIGHT)
        fps = positive_value(cv2.CAP_PROP_FPS)
        frame_count = positive_value(cv2.CAP_PROP_FRAME_COUNT)
        return {
            "width": int(width) if width else None,
            "height": int(height) if height else None,
            "fps": fps,
            "frame_count": int(frame_count) if frame_count else None,
            "duration": frame_count / fps if frame_count and fps else None,
        }

    def read_frame(self) -> np.ndarray | None:
        """Return the next BGR frame, or None at end of video; count successes."""
        if self.capture is None or not self.capture.isOpened():
            raise RuntimeError("Open the video before reading frames.")
        try:
            success, frame = self.capture.read()
        except Exception:
            self.release()
            raise
        if not success:
            self.release()
            return None
        self.frames_read += 1
        return frame

    def read_frames(self, max_frames: int | None = None):
        """Yield one frame at a time and release at EOF, a limit, or an error.

        Use a with block when stopping iteration early or processing frames,
        so cleanup does not depend on the generator being closed.
        """
        try:
            if max_frames is not None and max_frames <= 0:
                raise ValueError("max_frames must be a positive integer.")
            count = 0
            while max_frames is None or count < max_frames:
                frame = self.read_frame()
                if frame is None:
                    break
                count += 1
                yield frame
        finally:
            self.release()

    def release(self):
        """Release the capture; safe to call more than once."""
        if self.capture is not None:
            self.capture.release()
            self.capture = None

    def __enter__(self):
        return self.open()

    def __exit__(self, exc_type, exc_value, traceback):
        self.release()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, help="Path to a local video file")
    parser.add_argument("--max-frames", type=int, help="Positive maximum frames to read")
    args = parser.parse_args(argv)
    if args.max_frames is not None and args.max_frames <= 0:
        parser.error("--max-frames must be a positive integer")

    try:
        with VideoReader(args.video) as reader:
            print("Video opened successfully")
            metadata = reader.get_metadata()
            for key, label in (("width", "Width"), ("height", "Height"),
                               ("fps", "FPS"), ("frame_count", "Total frames")):
                value = metadata[key]
                print(f"{label}: {value if value is not None else 'Unavailable'}")
            duration = metadata["duration"]
            print(f"Duration (estimated): {duration:.3f} seconds" if duration is not None
                  else "Duration: Unavailable")
            print("\nReading frames...")
            for frame in reader.read_frames(args.max_frames):
                pass  # Task 2 only reads; future tasks can process this BGR array.
            print(f"Frames successfully read: {reader.frames_read}")
        print("Video released successfully")
        return 0
    except (OSError, ValueError, RuntimeError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
