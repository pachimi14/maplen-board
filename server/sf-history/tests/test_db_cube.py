from __future__ import annotations

from pathlib import Path

import db


def _points(n: int, *, start_hour: int = 0) -> list[dict]:
    return [
        {
            "date": f"2026-01-01T{(start_hour + i) % 24:02d}:00:00Z",
            "endPrice": 1000.0 + i,
            "sumEnhanceCnt": 0,
        }
        for i in range(n)
    ]


def test_upsert_and_count_cube_hourly_rows(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    written = db.upsert_cube_hourly_rows(conn, 1003720, "RED", _points(3), "2026-08-21T00:00:00Z")
    assert written == 3
    assert db.count_cube_hourly_rows(conn) == 3
    assert db.count_duplicate_cube_hourly_rows(conn) == 0
    conn.close()


def test_upsert_cube_hourly_rows_upserts_not_duplicates(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    db.upsert_cube_hourly_rows(conn, 1003720, "RED", _points(2), "2026-08-21T00:00:00Z")
    db.upsert_cube_hourly_rows(conn, 1003720, "RED", _points(2), "2026-08-21T01:00:00Z")
    assert db.count_cube_hourly_rows(conn) == 2
    assert db.count_duplicate_cube_hourly_rows(conn) == 0
    conn.close()


def test_cube_series_key_is_independent_per_sub_type(tmp_path: Path) -> None:
    """(item_id, cube_sub_type, price_at) -- two sub-types of the same item at
    the same price_at are two distinct rows, not a collision."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    db.upsert_cube_hourly_rows(conn, 1003720, "RED", _points(1), "2026-08-21T00:00:00Z")
    db.upsert_cube_hourly_rows(conn, 1003720, "BLACK", _points(1), "2026-08-21T00:00:00Z")
    assert db.count_cube_hourly_rows(conn) == 2
    conn.close()


def test_record_and_load_done_cube_combinations(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    db.record_cube_progress(
        conn, 1003720, "RED",
        status="done", row_count=3, oldest_at="2026-08-01T00:00:00Z",
        newest_at="2026-08-21T00:00:00Z", updated_at="2026-08-21T00:00:00Z",
    )
    db.record_cube_progress(
        conn, 1003720, "BLACK",
        status="error", row_count=0, oldest_at=None, newest_at=None,
        updated_at="2026-08-21T00:00:00Z", note="http_status=500",
    )

    done = db.load_done_cube_combinations(conn)
    assert done == {(1003720, "RED")}
    assert db.count_progress_by_status_cube(conn) == {"done": 1, "error": 1}
    errors = db.list_error_cube_combinations(conn)
    assert errors == [
        {"itemId": 1003720, "cubeSubType": "BLACK", "note": "http_status=500", "updatedAt": "2026-08-21T00:00:00Z"}
    ]
    conn.close()


def test_record_cube_progress_rejects_bad_status(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)
    try:
        raised = False
        try:
            db.record_cube_progress(
                conn, 1, "RED", status="bogus", row_count=0,
                oldest_at=None, newest_at=None, updated_at="2026-08-21T00:00:00Z",
            )
        except ValueError:
            raised = True
        assert raised
    finally:
        conn.close()


def test_cube_writes_never_touch_the_sf_tables(tmp_path: Path) -> None:
    """SH-39 plan §8 accept criterion (c): the CUBE processing must never
    write to sf_price_history_hourly / sf_price_history_4h /
    sf_history_backfill_progress -- verified here by writing a bunch of
    CUBE rows/progress and asserting the SF tables stay at row count 0."""
    conn = db.connect(tmp_path / "x.sqlite")
    db.apply_schema(conn)

    for item_id in (1003720, 1003800):
        for cube_sub_type in ("RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"):
            db.upsert_cube_hourly_rows(conn, item_id, cube_sub_type, _points(2), "2026-08-21T00:00:00Z")
            db.record_cube_progress(
                conn, item_id, cube_sub_type,
                status="done", row_count=2, oldest_at="2026-08-21T00:00:00Z",
                newest_at="2026-08-21T01:00:00Z", updated_at="2026-08-21T00:00:00Z",
            )

    assert db.count_hourly_rows(conn) == 0
    assert db.count_progress_by_status(conn) == {}
    cur = conn.execute("SELECT COUNT(*) FROM sf_price_history_4h")
    assert cur.fetchone()[0] == 0

    # And the CUBE side really did get written (sanity: this isn't a no-op test).
    assert db.count_cube_hourly_rows(conn) == 2 * 4 * 2
    assert db.count_progress_by_status_cube(conn) == {"done": 8}
    conn.close()
