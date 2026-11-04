"""Generate synthetic OCR sign and blank images without any cloud request."""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="output/ocr_samples")
    args = parser.parse_args(argv)
    try:
        directory = Path(args.output)
        directory.mkdir(parents=True, exist_ok=True)
        blank = np.full((240, 640, 3), 255, dtype=np.uint8)
        sign = blank.copy()
        cv2.putText(sign, "ROOM 205", (45, 145), cv2.FONT_HERSHEY_SIMPLEX,
                    2.7, (0, 0, 0), 5, cv2.LINE_AA)
        for name, image in (("sign.png", sign), ("blank.png", blank)):
            path = directory / name
            if not cv2.imwrite(str(path), image):
                raise OSError(f"Cannot save sample image: {path}")
            print(f"Created: {path}")
        print("Expected sign text: ROOM 205. No OCR request was made.")
        return 0
    except (OSError, ValueError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
