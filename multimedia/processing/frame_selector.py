"""Select clear, changed or periodically needed frames using Tasks 3-5."""

import argparse
import math
import sys
from dataclasses import dataclass, replace
from numbers import Real
from pathlib import Path

import cv2

from .duplicate_filter import DuplicateFilter
from .frame_extractor import ExtractedFrame, FrameExtractor, save_frame
from .quality_filter import evaluate_quality


@dataclass(frozen=True)
class SelectionResult:
    source_video: str
    frame_index: int
    timestamp_ms: float
    captured_at: str | None
    accepted: bool
    reason: str
    sharpness_score: float
    is_blurry: bool
    is_duplicate: bool | None
    hash_distance: int | None
    pixel_difference: float | None


@dataclass
class SelectionStats:
    total_evaluated: int = 0
    accepted: int = 0
    rejected: int = 0
    blurry: int = 0
    duplicates: int = 0
    first_frames: int = 0
    periodic_frames: int = 0
    new_scenes: int = 0


def _finite_number(value, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError(f"{name} must be a finite real number.")
    try:
        value = float(value)
    except OverflowError as error:
        raise ValueError(f"{name} must be finite.") from error
    if not math.isfinite(value) or value < 0 or (positive and value == 0):
        condition = "positive" if positive else "nonnegative"
        raise ValueError(f"{name} must be finite and {condition}.")
    return value


class FrameSelector:
    """Evaluate sequential ExtractedFrame objects without retaining images.

    Quality is checked first. Clear frames are accepted as first_frame,
    new_scene, or periodic_frame; other frames are blurry or duplicate.
    Periodic coverage uses an inclusive gap boundary in video time. None
    disables it. Reset before starting a new video/session.
    """

    def __init__(self, sharpness_threshold: float = 100.0,
                 hash_threshold: int = 6, pixel_threshold: float = 12.0,
                 max_gap_seconds: float | None = 10.0):
        self.sharpness_threshold = _finite_number(sharpness_threshold, "sharpness_threshold")
        self.max_gap_seconds = (
            None if max_gap_seconds is None
            else _finite_number(max_gap_seconds, "max_gap_seconds", positive=True)
        )
        self._duplicate_filter = DuplicateFilter(hash_threshold, pixel_threshold)
        self.reset()

    @property
    def stats(self) -> SelectionStats:
        """Return a snapshot; changing it cannot corrupt internal counts."""
        return replace(self._stats)

    @property
    def last_accepted_timestamp_ms(self) -> float | None:
        return self._last_accepted_timestamp_ms

    def reset(self):
        self._duplicate_filter.reset()
        self._last_timestamp_ms = None
        self._last_accepted_timestamp_ms = None
        self._stats = SelectionStats()

    def evaluate(self, frame: ExtractedFrame) -> SelectionResult:
        """Return one decision. Invalid inputs raise without updating state."""
        if not isinstance(frame, ExtractedFrame):
            raise TypeError("frame must be an ExtractedFrame from Task 3.")
        timestamp = _finite_number(frame.timestamp_ms, "timestamp_ms")
        if self._last_timestamp_ms is not None and timestamp < self._last_timestamp_ms:
            raise ValueError("timestamp_ms must be monotonically nondecreasing; reset for a new session.")

        quality = evaluate_quality(frame.frame, self.sharpness_threshold)
        duplicate = None
        if quality.is_blurry:
            accepted, reason = False, "blurry"
        else:
            duplicate = self._duplicate_filter.check(frame.frame)
            if self._last_accepted_timestamp_ms is None:
                accepted, reason = True, "first_frame"
            elif not duplicate.is_duplicate:
                accepted, reason = True, "new_scene"
            elif (self.max_gap_seconds is not None and
                  (timestamp - self._last_accepted_timestamp_ms) / 1000 >= self.max_gap_seconds):
                # check() leaves duplicate references unchanged; this explicit
                # policy acceptance must update it, as well as the coverage timer.
                self._duplicate_filter.set_reference(frame.frame)
                accepted, reason = True, "periodic_frame"
            else:
                accepted, reason = False, "duplicate"

        result = SelectionResult(
            source_video=frame.source_video, frame_index=frame.frame_index,
            timestamp_ms=frame.timestamp_ms, captured_at=frame.captured_at,
            accepted=accepted, reason=reason, sharpness_score=quality.sharpness_score,
            is_blurry=quality.is_blurry,
            is_duplicate=duplicate.is_duplicate if duplicate and reason != "first_frame" else None,
            hash_distance=duplicate.hash_distance if duplicate else None,
            pixel_difference=duplicate.pixel_difference if duplicate else None,
        )
        self._last_timestamp_ms = timestamp
        if accepted:
            self._last_accepted_timestamp_ms = timestamp
        self._record(result)
        return result

    def _record(self, result: SelectionResult):
        stats = self._stats
        stats.total_evaluated += 1
        if result.accepted:
            stats.accepted += 1
        else:
            stats.rejected += 1
        if result.reason == "first_frame":
            stats.first_frames += 1
        elif result.reason == "new_scene":
            stats.new_scenes += 1
        elif result.reason == "periodic_frame":
            stats.periodic_frames += 1
        elif result.reason == "blurry":
            stats.blurry += 1
        elif result.reason == "duplicate":
            stats.duplicates += 1


def _gap_argument(value: str) -> float | None:
    if value.lower() == "none":
        return None
    try:
        return float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("--max-gap must be seconds or 'none'.") from error


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--interval", type=float, default=1.0, help="Sampling interval in seconds")
    parser.add_argument("--sharpness-threshold", type=float, default=100.0)
    parser.add_argument("--hash-threshold", type=int, default=6)
    parser.add_argument("--pixel-threshold", type=float, default=12.0)
    parser.add_argument("--max-gap", type=_gap_argument, default=10.0,
                        help="Maximum gap in seconds, or 'none' to disable coverage")
    parser.add_argument("--output", help="Optional directory for accepted JPEGs only")
    args = parser.parse_args(argv)
    try:
        selector = FrameSelector(args.sharpness_threshold, args.hash_threshold,
                                 args.pixel_threshold, args.max_gap)
        with FrameExtractor(args.video, interval=args.interval) as extractor:
            print("Aether - Useful Frame Selection\n")
            print(f"Video: {args.video}")
            print(f"Sampling interval: {args.interval:g} seconds")
            print(f"Sharpness threshold: {selector.sharpness_threshold:g}")
            print(f"Duplicate thresholds: hash={args.hash_threshold}, pixels={args.pixel_threshold:g}")
            print(f"Maximum gap: {args.max_gap if args.max_gap is not None else 'disabled'} seconds\n")
            for frame in extractor.extract_frames():
                result = selector.evaluate(frame)
                print(f"Frame {result.frame_index} | {result.timestamp_ms:.3f} ms | "
                      f"Sharpness: {result.sharpness_score:.2f} | "
                      f"{'ACCEPTED' if result.accepted else 'REJECTED'} | {result.reason}")
                if result.accepted and args.output is not None:
                    save_frame(frame, args.output)
        stats = selector.stats
        print("\nFrame Selection Summary")
        for label, value in (
            ("Total evaluated", stats.total_evaluated), ("Accepted", stats.accepted),
            ("Rejected", stats.rejected), ("Blurry", stats.blurry),
            ("Duplicates", stats.duplicates), ("First frames", stats.first_frames),
            ("Periodic frames", stats.periodic_frames), ("New scenes", stats.new_scenes),
        ):
            print(f"{label}: {value}")
        if args.output is not None:
            print(f"Accepted images saved to: {Path(args.output).resolve()}")
        print("Selection completed; video released successfully")
        return 0
    except (OSError, TypeError, ValueError, RuntimeError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
