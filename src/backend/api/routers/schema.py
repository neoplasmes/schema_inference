import io
import json
import os
import shutil
import time
import uuid
import xml.etree.ElementTree as ET
from typing import List

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, WebSocket
from fastapi.responses import JSONResponse, StreamingResponse

from backend.api.backgroundTasks.BackgroundTaskManager import (
    BackgroundTask,
    globalBackgroundTaskManager,
)
from backend.api.routers.documentGrammarPipeline import documentGrammarPipeline
from backend.processes import buildSchema

schemaRouter = APIRouter(prefix="/schema")


# Хранилище сессий в памяти (в продакшене лучше использовать Redis)
sessions = {}


class SessionFilesCleanupBackgroundTask(BackgroundTask):
    def __init__(self, sessionID: str):
        self.sessionID = sessionID

    async def execute(self):
        if self.sessionID in sessions:
            session_dir = os.path.join("uploaded_files", self.sessionID)
            if os.path.exists(session_dir):
                shutil.rmtree(session_dir)
            del sessions[self.sessionID]
            print(f"Сессия {self.sessionID} удалена по таймауту")


@schemaRouter.post("/uploadfiles/")
async def create_upload_files(files: list[UploadFile] = File(...)):
    # Создаем уникальный ID сессии
    session_id = str(uuid.uuid4())
    session_dir = os.path.join("uploaded_files", session_id)
    os.makedirs(session_dir, exist_ok=True)

    # Сохраняем файлы в папку сессии
    saved_files = []
    for file in files:
        file_location = os.path.join(session_dir, file.filename)  # type: ignore
        with open(file_location, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_files.append(file.filename)

    # Сохраняем информацию о сессии
    sessions[session_id] = {"filenames": saved_files, "created_at": time.time()}

    # Запускаем задачу очистки по таймауту
    globalBackgroundTaskManager.scheduleTask(
        SessionFilesCleanupBackgroundTask(session_id), 300
    )

    return JSONResponse(
        content={
            "message": "Файлы загружены, подключитесь к WebSocket для обработки",
            "session_id": session_id,
        }
    )


@schemaRouter.websocket("/ws/process/{session_id}")
async def websocket_process(websocket: WebSocket, session_id: str):
    await websocket.accept()

    try:
        # Проверяем, существует ли сессия
        if session_id not in sessions:
            await websocket.send_json({"error": "Сессия не найдена"})
            await websocket.close()
            return

        session = sessions[session_id]
        filenames = session["filenames"]
        total_files = len(filenames)
        session_dir = os.path.join("uploaded_files", session_id)

        if not filenames:
            await websocket.send_json({"error": "Список файлов пуст"})
            await websocket.close()
            return

        processed_files = []  # Список для хранения успешно обработанных файлов

        trees: List[ET.ElementTree] = []

        for i, filename in enumerate(filenames, 1):
            file_path = os.path.join(session_dir, filename)
            if not os.path.exists(file_path):
                await websocket.send_json({"error": f"Файл {filename} не найден"})
                continue

            # Чтение и обработка XML-файла
            try:
                tree = ET.parse(file_path)
                trees.append(tree)  # type: ignore
                processed_files.append(filename)
            except ET.ParseError:
                await websocket.send_json({"error": f"Ошибка при разборе {filename}"})
                continue

            # Отправка прогресса
            progress = (i / total_files) * 100
            await websocket.send_json(
                {
                    "status": "progress",
                    "processed": i,
                    "total": total_files,
                    "progress": progress,
                }
            )

        jsonData = documentGrammarPipeline(trees)

        # Финальный ответ
        await websocket.send_json(
            {
                "status": "completed",
                "message": jsonData,
                "details": "Все XML-файлы успешно обработаны",
            }
        )

    except Exception as e:
        await websocket.send_json({"error": str(e)})
    finally:
        # Удаляем файлы и сессию
        if session_id in sessions:
            session_dir = os.path.join("uploaded_files", session_id)
            if os.path.exists(session_dir):
                try:
                    shutil.rmtree(session_dir)  # Удаляем всю папку сессии
                except Exception as e:
                    print(f"Ошибка при удалении сессии {session_id}: {e}")
            del sessions[session_id]
        await websocket.close()


@schemaRouter.post("/generatexsd/")
async def generate_xsd(request: Request):
    try:
        schema = await request.json()

        if not isinstance(schema, dict):
            # 422 - unprocessable content
            raise HTTPException(status_code=422, detail="aaaa")
        # Преобразуем Pydantic модель в словарь
        schema_as_string = json.dumps(schema)

        # Генерируем XSD строку
        xsd_content = buildSchema(schema_as_string)

        # Создаем поток для отправки файла
        xsd_stream = io.StringIO(xsd_content)
        xsd_bytes = xsd_stream.getvalue().encode("utf-8")

        # Настраиваем заголовки для скачивания файла
        headers = {
            "Content-Disposition": 'attachment; filename="schema.xsd"',
            "Content-Type": "application/xml",
        }

        # Возвращаем StreamingResponse для скачивания файла
        return StreamingResponse(
            iter([xsd_bytes]), headers=headers, media_type="application/xml"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating XSD: {str(e)}")
