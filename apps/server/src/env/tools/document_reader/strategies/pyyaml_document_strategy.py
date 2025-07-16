import math
from typing import BinaryIO

import yaml
from yaml.nodes import MappingNode, Node, ScalarNode, SequenceNode

from app.ports.tools.document_reader import InvalidDocumentError
from core.entities import YamlDocumentNode


class PyyamlDocumentStrategy:
    """Read ordinary YAML mappings, lists and scalars without custom tags or aliases."""

    def read(self, source: BinaryIO) -> YamlDocumentNode:
        """Use a single named field as the root, otherwise keep a document container."""
        loader = None

        try:
            loader = yaml.SafeLoader(source)
            source_root = loader.get_single_node()

            if source_root is None:
                raise InvalidDocumentError("The YAML document is empty.")

            tag = "$document"
            role = "document"

            if (
                isinstance(source_root, MappingNode)
                and source_root.tag == "tag:yaml.org,2002:map"
                and len(source_root.value) == 1
            ):
                key, source_root = source_root.value[0]
                tag = self._key(key)
                role = "field"

            return self._convert_node(source_root, tag, role, loader, set(), 0)
        except (yaml.YAMLError, RecursionError, ValueError) as error:
            raise InvalidDocumentError(str(error)) from error
        finally:
            if loader is not None:
                loader.dispose()

    def _convert_node(
        self,
        source: Node,
        tag: str,
        role: str,
        loader: yaml.SafeLoader,
        visited: set[int],
        depth: int,
    ) -> YamlDocumentNode:
        if id(source) in visited:
            raise InvalidDocumentError("YAML aliases are not supported.")

        if depth > 256 or len(visited) >= 100_000:
            raise InvalidDocumentError(
                "The YAML document is too large or too deeply nested."
            )

        visited.add(id(source))

        if isinstance(source, ScalarNode):
            return self._scalar(source, tag, role, loader)

        if isinstance(source, MappingNode) and source.tag == "tag:yaml.org,2002:map":
            result = YamlDocumentNode(
                tag, node_kind="mapping", role=role, ordered=False
            )
            keys: set[str] = set()

            for key, value in source.value:
                name = self._key(key)

                if name in keys:
                    raise InvalidDocumentError(f"Duplicate YAML field: {name!r}.")

                keys.add(name)
                result.children.append(
                    self._convert_node(value, name, "field", loader, visited, depth + 1)
                )

            return result

        if isinstance(source, SequenceNode) and source.tag == "tag:yaml.org,2002:seq":
            result = YamlDocumentNode(tag, node_kind="sequence", role=role)

            for value in source.value:
                result.children.append(
                    self._convert_node(value, "[]", "item", loader, visited, depth + 1)
                )

            return result

        raise InvalidDocumentError(f"Unsupported YAML tag: {source.tag!r}.")

    @staticmethod
    def _key(source: Node) -> str:
        if (
            not isinstance(source, ScalarNode)
            or source.tag != "tag:yaml.org,2002:str"
            or not source.value
        ):
            raise InvalidDocumentError("YAML field names must be nonempty strings.")

        return source.value

    @staticmethod
    def _scalar(
        source: ScalarNode, tag: str, role: str, loader: yaml.SafeLoader
    ) -> YamlDocumentNode:
        types = {
            "tag:yaml.org,2002:str": "string",
            "tag:yaml.org,2002:int": "integer",
            "tag:yaml.org,2002:float": "number",
            "tag:yaml.org,2002:bool": "boolean",
            "tag:yaml.org,2002:null": "null",
            "tag:yaml.org,2002:timestamp": "date",
        }
        value_type = types.get(source.tag)

        if value_type is None:
            raise InvalidDocumentError(f"Unsupported YAML scalar tag: {source.tag!r}.")

        value = (
            source.value if value_type == "date" else loader.construct_object(source)
        )

        if isinstance(value, float) and not math.isfinite(value):
            raise InvalidDocumentError("YAML numeric values must be finite.")

        return YamlDocumentNode(
            tag,
            text=source.value,
            node_kind="scalar",
            role=role,
            value_type=value_type,
            value=value,
        )
