class DocumentStorageError(ValueError):
    """An uploaded document could not be stored or accessed."""


class DocumentNotFoundError(DocumentStorageError):
    """The requested document is missing from its upload session."""
