from enum import Enum


class XSDType(Enum):
    """Поддеживаемые в данной программе типы данных"""

    STRING = "string"
    BOOLEAN = "boolean"
    DECIMAL = "decimal"
    FLOAT = "float"
    DOUBLE = "double"
    DURATION = "duration"
    DATETIME = "dateTime"
    TIME = "time"
    DATE = "date"
    HEX_BINARY = "hexBinary"
    BASE64_BINARY = "base64Binary"
    ANY_URI = "anyURI"
    INTEGER = "integer"
    # не XSD типы, но они нужны для работы программы
    EMPTY = "empty"
    PARENT = "parent"
