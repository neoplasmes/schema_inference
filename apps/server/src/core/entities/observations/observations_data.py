from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, order=True)
class ExpandedName:
    namespace: str
    local_name: str

    @property
    def clark_name(self) -> str:
        if self.namespace:
            return f"{{{self.namespace}}}{self.local_name}"

        return self.local_name


@dataclass(frozen=True)
class AttributeObservation:
    name: ExpandedName
    value: str


@dataclass(frozen=True)
class NodeObservation:
    document_id: str
    position: tuple[int, ...]
    profile_id: str
    path: tuple[ExpandedName, ...]
    attributes: tuple[AttributeObservation, ...]
    text: str | None
    tail: str | None
    nil: bool | None
    kind: Literal["empty", "text", "children", "mixed"]
    child_profile_ids: tuple[str, ...]

    @property
    def name(self) -> ExpandedName:
        return self.path[-1]


@dataclass(frozen=True)
class ChildSequenceObservation:
    child_profile_ids: tuple[str, ...]
    count: int
    frequency: float


@dataclass(frozen=True)
class NodeProfile:
    profile_id: str
    path: tuple[ExpandedName, ...]
    parent_profile_id: str | None
    observations: tuple[NodeObservation, ...]
    child_sequences: tuple[ChildSequenceObservation, ...]

    @property
    def name(self) -> ExpandedName:
        return self.path[-1]

    @property
    def occurrence_count(self) -> int:
        return len(self.observations)

    @property
    def document_count(self) -> int:
        return len({item.document_id for item in self.observations})


@dataclass(frozen=True)
class ObservedDocument:
    document_id: str
    content_hash: str
    root_profile_id: str
    node_count: int


@dataclass(frozen=True)
class ObservedCorpus:
    documents: tuple[ObservedDocument, ...]
    profiles: tuple[NodeProfile, ...]

    @property
    def observations(self) -> tuple[NodeObservation, ...]:
        return tuple(
            observation
            for profile in self.profiles
            for observation in profile.observations
        )

    @property
    def document_count(self) -> int:
        return len(self.documents)

    @property
    def node_count(self) -> int:
        return sum(document.node_count for document in self.documents)


@dataclass(frozen=True)
class ObservationLimits:
    max_documents: int = 10_000
    max_nodes: int = 1_000_000
    max_depth: int = 512
