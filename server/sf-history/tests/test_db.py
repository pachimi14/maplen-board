from __future__ import annotations

from pathlib import Path

import db


def _make_points(dates: list[str], *, upgrade: int) -> list[dict]:
    return [
        {
            "date": d,
            "step": upgrade,
            "avgPrice": 100.0,
            "maxPrice": 110.0,
            "minPrice": 90.0,
            "endPrice": 1000.0 + i,
            "sumEnhanceCnt": 0,
        }
        for i, d in enumerate(dates)
    ]


def test_apply_schema_is_idempotent(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    db.apply_schema(conn)  # must not raise
    assert db.count_hourly_rows(conn) == 0
    conn.close()


def test_upsert_and_read_back(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    points = _make_points(["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"], upgrade=5)
    written = db.upsert_hourly_rows(conn, 111, 5, points, "2026-08-05T00:00:00Z")
    assert written == 2
    assert db.count_hourly_rows(conn) == 2
    assert db.count_duplicate_hourly_rows(conn) == 0

    row = conn.execute(
        "SELECT end_price, sum_enhance_count FROM sf_price_history_hourly "
        "WHERE item_id=111 AND item_upgrade=5 AND price_at='2026-01-01T00:00:00Z'"
    ).fetchone()
    assert row == (1000.0, 0)
    conn.close()


def test_upsert_is_conflict_safe_and_updates_in_place(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    points = _make_points(["2026-01-01T00:00:00Z"], upgrade=0)
    db.upsert_hourly_rows(conn, 1, 0, points, "2026-08-05T00:00:00Z")

    # Re-fetch with a revised endPrice for the same key -- must overwrite, not duplicate.
    revised = [{**points[0], "endPrice": 9999.0}]
    db.upsert_hourly_rows(conn, 1, 0, revised, "2026-08-05T01:00:00Z")

    assert db.count_hourly_rows(conn) == 1
    assert db.count_duplicate_hourly_rows(conn) == 0
    row = conn.execute(
        "SELECT end_price FROM sf_price_history_hourly WHERE item_id=1 AND item_upgrade=0"
    ).fetchone()
    assert row == (9999.0,)
    conn.close()


def test_progress_round_trip(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    db.record_progress(
        conn, 1, 0, status="done", row_count=10,
        oldest_at="2026-01-01T00:00:00Z", newest_at="2026-08-01T00:00:00Z",
        updated_at="2026-08-05T00:00:00Z",
    )
    db.record_progress(
        conn, 1, 1, status="error", row_count=0,
        oldest_at=None, newest_at=None, updated_at="2026-08-05T00:00:00Z",
        note="http_status=500",
    )

    assert db.load_done_combinations(conn) == {(1, 0)}
    assert db.count_progress_by_status(conn) == {"done": 1, "error": 1}
    errors = db.list_error_combinations(conn)
    assert errors == [{"itemId": 1, "itemUpgrade": 1, "note": "http_status=500", "updatedAt": "2026-08-05T00:00:00Z"}]
    conn.close()


def test_progress_upsert_overwrites_status(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    db.record_progress(
        conn, 5, 3, status="error", row_count=0,
        oldest_at=None, newest_at=None, updated_at="2026-08-05T00:00:00Z",
        note="http_status=500",
    )
    assert db.load_done_combinations(conn) == set()

    db.record_progress(
        conn, 5, 3, status="done", row_count=100,
        oldest_at="a", newest_at="b", updated_at="2026-08-05T01:00:00Z",
    )
    assert db.load_done_combinations(conn) == {(5, 3)}
    conn.close()
