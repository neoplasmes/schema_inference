import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.ports.repos.workspace import WorkspaceError, WorkspaceRepository
from core.entities import Principal


def timestamp() -> str:
    return datetime.now(UTC).isoformat()


def identifier(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex}"


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


def visible_owner(principal: Principal) -> str | None:
    """Return the owner a listing is limited to, or None when everything is visible."""
    return None if principal.is_admin else principal.subject


def authorize(
    repository: WorkspaceRepository,
    principal: Principal,
    kind: str,
    identifier: str,
) -> None:
    """Treat resources the principal may not see exactly like missing ones."""
    owner = repository.owner(kind, identifier)

    if owner is None or (not principal.is_admin and owner != principal.subject):
        raise WorkspaceError("not_found", "Resource does not exist.")
