from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import backfill
import db
import fetcher as fetcher_mod


ITEMS_2 = {
    "items": [
        {"itemId": 1001, "itemName": "A", "aliasItemIds": [1001]},
        {"itemId": 1002, "itemName": "B", "aliasItemIds": [1002]},
    ]
}


def _write_items(tmp_path: Path, payload: dict[str, Any] = ITEMS_2) -> Path:
    path = tmp_path / "items.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _points(n: int, *, start_hour: int = 0) -> list[dict[str, Any]]:
    return [
        {
            "date": f"2026-01-01T{(start_hour + i) % 24:02d}:00:00Z",
            "endPrice": 100.0 + i,
            "sumEnhanceCnt": 0,
        }
        for i in range(n)
    ]


def test_iter_combinations_covers_0_to_21_only() -> None:
    combos = backfill.iter_combinations(ITEMS_2["items"])
    assert len(combos) == 2 * 22
    upgrades_for_item = sorted(u for (item_id, u) in combos if item_id == 1001)
    assert upgrades_for_item == list(range(22))
    assert 22 not in upgrades_for_item


def test_backfill_limit_processes_only_that_many_and_writes_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        return 200, {"itemUpgrade": item_upgrade, "points": _points(3)}

    monkeypatch.setattr(backfill.fetcher_mod, "fetch_history_page", fake_fetch_history_page)

    result = backfill.run_backfill(db_path=db_path, items_path=items_path, limit=5, max_requests=700)

    assert result["processed"] == 5
    assert result["stop_reason"] is None

    conn = db.connect(db_path)
    assert db.count_progress_by_status(conn) == {"done": 5}
    assert db.count_hourly_rows(conn) == 5 * 3
    assert db.count_duplicate_hourly_rows(conn) == 0
    conn.close()


def test_backfill_resumability_second_run_only_fetches_remaining(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"

    call_count = {"n": 0}

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        call_count["n"] += 1
        return 200, {"itemUpgrade": item_upgrade, "points": _points(2)}

    monkeypatch.setattr(backfill.fetcher_mod, "fetch_history_page", fake_fetch_history_page)

    total_combos = len(backfill.iter_combinations(ITEMS_2["items"]))  # 44
    first_limit = 10
    result1 = backfill.run_backfill(db_path=db_path, items_path=items_path, limit=first_limit, max_requests=700)
    assert result1["processed"] == first_limit
    assert call_count["n"] == first_limit

    call_count["n"] = 0
    remaining = total_combos - first_limit
    result2 = backfill.run_backfill(db_path=db_path, items_path=items_path, limit=None, max_requests=700)
    assert result2["processed"] == remaining
    assert call_count["n"] == remaining  # exactly the "残り" count, plan §6(d)

    conn = db.connect(db_path)
    assert db.count_progress_by_status(conn) == {"done": total_combos}
    conn.close()


def test_backfill_records_error_status_on_non_200_and_continues(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        if item_upgrade == 0:
            return 500, None
        return 200, {"itemUpgrade": item_upgrade, "points": _points(1)}

    monkeypatch.setattr(backfill.fetcher_mod, "fetch_history_page", fake_fetch_history_page)

    # limit=3 -> pending combos are (1001,0), (1001,1), (1001,2); only upgrade=0 fails.
    result = backfill.run_backfill(db_path=db_path, items_path=items_path, limit=3, max_requests=700)
    assert result["processed"] == 3
    assert len(result["combo_errors"]) == 1
    assert result["combo_errors"][0] == {"itemId": 1001, "itemUpgrade": 0, "httpStatus": 500}

    conn = db.connect(db_path)
    statuses = db.count_progress_by_status(conn)
    assert statuses == {"error": 1, "done": 2}
    conn.close()


def test_backfill_raises_on_null_end_price(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        return 200, {"itemUpgrade": item_upgrade, "points": [{"date": "2026-01-01T00:00:00Z", "endPrice": None, "sumEnhanceCnt": 0}]}

    monkeypatch.setattr(backfill.fetcher_mod, "fetch_history_page", fake_fetch_history_page)

    with pytest.raises(backfill.BadEndPriceError):
        backfill.run_backfill(db_path=db_path, items_path=items_path, limit=1, max_requests=700)


def test_backfill_raises_on_negative_end_price(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"

    def fake_fetch_history_page(_ftr, item_id, *, item_upgrade, window_days, note=""):
        return 200, {"itemUpgrade": item_upgrade, "points": [{"date": "2026-01-01T00:00:00Z", "endPrice": -1.0, "sumEnhanceCnt": 0}]}

    monkeypatch.setattr(backfill.fetcher_mod, "fetch_history_page", fake_fetch_history_page)

    with pytest.raises(backfill.BadEndPriceError):
        backfill.run_backfill(db_path=db_path, items_path=items_path, limit=1, max_requests=700)


def test_backfill_stops_on_consecutive_429_and_marks_no_progress_for_that_combo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"

    def raising_fetch(_ftr, item_id, *, item_upgrade, window_days, note=""):
        raise fetcher_mod.ConsecutiveTooManyRequestsError("3 consecutive 429s")

    monkeypatch.setattr(backfill.fetcher_mod, "fetch_history_page", raising_fetch)

    result = backfill.run_backfill(db_path=db_path, items_path=items_path, limit=3, max_requests=700)
    assert result["stop_reason"] is not None
    assert "ConsecutiveTooManyRequestsError" in result["stop_reason"]
    assert result["processed"] == 0

    conn = db.connect(db_path)
    assert db.count_progress_by_status(conn) == {}
    conn.close()
