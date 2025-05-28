import asyncio
import logging

from app.use_cases.cleanup_session_case import CleanupSession

logger = logging.getLogger(__name__)


class SessionCleanupJob:
    def __init__(self, cleanup: CleanupSession, delay: float = 300) -> None:
        self._cleanup = cleanup
        self._delay = delay
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def schedule(self, session_id: str) -> None:
        async def cleanup_later() -> None:
            await asyncio.sleep(self._delay)
            await asyncio.to_thread(self._cleanup.execute, session_id)

        task = asyncio.create_task(cleanup_later())
        self._tasks[session_id] = task
        task.add_done_callback(lambda completed: self._on_done(session_id, completed))

    async def cancel(self, session_id: str) -> None:
        task = self._tasks.pop(session_id, None)
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def shutdown(self) -> None:
        session_ids = tuple(self._tasks)
        tasks = tuple(self._tasks.values())
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for session_id in session_ids:
            try:
                await asyncio.to_thread(self._cleanup.execute, session_id)
            except Exception:
                logger.exception("Failed to clean up session %s", session_id)

    def _on_done(self, session_id: str, task: asyncio.Task[None]) -> None:
        self._tasks.pop(session_id, None)
        if not task.cancelled():
            try:
                task.result()
            except Exception:
                logger.exception("Failed to clean up session %s", session_id)
