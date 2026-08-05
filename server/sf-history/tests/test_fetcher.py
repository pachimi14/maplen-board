from __future__ import annotations

from typing import Any

import pytest

import fetcher as fetcher_mod


class FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any] | None):
        self.status_code = status_code
        self._payload = payload
        self.text = "" if payload is None else str(payload)

    def json(self) -> dict[str, Any]:
        if self._payload is None:
            raise ValueError("no json body")
        return self._payload


class FakeSession:
    """Replays a fixed queue of (status_code, payload) tuples, in order."""

    def __init__(self, responses: list[tuple[int, dict[str, Any] | None]]):
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []
        self.headers: dict[str, str] = {}

    def get(self, url: str, params: dict[str, Any], timeout: float) -> FakeResponse:
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        status, payload = self._responses.pop(0)
        return FakeResponse(status, payload)


def _make_fetcher(responses: list[tuple[int, dict | None]], **kwargs: Any) -> fetcher_mod.Fetcher:
    session = FakeSession(responses)
    return fetcher_mod.Fetcher(session=session, min_interval_sec=0.0, **kwargs)  # type: ignore[arg-type]


def test_successful_get_logs_one_entry_and_resets_consecutive_429() -> None:
    ftr = _make_fetcher([(200, {"points": []})])
    status, payload, _text = ftr.get("http://x", {"a": 1}, endpoint="history")
    assert status == 200
    assert payload == {"points": []}
    assert ftr.total_requests == 1
    assert ftr.total_429 == 0


def test_budget_exceeded_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    ftr = _make_fetcher([(200, {}), (200, {})], max_requests=1)
    ftr.get("http://x", {}, endpoint="history")
    with pytest.raises(fetcher_mod.RequestBudgetExceededError):
        ftr.get("http://x", {}, endpoint="history")


def test_429_backs_off_and_retries_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []
    monkeypatch.setattr(fetcher_mod.time, "sleep", lambda s: sleeps.append(s))

    ftr = _make_fetcher([(429, None), (429, None), (200, {"ok": True})])
    status, payload, _text = ftr.get("http://x", {}, endpoint="history")

    assert status == 200
    assert payload == {"ok": True}
    assert ftr.total_requests == 3  # two 429s + the eventual 200, all logged
    assert ftr.total_429 == 2
    assert sleeps == [5.0, 15.0]  # BACKOFF_SCHEDULE_SEC[0], [1]


def test_three_consecutive_429_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fetcher_mod.time, "sleep", lambda s: None)
    ftr = _make_fetcher([(429, None), (429, None), (429, None)])
    with pytest.raises(fetcher_mod.ConsecutiveTooManyRequestsError):
        ftr.get("http://x", {}, endpoint="history")
    assert ftr.total_429 == 3


def test_total_429_over_five_raises_even_if_not_consecutive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fetcher_mod.time, "sleep", lambda s: None)
    # Pattern: 429, 200 (resets consecutive), 429, 200, 429, 200, 429, 200, 429, 200, 429
    # 6 total 429s spread out so consecutive never reaches 3; the 6th (> MAX_TOTAL_429=5) must raise.
    responses = [(429, None), (200, {}), (429, None), (200, {}), (429, None), (200, {}), (429, None), (200, {}), (429, None), (200, {}), (429, None)]
    ftr = _make_fetcher(responses)
    with pytest.raises(fetcher_mod.TotalTooManyRequestsExceededError):
        for _ in range(6):
            ftr.get("http://x", {}, endpoint="history")


def test_fetch_history_page_always_sends_explicit_item_upgrade() -> None:
    ftr = _make_fetcher([(200, {"itemUpgrade": 7, "points": []})])
    status, payload = fetcher_mod.fetch_history_page(
        ftr, 123, item_upgrade=7, window_days=160.0
    )
    assert status == 200
    assert payload["itemUpgrade"] == 7
    sent_params = ftr.session.calls[0]["params"]  # type: ignore[attr-defined]
    assert sent_params["itemUpgrade"] == 7
    assert sent_params["itemId"] == 123
    assert sent_params["period"] == 2
    assert "minTimestamp" in sent_params and "maxTimestamp" in sent_params


def test_log_as_dicts_round_trips_every_request() -> None:
    ftr = _make_fetcher([(200, {}), (200, {})])
    ftr.get("http://x", {"a": 1}, endpoint="history", note="n1")
    ftr.get("http://x", {"a": 2}, endpoint="latest", note="n2")
    entries = ftr.log_as_dicts()
    assert [e["endpoint"] for e in entries] == ["history", "latest"]
    assert [e["note"] for e in entries] == ["n1", "n2"]
