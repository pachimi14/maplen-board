from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import db
import fetcher as fetcher_mod
import poll_discovery


def _dynamicprice_payload(*, upgrades: list[int]) -> dict[str, Any]:
    starforce = {
        str(u): {
            "currentPrice": {
                "price": str(int(1e18)),
                "startDate": "2026-08-15T09:28:00Z",
                "endDate": "2026-08-15T09:29:00Z",
                "step": "STEP_TYPE_DISCOVERY",
            },
            "previousPrice": {
                "price": str(int(2e18)),
                "startDate": "2026-08-15T09:27:00Z",
                "endDate": "2026-08-15T09:28:00Z",
                "step": "STEP_TYPE_DISCOVERY",
            },
        }
        for u in upgrades
    }
    return {"data": {"currentPrices": {"starforce": starforce}}}


class FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any] | None):
        self.status_code = status_code
        self._payload = payload
        self.text = "" if payload is None else json.dumps(payload)

    def json(self) -> dict[str, Any]:
        if self._payload is None:
            raise ValueError("no json body")
        return self._payload


class FakeSession:
    def __init__(self, payload_by_item_id: dict[int, dict[str, Any] | None]) -> None:
        self._payload_by_item_id = payload_by_item_id
        self.headers: dict[str, str] = {}
        self.get_calls: list[str] = []

    def get(self, url: str, params: dict[str, Any], timeout: float) -> FakeResponse:
        self.get_calls.append(url)
        item_id = int(url.rstrip("/").split("/")[-2])
        payload = self._payload_by_item_id.get(item_id)
        if payload is None:
            return FakeResponse(500, None)
        return FakeResponse(200, payload)


def _seed_active_group(conn, *, representative_item_id: int, aliases: list[int], equip_part_type: str = "CAP") -> None:
    # ★2026-08-15 fix: `equip_part_type` is part of the group's real identity
    # (schema.sql's partial unique index) -- a caller seeding more than one
    # ACTIVE group in the same test must pass distinct values.
    db.upsert_discovery_monitored_group(
        conn,
        representative_item_id=representative_item_id,
        item_name=f"Item {representative_item_id}",
        equip_level_type="RANGE_200_TO_209",
        equip_type="BOSS_X",
        equip_part_type=equip_part_type,
        alias_item_ids=aliases,
        aliases=[{"itemId": a, "itemName": f"Item {a}"} for a in aliases],
        steps_consistent=True,
        is_active=True,
        now="2026-08-15T00:00:00Z",
    )


def _make_fetcher(session: FakeSession, **kwargs: Any) -> fetcher_mod.Fetcher:
    return fetcher_mod.Fetcher(session=session, min_interval_sec=0.0, **kwargs)  # type: ignore[arg-type]


# --- (l): zero monitored groups -> zero requests ------------------------------


def test_poll_makes_no_requests_when_no_monitored_groups(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    conn.close()

    session = FakeSession({})
    ftr = _make_fetcher(session)
    result = poll_discovery.run_poll(db_path=db_path, fetcher=ftr)

    assert result == {"monitoredGroups": 0, "polled": 0, "failed": 0, "rowsWritten": 0, "requestsMade": 0, "total429": 0}
    assert session.get_calls == []


# --- (g-2): exactly N requests -- representatives only, never aliases --------


def test_poll_hits_only_representatives_never_aliases(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_active_group(conn, representative_item_id=1004808, aliases=[1004808, 1004809, 1004810, 1004811, 1004812], equip_part_type="CAP")
    _seed_active_group(conn, representative_item_id=1053063, aliases=[1053063, 1053064], equip_part_type="CLOTHES")
    _seed_active_group(conn, representative_item_id=1152196, aliases=[1152196], equip_part_type="SHOULDER")
    conn.close()

    payload = _dynamicprice_payload(upgrades=[0, 1])
    session = FakeSession({1004808: payload, 1053063: payload, 1152196: payload})
    ftr = _make_fetcher(session)

    result = poll_discovery.run_poll(db_path=db_path, fetcher=ftr)

    assert result["monitoredGroups"] == 3
    assert result["polled"] == 3
    assert result["failed"] == 0
    assert result["requestsMade"] == 3  # (g-2): exactly one call per representative
    called_item_ids = {int(u.rstrip("/").split("/")[-2]) for u in session.get_calls}
    assert called_item_ids == {1004808, 1053063, 1152196}  # never 1004809/1053064/etc.


# --- (d)/(e): 25-band + previousPrice, upsert never duplicates ---------------


def test_poll_writes_current_and_previous_for_every_present_band(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_active_group(conn, representative_item_id=1004808, aliases=[1004808])
    conn.close()

    payload = _dynamicprice_payload(upgrades=list(range(25)))
    session = FakeSession({1004808: payload})
    ftr = _make_fetcher(session)

    result = poll_discovery.run_poll(db_path=db_path, fetcher=ftr)
    assert result["rowsWritten"] == 25 * 2  # current + previous per band

    conn = db.connect(db_path)
    bands, observed_at = db.latest_discovery_bands_for_item(conn, 1004808)
    assert len(bands) == 25
    assert observed_at is not None
    conn.close()


def test_poll_upsert_is_idempotent_across_runs(tmp_path: Path) -> None:
    """(e): polling the exact same upstream window twice must not add rows."""
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_active_group(conn, representative_item_id=1004808, aliases=[1004808])
    conn.close()

    payload = _dynamicprice_payload(upgrades=[0])
    session = FakeSession({1004808: payload})
    ftr = _make_fetcher(session)
    poll_discovery.run_poll(db_path=db_path, fetcher=ftr)
    poll_discovery.run_poll(db_path=db_path, fetcher=ftr)  # same startDates -- same upsert keys

    conn = db.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM sf_discovery_price_history WHERE item_id = 1004808").fetchone()[0]
    assert count == 2  # current window + previous window, not 4
    conn.close()


# --- partial failure ----------------------------------------------------------


def test_poll_counts_a_failed_representative_and_keeps_going(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_active_group(conn, representative_item_id=1001, aliases=[1001], equip_part_type="CAP")
    _seed_active_group(conn, representative_item_id=1002, aliases=[1002], equip_part_type="CLOTHES")
    conn.close()

    payload = _dynamicprice_payload(upgrades=[0])
    session = FakeSession({1001: payload, 1002: None})  # 1002 -> simulated HTTP 500
    ftr = _make_fetcher(session)

    result = poll_discovery.run_poll(db_path=db_path, fetcher=ftr)
    assert result["polled"] == 1
    assert result["failed"] == 1
    assert result["requestsMade"] == 2  # both were attempted -- partial success, not abort
