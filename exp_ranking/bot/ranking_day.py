"""Ranking-day id: labels daily gain for the prior UTC calendar day."""

from __future__ import annotations

import logging
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import config

logger = logging.getLogger(__name__)

UTC = ZoneInfo("UTC")
MIGRATION_MARKER_NAME = ".ranking_day_label_utc_gain"


def migration_marker_path() -> Path:
    return config.BASE_DIR / "data" / MIGRATION_MARKER_NAME


def ranking_day_from_fetch(dt: datetime) -> str:
    """Return the UTC gain day measured by a fetch at ``dt``.

    Official EXP resets at UTC 00:00 (= JST 09:00). A fetch on UTC date D
    reflects gain during UTC (D-1) 00:00–23:59, so the label is D-1.
    """
    if dt.tzinfo is None:
        current = dt.replace(tzinfo=UTC)
    else:
        current = dt.astimezone(UTC)
    return (current.date() - timedelta(days=1)).isoformat()


def shift_iso_date(iso_date: str, *, days: int) -> str:
    return (date.fromisoformat(iso_date) + timedelta(days=days)).isoformat()


def shift_all_snapshot_dates(db_path: Path, *, days: int = -1) -> int:
    """Shift every ``snapshot_date`` by ``days`` (two-phase update for UNIQUE)."""
    from sqlite_storage import init_db

    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, snapshot_date FROM ranking_snapshot ORDER BY id"
        ).fetchall()
        if not rows:
            return 0

        for row_id, snap_date in rows:
            conn.execute(
                "UPDATE ranking_snapshot SET snapshot_date = ? WHERE id = ?",
                (f"__shift__{snap_date}", row_id),
            )

        updated = 0
        for row_id, snap_date in rows:
            new_date = shift_iso_date(str(snap_date), days=days)
            conn.execute(
                "UPDATE ranking_snapshot SET snapshot_date = ? WHERE id = ?",
                (new_date, row_id),
            )
            updated += 1
        conn.commit()

    logger.info(
        "Shifted SQLite snapshot dates by %s day(s): rows=%s db=%s",
        days,
        updated,
        db_path,
    )
    return updated


def shift_ranking_day_skip_marker(*, days: int = -1) -> None:
    path = config.ranking_day_skip_marker_path()
    if not path.exists():
        return
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return
    try:
        shifted = shift_iso_date(raw, days=days)
    except ValueError:
        return
    path.write_text(shifted + "\n", encoding="utf-8")
    logger.info("Shifted ranking-day skip marker: %s -> %s", raw, shifted)


def migration_already_applied() -> bool:
    return migration_marker_path().exists()


def apply_ranking_day_label_migration(
    db_path: Path | None = None,
    *,
    days: int = -1,
) -> bool:
    """One-time shift of stored labels to UTC gain-day ids."""
    if migration_already_applied():
        return False

    db = db_path or config.sqlite_db_path()
    db.parent.mkdir(parents=True, exist_ok=True)

    shifted_rows = 0
    if db.exists():
        shifted_rows = shift_all_snapshot_dates(db, days=days)

    # T12 P4: this one-time migration previously also shifted dates inside
    # the local v1 rankings.json (`config.mvp_json_output_path()`, now
    # retired). T12 P7: the bundled cold-start snapshot seed that remained
    # here has also been retired (docs/IMPL_PLAN_T12_P7.md §2.1) -- no JSON
    # files are shifted by this migration anymore, only the SQLite rows
    # above and the skip marker below.
    shifted_json = 0

    shift_ranking_day_skip_marker(days=days)

    marker = migration_marker_path()
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        f"utc_gain_day shift={days} rows={shifted_rows} json_files={shifted_json}\n",
        encoding="utf-8",
    )
    logger.info(
        "Ranking-day label migration complete (shift=%s rows=%s json_files=%s)",
        days,
        shifted_rows,
        shifted_json,
    )
    return True
