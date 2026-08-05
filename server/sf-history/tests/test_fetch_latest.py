from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
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

    def get(self, url: str, params: dict[str, Any] | None = None, timeout: float = 0, headers: dict[str, str] | None = None) -> FakeResponse:
        self.calls.append({"url": url, "params": params, "timeout": timeout, "headers": headers})
        return self._responder(params)


def _star_force_payload(prices_by_upgrade: dict[int, float], latest_updated_at: str | None = "2026-08-05T12:00:00Z") -> dict[str, Any]:
    return {
        "latestUpdatedAt": latest_updated_at,
        "starForce": [
            {"itemUpgrade": upgrade, "closePrice": int(price * fetch_latest.PRICE_DIVISOR)}
            for upgrade, price in prices_by_upgrade.items()
        ],
    }


def _openapi_payload(
    prices_by_upgrade: dict[int, float], start_dates: dict[int, str] | None = None
) -> dict[str, Any]:
    """IMPL_PLAN_SH23 §0/§3-1: shape of `openapi.msu.io/.../dynamicprice`'s
    body -- `data.currentPrices.starforce` is a string-keyed object, and each
    entry's price is itself a *string* (large integer, NESO * 1e18)."""
    start_dates = start_dates or {}
    starforce = {
        str(upgrade): {
            "currentPrice": {
                "startDate": start_dates.get(upgrade, "2026-08-05T11:53:00Z"),
                "endDate": "2026-08-05T11:54:00Z",
                "createDate": "2026-08-05T11:53:49Z",
                "price": str(int(price * fetch_latest.PRICE_DIVISOR)),
                "step": "STEP_TYPE_CHANGE",
            }
        }
        for upgrade, price in prices_by_upgrade.items()
    }
    return {"data": {"currentPrices": {"starforce": starforce}}}


def _fixed_wall_clock(dt: datetime):
    return lambda: dt


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


# --- IMPL_PLAN_SH23 §3-1: `parse_openapi_payload` -- the official Open API's
# `data.currentPrices.starforce` shape (string keys, string prices). ---


def test_parse_openapi_payload_converts_price_and_takes_lowest_star_start_date() -> None:
    payload = _openapi_payload(
        {5: 250.5, 0: 100.0},
        start_dates={0: "2026-08-05T11:53:00Z", 5: "2026-08-05T11:59:00Z"},
    )
    result = fetch_latest.parse_openapi_payload(1382265, payload)
    assert result["itemId"] == 1382265
    assert result["prices"][0] == pytest.approx(100.0)
    assert result["prices"][5] == pytest.approx(250.5)
    assert result["prices"][1] is None
    assert len(result["prices"]) == 22
    # (b) "その価格がいつ時点のものか" -- taken from the lowest-star entry, not
    # an arbitrary/dict-order-dependent one.
    assert result["latestUpdatedAt"] == "2026-08-05T11:53:00Z"


def test_parse_openapi_payload_ignores_out_of_range_and_non_numeric_star_keys() -> None:
    """(6) "星キーは文字列で来ます。25件前提のハードコードをしない" -- keys
    22/23/24 (>= UPGRADE_COUNT) and a non-numeric key are all ignored, never
    extending `prices` past its fixed length of 22."""
    payload = _openapi_payload({0: 10.0, 22: 999.0, 24: 999.0})
    payload["data"]["currentPrices"]["starforce"]["not-a-number"] = {
        "currentPrice": {"price": "1", "startDate": "2026-08-05T11:53:00Z"}
    }
    result = fetch_latest.parse_openapi_payload(1, payload)
    assert result["prices"][0] == pytest.approx(10.0)
    assert len(result["prices"]) == 22


def test_parse_openapi_payload_raises_when_starforce_is_missing_or_empty() -> None:
    with pytest.raises(fetch_latest.UpstreamLatestError):
        fetch_latest.parse_openapi_payload(1, {"data": {"currentPrices": {}}})
    with pytest.raises(fetch_latest.UpstreamLatestError):
        fetch_latest.parse_openapi_payload(1, {})
    with pytest.raises(fetch_latest.UpstreamLatestError):
        fetch_latest.parse_openapi_payload(1, {"data": {"currentPrices": {"starforce": {}}}})


# --- IMPL_PLAN_SH23 §3-1/§3-3: upstream dispatch -- `api_key` configured ->
# Open API; not configured -> legacy endpoint (the fallback). ---


def test_fetch_upstream_uses_openapi_when_api_key_is_configured() -> None:
    session = FakeSession(lambda params: FakeResponse(200, _openapi_payload({0: 42.0})))
    cache = fetch_latest.LatestPriceCache(session=session, api_key="test-key-not-a-real-secret")

    result = cache.get(1001)

    assert result["prices"][0] == pytest.approx(42.0)
    assert cache.uses_open_api is True
    assert len(session.calls) == 1
    call = session.calls[0]
    assert call["url"] == fetch_latest.OPEN_API_URL_TEMPLATE.format(item_id=1001)
    assert call["headers"]["x-nxopen-api-key"] == "test-key-not-a-real-secret"
    assert call["headers"]["Content-Type"] == "application/json"
    assert call["params"] is None  # itemId is in the URL path, not a query param


def test_fetch_upstream_uses_legacy_endpoint_when_no_api_key_is_configured() -> None:
    session = FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 7.0})))
    cache = fetch_latest.LatestPriceCache(session=session)  # api_key defaults to ""

    result = cache.get(1001)

    assert result["prices"][0] == pytest.approx(7.0)
    assert cache.uses_open_api is False
    call = session.calls[0]
    assert call["url"] == fetch_latest.LATEST_URL
    assert "x-nxopen-api-key" not in call["headers"]


def test_uses_open_api_is_false_for_an_empty_string_api_key() -> None:
    """An empty string (e.g. `os.getenv("MSU_OPEN_API_KEY", "")` when unset)
    must behave exactly like not passing `api_key` at all."""
    cache = fetch_latest.LatestPriceCache(
        session=FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 1.0}))),
        api_key="",
    )
    assert cache.uses_open_api is False


# --- IMPL_PLAN_SH15 §4: `_compute_ttl_seconds` -- the formula and its guards,
# tested directly (§5(c): "失効の計算を単体テストで固定"). Every case below
# uses a fixed `wall_clock` so the assertions never depend on the real clock. ---


def _cache_with_fixed_wall_clock(now: datetime, **kwargs: Any) -> fetch_latest.LatestPriceCache:
    return fetch_latest.LatestPriceCache(
        session=FakeSession(lambda params: FakeResponse(200, {})),
        wall_clock=_fixed_wall_clock(now),
        **kwargs,
    )


def test_compute_ttl_normal_case_is_interval_plus_grace_minus_elapsed() -> None:
    """(c) normal case: a stamp published 5 minutes ago."""
    now = datetime(2026, 8, 5, 12, 5, 0, tzinfo=timezone.utc)
    cache = _cache_with_fixed_wall_clock(now)
    ttl = cache._compute_ttl_seconds("2026-08-05T12:00:00Z")
    # expiry = 12:00 + 1200s(interval) + 60s(grace) = 12:21:00 -> ttl = 12:21:00 - 12:05:00 = 960s
    assert ttl == pytest.approx(960.0)


def test_compute_ttl_stamp_one_hour_old_clamps_to_the_60_second_floor() -> None:
    """(c) "スタンプが1時間前 → 下限60秒": the single most dangerous failure
    mode this plan calls out -- a stale stamp must never drive the TTL to
    (or past) zero, which would turn every request into an upstream hit."""
    now = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)
    cache = _cache_with_fixed_wall_clock(now)
    ttl = cache._compute_ttl_seconds("2026-08-05T11:00:00Z")  # published 1 hour ago
    assert ttl == fetch_latest.MIN_TTL_SECONDS == 60.0


def test_compute_ttl_missing_or_invalid_stamp_falls_back_to_the_fixed_interval() -> None:
    """(c) "不正・欠落 → 20分": never guess a finer poll from a bad stamp."""
    now = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)
    cache = _cache_with_fixed_wall_clock(now)
    for bad_stamp in (None, "", "not-a-timestamp", 12345, {}):
        assert cache._compute_ttl_seconds(bad_stamp) == fetch_latest.DEFAULT_PUBLISH_INTERVAL_SECONDS == 1200.0


def test_compute_ttl_future_stamp_is_treated_like_a_missing_one() -> None:
    """A `latestUpdatedAt` ahead of the wall clock is corrupt/untrustworthy --
    never used to shorten the TTL below the plain fixed interval."""
    now = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)
    cache = _cache_with_fixed_wall_clock(now)
    ttl = cache._compute_ttl_seconds("2026-08-05T13:00:00Z")  # 1 hour in the future
    assert ttl == fetch_latest.DEFAULT_PUBLISH_INTERVAL_SECONDS


def test_compute_ttl_never_exceeds_the_20_minute_ceiling_even_if_misconfigured() -> None:
    """(c) "どの場合も20分を超えない": `MAX_TTL_SECONDS` is a hard rail, not
    derived from (and not raisable by) the configurable interval/grace."""
    now = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)
    cache = _cache_with_fixed_wall_clock(
        now,
        publish_interval_seconds=6000.0,  # deliberately misconfigured (100 min)
        grace_seconds=6000.0,
    )
    # A stamp published exactly now would otherwise compute 6000+6000=12000s.
    assert cache._compute_ttl_seconds("2026-08-05T12:00:00Z") == fetch_latest.MAX_TTL_SECONDS == 1200.0
    # The missing/invalid fallback path (== the configured interval) must
    # also respect the ceiling.
    assert cache._compute_ttl_seconds(None) == fetch_latest.MAX_TTL_SECONDS


def test_ttl_bounds_are_60_to_1200_seconds() -> None:
    assert fetch_latest.MIN_TTL_SECONDS == 60.0
    assert fetch_latest.MAX_TTL_SECONDS == 1200.0
    assert fetch_latest.DEFAULT_PUBLISH_INTERVAL_SECONDS == 1200.0
    assert fetch_latest.DEFAULT_GRACE_SECONDS == 60.0


# --- `LatestPriceCache.get()` behavior (single-flight, per-itemId isolation,
# error handling) -- unaffected by the TTL formula change (§5(e): single-
# flight must still pass unmodified in spirit, even though the constructor
# signature changed). ---


def test_cache_returns_fresh_result_without_a_second_upstream_call() -> None:
    """A stamp old enough that the computed TTL clamps to the 60s floor --
    still fresh 10s later, still exactly one upstream call."""
    now = datetime(2026, 8, 6, 0, 0, 0, tzinfo=timezone.utc)  # ~12h after the payload's stamp
    clock = {"t": 0.0}
    session = FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 10.0})))
    cache = fetch_latest.LatestPriceCache(session=session, clock=lambda: clock["t"], wall_clock=_fixed_wall_clock(now))

    first = cache.get(1001)
    clock["t"] = 10.0  # well within the (floor-clamped) 60s TTL
    second = cache.get(1001)

    assert first == second
    assert cache.upstream_call_count == 1  # (i): "2回目が公式を叩かないことをログで確認"
    assert len(session.calls) == 1


def test_cache_refetches_after_ttl_expires() -> None:
    now = datetime(2026, 8, 6, 0, 0, 0, tzinfo=timezone.utc)  # same floor-clamp scenario as above
    clock = {"t": 0.0}
    session = FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 10.0})))
    cache = fetch_latest.LatestPriceCache(session=session, clock=lambda: clock["t"], wall_clock=_fixed_wall_clock(now))

    cache.get(1001)
    clock["t"] = 61.0  # past the (floor-clamped) 60s TTL
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
    """plan §5: "同一 itemId への同時アクセスを1リクエストに畳む" -- (e) single-
    flight is unaffected by the TTL-formula change."""
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


def test_different_item_ids_do_not_block_each_other() -> None:
    session = FakeSession(lambda params: FakeResponse(200, _star_force_payload({0: 1.0})))
    cache = fetch_latest.LatestPriceCache(session=session)

    cache.get(1001)
    cache.get(1002)

    assert cache.upstream_call_count == 2


# --- IMPL_PLAN_SH15 §5(d): "20分の窓で同一itemIdの上流アクセスが2回を超えない" ---


def test_at_most_two_upstream_calls_within_a_20_minute_window_under_realistic_publish_timing() -> None:
    """Mimics real upstream behavior (the published stamp is always the
    start of the *current* 20-minute UTC bucket as of whenever upstream is
    actually asked -- not a value fixed for the whole test), then hammers
    the cache every 30s for a full 20-minute window. Even though the first
    request lands mid-bucket (worst realistic case: freshness left is less
    than a full 20 minutes), the cache should only reach upstream once more
    near the bucket boundary -- never more than twice total."""
    mono = {"t": 0.0}
    wall = {"dt": datetime(2026, 8, 5, 4, 5, 0, tzinfo=timezone.utc)}  # 5 min into the 04:00 bucket

    def responder(params: dict[str, Any]) -> FakeResponse:
        now = wall["dt"]
        bucket_minute = (now.minute // 20) * 20
        stamp = now.replace(minute=bucket_minute, second=0, microsecond=0)
        return FakeResponse(200, _star_force_payload({0: 10.0}, latest_updated_at=stamp.strftime("%Y-%m-%dT%H:%M:%SZ")))

    session = FakeSession(responder)
    cache = fetch_latest.LatestPriceCache(session=session, clock=lambda: mono["t"], wall_clock=lambda: wall["dt"])

    for _ in range(40):  # 40 x 30s = 1200s = 20 minutes
        cache.get(1001)
        mono["t"] += 30.0
        wall["dt"] += timedelta(seconds=30)

    assert cache.upstream_call_count <= 2
