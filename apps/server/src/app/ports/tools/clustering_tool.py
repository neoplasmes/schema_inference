from typing import Protocol

from core.entities import GrammarClustering


class ClusteringTool(Protocol):
    def cluster(
        self,
        request: GrammarClustering,
    ) -> dict[int, list[str]]: ...
