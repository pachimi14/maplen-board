from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import aggregate
import db


def _seed_hourly(conn, item_id: int, item_upgrade: int, points: list[tuple[str, float]]) -> None:
    db.upsert_hourly_rows(
        conn,
        item_id,
        item_upgrade,
        [{"date": d, "endPrice": p, "sumEnhanceCnt": 0} for d, p in points],
        "2026-08-05T00:00:00Z",
    )


def test_bucket_start_floors_to_4h_boundaries() -> None:
    assert aggregate.bucket_start("2026-03-08T00:00:00Z") == "2026-03-08T00:00:00Z"
    assert aggregate.bucket_start("2026-03-08T03:59:00Z") == "2026-03-08T00:00:00Z"
    assert aggregate.bucket_start("2026-03-08T04:00:00Z") == "2026-03-08T04:00:00Z"
    assert aggregate.bucket_start("2026-03-08T23:00:00Z") == "2026-03-08T20:00:00Z"


def test_bucket_end_is_start_plus_4h_and_rolls_over_midnight() -> None:
    assert aggregate.bucket_end("2026-03-08T20:00:00Z") == "2026-03-09T00:00:00Z"
    assert aggregate.bucket_end("2026-03-08T00:00:00Z") == "2026-03-08T04:00:00Z"


def test_compute_buckets_picks_last_hourly_row_in_bucket() -> None:
    rows = [
        ("2026-03-08T00:00:00Z", 100.0),
        ("2026-03-08T01:00:00Z", 110.0),
        ("2026-03-08T03:00:00Z", 130.0),  # last in [00:00, 04:00) -- must win
        ("2026-03-08T04:00:00Z", 200.0),
    ]
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)  # both buckets fully elapsed
    buckets = aggregate.compute_buckets(rows, now=now)

    assert buckets == [
        {"price_at": "2026-03-08T00:00:00Z", "end_price": 130.0, "source_hour_at": "2026-03-08T03:00:00Z"},
        {"price_at": "2026-03-08T04:00:00Z", "end_price": 200.0, "source_hour_at": "2026-03-08T04:00:00Z"},
    ]


def test_compute_buckets_excludes_in_progress_bucket() -> None:
    rows = [
        ("2026-03-08T00:00:00Z", 100.0),
        ("2026-03-08T05:00:00Z", 200.0),  # bucket [04:00, 08:00) not yet elapsed
    ]
    now = datetime(2026, 3, 8, 6, 0, tzinfo=timezone.utc)  # inside the second bucket's window
    buckets = aggregate.compute_buckets(rows, now=now)

    assert len(buckets) == 1
    assert buckets[0]["price_at"] == "2026-03-08T00:00:00Z"


def test_compute_buckets_boundary_now_exactly_at_bucket_end_is_complete() -> None:
    rows = [("2026-03-08T00:00:00Z", 100.0)]
    now = datetime(2026, 3, 8, 4, 0, tzinfo=timezone.utc)  # exactly bucket_end
    buckets = aggregate.compute_buckets(rows, now=now)
    assert len(buckets) == 1  # >= bucket_end means the window has fully elapsed


def test_rebuild_all_is_deterministic_across_two_runs(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_hourly(
        conn, 1, 0,
        [("2026-03-08T00:00:00Z", 100.0), ("2026-03-08T03:00:00Z", 130.0), ("2026-03-08T04:00:00Z", 200.0)],
    )
    _seed_hourly(conn, 1, 1, [("2026-03-08T00:00:00Z", 50.0)])
    _seed_hourly(conn, 2, 0, [("2026-03-08T00:00:00Z", 999.0)])
    conn.close()

    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    conn = db.connect(db_path)
    result1 = aggregate.rebuild_all(conn, now=now, generated_at="2026-08-05T01:00:00Z")
    hash1 = aggregate.content_hash(conn)
    rows1 = db.count_4h_rows(conn)
    conn.close()

    conn = db.connect(db_path)
    result2 = aggregate.rebuild_all(conn, now=now, generated_at="2026-08-05T02:00:00Z")  # different bookkeeping timestamp
    hash2 = aggregate.content_hash(conn)
    rows2 = db.count_4h_rows(conn)
    conn.close()

    assert result1["combos"] == result2["combos"] == 3
    assert rows1 == rows2
    assert hash1 == hash2  # (a): identical content hash despite differing generated_at


def test_rebuild_all_aggregates_each_star_independently(tmp_path: Path) -> None:
    """design §2.2: stars with different history depths must not block each other."""
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    # star 0 has two full buckets; star 1 starts much later (only one bucket).
    _seed_hourly(
        conn, 1, 0,
        [("2026-01-01T00:00:00Z", 1.0), ("2026-03-08T00:00:00Z", 2.0)],
    )
    _seed_hourly(conn, 1, 1, [("2026-03-08T00:00:00Z", 3.0)])
    conn.close()

    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)
    conn = db.connect(db_path)
    aggregate.rebuild_all(conn, now=now, generated_at="2026-08-05T00:00:00Z")
    rows0 = db.four_h_rows_for_item(conn, 1)
    conn.close()

    upgrades = {r[0] for r in rows0}
    assert upgrades == {0, 1}
    star0_dates = sorted(r[1] for r in rows0 if r[0] == 0)
    star1_dates = sorted(r[1] for r in rows0 if r[0] == 1)
    assert star0_dates[0] == "2026-01-01T00:00:00Z"
    assert star1_dates[0] == "2026-03-08T00:00:00Z"  # star 1's own (later) start, not star 0's


def test_update_combo_incremental_matches_full_rebuild_after_a_revision(tmp_path: Path) -> None:
    """The differential job's incremental path must produce the identical 4h
    rows a full rebuild would, including when the official API revises an
    already-persisted bucket's source value (design §5.2)."""
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    # Initial state: full rebuild from an initial hourly snapshot.
    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_hourly(
        conn, 1, 0,
        [
            ("2026-03-08T00:00:00Z", 100.0),
            ("2026-03-08T04:00:00Z", 200.0),
            ("2026-03-08T08:00:00Z", 300.0),
        ],
    )
    aggregate.rebuild_all(conn, now=now, generated_at="2026-08-05T00:00:00Z")
    conn.close()

    # A differential re-fetch UPSERTs a revised end_price for the most recent
    # bucket's hourly row (simulating "後から修正された値").
    conn = db.connect(db_path)
    _seed_hourly(conn, 1, 0, [("2026-03-08T08:00:00Z", 999.0)])
    aggregate.update_combo_incremental(conn, 1, 0, now=now, generated_at="2026-08-05T01:00:00Z")
    incremental_hash = aggregate.content_hash(conn)
    incremental_rows = db.four_h_rows_for_item(conn, 1)
    conn.close()

    # A full rebuild at the same point must agree exactly (ignoring generated_at).
    conn = db.connect(db_path)
    aggregate.rebuild_all(conn, now=now, generated_at="2026-08-05T02:00:00Z")
    full_hash = aggregate.content_hash(conn)
    full_rows = db.four_h_rows_for_item(conn, 1)
    conn.close()

    assert incremental_hash == full_hash
    assert incremental_rows == full_rows
    revised = [r for r in full_rows if r[1] == "2026-03-08T08:00:00Z"]
    assert revised == [(0, "2026-03-08T08:00:00Z", 999.0)]


def test_content_hash_changes_when_a_value_changes(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    now = datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)

    conn = db.connect(db_path)
    db.apply_schema(conn)
    _seed_hourly(conn, 1, 0, [("2026-03-08T00:00:00Z", 100.0)])
    aggregate.rebuild_all(conn, now=now, generated_at="g1")
    hash_before = aggregate.content_hash(conn)
    conn.close()

    conn = db.connect(db_path)
    _seed_hourly(conn, 1, 0, [("2026-03-08T00:00:00Z", 101.0)])
    aggregate.rebuild_all(conn, now=now, generated_at="g2")
    hash_after = aggregate.content_hash(conn)
    conn.close()

    assert hash_before != hash_after
