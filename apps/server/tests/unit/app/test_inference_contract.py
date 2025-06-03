import json

from app.use_cases.infer_schema import InferSchema


class EmptyTools:
    def contains(self, word):
        return False

    def cluster(self, request):
        return {}

    def relatedness(self, first, second) -> float:
        return 0.0

    def compare(self, first, second) -> float:
        return 0.0

    def pair(self, first, second) -> float:
        return 0.0

    def word_lists(self, first, second) -> float:
        return 0.0


def test_empty_inference_returns_a_json_object() -> None:
    tool = EmptyTools()
    inference = InferSchema(
        lexicon=tool,
        text_similarity=tool,
        semantic_similarity=tool,
        clusterer=tool,
    )

    assert isinstance(json.loads(inference.execute([])), dict)
