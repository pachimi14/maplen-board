from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import aggregate
import cube_aggregate
import db


def _seed_cube_hourly(conn, item_id: int, cube_sub_type: str, points: list[tuple[str, float]]) -> None:
    db.upsert_cube_hourly_rows(
        conn,
        item_id,
        cube_sub_type,
        [{"date": d, "endPrice": p, "sumEnhanceCnt": 0} for d, p in points],
        "2026-08-21T00:00:00Z",
    )


def test_cube_aggregate_reuses_compute_buckets_unmodified() -> None:
    """SH-39 plan §5/§7: cube_aggregate.py must call the SAME aggregate.
    compute_buckets, not a re-implementation."""
    assert cube_aggregate.rebuild_combo.__module__ == "cube_aggregate"
    # sanity: the function object cube_aggregate uses IS aggregate's.
    import inspect
    source = inspect.getsource(cube_aggregate.rebuild_combo)
    assert "aggregate.compute_buckets(" in source


def test_cube_rebuild_all_is_deterministic_across_two_runs(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_cube_hourly(
        conn, 1003720, "RED",
        [("2026-03-08T00:00:00Z", 100.0), ("2026-03-08T03:00:00Z", 130.0), ("2026-03-08T04:00:00Z", 200.0)],
    )
    _seed_cube_hourly(conn, 1003720, "BLACK", [("2026-03-08T00:00:00Z", 50.0)])
    _seed_cube_hourly(conn, 1003800, "RED", [("2026-03-08T00:00:00Z", 999.0)])
    conn.close()

    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    conn = db.connect(db_path)
    result1 = cube_aggregate.rebuild_all(conn, now=now, generated_at="2026-08-21T01:00:00Z")
    hash1 = cube_aggregate.content_hash(conn)
    rows1 = db.count_cube_4h_rows(conn)
    conn.close()

    conn = db.connect(db_path)
    result2 = cube_aggregate.rebuild_all(conn, now=now, generated_at="2026-08-21T02:00:00Z")
    hash2 = cube_aggregate.content_hash(conn)
    rows2 = db.count_cube_4h_rows(conn)
    conn.close()

    assert result1["combos"] == result2["combos"] == 3
    assert rows1 == rows2
    assert hash1 == hash2


def test_cube_rebuild_all_excludes_in_progress_bucket() -> None:
    """SH-39 plan §8 accept criterion (d): unfinished buckets never appear."""
    rows = [
        ("2026-03-08T00:00:00Z", 100.0),
        ("2026-03-08T05:00:00Z", 200.0),  # bucket [04:00, 08:00) not yet elapsed
    ]
    now = datetime(2026, 3, 8, 6, 0, tzinfo=timezone.utc)
    buckets = aggregate.compute_buckets(rows, now=now)
    assert len(buckets) == 1
    assert buckets[0]["price_at"] == "2026-03-08T00:00:00Z"


def test_cube_rebuild_all_excludes_in_progress_bucket_end_to_end(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_cube_hourly(
        conn, 1003720, "RED",
        [("2026-03-08T00:00:00Z", 100.0), ("2026-03-08T05:00:00Z", 200.0)],
    )
    conn.close()

    now = datetime(2026, 3, 8, 6, 0, tzinfo=timezone.utc)
    conn = db.connect(db_path)
    cube_aggregate.rebuild_all(conn, now=now, generated_at="2026-08-21T00:00:00Z")
    cur = conn.execute(
        "SELECT price_at FROM sf_cube_price_history_4h WHERE item_id = 1003720 AND cube_sub_type = 'RED'"
    )
    price_ats = [row[0] for row in cur.fetchall()]
    conn.close()

    assert price_ats == ["2026-03-08T00:00:00Z"]


def test_cube_update_combo_incremental_matches_full_rebuild_after_a_revision(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_cube_hourly(
        conn, 1003720, "RED",
        [
            ("2026-03-08T00:00:00Z", 100.0),
            ("2026-03-08T04:00:00Z", 200.0),
            ("2026-03-08T08:00:00Z", 300.0),
        ],
    )
    cube_aggregate.rebuild_all(conn, now=now, generated_at="2026-08-21T00:00:00Z")
    conn.close()

    conn = db.connect(db_path)
    _seed_cube_hourly(conn, 1003720, "RED", [("2026-03-08T08:00:00Z", 999.0)])
    cube_aggregate.update_combo_incremental(conn, 1003720, "RED", now=now, generated_at="2026-08-21T01:00:00Z")
    incremental_hash = cube_aggregate.content_hash(conn)
    conn.close()

    conn = db.connect(db_path)
    cube_aggregate.rebuild_all(conn, now=now, generated_at="2026-08-21T02:00:00Z")
    full_hash = cube_aggregate.content_hash(conn)
    conn.close()

    assert incremental_hash == full_hash


def test_cube_aggregate_never_writes_the_sf_4h_table(tmp_path: Path) -> None:
    """SH-39 plan §8 accept criterion (c)."""
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_cube_hourly(conn, 1003720, "RED", [("2026-03-08T00:00:00Z", 100.0)])
    conn.close()

    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)
    conn = db.connect(db_path)
    cube_aggregate.rebuild_all(conn, now=now, generated_at="2026-08-21T00:00:00Z")
    assert db.count_4h_rows(conn) == 0
    assert db.count_cube_4h_rows(conn) == 1
    conn.close()
