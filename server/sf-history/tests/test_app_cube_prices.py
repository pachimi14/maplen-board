"""IMPL_PLAN_SH40 §2/§3: `/sf-history/cube-prices` (scope A) and the
`cubes`/`cubeOrder` addition to `/sf-history/latest` (scope B).

Same offline-only discipline as `test_app.py` -- route functions called
directly with a hand-built `Request`, no network I/O, `FakeCache`/
`FakeSession` stand in for the shared upstream.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from starlette.requests import Request

import aggregate
import app as app_module
import cube
import db


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
def _env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
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


def test_cube_prices_unknown_item_id_is_404(_env: Path) -> None:
    response = app_module.cube_prices(_request(), itemId="9999999")
    assert response.status_code == 404


def test_cube_prices_missing_item_id_is_400(_env: Path) -> None:
    response = app_module.cube_prices(_request())
    assert response.status_code == 400


# --- (c) fixed order, exposed on the response root -------------------------


def test_cube_prices_order_is_fixed_and_exposed(_env: Path, tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    conn.close()
    response = app_module.cube_prices(_request(), itemId="1382265")
    body = json.loads(response.body)
    assert body["cubeOrder"] == ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"]
    assert body["cubeOrder"] == list(cube.CUBE_SUB_TYPES)


# --- (a)/(b) real per-row data: 4 series returned, White null before its own
# backfill start (J2: 2026-06-11), never 0/backfilled -- no special-casing in
# app.py, this falls straight out of "a cube_sub_type with no 4h row at that
# price_at leaves that slot None", the same mechanism `prices()` already
# relies on for a missing item_upgrade. ---


def test_cube_prices_shape_and_white_null_before_its_backfill_start(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)

    old_bucket = (datetime.now(timezone.utc) - timedelta(days=100)).strftime("%Y-%m-%dT00:00:00Z")
    new_bucket = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%dT00:00:00Z")

    # RED/BLACK/ADDITIONAL: real data at both buckets (started well before
    # White's 2026-06-11 launch, J2).
    for sub_type in ("RED", "BLACK", "ADDITIONAL"):
        db.replace_cube_4h_rows(
            conn, 1382265, sub_type,
            [
                {"price_at": old_bucket, "end_price": 111.0, "source_hour_at": old_bucket, "generated_at": "2026-08-05T01:00:00Z"},
                {"price_at": new_bucket, "end_price": 222.0, "source_hour_at": new_bucket, "generated_at": "2026-08-05T01:00:00Z"},
            ],
        )
    # WHITE_ADDITIONAL: only the NEW bucket has a real row -- the OLD bucket
    # predates its own backfill window, exactly like J2's real production gap.
    db.replace_cube_4h_rows(
        conn, 1382265, "WHITE_ADDITIONAL",
        [{"price_at": new_bucket, "end_price": 333.0, "source_hour_at": new_bucket, "generated_at": "2026-08-05T01:00:00Z"}],
    )
    conn.close()

    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None

    response = app_module.cube_prices(_request(), itemId="1382265")
    assert response.status_code == 200
    body = json.loads(response.body)

    by_date = {p["date"]: p["cubes"] for p in body["points"] if p["date"] in (old_bucket, new_bucket)}
    white_index = list(cube.CUBE_SUB_TYPES).index("WHITE_ADDITIONAL")

    # (b) ★White's old-bucket slot is None -- NOT 0, NOT the later 333.0 value.
    assert by_date[old_bucket][white_index] is None
    assert by_date[old_bucket][0] == 111.0  # RED, real data
    assert by_date[old_bucket][1] == 111.0  # BLACK
    assert by_date[old_bucket][2] == 111.0  # ADDITIONAL

    # New bucket: all 4 series present, including White.
    assert by_date[new_bucket] == [222.0, 222.0, 222.0, 333.0]


# --- (d) closed/provisional mirror the exact SF (prices()) rule ------------


def test_cube_prices_closed_and_provisional_mirror_sf(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)

    now = datetime.now(timezone.utc)
    current_bucket = aggregate.parse_iso_utc(aggregate.bucket_start(now.strftime("%Y-%m-%dT%H:%M:%SZ")))
    missing_bucket = current_bucket - timedelta(hours=4)  # fully elapsed, never aggregated
    confirmed_bucket = missing_bucket - timedelta(hours=4)  # already in sf_cube_price_history_4h

    confirmed_iso = aggregate.format_iso_utc(confirmed_bucket)
    missing_iso = aggregate.format_iso_utc(missing_bucket)
    current_iso = aggregate.format_iso_utc(current_bucket)

    db.replace_cube_4h_rows(
        conn, 1382265, "RED",
        [{"price_at": confirmed_iso, "end_price": 100.0, "source_hour_at": confirmed_iso, "generated_at": "2026-08-05T01:00:00Z"}],
    )
    hourly_at_missing = aggregate.format_iso_utc(missing_bucket + timedelta(hours=1))
    for sub_type in cube.CUBE_SUB_TYPES:
        db.upsert_cube_hourly_rows(
            conn, 1382265, sub_type,
            [{"date": hourly_at_missing, "endPrice": 200.0, "sumEnhanceCnt": 0}],
            "irrelevant",
        )
    conn.close()

    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None

    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {
                "itemId": item_id,
                "latestUpdatedAt": "now-ish",
                "prices": [999.0] + [None] * 21,
                "cubes": [999.0, None, None, None],
                "cubeOrder": list(cube.CUBE_SUB_TYPES),
            }

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.cube_prices(_request(), itemId="1382265")
        assert response.status_code == 200
        body = json.loads(response.body)

        dates = [p["date"] for p in body["points"]]
        assert dates == [confirmed_iso, missing_iso, current_iso]

        assert body["endDate"] == confirmed_iso  # last CONFIRMED bucket only

        provisional_points = [p for p in body["points"] if p.get("provisional") is True]
        assert len(provisional_points) == 2

        completed, live = provisional_points
        assert completed["date"] == missing_iso
        assert completed["cubes"][0] == 200.0
        assert "asOf" not in completed
        assert completed["closed"] is True  # elapsed window, just not yet persisted

        assert live["date"] == current_iso
        assert live["cubes"][0] == 999.0  # sourced from the shared latest cache
        assert live["asOf"] == "now-ish"
        assert live["closed"] is False

        assert sum(1 for p in body["points"] if p.get("closed") is False) == 1  # exactly one open point
        assert body["provisionalDate"] == current_iso
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_cube_prices_falls_back_to_hourly_when_shared_cache_has_no_cubes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(g)/robustness: a cache entry from BEFORE this slice (no `cubes` key
    at all, e.g. a stale in-flight request object) must not crash this
    route -- it degrades to the hourly-derived in-progress value, exactly
    like an upstream failure would."""
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)

    now = datetime.now(timezone.utc)
    current_bucket = aggregate.parse_iso_utc(aggregate.bucket_start(now.strftime("%Y-%m-%dT%H:%M:%SZ")))
    hourly_at_current = aggregate.format_iso_utc(current_bucket + timedelta(minutes=30))
    db.upsert_cube_hourly_rows(
        conn, 1382265, "RED",
        [{"date": hourly_at_current, "endPrice": 555.0, "sumEnhanceCnt": 0}],
        "irrelevant",
    )
    conn.close()

    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None

    class LegacyShapeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": "now-ish", "prices": [999.0] + [None] * 21}

    app_module.app.state.latest_cache = LegacyShapeCache()
    try:
        response = app_module.cube_prices(_request(), itemId="1382265")
        assert response.status_code == 200
        body = json.loads(response.body)
        live = [p for p in body["points"] if p.get("closed") is False]
        assert len(live) == 1
        assert live[0]["cubes"][0] == 555.0  # hourly fallback, not a crash
        assert "asOf" not in live[0]  # no real upstream stamp for a derived value
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()
