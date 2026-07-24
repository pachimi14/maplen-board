"""character_asset_key backfill should only touch missing rows."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from models import SnapshotRow
from sqlite_storage import append_snapshots, backfill_character_asset_keys, init_db, load_all_snapshots


def _row(
    snapshot_date: str,
    rank: int,
    name: str,
    asset_key: str = "",
) -> SnapshotRow:
    return SnapshotRow(
        snapshot_date=snapshot_date,
        rank=rank,
        rank_fluctuation=0,
        character_name=name,
        class_code="",
        job_code="",
        level=225,
        exp=rank * 100,
        image_url="",
        character_asset_key=asset_key,
    )


def _db_path(name: str) -> Path:
    stem = Path(name).stem
    return Path(__file__).with_name(f"{stem}_{os.getpid()}.db")


def _cleanup(path: Path) -> None:
    if not path.exists():
        return
    try:
        path.unlink()
    except PermissionError:
        pass


def test_backfill_character_asset_keys_updates_only_matching_empty_rows() -> None:
    db_path = _db_path("_test_asset_key_backfill_1.db")
    try:
        append_snapshots(
            db_path,
            [
                _row("2026-07-22", 1, "Alpha"),
                _row("2026-07-22", 2, "Beta", "asset-beta-old"),
                _row("2026-07-22", 3, "Gamma"),
            ],
            "2026-07-23T00:10:00+00:00",
        )

        updated = backfill_character_asset_keys(
            db_path,
            name_to_asset_key={
                "alpha": "asset-alpha",
                "beta": "asset-beta-new",
                "delta": "asset-delta",
            },
        )

        assert updated == 1
        rows = {row.character_name: row for row in load_all_snapshots(db_path)}
        assert rows["Alpha"].character_asset_key == "asset-alpha"
        assert rows["Beta"].character_asset_key == "asset-beta-old"
        assert rows["Gamma"].character_asset_key == ""
    finally:
        _cleanup(db_path)


def test_backfill_character_asset_keys_skips_when_no_empty_rows() -> None:
    db_path = _db_path("_test_asset_key_backfill_2.db")
    try:
        append_snapshots(
            db_path,
            [_row("2026-07-22", 1, "Alpha", "asset-alpha")],
            "2026-07-23T00:10:00+00:00",
        )

        updated = backfill_character_asset_keys(
            db_path,
            name_to_asset_key={"alpha": "asset-alpha-new"},
        )

        assert updated == 0
        rows = load_all_snapshots(db_path)
        assert rows[0].character_asset_key == "asset-alpha"
    finally:
        _cleanup(db_path)


def test_ranking_snapshot_schema_keeps_asset_key_not_null() -> None:
    db_path = _db_path("_test_asset_key_schema.db")
    try:
        init_db(db_path)
        with sqlite3.connect(db_path) as conn:
            rows = conn.execute("PRAGMA table_info(ranking_snapshot)").fetchall()
        columns = {str(row[1]): row for row in rows}
        assert int(columns["character_asset_key"][3]) == 1
    finally:
        _cleanup(db_path)


def test_backfill_character_asset_keys_handles_legacy_null_asset_key() -> None:
    db_path = _db_path("_test_asset_key_backfill_null.db")
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE ranking_snapshot (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_date TEXT NOT NULL,
                    rank INTEGER NOT NULL,
                    rank_fluctuation INTEGER NOT NULL DEFAULT 0,
                    character_name TEXT NOT NULL,
                    class_code TEXT NOT NULL DEFAULT '',
                    job_code TEXT NOT NULL DEFAULT '',
                    level INTEGER NOT NULL,
                    exp INTEGER NOT NULL,
                    image_url TEXT NOT NULL DEFAULT '',
                    character_asset_key TEXT DEFAULT NULL,
                    fetched_at TEXT NOT NULL,
                    UNIQUE(snapshot_date, rank)
                )
                """
            )
            conn.execute(
                """
                INSERT INTO ranking_snapshot (
                    snapshot_date, rank, rank_fluctuation, character_name,
                    class_code, job_code, level, exp, image_url,
                    character_asset_key, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "2026-07-22",
                    1,
                    0,
                    "LegacyNull",
                    "",
                    "",
                    225,
                    100,
                    "",
                    None,
                    "2026-07-23T00:10:00+00:00",
                ),
            )
            conn.commit()

        updated = backfill_character_asset_keys(
            db_path,
            name_to_asset_key={"legacynull": "asset-legacy-null"},
        )

        assert updated == 1
        with sqlite3.connect(db_path) as conn:
            row = conn.execute(
                "SELECT character_asset_key FROM ranking_snapshot WHERE character_name = ?",
                ("LegacyNull",),
            ).fetchone()
        assert row[0] == "asset-legacy-null"
    finally:
        _cleanup(db_path)

