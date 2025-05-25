from pathlib import Path
from typing import List

from app.ports.tools.semantic_similarity_error import SemanticSimilarityError
from app.ports.tools.semantic_similarity_tool import SemanticSimilarity


class SentenceTransformerSimilarity(SemanticSimilarity):
    """Load the optional legacy semantic model from local files on first use."""

    def __init__(self, model_path: Path):
        self._model_path = model_path
        self._model = None

    def _get_model(self):
        if self._model is None:
            if not self._model_path.is_dir():
                raise SemanticSimilarityError(
                    f"Legacy semantic model is missing: {self._model_path}. "
                    "Provide the local model or configure another SemanticSimilarity adapter."
                )

            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as error:
                raise SemanticSimilarityError(
                    "Legacy semantic dependencies are missing. "
                    "Install the server's legacy-ml extra to use this adapter."
                ) from error

            self._model = SentenceTransformer(
                str(self._model_path), local_files_only=True
            )

        return self._model

    def pair(self, first: str, second: str) -> float:
        model = self._get_model()
        first_embedding = model.encode(
            first, normalize_embeddings=True, convert_to_numpy=True
        )
        second_embedding = model.encode(
            second, normalize_embeddings=True, convert_to_numpy=True
        )
        return min(1.0, float(model.similarity(first_embedding, second_embedding)[0][0]))

    def word_lists(self, first: List[str], second: List[str]) -> float:
        import numpy as np

        model = self._get_model()
        first_embeddings = model.encode(
            first, normalize_embeddings=True, convert_to_numpy=True
        )
        second_embeddings = model.encode(
            second, normalize_embeddings=True, convert_to_numpy=True
        )
        matrix = np.clip(first_embeddings @ second_embeddings.T, -1.0, 1.0)
        result = (np.mean(np.max(matrix, axis=1)) + np.mean(np.max(matrix, axis=0))) / 2
        return min(1.0, float(result))
