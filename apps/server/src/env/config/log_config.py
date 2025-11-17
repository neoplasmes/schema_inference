from typing import Any

from pythonjsonlogger.core import RESERVED_ATTRS

from .settings import Environment


def build_log_config(environment: Environment) -> dict[str, Any]:
    """Describe application and uvicorn logging as a ``dictConfig`` mapping.

    Production writes one JSON object per line to stdout, so the cluster log
    collector can index the fields. Development keeps human-readable lines.
    """
    formatter: dict[str, Any] = (
        {
            "()": "pythonjsonlogger.json.JsonFormatter",
            "fmt": "%(asctime)s %(levelname)s %(name)s %(message)s",
            "rename_fields": {"asctime": "time", "levelname": "level"},
            "reserved_attrs": [*RESERVED_ATTRS, "color_message"],
        }
        if environment == "production"
        else {"format": "%(asctime)s %(levelname)-8s %(name)s: %(message)s"}
    )

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"default": formatter},
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "formatter": "default",
                "stream": "ext://sys.stdout",
            },
        },
        "root": {"handlers": ["stdout"], "level": "INFO"},
        "loggers": {
            "uvicorn": {"handlers": [], "level": "INFO", "propagate": True},
            "uvicorn.error": {"handlers": [], "level": "INFO", "propagate": True},
            "uvicorn.access": {"handlers": [], "level": "INFO", "propagate": True},
        },
    }
