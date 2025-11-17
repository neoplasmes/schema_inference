from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.http.metrics import expose_metrics


def server() -> FastAPI:
    application = FastAPI()

    @application.get("/api/ping")
    async def ping():
        return {"ok": True}

    expose_metrics(application)

    return application


def test_metrics_count_requests_by_route_and_status():
    client = TestClient(server())

    assert client.get("/api/ping").status_code == 200

    body = client.get("/metrics").text

    assert 'http_requests_total{handler="/api/ping",method="GET",status="200"}' in body
    assert "process_cpu_seconds_total" in body


def test_metrics_are_isolated_between_servers():
    first = TestClient(server())
    second = TestClient(server())

    first.get("/api/ping")

    assert 'handler="/api/ping"' not in second.get("/metrics").text
