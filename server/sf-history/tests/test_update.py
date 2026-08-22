from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import aggregate
import db
import update


ITEMS_1 = {"items": [{"itemId": 1001, "itemName": "A", "aliasItemIds": [1001]}]}


def _write_items(tmp_path: Path, payload: dict[str, Any] = ITEMS_1) -> Path:
    path = tmp_path / "items.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_iter_combinations_covers_0_to_21_only() -> None:
    combos = update.iter_combinations(ITEMS_1["items"])
    assert len(combos) == 22
    assert sorted(u for (_id, u) in combos) == list(range(22))


def test_update_fetches_all_combos_and_upserts_and_reaggregates(
    tmp_path: Path, monkeypatch
) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    # Seed one combo with pre-existing hourly + 4h data (as if SH-2's backfill
    # + a prior rebuild had already run).
    conn = db.connect(db_path)
    db.apply_schema(conn)
    db.upsert_hourly_rows(
        conn, 1001, 0,
        [{"date": "2026-03-08T00:00:00Z", "endPrice": 100.0, "sumEnhanceCnt": 0}],
        "2026-08-05T00:00:00Z",
    )
    aggregate.rebuild_all(conn, now=now, generated_at="2026-08-05T00:00:00Z")
    conn.close()

    calls: list[dict[str, Any]] = []

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        calls.append({"itemId": item_id, "itemUpgrade": item_upgrade, "windowDays": window_days})
        # Simulate the upstream returning one new point per combo, 4h after "now".
        return 200, {
            "itemUpgrade": item_upgrade,
            "points": [{"date": "2026-03-08T04:00:00Z", "endPrice": 111.0, "sumEnhanceCnt": 0}],
        }

    monkeypatch.setattr(update.fetcher_mod, "fetch_history_page", fake_fetch_history_page)

    result = update.run_update(db_path=db_path, items_path=items_path, now=now)

    assert result["combos"] == 22
    assert result["fetchedOk"] == 22
    assert result["fetchedError"] == 0
    assert result["stopReason"] is None
    assert len(calls) == 22

    conn = db.connect(db_path)
    rows = db.four_h_rows_for_item(conn, 1001)
    conn.close()
    upgrade0_rows = [r for r in rows if r[0] == 0]
    assert ("2026-03-08T00:00:00Z" in [r[1] for r in upgrade0_rows])
    assert ("2026-03-08T04:00:00Z" in [r[1] for r in upgrade0_rows])


def test_update_matches_full_rebuild_at_the_same_point(tmp_path: Path, monkeypatch) -> None:
    """plan §6: incremental result must equal a full re-rebuild at the same point."""
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    conn = db.connect(db_path)
    db.apply_schema(conn)
    db.upsert_hourly_rows(
        conn, 1001, 0,
        [
            {"date": "2026-03-08T00:00:00Z", "endPrice": 100.0, "sumEnhanceCnt": 0},
            {"date": "2026-03-08T04:00:00Z", "endPrice": 200.0, "sumEnhanceCnt": 0},
        ],
        "2026-08-05T00:00:00Z",
    )
    aggregate.rebuild_all(conn, now=now, generated_at="2026-08-05T00:00:00Z")
    conn.close()

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        # Upstream revises the most recent bucket's source value.
        return 200, {
            "itemUpgrade": item_upgrade,
            "points": [{"date": "2026-03-08T04:00:00Z", "endPrice": 250.0, "sumEnhanceCnt": 0}],
        }

    monkeypatch.setattr(update.fetcher_mod, "fetch_history_page", fake_fetch_history_page)
    update.run_update(db_path=db_path, items_path=items_path, now=now)

    conn = db.connect(db_path)
    incremental_hash = aggregate.content_hash(conn)
    conn.close()

    conn = db.connect(db_path)
    aggregate.rebuild_all(conn, now=now, generated_at="full-rebuild-check")
    full_hash = aggregate.content_hash(conn)
    conn.close()

    assert incremental_hash == full_hash


def test_update_records_error_and_continues(tmp_path: Path, monkeypatch) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        if item_upgrade == 0:
            return 500, None
        return 200, {"itemUpgrade": item_upgrade, "points": []}

    monkeypatch.setattr(update.fetcher_mod, "fetch_history_page", fake_fetch_history_page)
    result = update.run_update(db_path=db_path, items_path=items_path, now=now)

    assert result["fetchedError"] == 1
    assert result["fetchedOk"] == 21
    assert result["comboErrors"] == [{"itemId": 1001, "itemUpgrade": 0, "httpStatus": 500}]


def test_update_stops_on_consecutive_429(tmp_path: Path, monkeypatch) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    def raising_fetch(_ftr, item_id, *, item_upgrade, window_days, note=""):
        raise update.fetcher_mod.ConsecutiveTooManyRequestsError("3 consecutive 429s")

    monkeypatch.setattr(update.fetcher_mod, "fetch_history_page", raising_fetch)
    result = update.run_update(db_path=db_path, items_path=items_path, now=now)

    assert result["stopReason"] is not None
    assert "ConsecutiveTooManyRequestsError" in result["stopReason"]


# --- IMPL_PLAN_SH39 §6 (D): CUBE differential update, layered onto the same
# 4-hourly timer, SF first / CUBE second, CUBE failure never blocks SF.


def test_iter_cube_combinations_is_items_times_four_sub_types() -> None:
    combos = update.iter_cube_combinations(ITEMS_1["items"])
    assert len(combos) == 4
    assert sorted(st for (_id, st) in combos) == sorted(update.cube.CUBE_SUB_TYPES)


def test_run_cube_update_fetches_all_combos_and_upserts_and_reaggregates(
    tmp_path: Path, monkeypatch
) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    conn = db.connect(db_path)
    db.apply_schema(conn)
    db.upsert_cube_hourly_rows(
        conn, 1001, "RED",
        [{"date": "2026-03-08T00:00:00Z", "endPrice": 100.0, "sumEnhanceCnt": 0}],
        "2026-08-05T00:00:00Z",
    )
    conn.close()

    calls: list[dict[str, Any]] = []

    def fake_fetch_prospective_history_page(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        calls.append({"itemId": item_id, "cubeSubType": cube_sub_type, "windowDays": window_days})
        return 200, {"points": [{"date": "2026-03-08T04:00:00Z", "endPrice": 111.0, "sumEnhanceCnt": 0}]}

    monkeypatch.setattr(update.fetcher_mod, "fetch_prospective_history_page", fake_fetch_prospective_history_page)

    result = update.run_cube_update(db_path=db_path, items_path=items_path, now=now)

    assert result["combos"] == 4
    assert result["fetchedOk"] == 4
    assert result["fetchedError"] == 0
    assert result["stopReason"] is None
    assert len(calls) == 4

    conn = db.connect(db_path)
    cur = conn.execute(
        "SELECT price_at FROM sf_cube_price_history_4h WHERE item_id = 1001 AND cube_sub_type = 'RED' ORDER BY price_at"
    )
    price_ats = [row[0] for row in cur.fetchall()]
    conn.close()
    assert price_ats == ["2026-03-08T00:00:00Z", "2026-03-08T04:00:00Z"]


def test_run_all_runs_sf_before_cube_and_cube_failure_never_blocks_sf_completion(
    tmp_path: Path, monkeypatch
) -> None:
    """SH-39 plan §8 accept criterion (f)."""
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    call_order: list[str] = []

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        call_order.append("sf")
        return 200, {"itemUpgrade": item_upgrade, "points": [{"date": "2026-03-08T00:00:00Z", "endPrice": 1.0, "sumEnhanceCnt": 0}]}

    def raising_fetch_prospective(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        call_order.append("cube")
        raise RuntimeError("boom -- unexpected cube-side failure")

    monkeypatch.setattr(update.fetcher_mod, "fetch_history_page", fake_fetch_history_page)
    monkeypatch.setattr(update.fetcher_mod, "fetch_prospective_history_page", raising_fetch_prospective)

    combined = update.run_all(db_path=db_path, items_path=items_path, now=now)

    # SF ran to completion (its own result is fully populated) BEFORE any cube call fired.
    assert combined["sf"]["fetchedOk"] == 22
    assert combined["sf"]["stopReason"] is None
    assert combined["cube"] is None
    assert "boom" in combined["cubeError"]
    assert call_order[:22] == ["sf"] * 22  # every SF call precedes the first cube call
    assert call_order[22] == "cube"

    # And SF's writes are real / committed, not rolled back by the cube exception.
    conn = db.connect(db_path)
    rows = db.four_h_rows_for_item(conn, 1001)
    conn.close()
    assert len(rows) > 0


def test_run_all_reports_cube_result_when_cube_succeeds(tmp_path: Path, monkeypatch) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        return 200, {"itemUpgrade": item_upgrade, "points": []}

    def fake_fetch_prospective(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        return 200, {"points": []}

    monkeypatch.setattr(update.fetcher_mod, "fetch_history_page", fake_fetch_history_page)
    monkeypatch.setattr(update.fetcher_mod, "fetch_prospective_history_page", fake_fetch_prospective)

    combined = update.run_all(db_path=db_path, items_path=items_path, now=now)

    assert combined["cube"] is not None
    assert combined["cube"]["fetchedOk"] == 4
    assert combined["cubeError"] is None


def test_cube_update_never_writes_the_sf_tables(tmp_path: Path, monkeypatch) -> None:
    """SH-39 plan §8 accept criterion (c)."""
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    def fake_fetch_prospective(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        return 200, {"points": [{"date": "2026-03-08T00:00:00Z", "endPrice": 1.0, "sumEnhanceCnt": 0}]}

    monkeypatch.setattr(update.fetcher_mod, "fetch_prospective_history_page", fake_fetch_prospective)
    update.run_cube_update(db_path=db_path, items_path=items_path, now=now)

    conn = db.connect(db_path)
    assert db.count_hourly_rows(conn) == 0
    assert db.count_4h_rows(conn) == 0
    assert db.count_cube_hourly_rows(conn) > 0
    conn.close()


def test_window_start_is_8h_before_last_saved_or_before_now_if_never_fetched(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)
    conn = db.connect(db_path)
    db.apply_schema(conn)
    db.upsert_hourly_rows(
        conn, 1, 0,
        [{"date": "2026-03-08T20:00:00Z", "endPrice": 1.0, "sumEnhanceCnt": 0}],
        "2026-08-05T00:00:00Z",
    )

    assert update._window_start(conn, 1, 0, now=now) == aggregate.parse_iso_utc("2026-03-08T12:00:00Z")
    assert update._window_start(conn, 999, 0, now=now) == now - timedelta(hours=8)
    conn.close()
