"""Card blur for saved frames: card-shaped rectangles are found and blurred, other shapes are left alone."""

from datetime import UTC, datetime

import cv2
import numpy as np

from processing.card_redact import RedactingRepository, find_cards, redact_cards


def background(seed=1, size=(480, 640)):
    rng = np.random.default_rng(seed)
    image = cv2.resize(rng.integers(60, 140, (12, 16, 3), dtype=np.uint8), size[::-1], interpolation=cv2.INTER_CUBIC)
    return cv2.GaussianBlur(image, (21, 21), 0)


def draw_card(image, center, width, angle=0.0, colour=(235, 225, 210)):
    """A bank-card-like shape: ID-1 proportions, rounded corners, a chip and a number line."""
    height = width / (85.6 / 54.0)
    box = cv2.boxPoints(((center[0], center[1]), (width, height), angle)).astype(np.int32)
    cv2.fillConvexPoly(image, box, colour)
    cv2.polylines(image, [box], True, (40, 40, 40), 2)
    cv2.putText(image, "4532 7714 0091 2245", (int(center[0] - width * 0.42), int(center[1] + height * 0.15)),
                cv2.FONT_HERSHEY_SIMPLEX, width / 420, (20, 20, 20), 2)
    return image


def test_a_card_held_up_is_found_and_blurred():
    image = draw_card(background(), (320, 240), 300)
    boxes = find_cards(image)
    assert boxes
    redacted, count = redact_cards(image)
    assert count >= 1
    x, y, w, h = boxes[0]
    # The digits are gone: the card area is now smooth instead of sharp black-on-white text.
    assert cv2.Laplacian(cv2.cvtColor(redacted[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() < \
        cv2.Laplacian(cv2.cvtColor(image[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() / 5


def test_a_tilted_or_small_card_is_still_found():
    assert find_cards(draw_card(background(2), (300, 260), 260, angle=25))
    assert find_cards(draw_card(background(3), (200, 150), 120, angle=-10))


def test_doors_square_frames_and_plain_scenes_are_left_alone():
    door = background(4)
    cv2.rectangle(door, (240, 40), (400, 440), (60, 40, 20), -1)       # tall: about 1 : 2.5
    square = background(5)
    cv2.rectangle(square, (200, 120), (440, 360), (200, 200, 200), 4)  # 1 : 1
    for image in (door, square, background(6)):
        assert find_cards(image) == []
        assert redact_cards(image)[1] == 0


def test_saved_frames_go_through_redaction_and_everything_else_passes_through():
    class Repository:
        retention_hours = 24

        def __init__(self):
            self.saved = []

        def save_frame(self, session_id, captured_at, image, **kwargs):
            self.saved.append((image, kwargs))
            return "frame-1"

    inner = Repository()
    repository = RedactingRepository(inner)
    image = draw_card(background(), (320, 240), 300)
    assert repository.save_frame("s", datetime.now(UTC), image, ocr_text="") == "frame-1"
    saved, kwargs = inner.saved[0]
    assert repository.cards_blurred >= 1 and not np.array_equal(saved, image) and kwargs == {"ocr_text": ""}
    assert repository.retention_hours == 24  # other attributes come from the real repository


def test_long_numbers_in_read_text_are_hidden_but_ordinary_numbers_stay():
    from processing.card_redact import redact_text
    assert redact_text("Card 4532 7714 0091 2245 exp 12/28") == "Card [number hidden] exp 12/28"
    assert redact_text("ID: 000-123-456-78") == "ID: [number hidden]"
    assert redact_text("Room 214, price 15000 LBP, open 9:00-17:30") == "Room 214, price 15000 LBP, open 9:00-17:30"
    assert redact_text("") == "" and redact_text(None) is None


def test_saved_text_is_redacted_with_the_image():
    class Repository:
        def save_frame(self, session_id, captured_at, image, **kwargs):
            self.kwargs = kwargs
            return "frame-1"

    inner = Repository()
    RedactingRepository(inner).save_frame("s", datetime.now(UTC), background(), ocr_text="IBAN LB62 0999 0000 0001 0019 0122 9114")
    assert "0999" not in inner.kwargs["ocr_text"]


def test_reading_text_needs_only_the_mistral_key(monkeypatch):
    from processing import live_service
    keys = {"MISTRAL_API_KEY": "m", "OPENAI_API_KEY": ""}
    monkeypatch.setattr(live_service, "setting", lambda name, default: keys.get(name, default))
    ocr, vision, embedding, real = live_service.analysis_services()
    assert type(ocr).__name__ == "OCRService" and isinstance(vision, live_service.NoAIVision) and real
    keys["MISTRAL_API_KEY"] = ""
    assert isinstance(live_service.analysis_services()[0], live_service.NoAIOCR)
