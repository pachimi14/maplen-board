"""IMPL_PLAN_SH36 §3/§4: `/sf-history/prices`'s forming-band fill +
`formingBands` note field.

Hat-shaped fixture throughout (IMPL_PLAN_SH36 §0): representative 1004811,
☆1-10 (itemUpgrade 0-9) and ☆20-22 (itemUpgrade 19-21) still price-forming
(DISCOVERY step, real current prices), ☆11-19 (itemUpgrade 10-18) already
settled (CHANGE step, real `sf_price_history_4h`/hourly history). Same
pattern as `tests/test_app.py` (hand-built `Request`, no network / TestClient
dependency, plan §1 "新規依存が必要になった" stop condition).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from starlette.requests import Request

import app as app_module
import db


def _request() -> Request:
    return Request(
        {"type": "http", "method": "GET", "path": "/", "raw_path": b"/", "headers": [], "app": app_module.app}
    )


ITEMS: dict[str, Any] = {
    "generatedAt": "2026-08-21T00:00:00Z",
    "sourceRepo": "maplenEnhancebot",
    "sourceCommit": "abc",
    "excluded": [],
    "items": [
        {
            "itemId": 1004811,
            "itemName": "Arcane Umbra Thief Hat",
            "aliasItemIds": [1004811],
            "aliases": [{"itemId": 1004811, "itemName": "Arcane Umbra Thief Hat"}],
        },
        # A plain, non-DISCOVERY item alongside it -- (g)'s own no-op check.
        {
            "itemId": 1001,
            "itemName": "Full 22",
            "aliasItemIds": [1001],
            "aliases": [{"itemId": 1001, "itemName": "Full 22"}],
        },
    ],
}

SEED_BUCKET_START = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")

# The exact live snapshot captured 2026-08-21T09:30:15Z via
# `GET /sf-history/discovery/prices?itemId=1004811` (production,
# api.lulumi-tools.com) -- frozen here for a reproducible fixture. Star 22
# (itemUpgrade 21) is included at its own observed value (2.593298) -- still
# genuinely DISCOVERY, not the degenerate 0.000001 seen on ☆23-25
# (itemUpgrade 22-24, out of this system's 22-band range regardless).
HAT_LIVE_SNAPSHOT_STEPS = {
    **{i: "STEP_TYPE_DISCOVERY" for i in range(10)},
    **{i: "STEP_TYPE_CHANGE" for i in range(10, 19)},
    19: "STEP_TYPE_DISCOVERY",
    20: "STEP_TYPE_DISCOVERY",
    21: "STEP_TYPE_DISCOVERY",
}
HAT_LIVE_SNAPSHOT_PRICES = {
    0: 114.892432, 1: 229.785131, 2: 344.677717, 3: 459.570351, 4: 574.46295,
    5: 689.354941, 6: 804.247441, 7: 919.139943, 8: 1034.032455, 9: 1148.924952,
    10: 1201149.099335, 11: 1627180.850776, 12: 1799166.600104, 13: 1791177.020387,
    14: 1775197.860955, 15: 2963863.801319, 16: 2963863.801319, 17: 2963863.801319,
    18: 2963863.801319, 19: 2.347413, 20: 2.593298, 21: 0.000001,
}


def _write_items(tmp_path: Path) -> Path:
    path = tmp_path / "items.json"
    path.write_text(json.dumps(ITEMS), encoding="utf-8")
    return path


def _seed_db(db_path: Path) -> None:
    conn = db.connect(db_path)
    db.apply_schema(conn)

    # item 1004811: one confirmed 4h point at upgrade 10 (a "settled" band) --
    # the fill must leave this real value alone.
    db.replace_4h_rows(
        conn, 1004811, 10,
        [{"price_at": SEED_BUCKET_START, "end_price": 1201149.099335, "source_hour_at": SEED_BUCKET_START, "generated_at": "2026-08-21T01:00:00Z"}],
    )
    for upgrade in range(10, 19):
        db.upsert_hourly_rows(
            conn, 1004811, upgrade,
            [{"date": SEED_BUCKET_START, "endPrice": HAT_LIVE_SNAPSHOT_PRICES[upgrade], "sumEnhanceCnt": 0}],
            "2026-08-21T00:00:00Z",
        )

    db.upsert_discovery_monitored_group(
        conn,
        representative_item_id=1004811,
        item_name="Arcane Umbra Thief Hat",
        equip_level_type="RANGE_200_TO_209",
        equip_type="BOSS_ARCANE_UMBRA_SET",
        equip_part_type="CAP",
        alias_item_ids=[1004811],
        aliases=[{"itemId": 1004811, "itemName": "Arcane Umbra Thief Hat"}],
        steps_consistent=True,
        is_active=True,
        now="2026-08-21T09:30:15Z",
    )
    for upgrade, step in HAT_LIVE_SNAPSHOT_STEPS.items():
        db.upsert_discovery_price_points(
            conn, 1004811, upgrade,
            [{"priceAt": "2026-08-21T09:30:00Z", "endAt": None, "price": HAT_LIVE_SNAPSHOT_PRICES[upgrade], "step": step}],
            "2026-08-21T09:30:05Z",
        )

    # item 1001: plain, no DISCOVERY data at all -- (g)'s regression check.
    db.replace_4h_rows(
        conn, 1001, 0,
        [{"price_at": SEED_BUCKET_START, "end_price": 100.0, "source_hour_at": SEED_BUCKET_START, "generated_at": "2026-08-21T01:00:00Z"}],
    )
    for upgrade in range(22):
        db.upsert_hourly_rows(
            conn, 1001, upgrade,
            [{"date": SEED_BUCKET_START, "endPrice": 1.0, "sumEnhanceCnt": 0}],
            "2026-08-21T00:00:00Z",
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


def test_prices_fills_forming_bands_leaving_real_history_intact(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="1004811")
    assert response.status_code == 200
    body = json.loads(response.body)

    confirmed_points = [p for p in body["points"] if not p.get("provisional")]
    assert len(confirmed_points) == 1
    prices = confirmed_points[0]["prices"]

    # (e)/(f): a forming (☆1-10, ☆20-22) band's real current price, passed
    # through unchanged -- never a hardcoded constant.
    assert prices[0] == round(HAT_LIVE_SNAPSHOT_PRICES[0], 2)
    assert prices[9] == round(HAT_LIVE_SNAPSHOT_PRICES[9], 2)
    assert prices[19] == round(HAT_LIVE_SNAPSHOT_PRICES[19], 2)
    assert prices[20] == round(HAT_LIVE_SNAPSHOT_PRICES[20], 2)
    assert prices[21] == round(HAT_LIVE_SNAPSHOT_PRICES[21], 2)
    # settled band (☆11): the REAL confirmed 4h value, never overwritten by
    # the DISCOVERY-table's own (identical, in this fixture) current price.
    assert prices[10] == round(HAT_LIVE_SNAPSHOT_PRICES[10], 2)


def test_prices_forming_bands_field_matches_the_hat_boundary(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="1004811")
    body = json.loads(response.body)
    assert body["formingBands"] == [
        {"startStar": 1, "endStar": 10},
        {"startStar": 20, "endStar": 22},
    ]


def test_prices_forming_bands_is_empty_for_a_non_discovery_item(_env: Path) -> None:
    """(g): a strict no-op for an item never DISCOVERY-monitored."""
    response = app_module.prices(_request(), itemId="1001")
    body = json.loads(response.body)
    assert body["formingBands"] == []
    assert body["points"][0]["prices"][1] is None  # untouched -- no forming data to fill with


def test_prices_never_overwrites_a_real_confirmed_point_even_when_null_elsewhere(_env: Path) -> None:
    """A band with SOME real history (☆11, itemUpgrade 10) keeps that real
    value at the one point that has it -- the fill only ever touches a
    still-`None` slot, never replaces a genuine historical number."""
    response = app_module.prices(_request(), itemId="1004811")
    body = json.loads(response.body)
    confirmed_points = [p for p in body["points"] if not p.get("provisional")]
    assert confirmed_points[0]["prices"][10] == round(HAT_LIVE_SNAPSHOT_PRICES[10], 2)
    assert confirmed_points[0]["prices"][10] != round(HAT_LIVE_SNAPSHOT_PRICES[0], 2)  # sanity: distinct bands


def test_response_contract_still_matches_with_forming_bands_present(_env: Path) -> None:
    import json as _json
    from pathlib import Path as _Path

    contract = _json.loads((_Path(__file__).resolve().parents[1] / "contract" / "response_fields.json").read_text(encoding="utf-8"))
    response = app_module.prices(_request(), itemId="1004811")
    body = json.loads(response.body)
    assert set(body.keys()) == set(contract["prices"]["root"])
