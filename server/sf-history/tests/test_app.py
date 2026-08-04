from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from starlette.requests import Request

import app as app_module
import db


def _request(origin: str | None = None) -> Request:
    headers = []
    if origin is not None:
        headers.append((b"origin", origin.encode("utf-8")))
    return Request(
        {"type": "http", "method": "GET", "path": "/", "raw_path": b"/", "headers": headers, "app": app_module.app}
    )


ITEMS: dict[str, Any] = {
    "generatedAt": "2026-08-05T00:00:00Z",
    "sourceRepo": "maplenEnhancebot",
    "sourceCommit": "abc",
    "excluded": [{"itemId": 1113282, "reason": "test reason"}],
    "items": [
        {"itemId": 1001, "itemName": "Full 22", "aliasItemIds": [1001, 1099]},
        {"itemId": 1002, "itemName": "Capped 20", "aliasItemIds": [1002]},
    ],
}


def _write_items(tmp_path: Path) -> Path:
    path = tmp_path / "items.json"
    path.write_text(json.dumps(ITEMS), encoding="utf-8")
    return path


def _seed_db(db_path: Path) -> None:
    conn = db.connect(db_path)
    db.apply_schema(conn)
    # item 1001: full 22, two 4h points at upgrade 0.
    db.replace_4h_rows(
        conn, 1001, 0,
        [
            {"price_at": "2026-03-08T00:00:00Z", "end_price": 100.0, "source_hour_at": "2026-03-08T03:00:00Z", "generated_at": "2026-08-05T01:00:00Z"},
            {"price_at": "2026-03-08T04:00:00Z", "end_price": 110.0, "source_hour_at": "2026-03-08T04:00:00Z", "generated_at": "2026-08-05T01:00:00Z"},
        ],
    )
    # give item 1001 real hourly data through upgrade 21 (so maxStar == 22).
    for upgrade in range(22):
        db.upsert_hourly_rows(
            conn, 1001, upgrade,
            [{"date": "2026-03-08T00:00:00Z", "endPrice": 1.0, "sumEnhanceCnt": 0}],
            "2026-08-05T00:00:00Z",
        )
    # item 1002: hourly data only through upgrade 19 -- maxStar should be 20.
    for upgrade in range(20):
        db.upsert_hourly_rows(
            conn, 1002, upgrade,
            [{"date": "2026-03-08T00:00:00Z", "endPrice": 1.0, "sumEnhanceCnt": 0}],
            "2026-08-05T00:00:00Z",
        )
    conn.close()


@pytest.fixture()
def _env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    _seed_db(db_path)
    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None
    return db_path


def test_health(_env: Path) -> None:
    response = app_module.health(_request())
    assert response.status_code == 200
    assert json.loads(response.body) == {"status": "ok"}


def test_equipment_reports_data_derived_max_star(_env: Path) -> None:
    response = app_module.equipment(_request())
    body = json.loads(response.body)
    by_id = {row["itemId"]: row for row in body["items"]}
    assert by_id[1001]["maxStar"] == 22
    assert by_id[1002]["maxStar"] == 20
    assert body["excluded"] == ITEMS["excluded"]
    assert by_id[1001]["aliasItemIds"] == [1001, 1099]


def test_prices_unknown_item_id_is_404(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="999999")
    assert response.status_code == 404


def test_prices_non_integer_item_id_is_400(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="not-a-number")
    assert response.status_code == 400


def test_prices_missing_item_id_is_400(_env: Path) -> None:
    response = app_module.prices(_request(), itemId=None)
    assert response.status_code == 400


def test_prices_shape_and_null_slots(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="1001")
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["itemId"] == 1001
    assert body["interval"] == "4h"
    assert body["labelIs"] == "bucketStart"
    assert body["upgradeCount"] == 22
    assert len(body["points"]) == 2
    first = body["points"][0]
    assert first["date"] == "2026-03-08T00:00:00Z"
    assert first["prices"][0] == 100.0
    assert first["prices"][1] is None  # design §9.1/§10: missing star -> null
    assert len(first["prices"]) == 22


def test_prices_filters_to_display_window(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    old_generated = (datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.replace_4h_rows(
        conn, 1001, 0,
        [
            {"price_at": "2020-01-01T00:00:00Z", "end_price": 1.0, "source_hour_at": "2020-01-01T00:00:00Z", "generated_at": old_generated},
            {"price_at": (datetime.now(timezone.utc)).strftime("%Y-%m-%dT00:00:00Z"), "end_price": 2.0, "source_hour_at": "x", "generated_at": old_generated},
        ],
    )
    conn.close()

    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None

    response = app_module.prices(_request(), itemId="1001")
    body = json.loads(response.body)
    assert len(body["points"]) == 1  # the 2020 point is outside the 150-day window
    assert body["points"][0]["prices"][0] == 2.0


def test_cors_allows_configured_origin(_env: Path) -> None:
    response = app_module.equipment(_request("https://lulumi-tools.com"))
    assert response.headers["access-control-allow-origin"] == "https://lulumi-tools.com"


def test_cors_rejects_other_origins(_env: Path) -> None:
    response = app_module.equipment(_request("https://evil.example"))
    assert response.headers["access-control-allow-origin"] != "https://evil.example"


def test_cors_is_configurable_via_env(_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SF_HISTORY_ALLOWED_ORIGINS", "https://other.example")
    response = app_module.equipment(_request("https://other.example"))
    assert response.headers["access-control-allow-origin"] == "https://other.example"


def test_latest_returns_upstream_result(_env: Path) -> None:
    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": "2026-08-05T00:00:00Z", "prices": [1.0] + [None] * 21}

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.latest(_request(), itemId="1001")
        body = json.loads(response.body)
        assert body["itemId"] == 1001
        assert body["prices"][0] == 1.0
    finally:
        app_module.app.state.latest_cache = app_module.LatestPriceCache()


def test_latest_upstream_failure_is_503_not_a_historical_fallback(_env: Path) -> None:
    class FailingCache:
        def get(self, item_id: int) -> dict[str, Any]:
            raise app_module.UpstreamLatestError("boom")

    app_module.app.state.latest_cache = FailingCache()
    try:
        response = app_module.latest(_request(), itemId="1001")
        assert response.status_code == 503
        body = json.loads(response.body)
        assert "prices" not in body  # no historical fallback value is ever substituted in
    finally:
        app_module.app.state.latest_cache = app_module.LatestPriceCache()


def test_latest_unknown_item_id_is_404_before_touching_cache(_env: Path) -> None:
    class ExplodingCache:
        def get(self, item_id: int) -> dict[str, Any]:
            raise AssertionError("must not be called for an unknown itemId")

    app_module.app.state.latest_cache = ExplodingCache()
    try:
        response = app_module.latest(_request(), itemId="999999")
        assert response.status_code == 404
    finally:
        app_module.app.state.latest_cache = app_module.LatestPriceCache()
