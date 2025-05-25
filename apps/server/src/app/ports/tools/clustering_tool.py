from typing import Callable, Protocol, TypeVar

Item = TypeVar("Item")


class ClusteringTool(Protocol):
    def cluster(
        self,
        items: dict[str, Item],
        compare: Callable[[Item, Item], float],
        threshold: float,
    ) -> dict[int, list[str]]: ...
