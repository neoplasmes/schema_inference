import hashlib
import hmac

SIGNATURE_TOLERANCE = 300


def verify_webhook_signature(
    signing_key: str,
    header: str,
    body: bytes,
    now: float,
    tolerance: int = SIGNATURE_TOLERANCE,
) -> bool:
    """Check a ``t=<unix>,v1=<hex>`` signature over ``<t>.<body>``.

    A webhook is accepted only when it is fresh, so a captured delivery cannot
    be replayed later, and when any listed ``v1`` value matches the signature
    computed with the shared key.
    """
    if not signing_key or not header:
        return False

    timestamp = ""
    candidates: list[str] = []

    for part in header.split(","):
        name, _, value = part.strip().partition("=")

        if name == "t":
            timestamp = value
        elif name == "v1":
            candidates.append(value)

    try:
        issued = int(timestamp)
    except ValueError:
        return False

    if abs(now - issued) > tolerance or not candidates:
        return False

    expected = hmac.new(
        signing_key.encode(), f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()

    return any(
        hmac.compare_digest(expected.encode(), candidate.encode())
        for candidate in candidates
    )
