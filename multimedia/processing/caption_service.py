"""Caption access from a shared vision result, without another API request."""

from .object_detector import VisionResult


def get_caption(analysis: VisionResult) -> str:
    """Read the caption of an existing analysis; never analyze the image again."""
    if not isinstance(analysis, VisionResult):
        raise TypeError("analysis must be a VisionResult from VisionService.analyze_image().")
    return analysis.caption
