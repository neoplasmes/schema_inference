import time
from contextlib import closing

import docker
import httpx
from e2e.backend import DatabaseStack


def restart_server(stack: DatabaseStack) -> None:
    """Restart only the server container and wait for a new healthy HTTP process."""
    assert stack.compose is not None
    container_id = stack.compose.get_container("server").ID
    assert container_id is not None

    with closing(docker.from_env()) as engine:
        server = engine.containers.get(container_id)
        started_at = server.attrs["State"]["StartedAt"]
        server.restart(timeout=10)
        host = stack.compose.get_service_host("server", 8000)
        port = stack.compose.get_service_port("server", 8000)
        stack.api_url = f"http://{host}:{port}"
        deadline = time.monotonic() + 60

        with httpx.Client(base_url=stack.api_url, timeout=2, trust_env=False) as client:
            while time.monotonic() < deadline:
                try:
                    response = client.get("/api/v2/schemas")

                    if response.status_code == 200:
                        server.reload()
                        assert server.attrs["State"]["StartedAt"] != started_at

                        return
                except httpx.TransportError:
                    pass

                time.sleep(0.1)

        raise AssertionError(
            f"Restarted server did not become ready: {server.logs()!r}"
        )
