from __future__ import annotations

from pathlib import Path

import pytest

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


# --- ★2026-08-15 fix: group-identity lookup / explicit single-row deactivate ---


def test_get_discovery_monitored_group_by_group_key_finds_the_row(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn)
    row = db.get_discovery_monitored_group_by_group_key(conn, "RANGE_200_TO_209", "BOSS_ARCANE_UMBRA_SET", "CAP")
    assert row is not None
    assert row["itemId"] == 1004808
    conn.close()


def test_get_discovery_monitored_group_by_group_key_finds_an_inactive_row_too(tmp_path: Path) -> None:
    """A group's identity must be resolvable even while inactive (plan §5(k))
    -- scan_discovery.py relies on this to keep reusing the same
    representative across an active/inactive/active cycle."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn, is_active=False)
    row = db.get_discovery_monitored_group_by_group_key(conn, "RANGE_200_TO_209", "BOSS_ARCANE_UMBRA_SET", "CAP")
    assert row is not None
    assert row["isActive"] is False
    conn.close()


def test_get_discovery_monitored_group_by_group_key_none_when_unknown(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    assert db.get_discovery_monitored_group_by_group_key(conn, "X", "Y", "Z") is None
    conn.close()


def test_deactivate_discovery_group_flips_is_active_and_keeps_the_row(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn)
    db.deactivate_discovery_group(conn, 1004808, now="2026-08-16T00:00:00Z")
    row = db.get_discovery_monitored_group(conn, 1004808)
    assert row["isActive"] is False
    assert row["lastScanAt"] == "2026-08-16T00:00:00Z"
    conn.close()


def test_partial_unique_index_rejects_a_second_active_row_for_the_same_group(tmp_path: Path) -> None:
    """Defense in depth for the ★2026-08-15 fix: at most one ACTIVE row may
    exist per group identity. Inserting a second active row for the SAME
    group identity under a DIFFERENT representative_item_id must fail loudly
    (IntegrityError) rather than silently duplicate -- this is what would
    happen if scan_discovery.py's lookup-before-pick discipline were ever
    bypassed by a future change."""
    import sqlite3

    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn, representative_item_id=1004808, is_active=True)
    with pytest.raises(sqlite3.IntegrityError):
        _seed_group(conn, representative_item_id=1004811, is_active=True)
    conn.close()


def test_partial_unique_index_allows_a_superseded_inactive_row_to_coexist(tmp_path: Path) -> None:
    """The rare re-selection path: deactivate the old representative's row
    FIRST, then a new active row for the same group identity (different
    representative_item_id) inserts cleanly -- both rows persist (plan
    §5(k)), only one is ever active at a time."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn, representative_item_id=1004808, is_active=True)
    db.deactivate_discovery_group(conn, 1004808, now="2026-08-16T00:00:00Z")
    _seed_group(conn, representative_item_id=1004811, is_active=True)  # must not raise

    all_groups = db.list_all_discovery_monitored_groups(conn)
    assert len(all_groups) == 2
    assert db.list_active_discovery_monitored_groups(conn)[0]["itemId"] == 1004811
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


# --- find_discovery_transitions_for_item -- IMPL_PLAN_SH33 follow-up ---------


def test_find_discovery_transitions_for_item_returns_only_observed_flips(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    db.upsert_discovery_price_points(
        conn, 1053063, 3,
        [
            {"priceAt": "2026-08-14T10:00:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
            {"priceAt": "2026-08-14T10:05:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"},
        ],
        "2026-08-14T10:05:05Z",
    )
    db.upsert_discovery_price_points(
        conn, 1053063, 4,
        [{"priceAt": "2026-08-15T09:28:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"}],
        "2026-08-15T09:28:05Z",
    )
    transitions = db.find_discovery_transitions_for_item(conn, 1053063)
    assert transitions == {3: ("2026-08-14T10:00:00Z", "2026-08-14T10:05:00Z")}  # band 4 absent -- still DISCOVERY
    conn.close()


def test_find_discovery_transitions_for_item_never_guesses_a_pre_monitoring_settle(tmp_path: Path) -> None:
    """A band whose FIRST ever recorded row is already CHANGE (it settled
    before monitoring started) must not appear -- the true instant is
    unknowable, so this is deliberately indistinguishable from "unobserved"
    (plan: "推測して埋めない")."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    db.upsert_discovery_price_points(
        conn, 1053063, 10,
        [{"priceAt": "2026-08-15T09:28:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"}],
        "2026-08-15T09:28:05Z",
    )
    transitions = db.find_discovery_transitions_for_item(conn, 1053063)
    assert transitions == {}
    conn.close()


def test_find_discovery_transitions_for_item_empty_when_never_polled(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    assert db.find_discovery_transitions_for_item(conn, 999) == {}
    conn.close()


def test_find_discovery_transitions_for_item_only_returns_that_items_own_bands(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    for item_id in (1053063, 1053064):
        db.upsert_discovery_price_points(
            conn, item_id, 0,
            [
                {"priceAt": "2026-08-14T10:00:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
                {"priceAt": "2026-08-14T10:05:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"},
            ],
            "2026-08-14T10:05:05Z",
        )
    transitions = db.find_discovery_transitions_for_item(conn, 1053063)
    assert set(transitions.keys()) == {0}
    conn.close()


# --- sf_discovery_cube_price_history -- IMPL_PLAN_SH34 §2-1 -----------------


def test_upsert_discovery_cube_price_points_writes_current_and_previous(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    points = [
        {"priceAt": "2026-08-16T15:09:00Z", "endAt": "2026-08-16T15:10:00Z", "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
        {"priceAt": "2026-08-16T15:08:00Z", "endAt": "2026-08-16T15:09:00Z", "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
    ]
    written = db.upsert_discovery_cube_price_points(conn, 1004811, 2711000, points, "2026-08-16T15:09:05Z")
    assert written == 2

    cubes, observed_at = db.latest_discovery_cubes_for_item(conn, 1004811)
    assert cubes[2711000]["priceAt"] == "2026-08-16T15:09:00Z"  # most recent kept
    assert observed_at == "2026-08-16T15:09:05Z"
    conn.close()


def test_upsert_discovery_cube_price_points_is_idempotent_same_window(tmp_path: Path) -> None:
    """(c): the same (item_id, cube_item_id, price_at) written twice must
    not create a second row."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    point = [{"priceAt": "2026-08-16T15:09:00Z", "endAt": "2026-08-16T15:10:00Z", "price": 1.0, "step": "STEP_TYPE_DISCOVERY"}]
    db.upsert_discovery_cube_price_points(conn, 1004811, 2711000, point, "2026-08-16T15:09:05Z")
    db.upsert_discovery_cube_price_points(conn, 1004811, 2711000, point, "2026-08-16T15:14:05Z")  # re-poll, same window
    count = conn.execute(
        "SELECT COUNT(*) FROM sf_discovery_cube_price_history WHERE item_id=1004811 AND cube_item_id=2711000"
    ).fetchone()[0]
    assert count == 1
    conn.close()


def test_upsert_discovery_cube_price_points_never_touches_the_starforce_table(tmp_path: Path) -> None:
    """(b): writing cube rows must never insert into
    sf_discovery_price_history (the pre-existing, production-loaded table)."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    point = [{"priceAt": "2026-08-16T15:09:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"}]
    db.upsert_discovery_cube_price_points(conn, 1004811, 2711000, point, "2026-08-16T15:09:05Z")
    count = conn.execute("SELECT COUNT(*) FROM sf_discovery_price_history").fetchone()[0]
    assert count == 0
    conn.close()


def test_latest_discovery_cubes_for_item_empty_when_never_polled(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    cubes, observed_at = db.latest_discovery_cubes_for_item(conn, 1004811)
    assert cubes == {}
    assert observed_at is None
    conn.close()


def test_latest_discovery_cubes_for_item_key_order_is_ascending_cube_item_id(tmp_path: Path) -> None:
    """(j): the query is `ORDER BY cube_item_id`, so callers (app.py) never
    need to re-sort to get the deterministic "code order" plan §3 requires."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    for cube_item_id in (5062503, 2711000, 5062009):
        db.upsert_discovery_cube_price_points(
            conn, 1004811, cube_item_id,
            [{"priceAt": "2026-08-16T15:09:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"}],
            "2026-08-16T15:09:05Z",
        )
    cubes, _ = db.latest_discovery_cubes_for_item(conn, 1004811)
    assert list(cubes.keys()) == [2711000, 5062009, 5062503]
    conn.close()


def test_find_discovery_cube_transitions_for_item_returns_only_observed_flips(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    db.upsert_discovery_cube_price_points(
        conn, 1004811, 5062010,
        [
            {"priceAt": "2026-08-14T10:00:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"},
            {"priceAt": "2026-08-14T10:05:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_CHANGE"},
        ],
        "2026-08-14T10:05:05Z",
    )
    db.upsert_discovery_cube_price_points(
        conn, 1004811, 2711000,
        [{"priceAt": "2026-08-15T09:28:00Z", "endAt": None, "price": 1.0, "step": "STEP_TYPE_DISCOVERY"}],
        "2026-08-15T09:28:05Z",
    )
    transitions = db.find_discovery_cube_transitions_for_item(conn, 1004811)
    assert transitions == {5062010: ("2026-08-14T10:00:00Z", "2026-08-14T10:05:00Z")}  # 2711000 absent -- still DISCOVERY
    conn.close()


def test_find_discovery_cube_transitions_for_item_empty_when_never_polled(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    assert db.find_discovery_cube_transitions_for_item(conn, 999) == {}
    conn.close()


# --- list_visible_discovery_monitored_groups -- IMPL_PLAN_SH33 follow-up ----


def test_list_visible_includes_active_and_recently_deactivated(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn, representative_item_id=1004808, is_active=True, now="2026-08-15T00:00:00Z")
    _seed_group(conn, representative_item_id=1053063, is_active=False, now="2026-08-10T00:00:00Z")

    visible = db.list_visible_discovery_monitored_groups(conn, since_iso="2026-08-01T00:00:00Z")
    assert {g["itemId"] for g in visible} == {1004808, 1053063}
    conn.close()


def test_list_visible_excludes_a_group_deactivated_before_since_iso(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn, representative_item_id=1004808, is_active=True, now="2026-08-15T00:00:00Z")
    _seed_group(conn, representative_item_id=9999999, is_active=False, now="2026-01-01T00:00:00Z")

    visible = db.list_visible_discovery_monitored_groups(conn, since_iso="2026-08-01T00:00:00Z")
    assert {g["itemId"] for g in visible} == {1004808}
    conn.close()


def test_list_visible_still_never_shows_a_poll_target_to_component_b(tmp_path: Path) -> None:
    """list_active_discovery_monitored_groups (Component B's own poll-target
    list) is untouched by this addition -- a recently-deactivated group must
    NOT be polled again just because it is still visible in the equipment
    list."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    _seed_group(conn, representative_item_id=1053063, is_active=False, now="2026-08-10T00:00:00Z")
    assert db.list_active_discovery_monitored_groups(conn) == []
    assert len(db.list_visible_discovery_monitored_groups(conn, since_iso="2026-08-01T00:00:00Z")) == 1
    conn.close()
