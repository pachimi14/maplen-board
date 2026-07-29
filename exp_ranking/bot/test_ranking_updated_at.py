"""Tests for preserving rankings.json meta.updatedAt on re-export."""

from __future__ import annotations

import logging
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from main import resolve_ranking_updated_at
from models import SnapshotRow
from sqlite_storage import (
    LAST_RANKING_FETCHED_AT_KEY,
    append_snapshots,
    get_app_meta,
    init_db,
    latest_snapshot_fetched_at,
    reconcile_ranking_fetched_at_meta,
    set_app_meta,
)


def test_resolve_prefers_app_meta_over_export_time() -> None:
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    logger = logging.getLogger("test_ranking_updated_at")
    try:
        init_db(db)
        stored = datetime(2026, 6, 21, 0, 35, tzinfo=timezone.utc)
        set_app_meta(
            db,
            LAST_RANKING_FETCHED_AT_KEY,
            stored.isoformat(timespec="seconds"),
        )

        resolved = resolve_ranking_updated_at(db, logger)
        assert resolved == stored
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_latest_snapshot_fetched_at_uses_newest_day() -> None:
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    try:
        init_db(db)
        rows = [
            SnapshotRow("2026-06-20", 1, 0, "A", "", "", 250, 1, "", "k1"),
            SnapshotRow("2026-06-21", 1, 0, "A", "", "", 251, 1, "", "k1"),
        ]
        append_snapshots(db, [rows[0]], "2026-06-20T00:20:00+00:00")
        append_snapshots(db, [rows[1]], "2026-06-21T00:35:00+00:00")

        parsed = latest_snapshot_fetched_at(db)
        assert parsed == datetime(2026, 6, 21, 0, 35, tzinfo=timezone.utc)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_resolve_falls_back_to_now_when_no_app_meta_or_snapshots() -> None:
    """T12 P4: the local v1 rankings.json fallback (`read_json_updated_at`)
    is retired -- with no app_meta and no snapshot rows, resolution now falls
    straight through to the current-time fallback (still DB-derived-first,
    per main.py:660's from_db priority, which this test does not exercise)."""
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    logger = logging.getLogger("test_ranking_updated_at")
    try:
        init_db(db)
        before = datetime.now(timezone.utc)

        resolved = resolve_ranking_updated_at(db, logger)

        after = datetime.now(timezone.utc)
        assert before <= resolved <= after
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_resolve_upgrades_stale_app_meta_from_latest_snapshot() -> None:
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    logger = logging.getLogger("test_ranking_updated_at")
    try:
        init_db(db)
        stale = datetime(2026, 6, 22, 0, 30, 9, tzinfo=timezone.utc)
        set_app_meta(
            db,
            LAST_RANKING_FETCHED_AT_KEY,
            stale.isoformat(timespec="seconds"),
        )
        rows = [
            SnapshotRow("2026-06-24", 1, 0, "A", "", "", 250, 1, "", "k1"),
        ]
        newer = datetime(2026, 6, 25, 0, 35, 0, tzinfo=timezone.utc)
        append_snapshots(db, rows, newer.isoformat(timespec="seconds"))

        resolved = resolve_ranking_updated_at(db, logger)
        assert resolved == newer
        stored = get_app_meta(db, LAST_RANKING_FETCHED_AT_KEY)
        assert stored == newer.isoformat(timespec="seconds")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_reconcile_ranking_fetched_at_meta() -> None:
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    try:
        init_db(db)
        stale = datetime(2026, 6, 22, 0, 30, tzinfo=timezone.utc)
        set_app_meta(
            db,
            LAST_RANKING_FETCHED_AT_KEY,
            stale.isoformat(timespec="seconds"),
        )
        rows = [SnapshotRow("2026-06-24", 1, 0, "A", "", "", 250, 1, "", "k1")]
        newer = datetime(2026, 6, 25, 0, 35, tzinfo=timezone.utc)
        append_snapshots(db, rows, newer.isoformat(timespec="seconds"))

        assert reconcile_ranking_fetched_at_meta(db)
        stored = get_app_meta(db, LAST_RANKING_FETCHED_AT_KEY)
        assert stored == newer.isoformat(timespec="seconds")
        assert not reconcile_ranking_fetched_at_meta(db)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    test_resolve_prefers_app_meta_over_export_time()
    test_latest_snapshot_fetched_at_uses_newest_day()
    test_resolve_falls_back_to_now_when_no_app_meta_or_snapshots()
    test_resolve_upgrades_stale_app_meta_from_latest_snapshot()
    test_reconcile_ranking_fetched_at_meta()
    print("ok")
