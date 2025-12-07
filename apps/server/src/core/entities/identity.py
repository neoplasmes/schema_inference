from dataclasses import dataclass


@dataclass(frozen=True)
class Identity:
    """Describe who an access token was issued to and for how long it stays valid."""

    subject: str
    roles: frozenset[str]
    expires_at: int
    token_id: str = ""
    client_id: str = ""
