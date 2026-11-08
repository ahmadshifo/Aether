"""Face blur tests. A fake detector checks the blurring; the real YuNet model is loaded once to prove
the shipped model file works. No faces are identified, only located."""

import cv2
import numpy as np
import pytest

from processing.face_blur import MODEL_PATH, FaceBlurError, FaceBlurrer


class FakeDetector:
    def __init__(self, faces=None, fail=False):
        self.faces, self.fail, self.size = faces, fail, None

    def setInputSize(self, size):
        self.size = size

    def detect(self, image):
        if self.fail:
            raise cv2.error("synthetic detector failure")
        return 1, None if self.faces is None else np.array(self.faces, dtype=np.float32)


def detailed_image():
    rng = np.random.default_rng(7)
    return rng.integers(0, 255, (240, 320, 3), dtype=np.uint8)


def test_face_area_is_hidden_and_rest_is_untouched():
    image = detailed_image()
    blurrer = FaceBlurrer(detector=FakeDetector([[100, 80, 60, 60, 0.9]]), expand=0.0)
    result, count = blurrer.blur(image)
    assert count == 1 and result is not image
    face_before, face_after = image[80:140, 100:160].astype(int), result[80:140, 100:160].astype(int)
    assert np.abs(face_before - face_after).mean() > 20          # strongly changed
    assert face_after.std() < face_before.std() / 2               # detail removed
    mask = np.ones(image.shape[:2], bool)
    mask[80:140, 100:160] = False
    assert np.array_equal(image[mask], result[mask])               # nothing else changed


def test_boxes_are_enlarged_and_clipped_to_the_image():
    blurrer = FaceBlurrer(detector=FakeDetector([[300, 0, 40, 40, 0.9]]), expand=0.3)
    (x, y, w, h), = blurrer.detect(detailed_image())
    assert x < 300 and y == 0 and x + w == 320 and h > 40


def test_no_faces_returns_the_original_image():
    image = detailed_image()
    result, count = FaceBlurrer(detector=FakeDetector(None)).blur(image)
    assert count == 0 and result is image


def test_detector_failure_raises_so_the_frame_can_be_dropped():
    with pytest.raises(FaceBlurError):
        FaceBlurrer(detector=FakeDetector(fail=True)).blur(detailed_image())


def test_grayscale_and_bgra_images_are_supported():
    detector = FakeDetector([[10, 10, 30, 30, 0.9]])
    for image in (detailed_image()[:, :, 0].copy(), cv2.cvtColor(detailed_image(), cv2.COLOR_BGR2BGRA)):
        result, count = FaceBlurrer(detector=detector).blur(image)
        assert count == 1 and result.shape == image.shape and detector.size == (320, 240)


def test_missing_model_file_is_reported(tmp_path):
    with pytest.raises(FaceBlurError):
        FaceBlurrer(model_path=tmp_path / "absent.onnx")


def test_real_yunet_model_loads_and_finds_no_face_in_an_empty_scene():
    assert MODEL_PATH.is_file()
    result, count = FaceBlurrer().blur(np.full((480, 640, 3), 200, np.uint8))
    assert count == 0 and result.shape == (480, 640, 3)
