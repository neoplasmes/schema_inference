import re
from typing import Union

from domain.entities.xsd_type import XSDType

PATTERNS = {
    XSDType.INTEGER: r"^-?\d+$",
    XSDType.BOOLEAN: r"^(true|false)$",
    XSDType.DECIMAL: r"^-?\d*\.\d+$",
    XSDType.DURATION: r"^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$",
    XSDType.DATETIME: r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$",
    XSDType.TIME: r"^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$",
    XSDType.DATE: r"^\d{4}-\d{2}-\d{2}(?:Z|[+-]\d{2}:\d{2})?$",
    XSDType.ANY_URI: r"^(?:http|https|ftp|file)://[^\s]+$",
}


def inferXSDType(value: Union[str, None]) -> XSDType:
    if value is None or value == "":
        return XSDType.EMPTY

    value = value.strip()

    if value == "P":
        return XSDType.DURATION

    for xsdtype, pattern in PATTERNS.items():
        if re.match(pattern, value):
            if xsdtype == XSDType.HEX_BINARY and len(value) % 2 != 0:
                continue
            return xsdtype

    return XSDType.STRING
