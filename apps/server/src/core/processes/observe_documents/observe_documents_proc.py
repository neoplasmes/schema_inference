import hashlib
import json
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Literal

from core.entities import XmlNode
from core.entities.observations import (
    AttributeObservation,
    ChildSequenceObservation,
    ExpandedName,
    NodeObservation,
    NodeProfile,
    ObservationLimits,
    ObservedCorpus,
    ObservedDocument,
)
from core.processes.observe_documents import ObserveDocumentsError


def observe_documents(
    roots: Sequence[XmlNode],
    limits: ObservationLimits | None = None,
) -> ObservedCorpus:
    """Snapshot documents without merging names, paths, or observed alternatives."""
    limits = limits or ObservationLimits()
    _validate_limits(limits)

    if len(roots) > limits.max_documents:
        raise ObserveDocumentsError("The document count exceeds max_documents.")

    profile_ids: dict[tuple[ExpandedName, ...], str] = {}
    snapshots: list[tuple[str, tuple[NodeObservation, ...]]] = []
    node_count = 0

    for root in roots:
        content_hash, observations = _snapshot_document(
            root,
            limits,
            limits.max_nodes - node_count,
            profile_ids,
        )
        snapshots.append((content_hash, observations))
        node_count += len(observations)

    documents: list[ObservedDocument] = []
    by_profile: dict[str, list[NodeObservation]] = defaultdict(list)
    duplicates: Counter[str] = Counter()

    for content_hash, observations in sorted(snapshots, key=lambda item: item[0]):
        duplicates[content_hash] += 1
        document_id = f"document_{content_hash}_{duplicates[content_hash]}"
        documents.append(
            ObservedDocument(
                document_id=document_id,
                content_hash=content_hash,
                root_profile_id=observations[0].profile_id,
                node_count=len(observations),
            )
        )

        for observation in observations:
            by_profile[observation.profile_id].append(
                replace(observation, document_id=document_id)
            )

    profiles = tuple(
        _build_profile(profile_id, observations, profile_ids)
        for profile_id, observations in sorted(by_profile.items())
    )

    return ObservedCorpus(documents=tuple(documents), profiles=profiles)


def _snapshot_document(
    root: XmlNode,
    limits: ObservationLimits,
    remaining_nodes: int,
    profile_ids: dict[tuple[ExpandedName, ...], str],
) -> tuple[str, tuple[NodeObservation, ...]]:
    pending: list[tuple[XmlNode, tuple[ExpandedName, ...], tuple[int, ...], bool]] = [
        (root, (), (), False)
    ]
    active: set[int] = set()
    observations: list[NodeObservation] = []
    digest = hashlib.sha256()

    while pending:
        node, parent_path, position, exiting = pending.pop()

        if exiting:
            active.remove(id(node))

            continue

        if not isinstance(node, XmlNode):
            raise ObserveDocumentsError("Every document node must be an XmlNode.")

        if id(node) in active:
            raise ObserveDocumentsError("A document contains a cyclic child reference.")

        if len(observations) >= remaining_nodes:
            raise ObserveDocumentsError("The corpus node count exceeds max_nodes.")

        path = parent_path + (_expanded_name(node.tag),)

        if len(path) > limits.max_depth:
            raise ObserveDocumentsError("A document exceeds max_depth.")

        _validate_content(node)
        active.add(id(node))
        attributes = tuple(
            sorted(
                (
                    AttributeObservation(_expanded_name(name), value)
                    for name, value in node.attributes.items()
                ),
                key=lambda attribute: attribute.name,
            )
        )
        child_profile_ids = tuple(
            _profile_id(path + (_expanded_name(child.tag),), profile_ids)
            for child in node.children
        )
        observation = NodeObservation(
            document_id="",
            position=position,
            profile_id=_profile_id(path, profile_ids),
            path=path,
            attributes=attributes,
            text=node.text,
            tail=node.tail,
            nil=_nil_value(attributes),
            kind=_content_kind(node),
            child_profile_ids=child_profile_ids,
        )
        observations.append(observation)
        encoded = json.dumps(
            (
                (observation.name.namespace, observation.name.local_name),
                tuple(
                    (
                        attribute.name.namespace,
                        attribute.name.local_name,
                        attribute.value,
                    )
                    for attribute in attributes
                ),
                node.text,
                node.tail,
                len(node.children),
            ),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        pending.append((node, parent_path, position, True))

        for index in range(len(node.children) - 1, -1, -1):
            pending.append((node.children[index], path, position + (index,), False))

    return digest.hexdigest(), tuple(observations)


def _build_profile(
    profile_id: str,
    observations: list[NodeObservation],
    profile_ids: dict[tuple[ExpandedName, ...], str],
) -> NodeProfile:
    observations.sort(
        key=lambda observation: (observation.document_id, observation.position)
    )
    path = observations[0].path
    counts = Counter(observation.child_profile_ids for observation in observations)
    sequences = tuple(
        ChildSequenceObservation(
            child_profile_ids=children,
            count=count,
            frequency=count / len(observations),
        )
        for children, count in sorted(counts.items())
    )

    return NodeProfile(
        profile_id=profile_id,
        path=path,
        parent_profile_id=profile_ids[path[:-1]] if len(path) > 1 else None,
        observations=tuple(observations),
        child_sequences=sequences,
    )


def _profile_id(
    path: tuple[ExpandedName, ...],
    profile_ids: dict[tuple[ExpandedName, ...], str],
) -> str:
    if path not in profile_ids:
        encoded = json.dumps(
            [(name.namespace, name.local_name) for name in path],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        profile_ids[path] = f"profile_{hashlib.sha256(encoded).hexdigest()}"

    return profile_ids[path]


def _expanded_name(name: str) -> ExpandedName:
    if not isinstance(name, str) or not name:
        raise ObserveDocumentsError("An expanded XML name must be a nonempty string.")

    if name.startswith("{"):
        namespace, separator, local_name = name[1:].rpartition("}")

        if not separator or not namespace or not local_name:
            raise ObserveDocumentsError(f"Invalid expanded XML name: {name!r}.")

        return ExpandedName(namespace=namespace, local_name=local_name)

    return ExpandedName(namespace="", local_name=name)


def _nil_value(attributes: tuple[AttributeObservation, ...]) -> bool | None:
    for attribute in attributes:
        if attribute.name != ExpandedName(
            "http://www.w3.org/2001/XMLSchema-instance", "nil"
        ):
            continue

        value = attribute.value.strip()

        if value in ("true", "1"):
            return True

        if value in ("false", "0"):
            return False

    return None


def _content_kind(node: XmlNode) -> Literal["empty", "text", "children", "mixed"]:
    has_text = bool(node.text and node.text.strip())

    if node.children:
        has_tail = any(child.tail and child.tail.strip() for child in node.children)

        return "mixed" if has_text or has_tail else "children"

    return "text" if has_text else "empty"


def _validate_limits(limits: ObservationLimits) -> None:
    values = (limits.max_documents, limits.max_nodes, limits.max_depth)

    if any(type(value) is not int or value < 1 for value in values):
        raise ObserveDocumentsError("Observation limits must be positive integers.")


def _validate_content(node: XmlNode) -> None:
    if node.text is not None and not isinstance(node.text, str):
        raise ObserveDocumentsError("Node text must be a string or None.")

    if node.tail is not None and not isinstance(node.tail, str):
        raise ObserveDocumentsError("Node tail must be a string or None.")

    if not isinstance(node.attributes, Mapping) or any(
        not isinstance(value, str) for value in node.attributes.values()
    ):
        raise ObserveDocumentsError("Node attributes must map names to strings.")

    if not isinstance(node.children, (list, tuple)) or any(
        not isinstance(child, XmlNode) for child in node.children
    ):
        raise ObserveDocumentsError(
            "Node children must be a sequence of XmlNode values."
        )
