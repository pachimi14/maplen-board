"""Tests for preserving rankings.json meta.updatedAt on re-export."""

from __future__ import annotations

import json
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
    init_db,
    latest_snapshot_fetched_at,
    set_app_meta,
)


def test_resolve_prefers_app_meta_over_export_time() -> None:
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    json_path = tmpdir / "rankings.json"
    logger = logging.getLogger("test_ranking_updated_at")
    try:
        init_db(db)
        stored = datetime(2026, 6, 21, 0, 35, tzinfo=timezone.utc)
        set_app_meta(
            db,
            LAST_RANKING_FETCHED_AT_KEY,
            stored.isoformat(timespec="seconds"),
        )

        resolved = resolve_ranking_updated_at(db, json_path, logger)
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


def test_resolve_uses_local_json_when_app_meta_missing() -> None:
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    json_path = tmpdir / "rankings.json"
    logger = logging.getLogger("test_ranking_updated_at")
    try:
        init_db(db)
        stored = datetime(2026, 6, 20, 12, 0, tzinfo=timezone.utc)
        json_path.write_text(
            json.dumps({"meta": {"updatedAt": stored.isoformat(timespec="seconds")}}),
            encoding="utf-8",
        )

        resolved = resolve_ranking_updated_at(db, json_path, logger)
        assert resolved == stored
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    test_resolve_prefers_app_meta_over_export_time()
    test_latest_snapshot_fetched_at_uses_newest_day()
    test_resolve_uses_local_json_when_app_meta_missing()
    print("ok")
