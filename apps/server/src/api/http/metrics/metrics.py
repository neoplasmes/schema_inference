from fastapi import FastAPI
from prometheus_client import CollectorRegistry, PlatformCollector, ProcessCollector
from prometheus_fastapi_instrumentator import Instrumentator


def expose_metrics(server: FastAPI) -> None:
    """Instrument every HTTP route and serve Prometheus metrics at ``/metrics``.

    Each server gets its own registry, so several application instances
    can live in one process without colliding metric names.
    """
    registry = CollectorRegistry()
    ProcessCollector(registry=registry)
    PlatformCollector(registry=registry)

    instrumentator = Instrumentator(
        should_group_status_codes=False,
        excluded_handlers=["/metrics"],
        registry=registry,
    )
    instrumentator.instrument(server).expose(server, include_in_schema=False)
