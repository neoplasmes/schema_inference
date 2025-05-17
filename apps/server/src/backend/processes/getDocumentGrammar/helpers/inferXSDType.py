import re
from typing import Union

from backend.entities.XSDTypes.XSDTypes import XSDType

PATTERNS = {
    XSDType.INTEGER: r"^-?\d+$",
    XSDType.BOOLEAN: r"^(true|false)$",
    XSDType.DECIMAL: r"^-?\d*\.\d+$",
    # XSDType.FLOAT: r"^-?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$",
    # XSDType.DOUBLE: r"^-?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$",
    XSDType.DURATION: r"^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$",
    XSDType.DATETIME: r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$",
    XSDType.TIME: r"^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$",
    XSDType.DATE: r"^\d{4}-\d{2}-\d{2}(?:Z|[+-]\d{2}:\d{2})?$",
    # XSDType.HEX_BINARY: r"^[0-9a-fA-F]+$",
    # XSDType.BASE64_BINARY: r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
    XSDType.ANY_URI: r"^(?:http|https|ftp|file)://[^\s]+$",
}


def inferXSDType(value: Union[str, None]) -> XSDType:
    # пустой тип
    if value is None or value == "":
        return XSDType.EMPTY

    value = value.strip()

    # пустая длительность
    if value == "P":
        return XSDType.DURATION

    for xsdtype, pattern in PATTERNS.items():
        if re.match(pattern, value):
            # hexBinary должна быть чётной
            if xsdtype == XSDType.HEX_BINARY and len(value) % 2 != 0:
                continue
            return xsdtype

    # по умолчанию возвращаем строку
    return XSDType.STRING
