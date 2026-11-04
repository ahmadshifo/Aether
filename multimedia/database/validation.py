"""Validate repository metadata before filesystem writes or SQL execution."""

from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP
import math
from numbers import Integral, Real
from uuid import UUID

import numpy as np

from .models import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL


def as_uuid(value, name: str) -> UUID:
    try:
        if not isinstance(value, (UUID, str)):
            raise ValueError()
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f"{name} must be a valid UUID.") from None


def as_utc(value: datetime, name="captured_at") -> datetime:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            raise ValueError(f"{name} must be a valid timezone-aware ISO 8601 timestamp.") from None
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime; never substitute video time.")
    return value.astimezone(UTC)


def optional_position(value, name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, Integral) or not 0 <= value <= (1 << 63) - 1:
        raise ValueError(f"{name} must be a nonnegative BIGINT or None.")
    return int(value)


def video_milliseconds(value) -> int | None:
    """Round Task 3 fractional milliseconds to nearest BIGINT, half upward."""
    if value is None:
        return None
    if isinstance(value, Integral) and not isinstance(value, bool):
        return optional_position(value, "video_timestamp_ms")
    if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value < 0:
        raise ValueError("video_timestamp_ms must be finite nonnegative milliseconds or None.")
    if value > (1 << 63) - 1:
        raise ValueError("video_timestamp_ms exceeds BIGINT storage.")
    rounded = int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return optional_position(rounded, "video_timestamp_ms")


def validate_embedding(embedding, model):
    if embedding is None:
        if model is not None:
            raise ValueError("embedding_model must be None when embedding is None.")
        return None
    if model != EMBEDDING_MODEL:
        raise ValueError("embedding_model must be text-embedding-3-small when an embedding is supplied.")
    if not isinstance(embedding, (list, tuple, np.ndarray)):
        raise TypeError("embedding must be a numerical vector.")
    array = np.asarray(embedding)
    if array.ndim != 1 or array.size != EMBEDDING_DIMENSIONS:
        raise ValueError("embedding must have exactly 1536 dimensions.")
    if any(isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) for value in embedding):
        raise ValueError("embedding must contain real numerical values, excluding booleans.")
    try:
        with np.errstate(over="ignore", under="ignore", invalid="ignore"):
            array = np.asarray(embedding, dtype=np.float64)
    except (ValueError, TypeError, OverflowError):
        raise ValueError("embedding values must fit finite JSON floating-point storage.") from None
    if not np.isfinite(array).all() or not np.any(array):
        raise ValueError("embedding must contain finite floating-point values and be nonzero.")
    return array.tolist()
