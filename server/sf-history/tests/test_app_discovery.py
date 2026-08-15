from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from starlette.requests import Request

import app as app_module
import db

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "contract" / "response_fields.json").read_text(encoding="utf-8"))


def _request() -> Request:
    return Request(
        {"type": "http", "method": "GET", "path": "/", "raw_path": b"/", "headers": [], "app": app_module.app}
    )


@pytest.fixture()
def _env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    conn.close()
    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    return db_path


def _seed_group(db_path: Path, *, representative_item_id: int = 1004808, is_active: bool = True) -> None:
    conn = db.connect(db_path)
    db.upsert_discovery_monitored_group(
        conn,
        representative_item_id=representative_item_id,
        item_name="Arcane Umbra Knight Hat",
        equip_level_type="RANGE_200_TO_209",
        equip_type="BOSS_ARCANE_UMBRA_SET",
        equip_part_type="CAP",
        alias_item_ids=[representative_item_id, representative_item_id + 1],
        aliases=[
            {"itemId": representative_item_id, "itemName": "Arcane Umbra Knight Hat"},
            {"itemId": representative_item_id + 1, "itemName": "Arcane Umbra Mage Hat"},
        ],
        steps_consistent=True,
        is_active=is_active,
        now="2026-08-15T00:00:00Z",
    )
    conn.close()


# --- discovery_equipment: (g) 3 rows, never aliases as their own rows -------


def test_discovery_equipment_lists_only_active_groups(_env: Path) -> None:
    _seed_group(_env, representative_item_id=1004808, is_active=True)
    _seed_group(_env, representative_item_id=1053063, is_active=True)
    _seed_group(_env, representative_item_id=9999999, is_active=False)

    response = app_module.discovery_equipment(_request())
    body = json.loads(response.body)
    assert {item["itemId"] for item in body["items"]} == {1004808, 1053063}
    assert set(body.keys()) == set(CONTRACT["discoveryEquipment"]["root"])
    for item in body["items"]:
        assert set(item.keys()) == set(CONTRACT["discoveryEquipment"]["item"])


def test_discovery_equipment_empty_when_nothing_monitored(_env: Path) -> None:
    response = app_module.discovery_equipment(_request())
    body = json.loads(response.body)
    assert body["items"] == []


# --- discovery_prices: (h) 25 bands + isDiscovery badge, (j) observedAt ----


def test_discovery_prices_returns_25_bands_with_discovery_badges(_env: Path) -> None:
    _seed_group(_env, representative_item_id=1053063)
    conn = db.connect(_env)
    # Suit-like pattern from the real 2026-08-15 probe: bands 10-13 and 15
    # CHANGE, everything else DISCOVERY.
    change_bands = {10, 11, 12, 13, 15}
    for upgrade in range(25):
        step = "STEP_TYPE_CHANGE" if upgrade in change_bands else "STEP_TYPE_DISCOVERY"
        db.upsert_discovery_price_points(
            conn, 1053063, upgrade,
            [{"priceAt": "2026-08-15T09:28:00Z", "endAt": "2026-08-15T09:29:00Z", "price": 1.0, "step": step}],
            "2026-08-15T09:28:05Z",
        )
    conn.close()

    response = app_module.discovery_prices(_request(), itemId="1053063")
    body = json.loads(response.body)
    assert set(body.keys()) == set(CONTRACT["discoveryPrices"]["root"])
    assert len(body["bands"]) == 25
    assert body["observedAt"] == "2026-08-15T09:28:05Z"

    no_badge_bands = {b["itemUpgrade"] for b in body["bands"] if not b["isDiscovery"]}
    assert no_badge_bands == change_bands
    for band in body["bands"]:
        assert set(band.keys()) == set(CONTRACT["discoveryPrices"]["band"])


def test_discovery_prices_404_for_unknown_item(_env: Path) -> None:
    response = app_module.discovery_prices(_request(), itemId="42")
    assert response.status_code == 404


def test_discovery_prices_400_for_non_integer_item_id(_env: Path) -> None:
    response = app_module.discovery_prices(_request(), itemId="abc")
    assert response.status_code == 400


def test_discovery_prices_bands_are_null_when_never_polled(_env: Path) -> None:
    """A group Component A just folded but Component B has not polled yet --
    must not crash, and observedAt must be null (§5(j): never invent it)."""
    _seed_group(_env, representative_item_id=1004808)
    response = app_module.discovery_prices(_request(), itemId="1004808")
    body = json.loads(response.body)
    assert body["observedAt"] is None
    assert all(b["price"] is None and b["step"] is None for b in body["bands"])


# --- discovery_recent: (k) 30-day default, configurable ----------------------


def test_discovery_recent_defaults_to_30_days(_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SF_HISTORY_DISCOVERY_RECENT_DAYS", raising=False)
    _seed_group(_env, representative_item_id=1004808)
    now = datetime.now(timezone.utc)
    recent_discovery_at = (now - timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    recent_change_at = (now - timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%SZ")
    old_discovery_at = (now - timedelta(days=200)).strftime("%Y-%m-%dT%H:%M:%SZ")
    old_change_at = (now - timedelta(days=199)).strftime("%Y-%m-%dT%H:%M:%SZ")

    conn = db.connect(_env)
    db.upsert_discovery_price_points(
        conn, 1004808, 0,
        [
            {"priceAt": recent_discovery_at, "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
            {"priceAt": recent_change_at, "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"},
        ],
        recent_change_at,
    )
    db.upsert_discovery_price_points(
        conn, 1004808, 1,
        [
            {"priceAt": old_discovery_at, "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
            {"priceAt": old_change_at, "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"},
        ],
        old_change_at,
    )
    conn.close()

    response = app_module.discovery_recent(_request())
    body = json.loads(response.body)
    assert body["days"] == 30
    assert set(body.keys()) == set(CONTRACT["discoveryRecent"]["root"])
    assert [item["itemUpgrade"] for item in body["items"]] == [0]  # only the 5-day-ago flip
    for item in body["items"]:
        assert set(item.keys()) == set(CONTRACT["discoveryRecent"]["item"])
        assert item["itemName"] == "Arcane Umbra Knight Hat"


def test_discovery_recent_env_var_changes_the_default(_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SF_HISTORY_DISCOVERY_RECENT_DAYS", "7")
    response = app_module.discovery_recent(_request())
    body = json.loads(response.body)
    assert body["days"] == 7


def test_discovery_recent_query_param_overrides_default(_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SF_HISTORY_DISCOVERY_RECENT_DAYS", raising=False)
    response = app_module.discovery_recent(_request(), days="90")
    body = json.loads(response.body)
    assert body["days"] == 90


def test_discovery_recent_survives_a_group_that_has_since_been_deactivated(_env: Path) -> None:
    """§5(k): "記録は永久に残す" -- a transition from a group that is no
    longer active must still show up (with its name resolved)."""
    _seed_group(_env, representative_item_id=1004808, is_active=False)
    now = datetime.now(timezone.utc)
    discovery_at = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    change_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = db.connect(_env)
    db.upsert_discovery_price_points(
        conn, 1004808, 0,
        [
            {"priceAt": discovery_at, "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
            {"priceAt": change_at, "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"},
        ],
        change_at,
    )
    conn.close()

    response = app_module.discovery_recent(_request())
    body = json.loads(response.body)
    assert len(body["items"]) == 1
    assert body["items"][0]["itemName"] == "Arcane Umbra Knight Hat"


# --- (i): no upstream access at all -------------------------------------------


class _ExplodingCache:
    def get(self, item_id: int) -> dict[str, Any]:
        raise AssertionError("discovery routes must never touch the latest_cache (upstream)")


def test_discovery_routes_never_touch_the_latest_cache(_env: Path) -> None:
    _seed_group(_env, representative_item_id=1004808)
    app_module.app.state.latest_cache = _ExplodingCache()
    try:
        app_module.discovery_equipment(_request())
        app_module.discovery_prices(_request(), itemId="1004808")
        app_module.discovery_recent(_request())
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()
