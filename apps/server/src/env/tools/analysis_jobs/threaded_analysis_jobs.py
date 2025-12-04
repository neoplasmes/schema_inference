import logging
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor

from app.use_cases.run_analysis import RunAnalysis


class ThreadedAnalysisJobs:
    """Resume durable jobs on startup and stop the single inference worker on shutdown.

    Running jobs finish on shutdown; queued jobs are cancelled and resumed by `start`.
    """

    def __init__(
        self,
        run_analysis: RunAnalysis,
        on_finished: Callable[[], None] | None = None,
    ) -> None:
        self._run = run_analysis
        self._on_finished = on_finished
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="analysis"
        )

    def submit(self, identifier: str) -> None:
        future = self._executor.submit(self._run.execute, identifier)
        future.add_done_callback(self._log_failure)
        future.add_done_callback(self._notify)

    def start(self) -> None:
        for identifier in self._run.pending():
            self.submit(identifier)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=True)

    def _notify(self, future: Future) -> None:
        if self._on_finished is None or future.cancelled():
            return

        try:
            self._on_finished()
        except Exception:
            logging.getLogger(__name__).exception("Finished-job notification failed")

    @staticmethod
    def _log_failure(future: Future) -> None:
        if future.cancelled():
            return

        error = future.exception()

        if error is not None:
            logging.getLogger(__name__).error("Analysis job crashed", exc_info=error)
