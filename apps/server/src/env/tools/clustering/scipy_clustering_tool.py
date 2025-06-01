import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage

from app.ports.tools import ClusteringTool
from core.entities import GrammarClustering


class ScipyGrammarClusterer(ClusteringTool):
    def cluster(self, request: GrammarClustering) -> dict[int, list[str]]:
        """Execute clustering with the scores and policy supplied by the core."""
        keys = request.keys

        if len(keys) < 2:
            return {1: list(keys)} if keys else {}

        distances = 1 - np.asarray(request.similarities, dtype=float)
        hierarchy = linkage(distances, method=request.linkage)
        labels = fcluster(hierarchy, t=1 - request.threshold, criterion="distance")
        clusters: dict[int, list[str]] = {}

        for key, label in zip(keys, labels, strict=True):
            clusters.setdefault(int(label), []).append(key)

        return clusters
