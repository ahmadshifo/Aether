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

# An ID-1 card is about 1.585 times as wide as it is tall; accept a little more or less for a card held at an angle.
RATIO_RANGE = (1.35, 1.85)
# Share of the frame a card may cover: from a card at arm's length to one held up to the lens.
AREA_RANGE = (0.008, 0.7)
# How completely the outline fills its rectangle (rounded corners allowed).
RECTANGULAR = 0.82
# Blur a little past the edge, so no digit survives at the border.
PADDING = 0.08
# Each card is pixelated in blocks this many pixels wide before the blur.
BLOCK_SIZE = 14

# Text read from a frame (OCR): 8 or more digits in a row, allowing spaces, dashes and dots between them,
# such as card, ID, account or passport numbers. Short numbers (prices, room numbers, times) stay readable.
LONG_NUMBER = re.compile(r"(?<![\w])\d(?:[ \-.]?\d){7,}(?![\w])")
HIDDEN = "[number hidden]"


def find_cards(image: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Boxes (x, y, w, h) around card-shaped rectangles."""
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    # Find edges, then thicken them so each card outline closes into one contour.
    edges = cv2.dilate(cv2.Canny(gray, 40, 140), np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = (_card_box(contour, width, height) for contour in contours)
    return [box for box in boxes if box is not None]


def _card_box(contour, width: int, height: int):
    """The padded (x, y, w, h) box if this contour is a card-shaped rectangle, otherwise None."""
    hull = cv2.convexHull(contour)
    area = cv2.contourArea(hull)
    frame_area = float(width * height)
    if not AREA_RANGE[0] * frame_area <= area <= AREA_RANGE[1] * frame_area:
        return None
    corners = cv2.approxPolyDP(hull, 0.04 * cv2.arcLength(hull, True), True)
    if len(corners) != 4:
        return None
    (_, _), (side_a, side_b), _ = cv2.minAreaRect(corners)
    if min(side_a, side_b) <= 0:
        return None
    ratio = max(side_a, side_b) / min(side_a, side_b)
    if not RATIO_RANGE[0] <= ratio <= RATIO_RANGE[1] or area / (side_a * side_b) < RECTANGULAR:
        return None
    x, y, w, h = cv2.boundingRect(corners)
    pad_x, pad_y = int(w * PADDING), int(h * PADDING)
    left, top = max(0, x - pad_x), max(0, y - pad_y)
    right, bottom = min(width, x + w + pad_x), min(height, y + h + pad_y)
    return left, top, right - left, bottom - top


def redact_cards(image: np.ndarray) -> tuple[np.ndarray, int]:
    """A copy with every card-shaped area pixelated and blurred, and how many were found."""
    boxes = find_cards(image)
    if not boxes:
        return image, 0
    result = image.copy()
    for x, y, w, h in boxes:
        result[y:y + h, x:x + w] = _pixelate_and_blur(result[y:y + h, x:x + w], w, h)
    return result, len(boxes)


def _pixelate_and_blur(region: np.ndarray, w: int, h: int) -> np.ndarray:
    """The region in coarse blocks, then softened so the blocks don't look like a grid."""
    small = cv2.resize(region, (max(1, w // BLOCK_SIZE), max(1, h // BLOCK_SIZE)), interpolation=cv2.INTER_AREA)
    pixelated = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
    kernel = max(3, (min(w, h) // 4) | 1)  # odd kernel size, scaled to the card
    return cv2.GaussianBlur(pixelated, (kernel, kernel), 0)


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
