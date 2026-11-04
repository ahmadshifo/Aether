"""Caption access shares the existing vision analysis and never calls twice."""

import pytest

from processing.caption_service import get_caption
from processing.object_detector import VisionResult, VisionService, parse_analysis, DEFAULT_MODEL

pytestmark = pytest.mark.usefixtures("vision_offline")


def test_objects_and_caption_use_exactly_one_api_request(vision_client, vision_image):
    analysis = VisionService(client=vision_client).analyze_image(vision_image)
    assert analysis.objects == ["chair", "table"]
    assert get_caption(analysis) == "A chair is beside a table."
    assert get_caption(analysis) == analysis.caption
    vision_client.responses.create.assert_called_once()


def test_caption_trims_edges_only_and_preserves_unicode(vision_response):
    caption = "A café sign reads الغرفة ٢٠٥.\nA chair is beside the door."
    response = vision_response({"objects": ["sign", "chair"], "caption": f"  {caption}\n ", "uncertain": False})
    assert get_caption(parse_analysis(response, DEFAULT_MODEL)) == caption


def test_empty_caption_and_uncertainty_are_not_failure(vision_response):
    result = parse_analysis(vision_response({"objects": [], "caption": "", "uncertain": True}), DEFAULT_MODEL)
    assert get_caption(result) == "" and result.uncertain is True


@pytest.mark.parametrize("bad", [None, "caption", {"caption": "A room."}])
def test_caption_requires_shared_analysis_result(bad):
    with pytest.raises(TypeError, match="VisionResult"):
        get_caption(bad)


def test_caption_access_preserves_the_result():
    result = VisionResult(["door", "sign"], "A sign is beside a door.", DEFAULT_MODEL, False)
    original = (result.objects.copy(), result.caption, result.model, result.uncertain)
    get_caption(result)
    assert original == (result.objects, result.caption, result.model, result.uncertain)
