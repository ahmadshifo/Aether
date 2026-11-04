"""Evaluate image sharpness using variance of the Laplacian, without mutation."""

import argparse
import math
import sys
from dataclasses import dataclass
from numbers import Real
from pathlib import Path

import cv2
import numpy as np

from .image_utils import to_grayscale


@dataclass(frozen=True)
class QualityResult:
    sharpness_score: float
    threshold: float
    is_blurry: bool
    accepted: bool


def _validate_threshold(threshold: float) -> float:
    if isinstance(threshold, bool) or not isinstance(threshold, Real):
        raise TypeError("threshold must be a finite nonnegative real number.")
    try:
        value = float(threshold)
    except OverflowError as error:
        raise ValueError("threshold must be finite.") from error
    if not math.isfinite(value) or value < 0:
        raise ValueError("threshold must be finite and nonnegative.")
    return value


def calculate_sharpness(image: np.ndarray) -> float:
    """Return Laplacian variance for a uint8 grayscale, BGR, or BGRA image.

    Restrict pixels to the standard OpenCV 0..255 uint8 scale so scores and
    thresholds use consistent units. Unsupported types (including floating
    point arrays with NaN/Inf) are rejected rather than silently rescaled.
    The source image is never modified.
    """
    gray = to_grayscale(image)
    score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if not math.isfinite(score) or score < 0:
        raise ValueError("Could not calculate a finite nonnegative sharpness score.")
    return score


def evaluate_quality(image: np.ndarray, threshold: float = 100.0) -> QualityResult:
    """Evaluate only sharpness; accepted means score >= the selected threshold.

    The default is an initial baseline, not a universal blur threshold or an
    AI confidence. Calibrate for your image sizes and scenes. Simple scenes
    can score low and noisy images can score high, regardless of useful detail.
    """
    threshold = _validate_threshold(threshold)
    score = calculate_sharpness(image)
    blurry = score < threshold
    return QualityResult(score, threshold, blurry, not blurry)


def is_blurry(image: np.ndarray, threshold: float = 100.0) -> bool:
    """Classify scores strictly below threshold as blurry (equality passes)."""
    return evaluate_quality(image, threshold).is_blurry


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Local image file path")
    parser.add_argument("--threshold", type=float, default=100.0,
                        help="Nonnegative sharpness threshold (default: 100)")
    args = parser.parse_args(argv)
    try:
        threshold = _validate_threshold(args.threshold)
        path = Path(args.image)
        if not path.is_file():
            raise FileNotFoundError(f"Image file not found: {path}")
        image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if image is None:
            raise ValueError(f"Cannot read image: {path}")
        result = evaluate_quality(image, threshold)
        print("Image Quality Analysis\n")
        print(f"Image: {path}")
        print(f"Resolution: {image.shape[1]}x{image.shape[0]}\n")
        print(f"Sharpness score: {result.sharpness_score:.2f}")
        print(f"Threshold: {result.threshold:.2f}\n")
        print(f"Blurry: {'Yes' if result.is_blurry else 'No'}")
        print(f"Accepted: {'Yes' if result.accepted else 'No'}")
        print("\nAnalysis completed successfully")
        return 0
    except (OSError, TypeError, ValueError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
