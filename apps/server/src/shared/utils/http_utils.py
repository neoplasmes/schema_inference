import base64
import json
from typing import Any
from urllib.parse import quote_plus, urlencode
from urllib.request import Request, urlopen


def basic_authorization(user: str, password: str) -> str:
    """Return an HTTP Basic credential with form-encoded parts, as OAuth requires."""
    raw = f"{quote_plus(user)}:{quote_plus(password)}"

    return "Basic " + base64.b64encode(raw.encode()).decode()


def post_form(
    url: str,
    fields: dict[str, str],
    headers: dict[str, str],
    timeout: float,
) -> dict[str, Any]:
    """Send a form-encoded POST and return the JSON object of the response.

    Network and HTTP failures propagate as the standard library raises them.
    """
    request = Request(
        url,
        data=urlencode(fields).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded", **headers},
        method="POST",
    )

    with urlopen(request, timeout=timeout) as response:
        body = response.read()

    parsed = json.loads(body) if body else {}

    return parsed if isinstance(parsed, dict) else {}
