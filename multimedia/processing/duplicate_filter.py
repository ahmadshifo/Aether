"""Compare frames using dHash and mean grayscale pixel difference."""

import argparse
import math
import sys
from dataclasses import dataclass
from numbers import Integral, Real
from pathlib import Path

import cv2
import numpy as np

from .image_utils import to_grayscale


@dataclass(frozen=True)
class DuplicateResult:
    # No comparison is possible for the first frame after construction/reset.
    hash_distance: int | None
    pixel_difference: float | None
    hash_threshold: int
    pixel_threshold: float
    is_duplicate: bool

    @property
    def accepted(self) -> bool:
        return not self.is_duplicate


def _validate_integer(value, name: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise TypeError(f"{name} must be an integer between 0 and {maximum}.")
    if not 0 <= value <= maximum:
        raise ValueError(f"{name} must be between 0 and {maximum}.")
    return int(value)


def _validate_thresholds(hash_threshold, pixel_threshold) -> tuple[int, float]:
    hash_threshold = _validate_integer(hash_threshold, "hash_threshold", 64)
    if isinstance(pixel_threshold, bool) or not isinstance(pixel_threshold, Real):
        raise TypeError("pixel_threshold must be a finite nonnegative real number.")
    try:
        pixel_threshold = float(pixel_threshold)
    except OverflowError as error:
        raise ValueError("pixel_threshold must be finite.") from error
    if not math.isfinite(pixel_threshold) or pixel_threshold < 0:
        raise ValueError("pixel_threshold must be finite and nonnegative.")
    return hash_threshold, pixel_threshold


def _dhash_from_gray(gray: np.ndarray) -> int:
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    differences = small[:, :-1] > small[:, 1:]
    value = 0
    for bit in differences.flat:
        value = (value << 1) | int(bit)
    return value


def calculate_dhash(image: np.ndarray) -> int:
    """Return a 64-bit Python integer: left > right, row-major, MSB first.

    Resize grayscale to 9x8 with INTER_AREA. Color/alpha are not compared.
    """
    return _dhash_from_gray(to_grayscale(image))


def hamming_distance(hash1: int, hash2: int) -> int:
    """Count differing bits between two unsigned 64-bit integer hashes."""
    hash1 = _validate_integer(hash1, "hash1", (1 << 64) - 1)
    hash2 = _validate_integer(hash2, "hash2", (1 << 64) - 1)
    return (hash1 ^ hash2).bit_count()


def _comparison_image(gray: np.ndarray) -> np.ndarray:
    return cv2.resize(gray, (128, 128), interpolation=cv2.INTER_AREA)


def calculate_pixel_difference(image1: np.ndarray, image2: np.ndarray) -> float:
    """Return mean absolute grayscale difference on the 0..255 scale.

    Both images are resized to 128x128 with INTER_AREA, even when upscaling.
    Aspect ratios are normalized to the same square; this is a heuristic.
    OpenCV absdiff avoids unsigned subtraction wrapping around at zero.
    """
    first = _comparison_image(to_grayscale(image1))
    second = _comparison_image(to_grayscale(image2))
    return float(cv2.absdiff(first, second).mean())


def _prepare(image: np.ndarray) -> tuple[int, np.ndarray]:
    gray = to_grayscale(image)
    return _dhash_from_gray(gray), _comparison_image(gray)


def _compare(first, second, hash_threshold: int, pixel_threshold: float) -> DuplicateResult:
    distance = hamming_distance(first[0], second[0])
    difference = float(cv2.absdiff(first[1], second[1]).mean())
    duplicate = distance <= hash_threshold and difference <= pixel_threshold
    return DuplicateResult(distance, difference, hash_threshold, pixel_threshold, duplicate)


def compare_frames(image1: np.ndarray, image2: np.ndarray,
                   hash_threshold: int = 6, pixel_threshold: float = 12.0) -> DuplicateResult:
    """Return measured similarity; both inclusive thresholds must pass.

    Defaults are preliminary, not guarantees. Small text changes, color-only
    changes, and details lost while resizing can be missed. No files are saved
    or deleted; callers decide how to use this result in later tasks.
    """
    hash_threshold, pixel_threshold = _validate_thresholds(hash_threshold, pixel_threshold)
    return _compare(_prepare(image1), _prepare(image2), hash_threshold, pixel_threshold)


def are_duplicates(image1: np.ndarray, image2: np.ndarray,
                   hash_threshold: int = 6, pixel_threshold: float = 12.0) -> bool:
    return compare_frames(image1, image2, hash_threshold, pixel_threshold).is_duplicate


class DuplicateFilter:
    """Compare against the last accepted frame, keeping only compact data.

    The first valid image is accepted, with both distances None. Invalid input
    leaves the reference intact. Reset before starting a new video/session.
    """

    def __init__(self, hash_threshold: int = 6, pixel_threshold: float = 12.0):
        self.hash_threshold, self.pixel_threshold = _validate_thresholds(hash_threshold, pixel_threshold)
        self._reference = None

    def check(self, image: np.ndarray) -> DuplicateResult:
        # Validate before changing any state, including the first frame.
        hash_threshold, pixel_threshold = _validate_thresholds(self.hash_threshold, self.pixel_threshold)
        current = _prepare(image)
        if self._reference is None:
            result = DuplicateResult(None, None, hash_threshold, pixel_threshold, False)
        else:
            result = _compare(self._reference, current, hash_threshold, pixel_threshold)
        if result.accepted:
            # resize created independent data, so caller mutations cannot alter it.
            self._reference = current
        return result

    def reset(self):
        self._reference = None

    def set_reference(self, image: np.ndarray):
        """Use a frame explicitly accepted by an external selection policy.

        For example, a selector may accept a clear duplicate for periodic
        coverage. Validation finishes before replacing the compact reference.
        Normal check() behavior is unchanged.
        """
        self._reference = _prepare(image)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-a", required=True)
    parser.add_argument("--image-b", required=True)
    parser.add_argument("--hash-threshold", type=int, default=6)
    parser.add_argument("--pixel-threshold", type=float, default=12.0)
    args = parser.parse_args(argv)
    try:
        hash_threshold, pixel_threshold = _validate_thresholds(args.hash_threshold, args.pixel_threshold)
        images = []
        for name in (args.image_a, args.image_b):
            path = Path(name)
            if not path.is_file():
                raise FileNotFoundError(f"Image file not found: {path}")
            image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
            if image is None:
                raise ValueError(f"Cannot read image: {path}")
            images.append(image)
        result = compare_frames(*images, hash_threshold, pixel_threshold)
        print("Duplicate Frame Analysis\n")
        print(f"Image A: {args.image_a}")
        print(f"Image B: {args.image_b}\n")
        print(f"dHash distance: {result.hash_distance}")
        print(f"Pixel difference: {result.pixel_difference:.2f}\n")
        print(f"Hash threshold: {result.hash_threshold}")
        print(f"Pixel threshold: {result.pixel_threshold:.2f}\n")
        print(f"Duplicate: {'Yes' if result.is_duplicate else 'No'}")
        print("\nAnalysis completed successfully")
        return 0
    except (OSError, TypeError, ValueError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
