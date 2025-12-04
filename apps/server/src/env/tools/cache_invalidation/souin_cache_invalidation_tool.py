import base64
import json
from http.client import HTTPException
from urllib.error import URLError
from urllib.request import Request, urlopen

from app.ports.tools.cache_invalidation import CacheInvalidationError
from core.entities import ResourceChange

COLLECTIONS = {"schema": "schemas", "analysis": "analyses"}


class SouinCacheInvalidationTool:
    """Purge Souin entries by surrogate key and, for deletions, by URI prefix."""

    def __init__(
        self, purge_url: str, user: str = "", password: str = "", timeout: float = 5.0
    ) -> None:
        self._url = purge_url
        self._timeout = timeout
        self._authorization = (
            "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
            if user
            else None
        )

    def invalidate(self, changes: list[ResourceChange]) -> None:
        keys: list[str] = []

        for change in changes:
            collection = COLLECTIONS.get(change.kind)

            if collection is None:
                continue

            keys.extend([collection, f"{change.kind}:{change.resource_id}"])

        if not keys:
            return

        self._send("PURGE", {"Surrogate-Key": ", ".join(dict.fromkeys(keys))})

        for change in changes:
            collection = COLLECTIONS.get(change.kind)

            if change.deleted and collection is not None:
                body = {
                    "type": "uri-prefix",
                    "selectors": [f"/api/v2/{collection}/{change.resource_id}/"],
                    "purge": True,
                }
                self._send(
                    "POST",
                    {"Content-Type": "application/json"},
                    json.dumps(body).encode(),
                )

    def _send(
        self, method: str, headers: dict[str, str], body: bytes | None = None
    ) -> None:
        if self._authorization is not None:
            headers = {**headers, "Authorization": self._authorization}

        request = Request(self._url, data=body, headers=headers, method=method)

        try:
            with urlopen(request, timeout=self._timeout) as response:
                response.read()
        except (URLError, OSError, HTTPException) as error:
            raise CacheInvalidationError(
                f"{method} {self._url} failed: {error}"
            ) from error
