from collections.abc import Iterator

import pytest
from e2e.backend import DatabaseStack


@pytest.fixture(scope="session")
def database_stack() -> Iterator[DatabaseStack]:
    """Use real containers for tests which request database access."""
    with DatabaseStack().running() as stack:
        yield stack


@pytest.fixture
def database_url(database_stack: DatabaseStack) -> Iterator[str]:
    """Isolate database state between tests without replacing the repository."""
    with database_stack.database() as url:
        yield url
