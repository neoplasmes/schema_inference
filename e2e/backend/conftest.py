from collections.abc import Callable, Iterator

import httpx
import pytest
from e2e.backend import DatabaseStack


@pytest.fixture(scope="session")
def api_stack(
    record_testsuite_property: Callable[[str, object], None],
) -> Iterator[DatabaseStack]:
    """Run the HTTP server with its own PostgreSQL and PgBouncer containers."""
    with DatabaseStack(api=True).running() as stack:
        record_testsuite_property("compose_project", stack.name)

        yield stack


@pytest.fixture
def api(api_stack: DatabaseStack) -> Iterator[httpx.Client]:
    """Send requests over the published HTTP port without an in-process app."""
    with httpx.Client(
        base_url=api_stack.api_url, timeout=30, trust_env=False
    ) as client:
        yield client
