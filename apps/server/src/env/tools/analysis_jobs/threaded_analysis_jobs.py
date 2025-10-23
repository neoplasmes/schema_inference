from concurrent.futures import ThreadPoolExecutor

from app.use_cases.run_analysis import RunAnalysis


class ThreadedAnalysisJobs:
    """Resume durable jobs on startup and drain the single inference worker on shutdown."""

    def __init__(self, run_analysis: RunAnalysis) -> None:
        self._run = run_analysis
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="analysis"
        )

    def submit(self, identifier: str) -> None:
        self._executor.submit(self._run.execute, identifier)

    def start(self) -> None:
        for identifier in self._run.pending():
            self.submit(identifier)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True)
