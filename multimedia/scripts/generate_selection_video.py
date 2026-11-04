"""Generate an eight-second MJPG video with a predictable selection sequence."""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np


def create_scenes() -> list[np.ndarray]:
    sharp = np.full((128, 160, 3), 30, dtype=np.uint8)
    cv2.rectangle(sharp, (10, 10), (80, 110), (210, 210, 210), -1)
    cv2.putText(sharp, "A", (95, 80), cv2.FONT_HERSHEY_SIMPLEX,
                1.5, (130, 130, 130), 3)
    other = cv2.bitwise_not(sharp)
    blurry = cv2.GaussianBlur(sharp, (15, 15), 0)
    blurry_other = cv2.GaussianBlur(other, (15, 15), 0)
    return [sharp, sharp, blurry, other, other, blurry_other, other, other]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="output/selection_demo.avi")
    args = parser.parse_args(argv)
    try:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (160, 128))
        try:
            if not writer.isOpened():
                raise OSError(f"Cannot create MJPG video: {path}")
            for scene in create_scenes():
                for _ in range(10):
                    writer.write(scene)
        finally:
            writer.release()
        capture = cv2.VideoCapture(str(path))
        try:
            if not capture.isOpened() or not capture.read()[0]:
                raise OSError(f"Generated video is unreadable: {path}")
        finally:
            capture.release()
        print(f"Created: {path} (160x128, 10 FPS, 80 frames, 8 seconds)")
        print("At interval=1, sharpness=100, hash=6, pixels=12, max-gap=3:")
        print("first_frame, duplicate, blurry, new_scene, duplicate, blurry, periodic_frame, duplicate")
        print("Expected: evaluated=8, accepted=3, rejected=5, blurry=2, duplicates=3, periodic=1, new_scenes=1")
        return 0
    except (OSError, ValueError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
