"""IMPL_PLAN_SH20 -- the Python half of the response/normalization contract.

`contract/response_fields.json` is the single, shared source of truth for
which keys `app.py`'s JSON responses may carry (the frontend's
`integrations/contract.test.js` reads the same file). This module asserts
the ACTUAL response key sets against it, both directions:

  - a key the response carries that is not listed in the contract -> fails
    ("サーバーが新しいフィールドを足すと... Python テストが落ちる")
  - a key the contract lists that the response stops carrying -> fails

For `prices.point`, no single point necessarily carries every listed key
(`provisional`/`closed`/`asOf` are conditional -- see app.py's own docstring
above the `points` route). `test_prices_point_keys_cover_the_full_contract`
therefore drives one request through every point shape the route can ever
produce (confirmed / elapsed-but-unaggregated-provisional / in-progress with
`asOf`) in a single fixture -- modeled on
`test_app.py::test_prices_fills_a_completed_but_unaggregated_bucket_from_hourly_data`
-- and checks the UNION of keys actually observed against the contract, plus
that no single point ever carries a key the contract does not list.

Offline: same as every other test in this directory -- `app_module.prices`/
`equipment`/`latest` are called directly with a hand-built `Request` and a
`FakeCache` standing in for the upstream `enhance-price/latest` call. No
network I/O.
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

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "contract" / "response_fields.json").read_text(encoding="utf-8"))


def _request() -> Request:
    return Request(
        {"type": "http", "method": "GET", "path": "/", "raw_path": b"/", "headers": [], "app": app_module.app}
    )


ITEMS: dict[str, Any] = {
    "generatedAt": "2026-08-05T00:00:00Z",
    "excluded": [{"itemId": 1113282, "reason": "test reason"}],
    "items": [
        {
            "itemId": 1001,
            "itemName": "Full 22",
            "aliasItemIds": [1001, 1099],
            "aliases": [
                {"itemId": 1001, "itemName": "Full 22"},
                {"itemId": 1099, "itemName": "Full 22 Alias"},
            ],
        },
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
    # One confirmed 4h bucket, well inside the display window.
    seed_date = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")
    db.replace_4h_rows(
        conn, 1001, 0,
        [{"price_at": seed_date, "end_price": 100.0, "source_hour_at": seed_date, "generated_at": "2026-08-05T01:00:00Z"}],
    )
    for upgrade in range(22):
        db.upsert_hourly_rows(
            conn, 1001, upgrade,
            [{"date": seed_date, "endPrice": 1.0, "sumEnhanceCnt": 0}],
            "2026-08-05T00:00:00Z",
        )
    conn.close()
    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None
    return db_path


def test_equipment_root_and_item_keys_match_contract(_env: Path) -> None:
    response = app_module.equipment(_request())
    body = json.loads(response.body)
    assert set(body.keys()) == set(CONTRACT["equipment"]["root"])
    for item in body["items"]:
        assert set(item.keys()) == set(CONTRACT["equipment"]["item"])


def test_latest_root_keys_match_contract(_env: Path) -> None:
    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {
                "itemId": item_id,
                "latestUpdatedAt": "2026-08-05T01:40:00Z",
                "prices": [999.0] + [None] * 21,
                "cubes": [1.0, 2.0, None, None],
                "cubeOrder": ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"],
            }

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.latest(_request(), itemId="1001")
        body = json.loads(response.body)
        assert set(body.keys()) == set(CONTRACT["latest"]["root"])
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_prices_root_keys_match_contract(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="1001")
    body = json.loads(response.body)
    assert set(body.keys()) == set(CONTRACT["prices"]["root"])


def test_prices_point_keys_cover_the_full_contract(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Drives one request through all 3 point shapes the route ever produces
    -- confirmed, elapsed-but-unaggregated-provisional, and in-progress (with
    `asOf`) -- modeled on `test_app.py`'s
    `test_prices_fills_a_completed_but_unaggregated_bucket_from_hourly_data`.
    """
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)

    now = datetime.now(timezone.utc)
    current_bucket = aggregate.parse_iso_utc(aggregate.bucket_start(now.strftime("%Y-%m-%dT%H:%M:%SZ")))
    missing_bucket = current_bucket - timedelta(hours=4)  # fully elapsed, never aggregated
    confirmed_bucket = missing_bucket - timedelta(hours=4)  # already in sf_price_history_4h

    confirmed_iso = aggregate.format_iso_utc(confirmed_bucket)
    missing_iso = aggregate.format_iso_utc(missing_bucket)

    db.replace_4h_rows(
        conn, 1001, 0,
        [{"price_at": confirmed_iso, "end_price": 100.0, "source_hour_at": confirmed_iso, "generated_at": "2026-08-05T01:00:00Z"}],
    )
    hourly_at_missing = aggregate.format_iso_utc(missing_bucket + timedelta(hours=1))
    for upgrade in range(22):
        db.upsert_hourly_rows(
            conn, 1001, upgrade,
            [{"date": hourly_at_missing, "endPrice": 200.0 + upgrade, "sumEnhanceCnt": 0}],
            "irrelevant",
        )
    conn.close()

    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None

    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": "2026-08-05T01:40:00Z", "prices": [999.0] + [None] * 21}

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        body = json.loads(response.body)
        points = body["points"]
        assert len(points) == 3  # confirmed, elapsed-provisional, in-progress

        contract_point_keys = set(CONTRACT["prices"]["point"])
        seen_keys: set[str] = set()
        for point in points:
            keys = set(point.keys())
            # a key the contract does not list -> Python side must fail.
            assert keys <= contract_point_keys, f"unexpected point keys: {keys - contract_point_keys}"
            seen_keys |= keys
        # a contract key never actually observed -> Python side must fail.
        assert seen_keys == contract_point_keys, f"contract point keys never observed: {contract_point_keys - seen_keys}"
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


# --- IMPL_PLAN_SH40: `/sf-history/cube-prices` -- same contract discipline as
# `prices` above, mirrored for the CUBE (RED/BLACK/ADDITIONAL/WHITE_ADDITIONAL)
# series (plan §2: "既存 /sf-history/prices と同じ流儀").


def test_cube_prices_root_keys_match_contract(_env: Path) -> None:
    response = app_module.cube_prices(_request(), itemId="1001")
    body = json.loads(response.body)
    assert set(body.keys()) == set(CONTRACT["cubePrices"]["root"])


def test_cube_prices_point_keys_cover_the_full_contract(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CUBE counterpart of `test_prices_point_keys_cover_the_full_contract`
    -- drives one request through all 3 point shapes this route ever
    produces (confirmed, elapsed-but-unaggregated-provisional, in-progress
    with `asOf`)."""
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

    db.replace_cube_4h_rows(
        conn, 1001, "RED",
        [{"price_at": confirmed_iso, "end_price": 100.0, "source_hour_at": confirmed_iso, "generated_at": "2026-08-05T01:00:00Z"}],
    )
    hourly_at_missing = aggregate.format_iso_utc(missing_bucket + timedelta(hours=1))
    for cube_sub_type in cube.CUBE_SUB_TYPES:
        db.upsert_cube_hourly_rows(
            conn, 1001, cube_sub_type,
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
                "latestUpdatedAt": "2026-08-05T01:40:00Z",
                "prices": [999.0] + [None] * 21,
                "cubes": [111.0, None, None, None],
                "cubeOrder": list(cube.CUBE_SUB_TYPES),
            }

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.cube_prices(_request(), itemId="1001")
        body = json.loads(response.body)
        points = body["points"]
        assert len(points) == 3  # confirmed, elapsed-provisional, in-progress

        contract_point_keys = set(CONTRACT["cubePrices"]["point"])
        seen_keys: set[str] = set()
        for point in points:
            keys = set(point.keys())
            assert keys <= contract_point_keys, f"unexpected point keys: {keys - contract_point_keys}"
            seen_keys |= keys
        assert seen_keys == contract_point_keys, f"contract point keys never observed: {contract_point_keys - seen_keys}"
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()
