"""SQLite access for the SF price history backfill (SH-2).

Schema: ``schema.sql``. This module only reads/writes
``sf_price_history_hourly`` and ``sf_history_backfill_progress`` -- it never
touches anything outside the DB file it is given.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterable

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def connect(db_path: Path | str) -> sqlite3.Connection:
    """Open (creating if needed) the SQLite DB at ``db_path``."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def apply_schema(conn: sqlite3.Connection, schema_path: Path = SCHEMA_PATH) -> None:
    """Idempotently create the tables (CREATE TABLE IF NOT EXISTS)."""
    sql = Path(schema_path).read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.commit()


def upsert_hourly_rows(
    conn: sqlite3.Connection,
    item_id: int,
    item_upgrade: int,
    points: Iterable[dict[str, Any]],
    fetched_at: str,
) -> int:
    """UPSERT one (item_id, item_upgrade) combo's history points.

    Writes immediately (single transaction per call, committed before
    returning) rather than buffering across combinations -- IMPL_PLAN_SH2 §5:
    "1件ずつ即座に SQLite へ書く。全部終わってからまとめて書かない".
    ``end_price`` is taken from the API's ``endPrice`` unconverted (schema.sql
    comment / IMPL_PLAN_SH2 §3): no unit conversion happens in this function.

    Returns the number of rows written (== len(points)).
    """
    rows = [
        (
            item_id,
            item_upgrade,
            point["date"],
            point.get("step"),
            point.get("avgPrice"),
            point.get("maxPrice"),
            point.get("minPrice"),
            point["endPrice"],
            point.get("sumEnhanceCnt") or 0,
            fetched_at,
        )
        for point in points
    ]
    conn.executemany(
        """
        INSERT INTO sf_price_history_hourly
            (item_id, item_upgrade, price_at, step, avg_price, max_price,
             min_price, end_price, sum_enhance_count, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, item_upgrade, price_at) DO UPDATE SET
            step=excluded.step,
            avg_price=excluded.avg_price,
            max_price=excluded.max_price,
            min_price=excluded.min_price,
            end_price=excluded.end_price,
            sum_enhance_count=excluded.sum_enhance_count,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def record_progress(
    conn: sqlite3.Connection,
    item_id: int,
    item_upgrade: int,
    *,
    status: str,
    row_count: int,
    oldest_at: str | None,
    newest_at: str | None,
    updated_at: str,
    note: str | None = None,
) -> None:
    """UPSERT the resumability marker for one (item_id, item_upgrade) combo."""
    if status not in ("done", "error"):
        raise ValueError(f"status must be 'done' or 'error', got {status!r}")
    conn.execute(
        """
        INSERT INTO sf_history_backfill_progress
            (item_id, item_upgrade, status, row_count, oldest_at, newest_at, updated_at, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, item_upgrade) DO UPDATE SET
            status=excluded.status,
            row_count=excluded.row_count,
            oldest_at=excluded.oldest_at,
            newest_at=excluded.newest_at,
            updated_at=excluded.updated_at,
            note=excluded.note
        """,
        (item_id, item_upgrade, status, row_count, oldest_at, newest_at, updated_at, note),
    )
    conn.commit()


def load_done_combinations(conn: sqlite3.Connection) -> set[tuple[int, int]]:
    """Return the (item_id, item_upgrade) pairs already marked status='done'."""
    cur = conn.execute(
        "SELECT item_id, item_upgrade FROM sf_history_backfill_progress WHERE status = 'done'"
    )
    return {(row[0], row[1]) for row in cur.fetchall()}


def count_progress_by_status(conn: sqlite3.Connection) -> dict[str, int]:
    cur = conn.execute(
        "SELECT status, COUNT(*) FROM sf_history_backfill_progress GROUP BY status"
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def count_hourly_rows(conn: sqlite3.Connection) -> int:
    cur = conn.execute("SELECT COUNT(*) FROM sf_price_history_hourly")
    return int(cur.fetchone()[0])


def count_duplicate_hourly_rows(conn: sqlite3.Connection) -> int:
    """COUNT(*) - COUNT(DISTINCT key) -- must be 0 (accept criterion (e))."""
    cur = conn.execute(
        "SELECT COUNT(*) - COUNT(DISTINCT item_id || '/' || item_upgrade || '/' || price_at) "
        "FROM sf_price_history_hourly"
    )
    return int(cur.fetchone()[0])


def list_error_combinations(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    cur = conn.execute(
        "SELECT item_id, item_upgrade, note, updated_at FROM sf_history_backfill_progress "
        "WHERE status = 'error' ORDER BY item_id, item_upgrade"
    )
    return [
        {"itemId": row[0], "itemUpgrade": row[1], "note": row[2], "updatedAt": row[3]}
        for row in cur.fetchall()
    ]


# --- SH-3: sf_price_history_4h access (aggregate.py / app.py) ---------------


def distinct_hourly_combinations(conn: sqlite3.Connection) -> list[tuple[int, int]]:
    """Every (item_id, item_upgrade) that has at least one hourly row.

    Combinations backfilled with 0 rows (design §7.1: items that cap below
    ☆22) never appear here -- there is nothing to derive a 4h bucket from.
    """
    cur = conn.execute(
        "SELECT DISTINCT item_id, item_upgrade FROM sf_price_history_hourly "
        "ORDER BY item_id, item_upgrade"
    )
    return [(row[0], row[1]) for row in cur.fetchall()]


def hourly_series(
    conn: sqlite3.Connection, item_id: int, item_upgrade: int, *, since: str | None = None
) -> list[tuple[str, float]]:
    """(price_at, end_price) pairs for one series, ordered by price_at.

    ``since`` (inclusive) scopes the query to an incremental re-aggregation
    window (aggregate.update_combo_incremental) -- it must always be a value
    that is itself a 4h bucket boundary, so that no row belonging to a bucket
    starting before it is silently dropped (aggregate.py enforces this).
    """
    if since is None:
        cur = conn.execute(
            "SELECT price_at, end_price FROM sf_price_history_hourly "
            "WHERE item_id = ? AND item_upgrade = ? ORDER BY price_at",
            (item_id, item_upgrade),
        )
    else:
        cur = conn.execute(
            "SELECT price_at, end_price FROM sf_price_history_hourly "
            "WHERE item_id = ? AND item_upgrade = ? AND price_at >= ? ORDER BY price_at",
            (item_id, item_upgrade, since),
        )
    return [(row[0], row[1]) for row in cur.fetchall()]


def replace_4h_rows(
    conn: sqlite3.Connection,
    item_id: int,
    item_upgrade: int,
    rows: Iterable[dict[str, Any]],
    *,
    since: str | None = None,
) -> int:
    """Fully replace (delete then insert) the 4h rows for one combination.

    A full replace (not UPSERT-only) is what makes the determinism guarantee
    (IMPL_PLAN_SH3 §7(a)) hold: re-deriving a range can never leave a stale
    row behind from a previous run's different bucket boundary. ``since``
    (inclusive, a bucket-start value) scopes both the delete and the implicit
    insert range to an incremental re-aggregation; ``None`` replaces the
    combination's entire history.
    """
    rows = list(rows)
    if since is None:
        conn.execute(
            "DELETE FROM sf_price_history_4h WHERE item_id = ? AND item_upgrade = ?",
            (item_id, item_upgrade),
        )
    else:
        conn.execute(
            "DELETE FROM sf_price_history_4h WHERE item_id = ? AND item_upgrade = ? AND price_at >= ?",
            (item_id, item_upgrade, since),
        )
    conn.executemany(
        """
        INSERT INTO sf_price_history_4h
            (item_id, item_upgrade, price_at, end_price, source_hour_at, generated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (
                item_id,
                item_upgrade,
                row["price_at"],
                row["end_price"],
                row["source_hour_at"],
                row["generated_at"],
            )
            for row in rows
        ],
    )
    conn.commit()
    return len(rows)


def count_4h_rows(conn: sqlite3.Connection) -> int:
    cur = conn.execute("SELECT COUNT(*) FROM sf_price_history_4h")
    return int(cur.fetchone()[0])


def max_4h_price_at_for_combo(
    conn: sqlite3.Connection, item_id: int, item_upgrade: int
) -> str | None:
    cur = conn.execute(
        "SELECT MAX(price_at) FROM sf_price_history_4h WHERE item_id = ? AND item_upgrade = ?",
        (item_id, item_upgrade),
    )
    row = cur.fetchone()
    return row[0] if row else None


def max_upgrade_by_item(conn: sqlite3.Connection) -> dict[int, int]:
    """MAX(item_upgrade) with at least one hourly row, per item_id.

    This is the data-derived basis for ``maxStar`` (design §7.1: "ハードコード
    せず、hourly の実データから導出する"). Combinations backfilled with 0 rows
    (items that cap below ☆22) never appear in ``sf_price_history_hourly``, so
    they are naturally excluded here without any special-casing.
    """
    cur = conn.execute(
        "SELECT item_id, MAX(item_upgrade) FROM sf_price_history_hourly GROUP BY item_id"
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def four_h_rows_for_item(conn: sqlite3.Connection, item_id: int) -> list[tuple[int, str, float]]:
    """(item_upgrade, price_at, end_price) for every 4h row of one item, ordered."""
    cur = conn.execute(
        "SELECT item_upgrade, price_at, end_price FROM sf_price_history_4h "
        "WHERE item_id = ? ORDER BY price_at, item_upgrade",
        (item_id,),
    )
    return [(row[0], row[1], row[2]) for row in cur.fetchall()]


def latest_generated_at_for_item(conn: sqlite3.Connection, item_id: int) -> str | None:
    cur = conn.execute(
        "SELECT MAX(generated_at) FROM sf_price_history_4h WHERE item_id = ?", (item_id,)
    )
    row = cur.fetchone()
    return row[0] if row else None
