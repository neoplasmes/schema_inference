from typing import Annotated

from fastapi import Depends

from core.entities import ADMIN_ROLE, Principal


def current_principal() -> Principal:
    """Resolve the subject acting in the current request.

    This is the single injection point for authentication: every route takes
    its acting principal from here. Until requests are authenticated it yields
    a fixed administrator.
    """
    return Principal("admin", frozenset({ADMIN_ROLE}))


Actor = Annotated[Principal, Depends(current_principal)]
