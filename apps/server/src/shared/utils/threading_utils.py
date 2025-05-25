import asyncio
from functools import partial
from typing import Callable, TypeVar

Result = TypeVar("Result")


async def complete_in_thread(function: Callable[..., Result], *args) -> Result:
    """Finish the worker before propagating cancellation to its caller."""
    loop = asyncio.get_running_loop()
    worker = loop.run_in_executor(None, partial(function, *args))
    cancellation = None
    while not worker.done():
        try:
            await asyncio.shield(worker)
        except asyncio.CancelledError as error:
            cancellation = error
    result = worker.result()
    if cancellation is not None:
        raise cancellation
    return result
