"""Blur bank cards and ID cards in frames before they are saved, the way faces are blurred.

No AI: bank cards, ID cards and driving licences all have the same ISO/IEC 7810 ID-1 size (85.6 x 54 mm),
so they show up as a rectangle about 1.59 times as wide as it is tall. OpenCV finds such rectangles from
their edges; each one is pixelated and blurred so the card number, name and photo can't be read.

What it can't do without reading the text (OCR): find an ID number or an address written on a letter or form.
It also blurs other card-shaped things (a phone or laptop screen seen straight on, a postcard). That only
affects the saved copy for the dashboard; the assistant still answers from the live, unredacted picture.

Only saved frames (RustFS/MySQL, shown on the dashboard) are redacted: RedactingRepository wraps the
repository's save_frame, which both save paths use (the periodic save and the frames an answer used).
"""

import logging
import re

import cv2
import numpy as np

log = logging.getLogger("multimedia.redact")

CARD_RATIO = 85.6 / 54.0          # 1.585, the ID-1 card shape
RATIO_RANGE = (1.35, 1.85)        # wide enough for a card held at an angle
AREA_RANGE = (0.008, 0.7)         # share of the frame: from a card at arm's length to one held to the lens
RECTANGULAR = 0.82                # how completely the shape fills its rectangle (rounded corners allowed)
PADDING = 0.08                    # blur a little past the edge, so no digit survives at the border
# In the text read from a frame (OCR): 8 or more digits in a row, allowing spaces, dashes and dots between them,
# such as card, ID, account or passport numbers. Short numbers (prices, room numbers, times) stay readable.
LONG_NUMBER = re.compile(r"(?<![\w])\d(?:[ \-.]?\d){7,}(?![\w])")
HIDDEN = "[number hidden]"


def find_cards(image: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Boxes (x, y, w, h) around card-shaped rectangles."""
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.dilate(cv2.Canny(gray, 40, 140), np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    frame_area, boxes = float(width * height), []
    for contour in contours:
        hull = cv2.convexHull(contour)
        area = cv2.contourArea(hull)
        if not AREA_RANGE[0] * frame_area <= area <= AREA_RANGE[1] * frame_area:
            continue
        corners = cv2.approxPolyDP(hull, 0.04 * cv2.arcLength(hull, True), True)
        if len(corners) != 4:
            continue
        (_, _), (side_a, side_b), _ = cv2.minAreaRect(corners)
        if min(side_a, side_b) <= 0:
            continue
        ratio = max(side_a, side_b) / min(side_a, side_b)
        if not RATIO_RANGE[0] <= ratio <= RATIO_RANGE[1] or area / (side_a * side_b) < RECTANGULAR:
            continue
        x, y, w, h = cv2.boundingRect(corners)
        pad_x, pad_y = int(w * PADDING), int(h * PADDING)
        left, top = max(0, x - pad_x), max(0, y - pad_y)
        right, bottom = min(width, x + w + pad_x), min(height, y + h + pad_y)
        boxes.append((left, top, right - left, bottom - top))
    return boxes


def redact_cards(image: np.ndarray) -> tuple[np.ndarray, int]:
    """A copy with every card-shaped area pixelated and blurred, and how many were found."""
    boxes = find_cards(image)
    if not boxes:
        return image, 0
    result = image.copy()
    for x, y, w, h in boxes:
        region = result[y:y + h, x:x + w]
        small = cv2.resize(region, (max(1, w // 14), max(1, h // 14)), interpolation=cv2.INTER_AREA)
        pixelated = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
        kernel = max(3, (min(w, h) // 4) | 1)
        result[y:y + h, x:x + w] = cv2.GaussianBlur(pixelated, (kernel, kernel), 0)
    return result, len(boxes)


def redact_text(text: str | None) -> str | None:
    """The read text with every long number hidden ("Card 4532 7714 0091 2245" -> "Card [number hidden]")."""
    return LONG_NUMBER.sub(HIDDEN, text) if text else text


class RedactingRepository:
    """The frame repository, but every image (and the text read from it) is redacted before save_frame stores it.
    Everything else is passed straight through to the real repository."""

    def __init__(self, repository):
        self._repository = repository
        self.cards_blurred = 0

    def __getattr__(self, name):
        return getattr(self._repository, name)

    def save_frame(self, session_id, captured_at, image, *args, **kwargs):
        # Fail-safe, like face blur: if redaction fails the error goes up and this frame is not saved,
        # so a card is never stored unblurred.
        image, cards = redact_cards(image)
        self.cards_blurred += cards
        if "ocr_text" in kwargs:
            kwargs["ocr_text"] = redact_text(kwargs["ocr_text"])
        if cards:
            log.info("Blurred %d card-shaped area(s) before saving", cards)
        return self._repository.save_frame(session_id, captured_at, image, *args, **kwargs)
