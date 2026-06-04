"""Skip CI run when today's ranking-day snapshot is already stored."""

from __future__ import annotations

import logging
from pathlib import Path

import config
from sqlite_storage import count_snapshots_for_date, has_snapshots_for_date

logger = logging.getLogger(__name__)


def clear_ranking_day_skip_marker() -> None:
    path = config.ranking_day_skip_marker_path()
    if path.exists():
        path.unlink()


def mark_ranking_day_complete(snapshot_date: str) -> None:
    path = config.ranking_day_skip_marker_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(snapshot_date + "\n", encoding="utf-8")


def is_ranking_day_skip_marker_set() -> bool:
    return config.ranking_day_skip_marker_path().exists()


def ranking_day_already_captured(db_path: Path, snapshot_date: str) -> bool:
    if not snapshot_date:
        return False
    if not has_snapshots_for_date(db_path, snapshot_date):
        return False
    return (
        count_snapshots_for_date(db_path, snapshot_date)
        >= config.skip_run_min_snapshot_rows()
    )


def should_skip_entire_run(db_path: Path, snapshot_date: str) -> bool:
    if not config.skip_run_if_ranking_day_exists():
        return False
    return ranking_day_already_captured(db_path, snapshot_date)


def try_skip_entire_run(db_path: Path, snapshot_date: str) -> bool:
    """Return True when the job should exit without fetch/build/deploy."""
    clear_ranking_day_skip_marker()
    if not should_skip_entire_run(db_path, snapshot_date):
        return False

    rows = count_snapshots_for_date(db_path, snapshot_date)
    mark_ranking_day_complete(snapshot_date)
    logger.info(
        "Ranking day %s already captured (%s rows >= %s); "
        "skipping ranking fetch, Navigator, and deploy",
        snapshot_date,
        rows,
        config.skip_run_min_snapshot_rows(),
    )
    return True
