"""Create a deterministic sharp/blurred PNG pair for headless manual testing.

Run from multimedia/: python -m scripts.generate_quality_samples
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

from processing.quality_filter import calculate_sharpness


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="output/quality_samples")
    args = parser.parse_args(argv)
    try:
        output = Path(args.output)
        output.mkdir(parents=True, exist_ok=True)
        sharp = np.zeros((240, 320, 3), dtype=np.uint8)
        for x in range(10, 310, 20):
            cv2.line(sharp, (x, 10), (x, 130), (255, 255, 255), 2)
        cv2.rectangle(sharp, (20, 150), (110, 220), (0, 255, 255), 2)
        cv2.putText(sharp, "AETHER", (125, 190), cv2.FONT_HERSHEY_SIMPLEX,
                    0.8, (255, 255, 255), 2)
        blurred = cv2.GaussianBlur(sharp, (15, 15), 0)
        for name, image in (("sharp.png", sharp), ("blurred.png", blurred)):
            path = output / name
            if not cv2.imwrite(str(path), image):
                raise OSError(f"Cannot save image: {path}")
            print(f"Created: {path}")
        sharp_score = calculate_sharpness(sharp)
        blurred_score = calculate_sharpness(blurred)
        print(f"Sharp score: {sharp_score:.6f}")
        print(f"Blurred score: {blurred_score:.6f}")
        print(f"Suggested threshold for this pair: {(sharp_score + blurred_score) / 2:.6f}")
        return 0
    except (OSError, TypeError, ValueError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
