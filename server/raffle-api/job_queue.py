from __future__ import annotations

import queue
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from contracts import CreateJobRequest
from normalizer import CLASSIFICATION_VERSION, SCHEMA_VERSION


TERMINAL = {"complete", "partial", "error", "cancelled"}


@dataclass
class Job:
    job_id: str
    total_characters: int
    request: CreateJobRequest | None
    created_at: float
    status: str = "queued"
    stage: str = "queued"
    completed_characters: int = 0
    result: dict = field(default_factory=lambda: {"raffleResults": [], "clears": [], "warnings": [], "errors": [], "memberWallets": {}})
    cancel_event: threading.Event = field(default_factory=threading.Event)
    finished_at: float | None = None


class JobQueue:
    def __init__(
        self,
        processor: Callable,
        *,
        capacity: int = 20,
        completed_capacity: int = 50,
        ttl_seconds: int = 300,
        clock=time.monotonic,
    ) -> None:
        self.processor = processor
        self.completed_capacity = completed_capacity
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self._queue: queue.Queue[str | None] = queue.Queue(maxsize=capacity)
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._worker = threading.Thread(target=self._run, name="raffle-job-worker", daemon=True)
        self._worker.start()

    def create(self, request: CreateJobRequest) -> str | None:
        now = self.clock()
        self._prune(now)
        job_id = secrets.token_urlsafe(24)
        job = Job(
            job_id=job_id,
            total_characters=len(request.characters),
            request=request,
            created_at=now,
        )
        with self._lock:
            self._jobs[job_id] = job
        try:
            self._queue.put_nowait(job_id)
        except queue.Full:
            with self._lock:
                self._jobs.pop(job_id, None)
            return None
        return job_id

    def get(self, job_id: str) -> dict | None:
        now = self.clock()
        self._prune(now)
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            elapsed_ms = max(0, int((now - job.created_at) * 1000))
            payload = {
                "schemaVersion": SCHEMA_VERSION,
                "classificationVersion": CLASSIFICATION_VERSION,
                "status": job.status,
                "progress": {
                    "completedCharacters": job.completed_characters,
                    "totalCharacters": job.total_characters,
                    "stage": job.stage,
                    "elapsedMs": elapsed_ms,
                },
                "raffleResults": list(job.result.get("raffleResults", [])),
                "clears": list(job.result.get("clears", [])),
                "warnings": list(job.result.get("warnings", [])),
                "errors": list(job.result.get("errors", [])),
                "memberWallets": dict(job.result.get("memberWallets", {})),
            }
        return payload

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return False
            job.cancel_event.set()
            if job.status == "queued":
                job.status = "cancelled"
                job.stage = "cancelled"
                job.request = None
                job.finished_at = self.clock()
            return True

    def close(self) -> None:
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        self._worker.join(timeout=1)

    def _run(self) -> None:
        while True:
            job_id = self._queue.get()
            if job_id is None:
                return
            with self._lock:
                job = self._jobs.get(job_id)
                if job is None or job.status == "cancelled":
                    continue
                request = job.request
                job.status = "resolving"
                job.stage = "resolving"
            if request is None:
                continue

            def update(completed: int, stage: str) -> None:
                with self._lock:
                    current = self._jobs.get(job_id)
                    if current is None:
                        return
                    current.completed_characters = min(max(completed, 0), current.total_characters)
                    current.stage = stage
                    current.status = stage if stage in {"resolving", "fetching", "normalizing"} else current.status

            try:
                result = self.processor(request, update, job.cancel_event)
                with self._lock:
                    current = self._jobs.get(job_id)
                    if current is None:
                        continue
                    if current.cancel_event.is_set():
                        current.status = "cancelled"
                        current.stage = "cancelled"
                    else:
                        current.result = result
                        current.completed_characters = current.total_characters
                        current.status = "partial" if result.get("errors") else "complete"
                        current.stage = current.status
                    current.request = None
                    current.finished_at = self.clock()
            except Exception as exc:
                with self._lock:
                    current = self._jobs.get(job_id)
                    if current is None:
                        continue
                    current.result = {
                        "raffleResults": [],
                        "clears": [],
                        "warnings": [],
                        "errors": [{"code": "job_failed", "detail": type(exc).__name__}],
                    }
                    current.status = "error"
                    current.stage = "error"
                    current.request = None
                    current.finished_at = self.clock()

    def _prune(self, now: float) -> None:
        with self._lock:
            expired = [
                job_id
                for job_id, job in self._jobs.items()
                if job.finished_at is not None and now - job.finished_at > self.ttl_seconds
            ]
            for job_id in expired:
                self._jobs.pop(job_id, None)

            completed = sorted(
                (job for job in self._jobs.values() if job.status in TERMINAL),
                key=lambda job: job.finished_at or job.created_at,
            )
            while len(completed) > self.completed_capacity:
                oldest = completed.pop(0)
                self._jobs.pop(oldest.job_id, None)