import shutil
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import BinaryIO

from domain.repositories.document import DocumentNotFoundError, InvalidDocumentError


class FilesystemDocumentRepository:
    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def save(self, session_id: str, filename: str, source: BinaryIO) -> None:
        path = self._document_path(session_id, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as target:
            shutil.copyfileobj(source, target)

    def load(self, session_id: str, filename: str) -> ET.ElementTree:
        path = self._document_path(session_id, filename)
        try:
            return ET.parse(path)
        except FileNotFoundError as error:
            raise DocumentNotFoundError(filename) from error
        except ET.ParseError as error:
            raise InvalidDocumentError(filename) from error

    def remove_session(self, session_id: str) -> None:
        path = self._session_path(session_id)
        try:
            shutil.rmtree(path)
        except FileNotFoundError:
            pass

    def _session_path(self, session_id: str) -> Path:
        self._validate_name(session_id)
        return self._root / session_id

    def _document_path(self, session_id: str, filename: str) -> Path:
        self._validate_name(filename)
        return self._session_path(session_id) / filename

    @staticmethod
    def _validate_name(name: str) -> None:
        if not name or name in {".", ".."} or any(char in name for char in "/\\\0"):
            raise ValueError("Некорректное имя файла или сессии")
