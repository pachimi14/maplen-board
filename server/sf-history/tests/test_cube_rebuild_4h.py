from __future__ import annotations

from pathlib import Path

import db
import cube_rebuild_4h


def _seed(db_path: Path) -> None:
    conn = db.connect(db_path)
    db.apply_schema(conn)
    db.upsert_cube_hourly_rows(
        conn, 1003720, "RED",
        [
            {"date": "2026-03-08T00:00:00Z", "endPrice": 100.0, "sumEnhanceCnt": 0},
            {"date": "2026-03-08T04:00:00Z", "endPrice": 200.0, "sumEnhanceCnt": 0},
        ],
        "2026-08-21T00:00:00Z",
    )
    conn.close()


def test_run_rebuild_writes_rows_and_reports_content_hash(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    _seed(db_path)

    result = cube_rebuild_4h.run_rebuild(
        db_path, now=cube_rebuild_4h.aggregate.parse_iso_utc("2026-03-09T00:00:00Z")
    )

    assert result["combos"] == 1
    assert result["rowsWritten"] == 2
    assert result["rowsInTable"] == result["rowsWritten"]
    assert len(result["contentHash"]) == 64  # sha256 hex digest


def test_run_rebuild_twice_is_deterministic(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    _seed(db_path)
    now = cube_rebuild_4h.aggregate.parse_iso_utc("2026-03-09T00:00:00Z")

    result1 = cube_rebuild_4h.run_rebuild(db_path, now=now)
    result2 = cube_rebuild_4h.run_rebuild(db_path, now=now)

    assert result1["rowsInTable"] == result2["rowsInTable"]
    assert result1["contentHash"] == result2["contentHash"]


def test_run_rebuild_never_touches_the_sf_4h_table(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    _seed(db_path)
    now = cube_rebuild_4h.aggregate.parse_iso_utc("2026-03-09T00:00:00Z")

    cube_rebuild_4h.run_rebuild(db_path, now=now)

    conn = db.connect(db_path)
    assert db.count_4h_rows(conn) == 0
    conn.close()
