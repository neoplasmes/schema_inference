class DocumentStorageError(ValueError):
    pass


class DocumentNotFoundError(DocumentStorageError):
    pass
