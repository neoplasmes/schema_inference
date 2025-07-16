from collections import Counter
from dataclasses import dataclass

from core.entities.probability_space import Frequency, ObservedField, VariantReference


@dataclass(frozen=True)
class ProbabilitySpace:
    """Keep counted field alternatives with references local to this result."""

    documents: int
    nodes: tuple[ObservedField, ...]
    roots: tuple[Frequency[VariantReference], ...]
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        """Freeze the result and reconcile its graph with document-level evidence."""
        for attribute in ("nodes", "roots", "warnings"):
            object.__setattr__(self, attribute, tuple(getattr(self, attribute)))

        # Analysis may receive no documents, but its sample size is always a whole
        # count of documents rather than a negative, fractional or boolean value.
        if type(self.documents) is not int or self.documents < 0:
            raise ValueError("The document count must be a nonnegative integer.")

        # Each input document contributes one root observation, regardless of its
        # internal size, so root counts must cover the complete input collection.
        if sum(root.count for root in self.roots) != self.documents:
            raise ValueError("Root counts must account for every document.")

        # Root probabilities describe how often each complete document shape occurs
        # in the collection, using the same document count for every alternative.
        if any(root.total != self.documents for root in self.roots):
            raise ValueError("Root frequencies must use the document denominator.")

        fields = {node.id: node for node in self.nodes}
        variants = {
            VariantReference(node.id, item.value.id): item.value
            for node in self.nodes
            for item in node.variants
        }

        # A contextual field has one identity and one full path. Duplicate records
        # would split its statistics or make structural references ambiguous.
        if len(fields) != len(self.nodes) or len(
            {node.path for node in self.nodes}
        ) != len(self.nodes):
            raise ValueError("Field identifiers and paths must be unique.")

        # Repeated documents increase a root alternative's count rather than create
        # duplicate alternatives pointing to the same field and structural variant.
        if len({root.value for root in self.roots}) != len(self.roots):
            raise ValueError("Root references must be unique.")

        root_counts = Counter()
        root_documents = Counter()
        contexts = {node.path: node for node in self.nodes}

        for node in self.nodes:
            parent = contexts.get(node.path[:-1])
            expected_parents = parent.occurrences if parent else self.documents

            # A nested field must belong to an observed parent; an orphan path has
            # no document context in which its presence could be measured.
            if len(node.path) > 1 and parent is None:
                raise ValueError("A field has no parent context.")

            # A child's presence is measured over occurrences of its own parent,
            # while root presence is measured over the input documents.
            if node.parent_occurrences != expected_parents:
                raise ValueError("Field denominators must match their parent context.")

            locations = {
                (
                    source.document,
                    source.position
                    if source.representation == "attribute"
                    else source.position[:-1],
                )
                for source in node.sources
            }

            # Multiple occurrences inside one parent count as one presence. Source
            # locations provide the independent evidence for that parent count.
            if len(locations) != node.presence_count:
                raise ValueError(
                    "Presence counts must agree with observed parent locations."
                )

            for source in node.sources:
                # Provenance must refer to a document in this analyzed collection.
                if source.document >= self.documents:
                    raise ValueError("A source references an unknown document.")

                if len(node.path) == 1:
                    root_documents[source.document] += 1
                    root_counts[VariantReference(node.id, source.variant)] += 1

            for item in node.variants:
                for child in item.value.children:
                    # An observed structure can include only child alternatives
                    # that are actually represented in this analysis result.
                    if child not in variants:
                        raise ValueError(
                            "A structural variant references an unknown child."
                        )

                    # A child keeps its original parent role; a buyer's name cannot
                    # be reused as a seller's name merely because the labels match.
                    if fields[child.node].path[:-1] != node.path:
                        raise ValueError(
                            "A child reference must belong to its parent context."
                        )

        # Equal total counts alone could hide one omitted document and one counted
        # twice. Each source document must supply exactly one root observation.
        if root_documents != Counter(range(self.documents)):
            raise ValueError("Each document must have exactly one root observation.")

        # The root summary must reproduce the structural alternatives recorded in
        # source evidence, including how often each alternative was observed.
        if root_counts != Counter({root.value: root.count for root in self.roots}):
            raise ValueError(
                "Root frequencies must agree with root source observations."
            )

        reachable: set[VariantReference] = set()
        pending = [root.value for root in self.roots]

        while pending:
            reference = pending.pop()

            if reference in reachable:
                continue

            # Traversing a document alternative requires an actual recorded shape
            # for every reference, beginning with its root.
            if reference not in variants:
                raise ValueError("A root references an unknown variant.")

            reachable.add(reference)
            pending.extend(variants[reference].children)

        # Every stored alternative must participate in an observed document shape;
        # disconnected variants would add unsupported choices to the result.
        if reachable != variants.keys():
            raise ValueError("Every variant must be reachable from a root.")
