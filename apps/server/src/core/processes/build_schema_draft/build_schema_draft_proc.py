from typing import Any

from core.entities import DocumentNode, XmlDocumentNode
from core.entities.inference import InferenceLimits
from core.entities.schema_draft import SchemaGraph
from core.processes.normalize_documents import normalize_documents

XSI = "{http://www.w3.org/2001/XMLSchema-instance}"
SCALAR_TYPES = frozenset(
    {"string", "integer", "number", "decimal", "boolean", "null", "date", "datetime"}
)


def _name(value: str) -> dict[str, str | None]:
    """Separate an expanded XML name into its namespace and local name."""
    if value.startswith("{") and "}" in value:
        namespace, local_name = value[1:].split("}", 1)

        return {"namespaceUri": namespace, "localName": local_name}

    return {"namespaceUri": None, "localName": value}


def _scalar_type(value: str | None) -> str:
    """Translate inference scalar names into the editor's supported vocabulary."""
    scalar_type = {"double": "number", "dateTime": "datetime"}.get(
        value or "null", value or "null"
    )

    # A selected scalar must have a supported schema meaning rather than silently
    # becoming a string when its original type cannot be represented.
    if scalar_type not in SCALAR_TYPES:
        raise ValueError(f"Unsupported scalar type: {value!r}.")

    return scalar_type


def _xml_scalar_type(text: str | None) -> str:
    """Reuse the inference rules without simplifying the surrounding XML tree."""
    observation = normalize_documents([XmlDocumentNode("value", text)])[0]

    return _scalar_type(observation.data_type)


def _shapes(root: DocumentNode, syntax: str) -> dict[int, tuple[Any, ...]]:
    """Validate finite source containment and identify equal array-item shapes."""
    active: set[int] = set()
    shapes: dict[int, tuple[Any, ...]] = {}
    limits = InferenceLimits()
    count = 0

    def visit(node: DocumentNode, depth: int) -> tuple[Any, ...]:
        nonlocal count
        count += 1

        # A document is a finite tree. A cyclic child would make the resulting
        # schema contain itself without an explicit reusable definition.
        if id(node) in active:
            raise ValueError("The source document contains a cycle.")

        if depth >= limits.max_depth or count > limits.max_nodes:
            raise ValueError("The source document exceeds the draft size limits.")

        active.add(id(node))
        children = [(child.tag, visit(child, depth + 1)) for child in node.children]
        active.remove(id(node))

        if syntax == "xml":
            shape = (node.tag, tuple(children))
        elif node.node_kind == "mapping":
            # A mapping has one value for each property name. Keeping two values
            # under one name would make edits and generated schema rules ambiguous.
            if len({name for name, _ in children}) != len(children):
                raise ValueError("Mapping property names must be unique.")

            shape = ("object", tuple(sorted(children)))
        elif node.node_kind == "sequence":
            shape = ("array", frozenset(child for _, child in children))
        elif node.node_kind == "scalar" and not children:
            shape = ("scalar", _scalar_type(node.value_type))
        else:
            raise ValueError(f"Unsupported document node kind: {node.node_kind!r}.")

        shapes[id(node)] = shape

        return shape

    visit(root, 0)

    return shapes


class _DraftBuilder:
    """Build independent node occurrences and stable local member identities."""

    def __init__(self, shapes: dict[int, tuple[Any, ...]]) -> None:
        self.nodes: dict[str, dict[str, Any]] = {}
        self.collections: dict[str, list[dict[str, Any]]] = {}
        self.shapes = shapes
        self.member_count = 0

    def node(self, kind: str, **values: Any) -> str:
        """Add one semantic node without sharing mutable source document values."""
        identifier = f"node-{len(self.nodes) + 1}"
        self.nodes[identifier] = {"id": identifier, "kind": kind, **values}

        return identifier

    def scalar(self, scalar_type: str) -> str:
        """Create a scalar whose constraints have not been manually specialized."""
        return self.node("scalar", scalarType=scalar_type, constraints={})

    def collection(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        """Register a complete ordered collection for subsequent paged reads."""
        identifier = f"collection-{len(self.collections) + 1}"
        self.collections[identifier] = rows

        return {"id": identifier, "totalItems": len(rows)}

    def member(self, kind: str, node_id: str, **values: Any) -> dict[str, Any]:
        """Address a collection member independently from the node it contains."""
        self.member_count += 1

        return {
            "id": f"member-{self.member_count}",
            "kind": kind,
            "valueNodeId": node_id,
            **values,
        }

    def data_node(self, node: DocumentNode) -> str:
        """Retain mappings, sequences and scalar types from JSON or YAML sources."""
        if node.node_kind == "mapping":
            rows = [
                self.member(
                    "property", self.data_node(child), name=child.tag, required=True
                )
                for child in node.children
            ]

            return self.node(
                "object",
                properties=self.collection(rows),
                additionalProperties=False,
            )

        if node.node_kind == "sequence":
            unique: dict[tuple[Any, ...], DocumentNode] = {}

            for child in node.children:
                unique.setdefault(self.shapes[id(child)], child)

            alternatives = [self.data_node(child) for child in unique.values()]

            if not alternatives:
                item_id = self.scalar("null")
            elif len(alternatives) == 1:
                item_id = alternatives[0]
            else:
                rows = [
                    self.member("option", identifier, title=f"Variant {index}")
                    for index, identifier in enumerate(alternatives, 1)
                ]
                item_id = self.node(
                    "union", mode="anyOf", options=self.collection(rows)
                )

            # An empty sample proves only an empty array. Its zero upper bound
            # makes the placeholder item type vacuous instead of inventing evidence.
            return self.node(
                "array",
                itemsNodeId=item_id,
                minItems=0,
                maxItems=None if alternatives else 0,
            )

        return self.scalar(_scalar_type(node.value_type))

    def xml_node(self, node: DocumentNode) -> str:
        """Keep XML occurrences, names, text content and attribute ownership."""
        attributes = getattr(node, "attributes", {})
        nil = attributes.get(XSI + "nil", "false").strip()

        if nil not in {"true", "false", "1", "0"}:
            raise ValueError("Invalid xsi:nil value.")

        nillable = nil in {"true", "1"}

        # An explicitly nil element has no value; retaining children or text as
        # a null schema would silently discard contradictory source content.
        if nillable and (node.children or (node.text or "").strip()):
            raise ValueError("An xsi:nil element cannot contain text or children.")

        attribute_rows = [
            self.member(
                "xmlAttribute",
                self.scalar(_xml_scalar_type(value)),
                name=_name(name),
                required=True,
            )
            for name, value in sorted(attributes.items())
            if not name.startswith(XSI)
        ]
        mixed = bool(node.children) and (
            bool((node.text or "").strip())
            or any(
                (getattr(child, "tail", None) or "").strip() for child in node.children
            )
        )

        if node.children or attribute_rows:
            particles = [
                self.member(
                    "xmlParticle", self.xml_node(child), minOccurs=1, maxOccurs=1
                )
                for child in node.children
            ]
            particle_id = (
                self.node(
                    "xmlGroup",
                    compositor="sequence",
                    particles=self.collection(particles),
                )
                if particles
                else None
            )
            simple_id = (
                self.scalar("null" if nillable else _xml_scalar_type(node.text))
                if not node.children
                else None
            )
            content_id = self.node(
                "xmlComplex",
                attributes=self.collection(attribute_rows),
                particleNodeId=particle_id,
                simpleContentNodeId=simple_id,
                mixed=mixed,
            )
        else:
            content_id = self.scalar(
                "null" if nillable else _xml_scalar_type(node.text)
            )

        name = _name(node.tag)

        return self.node(
            "xmlElement",
            name=name,
            contentNodeId=content_id,
            nillable=nillable,
        )


def build_schema_draft(root: DocumentNode, syntax: str) -> SchemaGraph:
    """Convert one selected source shape into an independent editable schema graph."""
    if syntax not in {"xml", "json", "yaml"}:
        raise ValueError(f"Unsupported schema syntax: {syntax!r}.")

    builder = _DraftBuilder(_shapes(root, syntax))
    root_id = builder.xml_node(root) if syntax == "xml" else builder.data_node(root)

    return SchemaGraph(
        root_node_id=root_id,
        profile={
            "syntax": syntax,
            "dialect": "xsd-1.0" if syntax == "xml" else "json-schema-2020-12",
        },
        nodes=builder.nodes,
        collections=builder.collections,
    )
