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
