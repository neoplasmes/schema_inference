from typing import Callable, Dict, List, TypeVar

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

T = TypeVar("T")


def getDictCluster(
    inputDict: Dict[str, T], compareFn: Callable[[T, T], float], threshold: float = 0.8
) -> Dict[int, List[str]]:
    """
    Функция для кластеризации некоего словаря с помощью попарного сравнения элементов через CompareFn.
    CompareFn должна работать по принципу: 1 - лучший результат, 0 - худший
    threshold - выше какого реузльтата compareFn происходит кластеризация
    """

    keys = list(inputDict.keys())
    matrixSize = len(keys)

    matrix = np.zeros((matrixSize, matrixSize))
    for i in range(0, matrixSize):
        for j in range(0, matrixSize):
            key1, key2 = keys[i], keys[j]
            coefficient = compareFn(inputDict[key1], inputDict[key2])

            matrix[i, j] = coefficient
            matrix[j, i] = coefficient

    # Стандарт коэффициентов 1: лучший результат, 0: худший
    # кластерицзации происходит по "степени близости", поэтому мы инвертируем все коэффициенты, чтобы получить
    # т.н. "расстояние"
    np.fill_diagonal(matrix, 1)
    distanceMatrix = 1 - matrix

    distanceVector = squareform(distanceMatrix)
    Z = linkage(distanceVector, method="average")
    labels = fcluster(Z, t=1 - threshold, criterion="distance")

    # группировка слов по кластерам
    clusters: Dict[int, List[str]] = {}
    for key, label in zip(keys, labels):
        if not label in clusters:
            clusters[label] = []

        clusters[label].append(key)

    return clusters
