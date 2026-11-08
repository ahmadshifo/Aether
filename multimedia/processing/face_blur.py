"""Blur every detected face before a frame is kept, sent to an AI service, or stored.

Uses OpenCV's pretrained YuNet face *detector* (processing/models/face_detection_yunet_2023mar.onnx,
from github.com/opencv/opencv_zoo). It only finds where faces are; it never identifies anyone,
which keeps to docs/safety-and-privacy.md. Each face box is enlarged to cover hair, ears and chin,
pixelated and then blurred, so it cannot be reversed.

Fail-safe: if detection fails, FaceBlurError is raised and the caller must drop the frame, so an
unblurred face never slips through.
"""

import threading
from pathlib import Path

import cv2
import numpy as np

from .image_utils import validate_image

MODEL_PATH = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"


class FaceBlurError(RuntimeError):
    pass


class FaceBlurrer:
    def __init__(self, model_path: str | Path = MODEL_PATH, score_threshold: float = 0.6,
                 expand: float = 0.3, detector=None):
        self.expand = float(expand)
        self._lock = threading.Lock()  # One YuNet instance is shared by all live sessions.
        if detector is not None:
            self._detector = detector
            return
        if not Path(model_path).is_file():
            raise FaceBlurError(f"YuNet model not found at {model_path}.")
        try:
            self._detector = cv2.FaceDetectorYN.create(str(model_path), "", (320, 320), score_threshold, 0.3, 5000)
        except cv2.error:
            raise FaceBlurError("Could not load the YuNet face detector model.") from None

    def detect(self, image: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Face boxes (x, y, width, height), already enlarged and clipped to the image."""
        validate_image(image)
        bgr = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) if image.ndim == 2 else image[:, :, :3]
        bgr = np.ascontiguousarray(bgr)
        height, width = bgr.shape[:2]
        try:
            with self._lock:
                self._detector.setInputSize((width, height))
                _, faces = self._detector.detect(bgr)
        except cv2.error:
            raise FaceBlurError("Face detection failed for this frame.") from None
        boxes = []
        for face in [] if faces is None else faces:
            x, y, w, h = (float(v) for v in face[:4])
            pad_w, pad_h = w * self.expand, h * self.expand
            left, top = max(0, int(x - pad_w)), max(0, int(y - pad_h * 1.3))  # extra room above for hair
            right, bottom = min(width, int(x + w + pad_w)), min(height, int(y + h + pad_h))
            if right > left and bottom > top:
                boxes.append((left, top, right - left, bottom - top))
        return boxes

    def blur(self, image: np.ndarray) -> tuple[np.ndarray, int]:
        """A blurred copy of the image and the number of faces hidden."""
        boxes = self.detect(image)
        if not boxes:
            return image, 0
        result = image.copy()
        for x, y, w, h in boxes:
            region = result[y:y + h, x:x + w]
            small = cv2.resize(region, (max(1, w // 16), max(1, h // 16)), interpolation=cv2.INTER_AREA)
            pixelated = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
            kernel = max(3, (min(w, h) // 4) | 1)
            result[y:y + h, x:x + w] = cv2.GaussianBlur(pixelated, (kernel, kernel), 0)
        return result, len(boxes)
