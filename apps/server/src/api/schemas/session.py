from typing import Literal

from pydantic import BaseModel


class SessionCreated(BaseModel):
    message: str = "Файлы загружены, подключитесь к WebSocket для обработки"
    session_id: str


class ProcessingProgressMessage(BaseModel):
    status: Literal["progress"] = "progress"
    processed: int
    total: int
    progress: float


class ProcessingCompletedMessage(BaseModel):
    status: Literal["completed"] = "completed"
    message: str
    details: str = "Все XML-файлы успешно обработаны"


class ProcessingErrorMessage(BaseModel):
    error: str
