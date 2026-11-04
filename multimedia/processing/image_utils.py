"""Shared validation, color conversion, and in-memory JPEG preparation."""

import base64

import cv2
import numpy as np


class ImageEncodingError(ValueError):
    pass


def validate_image(image: np.ndarray):
    """Require nonempty uint8 grayscale, BGR, or BGRA image data."""
    if not isinstance(image, np.ndarray):
        raise TypeError("image must be a NumPy array.")
    if image.size == 0:
        raise ValueError("image must not be empty.")
    if image.ndim not in (2, 3) or (image.ndim == 3 and image.shape[2] not in (3, 4)):
        raise ValueError("image must be grayscale (H, W), BGR (H, W, 3), or BGRA (H, W, 4).")
    if image.dtype != np.uint8:
        raise TypeError("image pixels must use uint8 values in the range 0..255.")


def to_grayscale(image: np.ndarray) -> np.ndarray:
    """Convert validated pixels without changing the input; ignore BGRA alpha.

    Grayscale input is returned directly; callers must treat it as read-only.
    """
    validate_image(image)
    if image.ndim == 2:
        return image
    conversion = cv2.COLOR_BGR2GRAY if image.shape[2] == 3 else cv2.COLOR_BGRA2GRAY
    return cv2.cvtColor(image, conversion)


def encode_jpeg(image: np.ndarray) -> bytes:
    """Validate and encode entirely in memory, preserving source pixels."""
    validate_image(image)
    if image.ndim == 3 and image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    try:
        success, encoded = cv2.imencode(".jpg", image)
    except cv2.error:
        raise ImageEncodingError("Could not encode image as JPEG.") from None
    if not success or encoded is None or encoded.size == 0:
        raise ImageEncodingError("Could not encode image as JPEG.")
    return encoded.tobytes()


def image_to_data_url(image: np.ndarray) -> str:
    payload = base64.b64encode(encode_jpeg(image)).decode("ascii")
    return f"data:image/jpeg;base64,{payload}"
