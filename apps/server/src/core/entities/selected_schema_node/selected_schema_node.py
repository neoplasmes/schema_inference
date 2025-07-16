import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Literal

from core.entities.selected_schema_node import SelectedSchemaNodeError

_XML_LOCAL_NAME = re.compile(r"[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_.-]*")
_SIMPLE_TYPES = frozenset(
    "string boolean decimal float double duration dateTime time date gYearMonth "
    "gYear gMonthDay gDay gMonth hexBinary base64Binary anyURI QName "
    "normalizedString token language NMTOKEN NMTOKENS Name NCName ID IDREF "
    "IDREFS ENTITY ENTITIES integer nonPositiveInteger negativeInteger long int "
    "short byte nonNegativeInteger unsignedLong unsignedInt unsignedShort "
    "unsignedByte positiveInteger anySimpleType".split()
)


def _validate_name(name: str) -> None:
    """Require a supported element or attribute name for XSD generation.

    Names use Latin or Russian letters, digits, underscores, dots and hyphens.
    The first character must be a letter or underscore.
    """
    # Selected names become XSD element or attribute declarations. The application
    # supports a Latin/Russian subset of local names, without namespace prefixes.
    if not isinstance(name, str) or _XML_LOCAL_NAME.fullmatch(name) is None:
        raise SelectedSchemaNodeError(
            "Schema names must start with a Latin or Russian letter or underscore "
            "and contain only these letters, digits, underscores, dots or hyphens."
        )


@dataclass(frozen=True)
class SelectedSchemaNode:
    """Describe an immutable, valid selection ready for conversion to XSD."""

    name: str
    chosen_type: str
    min_occurs: int = 1
    max_occurs: int | Literal["unbounded"] = 1
    children: tuple["SelectedSchemaNode", ...] = ()
    attributes: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Validate the selected XSD shape and freeze its child and attribute data."""
        _validate_name(self.name)

        # Generation handles supported XSD simple types, structured parent content
        # and null values; other selections have no defined schema representation.
        if not isinstance(
            self.chosen_type, str
        ) or self.chosen_type not in _SIMPLE_TYPES | {"parent", "null"}:
            raise SelectedSchemaNodeError("The selected schema type is unsupported.")

        # An element occurs a whole, nonnegative number of times; zero makes it
        # optional, while a boolean is not a meaningful repetition count.
        if type(self.min_occurs) is not int or self.min_occurs < 0:
            raise SelectedSchemaNodeError("minOccurs must be a nonnegative integer.")

        # A document must be able to satisfy both occurrence bounds. An unbounded
        # maximum permits any number of repetitions above the selected minimum.
        if self.max_occurs != "unbounded" and (
            type(self.max_occurs) is not int or self.max_occurs < self.min_occurs
        ):
            raise SelectedSchemaNodeError(
                "maxOccurs must be unbounded or an integer >= minOccurs."
            )

        # Every selected child must carry the same validated schema rules as its
        # parent before the recursive XSD builder can emit its declaration.
        if not isinstance(self.children, (tuple, list)) or any(
            not isinstance(child, SelectedSchemaNode) for child in self.children
        ):
            raise SelectedSchemaNodeError(
                "Schema children must be selected schema nodes."
            )

        # The model uses parent nodes for nested elements and scalar nodes for
        # values; combining scalar content with element children is unsupported.
        if self.chosen_type != "parent" and self.children:
            raise SelectedSchemaNodeError(
                "A scalar schema node cannot contain child elements."
            )

        # An attribute selection associates each attribute name with one value
        # type, rather than representing attributes as nested element structures.
        if not isinstance(self.attributes, Mapping):
            raise SelectedSchemaNodeError(
                "Schema attributes must map names to simple types."
            )

        for name, value_type in self.attributes.items():
            _validate_name(name)

            # xmlns declares namespaces rather than business attributes, and an
            # ordinary XSD attribute carries a simple value rather than children.
            if (
                name == "xmlns"
                or not isinstance(value_type, str)
                or value_type not in _SIMPLE_TYPES
            ):
                raise SelectedSchemaNodeError(
                    "Schema attributes require ordinary names and XSD simple types."
                )

        object.__setattr__(self, "children", tuple(self.children))
        object.__setattr__(self, "attributes", MappingProxyType(dict(self.attributes)))
