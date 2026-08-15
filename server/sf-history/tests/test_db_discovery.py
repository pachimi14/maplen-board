from __future__ import annotations

from pathlib import Path

import db


def _seed_group(conn, *, representative_item_id: int = 1004808, is_active: bool = True, steps_consistent: bool = True, now: str = "2026-08-15T00:00:00Z") -> None:
    db.upsert_discovery_monitored_group(
        conn,
        representative_item_id=representative_item_id,
        item_name="Arcane Umbra Knight Hat",
        equip_level_type="RANGE_200_TO_209",
        equip_type="BOSS_ARCANE_UMBRA_SET",
        equip_part_type="CAP",
        alias_item_ids=[1004808, 1004809, 1004810, 1004811, 1004812],
        aliases=[
            {"itemId": 1004808, "itemName": "Arcane Umbra Knight Hat"},
            {"itemId": 1004809, "itemName": "Arcane Umbra Mage Hat"},
            {"itemId": 1004810, "itemName": "Arcane Umbra Archer Hat"},
            {"itemId": 1004811, "itemName": "Arcane Umbra Thief Hat"},
            {"itemId": 1004812, "itemName": "Arcane Umbra Pirate Hat"},
        ],
        steps_consistent=steps_consistent,
        is_active=is_active,
        now=now,
    )


# --- sf_discovery_scan_runs / sf_discovery_scan_raw --------------------------


def test_record_discovery_scan_run_and_raw_rows(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    run_id = db.record_discovery_scan_run(
        conn, run_at="2026-08-15T00:00:00Z", groups_total=84, items_total=472,
        items_failed=0, monitored_groups=3, duration_ms=235000.0,
    )
    assert run_id == 1

    steps = ["STEP_TYPE_DISCOVERY"] * 22 + ["STEP_TYPE_DISCOVERY"] * 3
    written = db.insert_discovery_scan_raw_rows(conn, run_id, 1004808, steps, "2026-08-15T00:00:00Z")
    assert written == 25

    rows = conn.execute(
        "SELECT COUNT(*) FROM sf_discovery_scan_raw WHERE run_id = ? AND item_id = ?", (run_id, 1004808)
    ).fetchone()
    assert rows[0] == 25
    conn.close()


def test_scan_raw_rows_are_append_only_across_runs(tmp_path: Path) -> None:
    """A second scan run's rows for the same item never overwrite the first
    run's -- run_id is part of the primary key (plan §2: "生のまま残す")."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    run1 = db.record_discovery_scan_run(conn, run_at="2026-08-14T00:00:00Z", groups_total=84, items_total=472, items_failed=0, monitored_groups=3, duration_ms=1.0)
    run2 = db.record_discovery_scan_run(conn, run_at="2026-08-15T00:00:00Z", groups_total=84, items_total=472, items_failed=0, monitored_groups=3, duration_ms=1.0)
    db.insert_discovery_scan_raw_rows(conn, run1, 1004808, ["STEP_TYPE_DISCOVERY"] * 25, "2026-08-14T00:00:00Z")
    db.insert_discovery_scan_raw_rows(conn, run2, 1004808, ["STEP_TYPE_CHANGE"] * 25, "2026-08-15T00:00:00Z")
    total = conn.execute("SELECT COUNT(*) FROM sf_discovery_scan_raw WHERE item_id = 1004808").fetchone()[0]
    assert total == 50
    conn.close()


# --- sf_discovery_monitored_groups -------------------------------------------


def test_upsert_and_list_active_monitored_groups(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn)

    active = db.list_active_discovery_monitored_groups(conn)
    assert len(active) == 1
    assert active[0]["itemId"] == 1004808
    assert active[0]["aliasItemIds"] == [1004808, 1004809, 1004810, 1004811, 1004812]
    assert len(active[0]["aliases"]) == 5
    assert active[0]["stepsConsistent"] is True
    assert active[0]["isActive"] is True
    conn.close()


def test_upsert_preserves_first_seen_at_across_updates(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn, now="2026-08-10T00:00:00Z")
    _seed_group(conn, now="2026-08-15T00:00:00Z")

    row = db.get_discovery_monitored_group(conn, 1004808)
    assert row["firstSeenAt"] == "2026-08-10T00:00:00Z"
    assert row["lastScanAt"] == "2026-08-15T00:00:00Z"
    conn.close()


def test_get_discovery_monitored_group_returns_none_when_unknown(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    assert db.get_discovery_monitored_group(conn, 999) is None
    conn.close()


def test_deactivate_flips_is_active_but_keeps_the_row(tmp_path: Path) -> None:
    """plan §5(k): the row (name/aliases) is never deleted -- only is_active flips."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn)

    flipped = db.deactivate_discovery_groups_not_in(conn, set(), now="2026-08-16T00:00:00Z")
    assert flipped == 1
    assert db.list_active_discovery_monitored_groups(conn) == []

    all_groups = db.list_all_discovery_monitored_groups(conn)
    assert len(all_groups) == 1
    assert all_groups[0]["isActive"] is False
    assert all_groups[0]["itemName"] == "Arcane Umbra Knight Hat"  # name/aliases retained
    conn.close()


def test_deactivate_is_a_noop_for_groups_still_active(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn)
    flipped = db.deactivate_discovery_groups_not_in(conn, {1004808}, now="2026-08-16T00:00:00Z")
    assert flipped == 0
    assert db.list_active_discovery_monitored_groups(conn)[0]["isActive"] is True
    conn.close()


# --- sf_discovery_price_history ----------------------------------------------


def test_upsert_discovery_price_points_writes_current_and_previous(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    points = [
        {"priceAt": "2026-08-15T09:28:00Z", "endAt": "2026-08-15T09:29:00Z", "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
        {"priceAt": "2026-08-15T09:27:00Z", "endAt": "2026-08-15T09:28:00Z", "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
    ]
    written = db.upsert_discovery_price_points(conn, 1004808, 0, points, "2026-08-15T09:28:05Z")
    assert written == 2

    bands, observed_at = db.latest_discovery_bands_for_item(conn, 1004808)
    assert bands[0]["priceAt"] == "2026-08-15T09:28:00Z"  # most recent kept
    assert observed_at == "2026-08-15T09:28:05Z"
    conn.close()


def test_upsert_discovery_price_points_is_idempotent_same_window(tmp_path: Path) -> None:
    """(e): the same (itemId, itemUpgrade, startDate) written twice must not
    create a second row."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    point = [{"priceAt": "2026-08-15T09:28:00Z", "endAt": "2026-08-15T09:29:00Z", "price": 1.0, "step": "STEP_TYPE_DISCOVERY"}]
    db.upsert_discovery_price_points(conn, 1004808, 0, point, "2026-08-15T09:28:05Z")
    db.upsert_discovery_price_points(conn, 1004808, 0, point, "2026-08-15T09:33:05Z")  # re-poll, same window
    count = conn.execute(
        "SELECT COUNT(*) FROM sf_discovery_price_history WHERE item_id=1004808 AND item_upgrade=0"
    ).fetchone()[0]
    assert count == 1
    conn.close()


def test_latest_discovery_bands_for_item_empty_when_never_polled(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    bands, observed_at = db.latest_discovery_bands_for_item(conn, 1004808)
    assert bands == {}
    assert observed_at is None
    conn.close()


def test_find_recent_discovery_transitions_filters_by_since(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    old_points = [
        {"priceAt": "2026-07-01T00:00:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
        {"priceAt": "2026-07-01T00:05:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"},
    ]
    recent_points = [
        {"priceAt": "2026-08-14T00:00:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
        {"priceAt": "2026-08-14T00:05:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"},
    ]
    db.upsert_discovery_price_points(conn, 1001, 0, old_points, "2026-07-01T00:05:00Z")
    db.upsert_discovery_price_points(conn, 1001, 1, recent_points, "2026-08-14T00:05:00Z")

    transitions = db.find_recent_discovery_transitions(conn, since_iso="2026-08-01T00:00:00Z")
    assert len(transitions) == 1
    assert transitions[0] == {
        "itemId": 1001,
        "itemUpgrade": 1,
        "windowStart": "2026-08-14T00:00:00Z",
        "windowEnd": "2026-08-14T00:05:00Z",
    }
    conn.close()


def test_find_recent_discovery_transitions_empty_when_no_flip_yet(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    still_discovery = [{"priceAt": "2026-08-14T00:00:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"}]
    db.upsert_discovery_price_points(conn, 1001, 0, still_discovery, "2026-08-14T00:00:00Z")
    transitions = db.find_recent_discovery_transitions(conn, since_iso="2026-01-01T00:00:00Z")
    assert transitions == []
    conn.close()
