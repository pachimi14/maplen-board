from __future__ import annotations

import threading
import time
from typing import Any

import pytest
import requests

import fetch_latest


class FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any] | None):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, Any]:
        if self._payload is None:
            raise ValueError("no json body")
        return self._payload


class FakeSession:
    def __init__(self, responder) -> None:
        self._responder = responder
        self.calls: list[dict[str, Any]] = []
        self.lock_calls = 0

    def get(self, url: str, params: dict[str, Any], timeout: float, headers: dict[str, str]) -> FakeResponse:
        self.calls.append({"url": url, "params": params, "timeout": timeout, "headers": headers})
        return self._responder(params)


def _star_force_payload(prices_by_upgrade: dict[int, float]) -> dict[str, Any]:
    return {
        "latestUpdatedAt": "2026-08-05T12:00:00Z",
        "starForce": [
            {"itemUpgrade": upgrade, "closePrice": int(price * fetch_latest.PRICE_DIVISOR)}
            for upgrade, price in prices_by_upgrade.items()
        ],
    }


def test_parse_latest_payload_converts_close_price_and_fills_nulls() -> None:
    payload = _star_force_payload({0: 100.0, 5: 250.5})
    result = fetch_latest.parse_latest_payload(1382265, payload)
    assert result["itemId"] == 1382265
    assert result["latestUpdatedAt"] == "2026-08-05T12:00:00Z"
    assert result["prices"][0] == pytest.approx(100.0)
    assert result["prices"][5] == pytest.approx(250.5)
    assert result["prices"][1] is None
    assert len(result["prices"]) == 22


def test_parse_latest_payload_ignores_upgrade_22_and_above() -> None:
    payload = {"latestUpdatedAt": None, "starForce": [{"itemUpgrade": 22, "closePrice": 1}]}
    result = fetch_latest.parse_latest_payload(1, payload)
    assert result["prices"] == [None] * 22


def test_cache_returns_fresh_result_without_a_second_upstream_call() -> None:
    clock = {"t": 0.0}
    session = FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 10.0})))
    cache = fetch_latest.LatestPriceCache(session=session, ttl_seconds=60.0, clock=lambda: clock["t"])

    first = cache.get(1001)
    clock["t"] = 10.0  # well within the 60s TTL
    second = cache.get(1001)

    assert first == second
    assert cache.upstream_call_count == 1  # (i): "2回目が公式を叩かないことをログで確認"
    assert len(session.calls) == 1


def test_cache_refetches_after_ttl_expires() -> None:
    clock = {"t": 0.0}
    session = FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 10.0})))
    cache = fetch_latest.LatestPriceCache(session=session, ttl_seconds=60.0, clock=lambda: clock["t"])

    cache.get(1001)
    clock["t"] = 61.0  # past the TTL
    cache.get(1001)

    assert cache.upstream_call_count == 2


def test_upstream_non_200_raises_and_is_not_cached() -> None:
    session = FakeSession(lambda params: FakeResponse(500, None))
    cache = fetch_latest.LatestPriceCache(session=session)

    with pytest.raises(fetch_latest.UpstreamLatestError):
        cache.get(1001)
    # A second call retries the upstream rather than returning a cached failure.
    with pytest.raises(fetch_latest.UpstreamLatestError):
        cache.get(1001)
    assert len(session.calls) == 2


def test_upstream_request_exception_raises_upstream_latest_error() -> None:
    def raise_connection_error(params: dict[str, Any]) -> FakeResponse:
        raise requests.ConnectionError("boom")

    session = FakeSession(raise_connection_error)
    cache = fetch_latest.LatestPriceCache(session=session)

    with pytest.raises(fetch_latest.UpstreamLatestError):
        cache.get(1001)


def test_missing_star_force_key_raises_upstream_latest_error() -> None:
    session = FakeSession(lambda params: FakeResponse(200, {"latestUpdatedAt": None}))
    cache = fetch_latest.LatestPriceCache(session=session)

    with pytest.raises(fetch_latest.UpstreamLatestError):
        cache.get(1001)


def test_concurrent_requests_for_the_same_item_are_coalesced_to_one_upstream_call() -> None:
    """plan §5: "同一 itemId への同時アクセスを1リクエストに畳む"."""
    call_started = threading.Event()
    release_call = threading.Event()
    call_count = {"n": 0}

    def slow_responder(params: dict[str, Any]) -> FakeResponse:
        call_count["n"] += 1
        call_started.set()
        release_call.wait(timeout=5)
        return FakeResponse(200, _star_force_payload({0: 42.0}))

    session = FakeSession(slow_responder)
    cache = fetch_latest.LatestPriceCache(session=session)

    results: list[dict[str, Any]] = []

    def worker() -> None:
        results.append(cache.get(1001))

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()

    assert call_started.wait(timeout=5)
    time.sleep(0.05)  # let the other threads pile up on the per-item lock
    release_call.set()
    for t in threads:
        t.join(timeout=5)

    assert call_count["n"] == 1
    assert len(results) == 5
    assert all(r == results[0] for r in results)


def test_default_ttl_is_300_seconds() -> None:
    """IMPL_PLAN_SH7 (f): DEFAULT_TTL_SECONDS == 300.0 (was 60.0)."""
    assert fetch_latest.DEFAULT_TTL_SECONDS == 300.0


def test_cache_uses_the_default_300s_ttl_when_not_overridden() -> None:
    clock = {"t": 0.0}
    session = FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 10.0})))
    cache = fetch_latest.LatestPriceCache(session=session, clock=lambda: clock["t"])  # ttl_seconds left at default

    cache.get(1001)
    clock["t"] = 299.0  # just inside the 300s default TTL
    cache.get(1001)
    assert cache.upstream_call_count == 1

    clock["t"] = 301.0  # just past it
    cache.get(1001)
    assert cache.upstream_call_count == 2


def test_different_item_ids_do_not_block_each_other() -> None:
    session = FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 1.0})))
    cache = fetch_latest.LatestPriceCache(session=session)

    cache.get(1001)
    cache.get(1002)

    assert cache.upstream_call_count == 2
