import asyncio
from abc import ABC, abstractmethod
from typing import Set


class BackgroundTask(ABC):
    """Интерфейс для фоновых задач"""

    @abstractmethod
    async def execute(self):
        """Асинхронный метод для выполнения задачи."""
        pass


class BackgroundTaskManager:
    def __init__(self):
        self.tasks: Set[asyncio.Task] = set()

    def scheduleTask(self, task: BackgroundTask, delay: float) -> asyncio.Task:
        """Создает задачу с задержкой и регистрирует её."""

        async def wrappedTask():
            await asyncio.sleep(delay)  # Задержка перед выполнением
            await task.execute()  # Выполняем задачу

        scheduledTask = asyncio.create_task(wrappedTask())
        self.tasks.add(scheduledTask)
        scheduledTask.add_done_callback(self.tasks.discard)  # Удаляем после завершения

        return scheduledTask

    async def gatherTasks(self):
        """Ожидает завершения всех активных задач."""
        if self.tasks:
            print("Waiting for background tasks to complete...")
            # await asyncio.gather(
            #     *[task for task in self.tasks if not task.done()],
            #     return_exceptions=True,
            # )
            print("All background tasks completed.")


# Глобальный экземпляр менеджера задач
globalBackgroundTaskManager = BackgroundTaskManager()
