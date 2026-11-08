"""Explicit synthetic analysis fixtures; never represent these as real AI output."""

from .embedding_service import DEFAULT_MODEL, EmbeddingResult, build_frame_description
from .object_detector import VisionResult
from .ocr_service import OCRResult


class MockOCR:
    def extract_text(self, image):
        return OCRResult("MOCK ROOM 205\nغرفة ٢٠٥", "mock-ocr", True, "MOCK ROOM 205\nغرفة ٢٠٥")


class MockVision:
    def analyze_image(self, image):
        return VisionResult(["synthetic sign"], "MOCK scene description; no real visual analysis.", "mock-vision", True)


class MockEmbedding:
    def embed_frame(self, ocr_text=None, objects=None, caption=None):
        text = build_frame_description(ocr_text, objects, caption)
        return EmbeddingResult(DEFAULT_MODEL, 1536, text, [1.0] + [0.0] * 1535) if text else None

    def embed_query(self, query):
        return EmbeddingResult(DEFAULT_MODEL, 1536, query, [1.0] + [0.0] * 1535)


def write_demo_video(path):
    """Four-second MJPG AVI: sharp, duplicate, blurry, changed scene."""
    from pathlib import Path
    import cv2
    import numpy as np
    path = Path(path)
    if path.exists():
        raise FileExistsError("Demo output already exists; choose a new path.")
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(42)
    first = rng.integers(0, 256, (96, 128, 3), dtype=np.uint8)
    second = rng.integers(0, 256, (96, 128, 3), dtype=np.uint8)
    scenes = [first, first, np.full_like(first, 128), second]
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (128, 96))
    try:
        if not writer.isOpened():
            raise RuntimeError("Cannot create MJPG demonstration video.")
        for scene in scenes:
            for _ in range(10):
                writer.write(scene)
    finally:
        writer.release()
    return path


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Create a synthetic local AVI, never real camera data")
    parser.add_argument("--output", required=True)
    print(write_demo_video(parser.parse_args().output))
