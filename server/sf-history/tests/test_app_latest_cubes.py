"""IMPL_PLAN_SH40 §3: the `cubes`/`cubeOrder` addition to
`/sf-history/latest` -- specifically the cross-cutting guarantees that
require the REAL `fetch_latest.LatestPriceCache` (not a `FakeCache`
stand-in), since they exercise `parse_openapi_payload`/`parse_potential_
cubes` end to end: ★(e) no extra upstream request, and (g) graceful
degradation when the upstream has no `potential` data at all.

Split out of `test_app_cube_prices.py` (scope A's own route tests, which
never need the real cache) so this file's tests are exactly the ones that
depend on BOTH SH-40 halves (A's `/sf-history/cube-prices` + B's `fetch_
latest.py` changes) being present together.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from starlette.requests import Request

import app as app_module
import fetch_latest


def _request() -> Request:
    return Request(
        {"type": "http", "method": "GET", "path": "/", "raw_path": b"/", "headers": [], "app": app_module.app}
    )


ITEMS: dict[str, Any] = {
    "generatedAt": "2026-08-05T00:00:00Z",
    "sourceRepo": "maplenEnhancebot",
    "sourceCommit": "abc",
    "excluded": [],
    "items": [
        {"itemId": 1382265, "itemName": "Arcane Umbra Staff", "aliasItemIds": [1382265], "aliases": [{"itemId": 1382265, "itemName": "Arcane Umbra Staff"}]},
    ],
}


def _write_items(tmp_path: Path) -> Path:
    path = tmp_path / "items.json"
    path.write_text(json.dumps(ITEMS), encoding="utf-8")
    return path


@pytest.fixture()
def _env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import db

    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    conn.close()
    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None
    return db_path


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeSession:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload
        self.calls: list[str] = []

    def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.calls.append(url)
        return _FakeResponse(200, self._payload)


def _openapi_payload_with_cubes() -> dict[str, Any]:
    return {
        "data": {
            "currentPrices": {
                "starforce": {
                    "0": {"currentPrice": {"price": "100000000000000000000", "startDate": "2026-08-22T00:00:00Z", "step": "STEP_TYPE_CHANGE"}},
                },
                "potential": {
                    "5062009": {"currentPrice": {"price": "200000000000000000000", "startDate": "2026-08-22T00:00:00Z", "step": "STEP_TYPE_CHANGE"}},
                    "5062010": {"currentPrice": {"price": "300000000000000000000", "startDate": "2026-08-22T00:00:00Z", "step": "STEP_TYPE_CHANGE"}},
                    "5062500": {"currentPrice": {"price": "400000000000000000000", "startDate": "2026-08-22T00:00:00Z", "step": "STEP_TYPE_CHANGE"}},
                    "5062503": {"currentPrice": {"price": "500000000000000000000", "startDate": "2026-08-22T00:00:00Z", "step": "STEP_TYPE_CHANGE"}},
                },
            }
        }
    }


def test_latest_and_cube_prices_together_make_exactly_one_upstream_call(
    _env: Path,
) -> None:
    """★(e): the accept-criterion test. A real `LatestPriceCache` (not a
    FakeCache stand-in) backed by a `_FakeSession` that counts HTTP calls --
    hitting `/sf-history/latest` THEN `/sf-history/cube-prices` for the same
    itemId results in exactly 1 upstream request, because both routes share
    `app.state.latest_cache` and its TTL has not elapsed. This is the same
    call count as before this slice (adding cube-prices data must not add a
    second call)."""
    session = _FakeSession(_openapi_payload_with_cubes())
    real_cache = fetch_latest.LatestPriceCache(session=session, api_key="not-a-real-secret")
    app_module.app.state.latest_cache = real_cache
    try:
        latest_response = app_module.latest(_request(), itemId="1382265")
        assert latest_response.status_code == 200
        latest_body = json.loads(latest_response.body)
        assert latest_body["prices"][0] == pytest.approx(100.0)
        assert latest_body["cubes"] == [pytest.approx(200.0), pytest.approx(300.0), pytest.approx(400.0), pytest.approx(500.0)]
        assert latest_body["cubeOrder"] == ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"]

        cube_response = app_module.cube_prices(_request(), itemId="1382265")
        assert cube_response.status_code == 200
        cube_body = json.loads(cube_response.body)
        live_points = [p for p in cube_body["points"] if p.get("closed") is False]
        assert len(live_points) == 1
        assert live_points[0]["cubes"] == [pytest.approx(200.0), pytest.approx(300.0), pytest.approx(400.0), pytest.approx(500.0)]

        # ★(e): exactly one HTTP call total across BOTH requests.
        assert len(session.calls) == 1
        assert real_cache.upstream_call_count == 1
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_latest_prices_are_unaffected_when_upstream_has_no_potential_data(
    _env: Path,
) -> None:
    """(g): the legacy (no-API-key) upstream has no `potential` field at all
    -- `prices` must still come back exactly as before this slice, `cubes`
    degrades to `[None] * 4` (never guessed at)."""
    session = _FakeSession(
        {"latestUpdatedAt": "2026-08-22T00:00:00Z", "starForce": [{"itemUpgrade": 0, "closePrice": int(50.0 * fetch_latest.PRICE_DIVISOR)}]}
    )
    real_cache = fetch_latest.LatestPriceCache(session=session)  # no api_key -> legacy endpoint
    app_module.app.state.latest_cache = real_cache
    try:
        response = app_module.latest(_request(), itemId="1382265")
        assert response.status_code == 200
        body = json.loads(response.body)
        assert body["prices"][0] == pytest.approx(50.0)  # (g): SF price unaffected
        assert body["cubes"] == [None, None, None, None]  # never guessed at
        assert body["cubeOrder"] == ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"]
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()
