from __future__ import annotations

import threading
import time

from contracts import CreateJobRequest
from job_queue import JobQueue


def request(member_id: str = "m1") -> CreateJobRequest:
    return CreateJobRequest.model_validate(
        {
            "raffledAt": "2026-07-30T00:00:00Z",
            "characters": [{"memberId": member_id, "assetKey": "CHARfixture" + member_id}],
        }
    )


def test_queue_reports_real_progress_and_clears_request() -> None:
    def processor(payload, update, cancel_event):
        assert not cancel_event.is_set()
        update(0, "fetching")
        update(1, "normalizing")
        return {"clears": [], "warnings": [], "errors": []}

    queue = JobQueue(processor, capacity=2)
    try:
        job_id = queue.create(request())
        assert job_id
        for _ in range(100):
            payload = queue.get(job_id)
            if payload["status"] == "complete":
                break
            time.sleep(0.005)
        assert payload["progress"]["completedCharacters"] == 1
        assert payload["progress"]["totalCharacters"] == 1
        assert payload["progress"]["stage"] == "complete"
    finally:
        queue.close()


def test_queue_capacity_fails_closed() -> None:
    gate = threading.Event()

    def processor(payload, update, cancel_event):
        gate.wait(timeout=1)
        return {"clears": [], "warnings": [], "errors": []}

    queue = JobQueue(processor, capacity=1)
    try:
        first = queue.create(request("m1"))
        second = queue.create(request("m2"))
        third = queue.create(request("m3"))
        assert first
        accepted = sum(value is not None for value in (first, second, third))
        assert accepted <= 2
        assert any(value is None for value in (second, third))
    finally:
        gate.set()
        queue.close()


def test_cancelled_job_does_not_complete() -> None:
    gate = threading.Event()

    def processor(payload, update, cancel_event):
        gate.wait(timeout=1)
        return {"clears": [], "warnings": [], "errors": []}

    queue = JobQueue(processor)
    try:
        job_id = queue.create(request())
        assert job_id
        assert queue.cancel(job_id)
        gate.set()
        for _ in range(100):
            payload = queue.get(job_id)
            if payload["status"] == "cancelled":
                break
            time.sleep(0.005)
        assert payload["status"] == "cancelled"
    finally:
        gate.set()
        queue.close()