"""Tests for P-DQ-3: partial UNIQUE(snapshot_date, character_asset_key) index.

`ranking_snapshot` only enforced `UNIQUE(snapshot_date, rank)`; nothing stopped
a recovery re-import from inserting a second row for the same
`(snapshot_date, character_asset_key)` at a different rank (see
docs/IMPL_PLAN_dq-dup-rows.md P-DQ-1/P-DQ-2, LULU-055/057/058). This adds a
structural, DB-level guard: a partial unique index that rejects duplicate
`(snapshot_date, character_asset_key)` inserts outright (excluding legacy
empty-asset-key rows), plus the one-time dedupe migration that must run
before the index can be created (existing duplicates would otherwise make
index creation fail).

The row-selection rule itself (class/job non-empty -> rank min) is NOT
re-implemented here -- `find_duplicate_snapshot_identity_groups` reuses
`analysis.select_canonical_snapshot_row`, the same function P-DQ-1 uses at
the output layer. These tests only cover the DB-layer wiring (which rows get
deleted, backup/reversibility, index creation, and idempotency).
"""

from __future__ import annotations

import shutil
import sqlite3
import tempfile
from pathlib import Path

import pytest

from models import SnapshotRow
from sqlite_storage import (
    UNIQUE_SNAPSHOT_IDENTITY_INDEX,
    append_snapshots,
    create_unique_snapshot_identity_index,
    dedupe_ranking_snapshot_identity_rows,
    find_duplicate_snapshot_identity_groups,
    init_db,
    migrate_unique_snapshot_identity_constraint,
)


@pytest.fixture()
def tmp_db() -> Path:
    tmpdir = Path(tempfile.mkdtemp())
    db = tmpdir / "t.db"
    init_db(db)
    try:
        yield db
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _insert_raw(db_path: Path, **overrides: object) -> int:
    """Insert a row bypassing INSERT OR IGNORE, to test raw constraint behavior."""
    defaults = {
        "snapshot_date": "2026-06-01",
        "rank": 1,
        "rank_fluctuation": 0,
        "character_name": "Hero",
        "class_code": "",
        "job_code": "",
        "level": 250,
        "exp": 100,
        "image_url": "",
        "character_asset_key": "key-1",
        "fetched_at": "2026-06-01T00:20:00+00:00",
    }
    defaults.update(overrides)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO ranking_snapshot (
                snapshot_date, rank, rank_fluctuation, character_name,
                class_code, job_code, level, exp, image_url,
                character_asset_key, fetched_at
            ) VALUES (
                :snapshot_date, :rank, :rank_fluctuation, :character_name,
                :class_code, :job_code, :level, :exp, :image_url,
                :character_asset_key, :fetched_at
            )
            """,
            defaults,
        )
        conn.commit()
        return int(cursor.lastrowid)


def _row_count(db_path: Path) -> int:
    with sqlite3.connect(db_path) as conn:
        return int(conn.execute("SELECT COUNT(*) FROM ranking_snapshot").fetchone()[0])


def _duplicate_group_count(db_path: Path) -> int:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT snapshot_date, character_asset_key
                FROM ranking_snapshot
                WHERE character_asset_key != ''
                GROUP BY snapshot_date, character_asset_key
                HAVING COUNT(*) > 1
            )
            """
        ).fetchone()
        return int(row[0])


def _index_exists(db_path: Path) -> bool:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
            (UNIQUE_SNAPSHOT_IDENTITY_INDEX,),
        ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# find_duplicate_snapshot_identity_groups / dedupe (rule reuse + reversibility)
# ---------------------------------------------------------------------------


def test_find_duplicate_groups_empty_when_no_duplicates(tmp_db: Path) -> None:
    _insert_raw(tmp_db, rank=1, character_asset_key="key-1")
    _insert_raw(tmp_db, rank=2, character_asset_key="key-2")
    assert find_duplicate_snapshot_identity_groups(tmp_db) == []


def test_find_duplicate_groups_ignores_empty_asset_key(tmp_db: Path) -> None:
    """Two rows, same date, both empty asset_key -- out of scope (§4)."""
    _insert_raw(tmp_db, rank=1, character_asset_key="", character_name="A")
    _insert_raw(tmp_db, rank=2, character_asset_key="", character_name="B")
    assert find_duplicate_snapshot_identity_groups(tmp_db) == []


def test_dedupe_keeps_row_with_class_job_regardless_of_rank(tmp_db: Path) -> None:
    """Reuses analysis.select_canonical_snapshot_row: class/job-populated row
    wins even though its rank is numerically higher (mirrors the 06-01 case)."""
    reimport_id = _insert_raw(
        tmp_db, rank=5620, class_code="", job_code="", character_asset_key="key-1"
    )
    genuine_id = _insert_raw(
        tmp_db,
        rank=12,
        class_code="ClassCode_THIEF",
        job_code="JobCode_NIGHTLORD",
        character_asset_key="key-1",
    )

    groups = find_duplicate_snapshot_identity_groups(tmp_db)
    assert len(groups) == 1
    assert groups[0]["keep_id"] == genuine_id
    assert groups[0]["delete_ids"] == [reimport_id]


def test_dedupe_dry_run_deletes_nothing(tmp_db: Path) -> None:
    _insert_raw(tmp_db, rank=1, character_asset_key="key-1", class_code="A")
    _insert_raw(tmp_db, rank=2, character_asset_key="key-1", class_code="")

    result = dedupe_ranking_snapshot_identity_rows(tmp_db, dry_run=True)
    assert result["dry_run"] is True
    assert result["groups"] == 1
    assert result["rows_deleted"] == 1
    assert len(result["backup_rows"]) == 1
    assert _row_count(tmp_db) == 2  # unchanged


def test_dedupe_execute_deletes_excess_and_resolves_duplicates(tmp_db: Path) -> None:
    keep_id = _insert_raw(tmp_db, rank=1, character_asset_key="key-1", class_code="A")
    excess_id = _insert_raw(tmp_db, rank=2, character_asset_key="key-1", class_code="")
    unrelated_id = _insert_raw(tmp_db, rank=3, character_asset_key="key-2")

    result = dedupe_ranking_snapshot_identity_rows(tmp_db, dry_run=False)
    assert result["groups"] == 1
    assert result["rows_deleted"] == 1

    assert _duplicate_group_count(tmp_db) == 0
    with sqlite3.connect(tmp_db) as conn:
        remaining_ids = {
            row[0] for row in conn.execute("SELECT id FROM ranking_snapshot").fetchall()
        }
    assert remaining_ids == {keep_id, unrelated_id}
    assert excess_id not in remaining_ids


def test_dedupe_backup_is_sufficient_to_restore_deleted_rows(tmp_db: Path) -> None:
    """§ acceptance criterion 7 (plan): backup must allow full restore."""
    _insert_raw(tmp_db, rank=1, character_asset_key="key-1", class_code="A", exp=500)
    _insert_raw(tmp_db, rank=2, character_asset_key="key-1", class_code="", exp=499)

    result = dedupe_ranking_snapshot_identity_rows(tmp_db, dry_run=False)
    assert result["rows_deleted"] == 1
    backup_row = result["backup_rows"][0]

    assert _row_count(tmp_db) == 1

    # Restore from backup into a fresh row (simulating recovery from backup).
    with sqlite3.connect(tmp_db) as conn:
        conn.execute(
            """
            INSERT INTO ranking_snapshot (
                snapshot_date, rank, rank_fluctuation, character_name,
                class_code, job_code, level, exp, image_url,
                character_asset_key, fetched_at
            ) VALUES (
                :snapshot_date, :rank, :rank_fluctuation, :character_name,
                :class_code, :job_code, :level, :exp, :image_url,
                :character_asset_key, :fetched_at
            )
            """,
            backup_row,
        )
        conn.commit()

    assert _row_count(tmp_db) == 2
    with sqlite3.connect(tmp_db) as conn:
        row = conn.execute(
            "SELECT exp FROM ranking_snapshot WHERE rank = 2"
        ).fetchone()
    assert row[0] == 499


# ---------------------------------------------------------------------------
# create_unique_snapshot_identity_index / migration ordering
# ---------------------------------------------------------------------------


def test_index_creation_fails_if_duplicates_not_removed_first(tmp_db: Path) -> None:
    """Order matters: create_unique_snapshot_identity_index must run AFTER
    dedupe, or it raises on existing duplicate (date, asset_key) rows."""
    _insert_raw(tmp_db, rank=1, character_asset_key="key-1")
    _insert_raw(tmp_db, rank=2, character_asset_key="key-1")

    with pytest.raises(sqlite3.IntegrityError):
        create_unique_snapshot_identity_index(tmp_db)


def test_migration_dedupes_then_creates_index(tmp_db: Path) -> None:
    """(a) migration performs dedupe -> create index, in that order, on a DB
    with duplicates."""
    keep_id = _insert_raw(
        tmp_db, rank=1, character_asset_key="key-1", class_code="A"
    )
    _insert_raw(tmp_db, rank=2, character_asset_key="key-1", class_code="")

    assert not _index_exists(tmp_db)

    result = migrate_unique_snapshot_identity_constraint(tmp_db, dry_run=False)

    assert result["dedupe"]["groups"] == 1
    assert result["dedupe"]["rows_deleted"] == 1
    assert result["index_created"] is True
    assert _index_exists(tmp_db)
    assert _duplicate_group_count(tmp_db) == 0
    with sqlite3.connect(tmp_db) as conn:
        row_ids = [r[0] for r in conn.execute("SELECT id FROM ranking_snapshot")]
    assert row_ids == [keep_id]


def test_migration_dry_run_does_not_create_index_or_delete(tmp_db: Path) -> None:
    _insert_raw(tmp_db, rank=1, character_asset_key="key-1", class_code="A")
    _insert_raw(tmp_db, rank=2, character_asset_key="key-1", class_code="")

    result = migrate_unique_snapshot_identity_constraint(tmp_db, dry_run=True)

    assert result["dedupe"]["rows_deleted"] == 1
    assert result["index_created"] is False
    assert not _index_exists(tmp_db)
    assert _row_count(tmp_db) == 2  # nothing deleted


# (b) constraint rejects re-insertion of the same (snapshot_date, asset_key)
def test_constraint_rejects_duplicate_date_asset_key_reinsertion(tmp_db: Path) -> None:
    _insert_raw(tmp_db, rank=1, character_asset_key="key-1")
    create_unique_snapshot_identity_index(tmp_db)

    with pytest.raises(sqlite3.IntegrityError):
        _insert_raw(tmp_db, rank=2, character_asset_key="key-1")


def test_constraint_via_append_snapshots_silently_skips_duplicate(tmp_db: Path) -> None:
    """append_snapshots uses INSERT OR IGNORE -- a same-day, same-identity
    re-fetch at a different rank must now be silently skipped instead of
    creating a second row for the same character."""
    create_unique_snapshot_identity_index(tmp_db)
    first = SnapshotRow(
        "2026-06-01", 1, 0, "Hero", "HERO", "HERO4", 250, 100, "", "key-1"
    )
    saved, skipped = append_snapshots(tmp_db, [first], "2026-06-01T00:20:00+00:00")
    assert (saved, skipped) == (1, 0)

    duplicate_identity_different_rank = SnapshotRow(
        "2026-06-01", 2, 0, "Hero", "HERO", "HERO4", 250, 999, "", "key-1"
    )
    saved, skipped = append_snapshots(
        tmp_db, [duplicate_identity_different_rank], "2026-06-01T00:30:00+00:00"
    )
    assert (saved, skipped) == (0, 1)
    assert _row_count(tmp_db) == 1


# (c) empty asset_key rows are out of scope for the constraint
def test_constraint_does_not_apply_to_empty_asset_key_rows(tmp_db: Path) -> None:
    create_unique_snapshot_identity_index(tmp_db)
    _insert_raw(tmp_db, rank=1, character_asset_key="", character_name="A")
    # Must not raise -- second empty-asset_key row on the same date is allowed.
    _insert_raw(tmp_db, rank=2, character_asset_key="", character_name="B")
    assert _row_count(tmp_db) == 2


# (d) idempotency: running the migration twice is a no-op the second time
def test_migration_is_idempotent(tmp_db: Path) -> None:
    _insert_raw(tmp_db, rank=1, character_asset_key="key-1", class_code="A")
    _insert_raw(tmp_db, rank=2, character_asset_key="key-1", class_code="")

    first = migrate_unique_snapshot_identity_constraint(tmp_db, dry_run=False)
    assert first["dedupe"]["rows_deleted"] == 1
    row_count_after_first = _row_count(tmp_db)

    second = migrate_unique_snapshot_identity_constraint(tmp_db, dry_run=False)
    assert second["dedupe"]["groups"] == 0
    assert second["dedupe"]["rows_deleted"] == 0
    assert second["index_created"] is True  # CREATE INDEX IF NOT EXISTS, safe no-op
    assert _row_count(tmp_db) == row_count_after_first


# (e) pre-existing UNIQUE(snapshot_date, rank) constraint is unaffected
def test_existing_unique_snapshot_date_rank_constraint_still_enforced(
    tmp_db: Path,
) -> None:
    create_unique_snapshot_identity_index(tmp_db)
    _insert_raw(tmp_db, rank=1, character_asset_key="key-1")
    with pytest.raises(sqlite3.IntegrityError):
        _insert_raw(tmp_db, rank=1, character_asset_key="key-2")


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-v"]))
