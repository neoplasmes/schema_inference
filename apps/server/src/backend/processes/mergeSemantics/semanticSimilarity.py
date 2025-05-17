from pathlib import Path
from typing import List

import numpy as np
from numpy import ndarray
from sentence_transformers import SentenceTransformer

# mergesemantics -> processes -> backend -> src -> calc
projectRoot = Path(__file__).parent.parent.parent.parent.parent
model = SentenceTransformer(
    str((projectRoot / "FinetunedModel" / "bge_finetuned_nouns"))
)


def getPairSimilarity(word1: str, word2: str) -> float:
    emb1 = model.encode(word1, normalize_embeddings=True, convert_to_numpy=True)
    emb2 = model.encode(word2, normalize_embeddings=True, convert_to_numpy=True)

    return min(1.0, float(model.similarity(emb1, emb2)[0][0]))


def getWordsSimilarityMatrix(words1: List[str], words2: List[str]) -> ndarray:
    # Нормализованный вектор = каждый элемент вектора поделить на его норму.
    # Норма = корень суммы квадратов каждого элемента.
    # Косинусное сходство - это скалярное произведение нормализованных векторов.
    embeddings1 = model.encode(words1, normalize_embeddings=True, convert_to_numpy=True)
    embeddings2 = model.encode(words2, normalize_embeddings=True, convert_to_numpy=True)

    # При перемножении матриц у нас как раз происходит вычисление скалярного произведения для каждой ячейки.
    # таким образом получается матрица косинусных сходств
    matrix = embeddings1 @ embeddings2.T
    matrix = np.clip(matrix, -1.0, 1.0)

    return matrix


def getWordListAssociativeSimilarity(words1: List[str], words2: List[str]) -> float:
    similarityMatrix = getWordsSimilarityMatrix(words1, words2)

    maxSimRows = np.max(similarityMatrix, axis=1)
    maxSimCols = np.max(similarityMatrix, axis=0)

    result = (np.mean(maxSimRows) + np.mean(maxSimCols)) / 2

    return min(1.0, result)
