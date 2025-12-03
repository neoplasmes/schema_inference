from dataclasses import dataclass

ADMIN_ROLE = "admin"


@dataclass(frozen=True)
class Principal:
    """Identify the acting subject and the roles that widen what it may see."""

    subject: str
    roles: frozenset[str] = frozenset()

    @property
    def is_admin(self) -> bool:
        return ADMIN_ROLE in self.roles
