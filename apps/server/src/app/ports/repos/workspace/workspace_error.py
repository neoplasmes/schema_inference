class WorkspaceError(Exception):
    """Report an expected resource or concurrency failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
