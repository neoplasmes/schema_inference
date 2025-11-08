import os
import signal
from pathlib import Path
from threading import Event

from e2e.backend import DatabaseStack


def serve() -> None:
    """Keep an isolated container stack alive for external browser tests."""
    stopped = Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    stop_file = os.environ.get("BACKEND_E2E_STOP_FILE")

    if stop_file and Path(stop_file).exists():
        return

    with DatabaseStack(
        api=True, api_port=int(os.environ.get("PORT", "8010"))
    ).running():
        print("Backend containers are ready", flush=True)

        while not stopped.wait(0.1):
            if stop_file and Path(stop_file).exists():
                break


if __name__ == "__main__":
    serve()
