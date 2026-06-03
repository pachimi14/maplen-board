"""Tests for ranking-day skip logic."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import shutil

from models import SnapshotRow
from ranking_day_skip import ranking_day_already_captured, should_skip_entire_run
from sqlite_storage import append_snapshots, init_db


def test_skip_when_enough_rows() -> None:
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    try:
        init_db(db)
        rows = [
            SnapshotRow(
                "2026-06-05", i, 0, f"C{i}", "", "", 248, 1, "", f"k{i}"
            )
            for i in range(1, 1100)
        ]
        append_snapshots(db, rows, "2026-06-05T00:00:00")
        assert ranking_day_already_captured(db, "2026-06-05")
        old = os.environ.get("SKIP_RUN_IF_RANKING_DAY_EXISTS")
        os.environ["SKIP_RUN_IF_RANKING_DAY_EXISTS"] = "true"
        try:
            assert should_skip_entire_run(db, "2026-06-05")
        finally:
            if old is None:
                os.environ.pop("SKIP_RUN_IF_RANKING_DAY_EXISTS", None)
            else:
                os.environ["SKIP_RUN_IF_RANKING_DAY_EXISTS"] = old
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    test_skip_when_enough_rows()
    print("ok")
