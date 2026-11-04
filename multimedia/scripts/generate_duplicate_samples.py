"""Generate duplicate-comparison examples and print a stateful demo, offline."""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

from processing.duplicate_filter import DuplicateFilter, compare_frames


def create_samples() -> dict[str, np.ndarray]:
    first = np.full((240, 320, 3), 30, dtype=np.uint8)
    cv2.rectangle(first, (30, 30), (160, 210), (210, 210, 210), -1)
    cv2.putText(first, "A", (190, 140), cv2.FONT_HERSHEY_SIMPLEX,
                2, (130, 130, 130), 4)
    third = np.full_like(first, 120)
    for y in range(0, 240, 30):
        cv2.rectangle(third, (0, y), (319, y + 14), (240, 240, 240), -1)
    samples = {
        "frame_a": first,
        "frame_a_slight": cv2.add(first, np.full_like(first, 3)),
        "frame_b": cv2.bitwise_not(first),
        "frame_c": third,
    }
    for label in ("205", "206"):
        image = np.full_like(first, 230)
        cv2.putText(image, f"ROOM {label}", (15, 135), cv2.FONT_HERSHEY_SIMPLEX,
                    1.4, (20, 20, 20), 3)
        samples[f"room_{label}"] = image
    return samples


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="output/duplicate_samples")
    args = parser.parse_args(argv)
    try:
        output = Path(args.output)
        output.mkdir(parents=True, exist_ok=True)
        samples = create_samples()
        for name, image in samples.items():
            path = output / f"{name}.png"
            if not cv2.imwrite(str(path), image):
                raise OSError(f"Cannot save image: {path}")
            print(f"Created: {path}")
        for label, first, second in (
            ("Identical", "frame_a", "frame_a"),
            ("Slight change", "frame_a", "frame_a_slight"),
            ("Different scenes", "frame_a", "frame_b"),
            ("Changed text (defaults)", "room_205", "room_206"),
        ):
            result = compare_frames(samples[first], samples[second])
            print(f"{label}: hash={result.hash_distance}, pixels={result.pixel_difference:.4f}, "
                  f"duplicate={result.is_duplicate}")
        strict = compare_frames(samples["room_205"], samples["room_206"], 0, 0)
        print(f"Changed text (thresholds 0/0): duplicate={strict.is_duplicate}")
        print("Sequence A, A, A, B, B, C:")
        duplicate_filter = DuplicateFilter()
        for name in ("frame_a", "frame_a", "frame_a", "frame_b", "frame_b", "frame_c"):
            result = duplicate_filter.check(samples[name])
            print(f"{name}: {'Duplicate' if result.is_duplicate else 'Accepted'}")
        return 0
    except (OSError, TypeError, ValueError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
