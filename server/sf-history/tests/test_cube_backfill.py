from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import cube
import cube_backfill
import db
import fetcher as fetcher_mod


ITEMS_2 = {
    "items": [
        {"itemId": 1001, "itemName": "A", "aliasItemIds": [1001]},
        {"itemId": 1002, "itemName": "B", "aliasItemIds": [1002]},
    ]
}

ITEMS_34 = {"items": [{"itemId": 2000 + i, "itemName": f"Item{i}"} for i in range(34)]}


def _write_items(tmp_path: Path, payload: dict[str, Any]) -> Path:
    path = tmp_path / "items.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _points(n: int, *, start_hour: int = 0) -> list[dict[str, Any]]:
    return [
        {
            "date": f"2026-01-01T{(start_hour + i) % 24:02d}:00:00Z",
            "endPrice": 1000.0 + i,
            "sumEnhanceCnt": 0,
        }
        for i in range(n)
    ]


def test_iter_combinations_covers_exactly_the_four_cube_sub_types() -> None:
    combos = cube_backfill.iter_combinations(ITEMS_2["items"])
    assert len(combos) == 2 * 4
    sub_types_for_item = sorted(st for (item_id, st) in combos if item_id == 1001)
    assert sub_types_for_item == sorted(cube.CUBE_SUB_TYPES)


def test_iter_combinations_is_136_for_34_items_x_4_sub_types() -> None:
    """SH-39 plan §8 accept criterion (b): 34 x 4 = 136."""
    combos = cube_backfill.iter_combinations(ITEMS_34["items"])
    assert len(combos) == 136


def test_cube_backfill_limit_processes_only_that_many_and_writes_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path, ITEMS_2)
    db_path = tmp_path / "x.sqlite"

    def fake_fetch(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        return 200, {"points": _points(3)}

    monkeypatch.setattr(cube_backfill.fetcher_mod, "fetch_prospective_history_page", fake_fetch)

    result = cube_backfill.run_cube_backfill(db_path=db_path, items_path=items_path, limit=5, max_requests=700)

    assert result["processed"] == 5
    assert result["stop_reason"] is None

    conn = db.connect(db_path)
    assert db.count_progress_by_status_cube(conn) == {"done": 5}
    assert db.count_cube_hourly_rows(conn) == 5 * 3
    assert db.count_duplicate_cube_hourly_rows(conn) == 0
    conn.close()


def test_cube_backfill_resumability_second_run_only_fetches_remaining(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path, ITEMS_2)
    db_path = tmp_path / "x.sqlite"

    call_count = {"n": 0}

    def fake_fetch(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        call_count["n"] += 1
        return 200, {"points": _points(2)}

    monkeypatch.setattr(cube_backfill.fetcher_mod, "fetch_prospective_history_page", fake_fetch)

    total_combos = len(cube_backfill.iter_combinations(ITEMS_2["items"]))  # 8
    first_limit = 3
    result1 = cube_backfill.run_cube_backfill(db_path=db_path, items_path=items_path, limit=first_limit, max_requests=700)
    assert result1["processed"] == first_limit
    assert call_count["n"] == first_limit

    call_count["n"] = 0
    remaining = total_combos - first_limit
    result2 = cube_backfill.run_cube_backfill(db_path=db_path, items_path=items_path, limit=None, max_requests=700)
    assert result2["processed"] == remaining
    assert call_count["n"] == remaining

    conn = db.connect(db_path)
    assert db.count_progress_by_status_cube(conn) == {"done": total_combos}
    conn.close()


def test_cube_backfill_records_error_status_on_non_200_and_continues(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path, ITEMS_2)
    db_path = tmp_path / "x.sqlite"

    def fake_fetch(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        if cube_sub_type == "RED":
            return 500, None
        return 200, {"points": _points(1)}

    monkeypatch.setattr(cube_backfill.fetcher_mod, "fetch_prospective_history_page", fake_fetch)

    # limit=4 -> pending combos for item 1001 across the 4 sub-types.
    result = cube_backfill.run_cube_backfill(db_path=db_path, items_path=items_path, limit=4, max_requests=700)
    assert result["processed"] == 4
    assert len(result["combo_errors"]) == 1
    assert result["combo_errors"][0] == {"itemId": 1001, "cubeSubType": "RED", "httpStatus": 500}

    conn = db.connect(db_path)
    statuses = db.count_progress_by_status_cube(conn)
    assert statuses == {"error": 1, "done": 3}
    conn.close()


def test_cube_backfill_raises_on_null_end_price(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    items_path = _write_items(tmp_path, ITEMS_2)
    db_path = tmp_path / "x.sqlite"

    def fake_fetch(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        return 200, {"points": [{"date": "2026-01-01T00:00:00Z", "endPrice": None, "sumEnhanceCnt": 0}]}

    monkeypatch.setattr(cube_backfill.fetcher_mod, "fetch_prospective_history_page", fake_fetch)

    with pytest.raises(cube_backfill.BadEndPriceError):
        cube_backfill.run_cube_backfill(db_path=db_path, items_path=items_path, limit=1, max_requests=700)


def test_cube_backfill_stops_on_consecutive_429_and_marks_no_progress_for_that_combo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path, ITEMS_2)
    db_path = tmp_path / "x.sqlite"

    def raising_fetch(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        raise fetcher_mod.ConsecutiveTooManyRequestsError("3 consecutive 429s")

    monkeypatch.setattr(cube_backfill.fetcher_mod, "fetch_prospective_history_page", raising_fetch)

    result = cube_backfill.run_cube_backfill(db_path=db_path, items_path=items_path, limit=3, max_requests=700)
    assert result["stop_reason"] is not None
    assert "ConsecutiveTooManyRequestsError" in result["stop_reason"]
    assert result["processed"] == 0

    conn = db.connect(db_path)
    assert db.count_progress_by_status_cube(conn) == {}
    conn.close()


def test_cube_backfill_never_writes_the_sf_tables(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """SH-39 plan §8 accept criterion (c)."""
    items_path = _write_items(tmp_path, ITEMS_2)
    db_path = tmp_path / "x.sqlite"

    def fake_fetch(_ftr, item_id, *, cube_sub_type, window_days, note=""):
        return 200, {"points": _points(2)}

    monkeypatch.setattr(cube_backfill.fetcher_mod, "fetch_prospective_history_page", fake_fetch)
    cube_backfill.run_cube_backfill(db_path=db_path, items_path=items_path, limit=None, max_requests=700)

    conn = db.connect(db_path)
    assert db.count_hourly_rows(conn) == 0
    assert db.count_progress_by_status(conn) == {}
    assert db.count_cube_hourly_rows(conn) > 0
    conn.close()
