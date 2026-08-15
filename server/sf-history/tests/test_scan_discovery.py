from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import db
import discovery
import fetcher as fetcher_mod
import scan_discovery


def _steps(*, discovery_bands: set[int] = frozenset(), total: int = 25) -> list[str]:
    return [discovery.DISCOVERY_STEP if i in discovery_bands else discovery.CHANGE_STEP for i in range(total)]


def _dynamicprice_payload(steps: list[str]) -> dict[str, Any]:
    starforce = {
        str(i): {"currentPrice": {"price": "1", "startDate": "2026-08-15T00:00:00Z", "endDate": "2026-08-15T00:01:00Z", "step": step}}
        for i, step in enumerate(steps)
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

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    """Group listing (POST) + per-group items / per-item dynamicprice (GET),
    all served from fixed dicts keyed by (group meta) / item id."""

    def __init__(
        self,
        *,
        groups: list[dict[str, Any]],
        items_by_group_key: dict[tuple[str, str, str], list[dict[str, Any]]],
        steps_by_item_id: dict[int, list[str] | None],
    ) -> None:
        self._groups = groups
        self._items_by_group_key = items_by_group_key
        self._steps_by_item_id = steps_by_item_id
        self.headers: dict[str, str] = {}
        self.get_calls: list[dict[str, Any]] = []
        self.post_calls: list[dict[str, Any]] = []

    def post(self, url: str, json: dict[str, Any], timeout: float) -> FakeResponse:  # noqa: A002 (shadows builtin, matches requests' kw name)
        self.post_calls.append({"url": url, "json": json})
        return FakeResponse(200, {"groups": self._groups, "pagination": {"totalRecord": str(len(self._groups))}})

    def get(self, url: str, params: dict[str, Any], timeout: float) -> FakeResponse:
        self.get_calls.append({"url": url, "params": params})
        if url == scan_discovery.ENHANCE_GROUP_ITEMS_URL:
            key = (params["equipLevelType"], params["equipType"], params["equipPartType"])
            items = self._items_by_group_key.get(key, [])
            return FakeResponse(200, {"items": items})
        # dynamicprice: item id is the last path segment before /dynamicprice
        item_id = int(url.rstrip("/").split("/")[-2])
        steps = self._steps_by_item_id.get(item_id)
        if steps is None:
            return FakeResponse(500, None)
        return FakeResponse(200, _dynamicprice_payload(steps))


def _group(equip_level_type: str, equip_type: str, equip_part_type: str) -> dict[str, Any]:
    return {"group": {"equipLevelType": equip_level_type, "equipType": equip_type, "equipPartType": equip_part_type}}


def _pick_by_week_count(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Trivial stand-in for maplenEnhancebot's real `pick_representative_item`
    (same weekCount-max rule) -- keeps this test suite hermetic/offline."""
    if not items:
        return None
    return max(items, key=lambda item: int(item.get("weekCount") or 0))


def _make_fetcher(session: FakeSession, **kwargs: Any) -> fetcher_mod.Fetcher:
    return fetcher_mod.Fetcher(session=session, min_interval_sec=0.0, **kwargs)  # type: ignore[arg-type]


# --- basic monitored-group detection + folding -------------------------------


def test_scan_folds_a_consistent_discovery_group_to_its_representative(tmp_path: Path) -> None:
    group_key = ("RANGE_200_TO_209", "BOSS_ARCANE_UMBRA_SET", "CAP")
    members = [
        {"itemId": "1004808", "itemName": "Arcane Umbra Knight Hat", "weekCount": 3153},
        {"itemId": "1004811", "itemName": "Arcane Umbra Thief Hat", "weekCount": 4112},
    ]
    steps = _steps(discovery_bands={0, 5})
    session = FakeSession(
        groups=[_group(*group_key)],
        items_by_group_key={group_key: members},
        steps_by_item_id={1004808: steps, 1004811: steps},
    )
    ftr = _make_fetcher(session)
    db_path = tmp_path / "x.sqlite"

    result = scan_discovery.run_scan(db_path=db_path, fetcher=ftr, pick_representative_item=_pick_by_week_count)

    assert result["groupsTotal"] == 1
    assert result["itemsTotal"] == 2
    assert result["itemsFailed"] == 0
    assert result["monitoredGroups"] == 1

    conn = db.connect(db_path)
    active = db.list_active_discovery_monitored_groups(conn)
    assert len(active) == 1
    assert active[0]["itemId"] == 1004811  # highest weekCount -- same rule as pick_representative_item
    assert active[0]["aliasItemIds"] == [1004808, 1004811]
    assert active[0]["stepsConsistent"] is True
    conn.close()


def test_scan_ignores_a_group_with_no_judge_range_discovery_band(tmp_path: Path) -> None:
    """(c): a group whose only DISCOVERY band is display-only (☆24 ==
    itemUpgrade 23) must not become a monitored group."""
    group_key = ("RANGE_1_TO_29", "NORMAL_X", "HAT")
    members = [{"itemId": "9001", "itemName": "X", "weekCount": 1}]
    steps = _steps(discovery_bands={23})  # itemUpgrade 23 == ☆24, judge range is 0..21
    session = FakeSession(
        groups=[_group(*group_key)],
        items_by_group_key={group_key: members},
        steps_by_item_id={9001: steps},
    )
    ftr = _make_fetcher(session)
    db_path = tmp_path / "x.sqlite"

    result = scan_discovery.run_scan(db_path=db_path, fetcher=ftr, pick_representative_item=_pick_by_week_count)
    assert result["monitoredGroups"] == 0

    conn = db.connect(db_path)
    assert db.list_active_discovery_monitored_groups(conn) == []
    conn.close()


def test_scan_does_not_fold_an_inconsistent_group_and_warns(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    group_key = ("RANGE_200_TO_209", "BOSS_X", "SUIT")
    members = [
        {"itemId": "2001", "itemName": "A", "weekCount": 10},
        {"itemId": "2002", "itemName": "B", "weekCount": 20},
    ]
    steps_a = _steps(discovery_bands={0})
    steps_b = _steps(discovery_bands={0, 1})  # differs from steps_a -- F7-for-step broken
    session = FakeSession(
        groups=[_group(*group_key)],
        items_by_group_key={group_key: members},
        steps_by_item_id={2001: steps_a, 2002: steps_b},
    )
    ftr = _make_fetcher(session)
    db_path = tmp_path / "x.sqlite"

    result = scan_discovery.run_scan(db_path=db_path, fetcher=ftr, pick_representative_item=_pick_by_week_count)
    assert result["monitoredGroups"] == 0

    conn = db.connect(db_path)
    assert db.list_active_discovery_monitored_groups(conn) == []
    # raw rows are still recorded for both members (plan §2: "生のまま残す")
    raw_count = conn.execute("SELECT COUNT(DISTINCT item_id) FROM sf_discovery_scan_raw").fetchone()[0]
    assert raw_count == 2
    conn.close()

    captured = capsys.readouterr()
    assert "WARNING" in captured.err
    assert "inconsistent" in captured.err


def test_scan_preserves_active_status_when_a_previously_folded_group_turns_inconsistent(tmp_path: Path) -> None:
    """An inconsistency freezes the group's active state -- it does not
    itself revoke a monitoring status a previous, consistent scan granted."""
    group_key = ("RANGE_200_TO_209", "BOSS_X", "SUIT")
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    db.upsert_discovery_monitored_group(
        conn, representative_item_id=2002, item_name="B", equip_level_type=group_key[0],
        equip_type=group_key[1], equip_part_type=group_key[2], alias_item_ids=[2001, 2002],
        aliases=[{"itemId": 2001, "itemName": "A"}, {"itemId": 2002, "itemName": "B"}],
        steps_consistent=True, is_active=True, now="2026-08-14T00:00:00Z",
    )
    conn.close()

    members = [{"itemId": "2001", "itemName": "A", "weekCount": 10}, {"itemId": "2002", "itemName": "B", "weekCount": 20}]
    steps_a = _steps(discovery_bands={0})
    steps_b = _steps(discovery_bands={0, 1})
    session = FakeSession(
        groups=[_group(*group_key)], items_by_group_key={group_key: members},
        steps_by_item_id={2001: steps_a, 2002: steps_b},
    )
    ftr = _make_fetcher(session)
    scan_discovery.run_scan(db_path=db_path, fetcher=ftr, pick_representative_item=_pick_by_week_count)

    conn = db.connect(db_path)
    row = db.get_discovery_monitored_group(conn, 2002)
    assert row["isActive"] is True  # not deactivated by this run's inconsistency
    conn.close()


def test_scan_deactivates_a_group_that_no_longer_has_a_discovery_band(tmp_path: Path) -> None:
    group_key = ("RANGE_200_TO_209", "BOSS_X", "SHOULDER")
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    db.upsert_discovery_monitored_group(
        conn, representative_item_id=3001, item_name="C", equip_level_type=group_key[0],
        equip_type=group_key[1], equip_part_type=group_key[2], alias_item_ids=[3001],
        aliases=[{"itemId": 3001, "itemName": "C"}], steps_consistent=True, is_active=True,
        now="2026-08-14T00:00:00Z",
    )
    conn.close()

    members = [{"itemId": "3001", "itemName": "C", "weekCount": 10}]
    all_change_steps = _steps(discovery_bands=set())
    session = FakeSession(
        groups=[_group(*group_key)], items_by_group_key={group_key: members},
        steps_by_item_id={3001: all_change_steps},
    )
    ftr = _make_fetcher(session)
    scan_discovery.run_scan(db_path=db_path, fetcher=ftr, pick_representative_item=_pick_by_week_count)

    conn = db.connect(db_path)
    assert db.list_active_discovery_monitored_groups(conn) == []
    row = db.get_discovery_monitored_group(conn, 3001)
    assert row is not None  # row kept (plan §5(k))
    assert row["isActive"] is False
    conn.close()


# --- partial success (plan §2: "1装備の失敗で全体を落とさない") -------------


def test_scan_counts_a_failed_item_and_keeps_going(tmp_path: Path) -> None:
    group_key = ("RANGE_200_TO_209", "BOSS_X", "CAP")
    members = [
        {"itemId": "4001", "itemName": "Ok", "weekCount": 1},
        {"itemId": "4002", "itemName": "Fails", "weekCount": 2},
    ]
    session = FakeSession(
        groups=[_group(*group_key)],
        items_by_group_key={group_key: members},
        steps_by_item_id={4001: _steps(discovery_bands={0}), 4002: None},  # None -> simulated HTTP 500
    )
    ftr = _make_fetcher(session)
    result = scan_discovery.run_scan(db_path=tmp_path / "x.sqlite", fetcher=ftr, pick_representative_item=_pick_by_week_count)

    assert result["itemsTotal"] == 2
    assert result["itemsFailed"] == 1
    # the surviving member alone is not enough to prove F7 across the whole
    # (nominal) group, but a single-member "group" is trivially consistent
    # (discovery.steps_consistent) and still gets folded.
    assert result["monitoredGroups"] == 1


# --- scan raw / run bookkeeping -----------------------------------------------


def test_scan_writes_a_run_summary_row(tmp_path: Path) -> None:
    group_key = ("RANGE_200_TO_209", "BOSS_X", "CAP")
    members = [{"itemId": "5001", "itemName": "A", "weekCount": 1}]
    session = FakeSession(
        groups=[_group(*group_key)], items_by_group_key={group_key: members},
        steps_by_item_id={5001: _steps(discovery_bands={0})},
    )
    ftr = _make_fetcher(session)
    db_path = tmp_path / "x.sqlite"
    scan_discovery.run_scan(db_path=db_path, fetcher=ftr, pick_representative_item=_pick_by_week_count)

    conn = db.connect(db_path)
    row = conn.execute(
        "SELECT groups_total, items_total, items_failed, monitored_groups FROM sf_discovery_scan_runs"
    ).fetchone()
    assert row == (1, 1, 0, 1)
    conn.close()


def test_scan_ignores_a_group_with_no_candidate_and_writes_no_raw_rows_for_it(tmp_path: Path) -> None:
    group_key = ("RANGE_200_TO_209", "BOSS_X", "CAP")
    members = [{"itemId": "6001", "itemName": "A", "weekCount": 1}]
    session = FakeSession(
        groups=[_group(*group_key)], items_by_group_key={group_key: members},
        steps_by_item_id={6001: _steps(discovery_bands=set())},  # fully CHANGE
    )
    ftr = _make_fetcher(session)
    db_path = tmp_path / "x.sqlite"
    scan_discovery.run_scan(db_path=db_path, fetcher=ftr, pick_representative_item=_pick_by_week_count)

    conn = db.connect(db_path)
    assert conn.execute("SELECT COUNT(*) FROM sf_discovery_scan_raw").fetchone()[0] == 0
    conn.close()
