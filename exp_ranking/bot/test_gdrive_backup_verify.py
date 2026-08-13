"""Unit tests for gdrive_backup_verify.py (T12 P5.5, commit2).

No Drive API / network is touched here -- every check operates on plain
files, dicts, and real (tmp_path) SQLite databases, matching the module's
own "no I/O of its own" design.
"""

from __future__ import annotations

import gzip
import hashlib
import sqlite3
from pathlib import Path

import gdrive_backup_verify as verify
from models import SnapshotRow
from sqlite_storage import append_snapshots


def _row(date: str, rank: int, name: str, exp: int, asset_key: str) -> SnapshotRow:
    return SnapshotRow(date, rank, 0, name, "", "", 225, exp, "", asset_key)


# ---------------------------------------------------------------------------
# V0
# ---------------------------------------------------------------------------


def test_v0_matches_when_sha256_equal_case_insensitive():
    assert verify.verify_v0_release_matches_expected("ABCDEF", "abcdef") is True


def test_v0_fails_when_mismatched():
    assert verify.verify_v0_release_matches_expected("abc123", "def456") is False


def test_v0_fails_when_either_side_empty():
    assert verify.verify_v0_release_matches_expected("", "abc") is False
    assert verify.verify_v0_release_matches_expected("abc", "") is False


# ---------------------------------------------------------------------------
# V1 / V2 / V3
# ---------------------------------------------------------------------------


def test_v1_true_when_id_present():
    assert verify.verify_v1_exists({"id": "file-1", "size": "10"}) is True


def test_v1_false_when_no_id_or_none():
    assert verify.verify_v1_exists({}) is False
    assert verify.verify_v1_exists(None) is False


def test_v2_true_when_size_positive():
    assert verify.verify_v2_nonzero_size({"size": "42"}) is True


def test_v2_false_when_size_zero_or_missing_or_malformed():
    assert verify.verify_v2_nonzero_size({"size": "0"}) is False
    assert verify.verify_v2_nonzero_size({}) is False
    assert verify.verify_v2_nonzero_size({"size": "not-a-number"}) is False


def test_v3_true_when_size_matches_local_file(tmp_path: Path):
    local = tmp_path / "backup.db.gz"
    local.write_bytes(b"x" * 100)
    assert verify.verify_v3_size_matches_local({"size": "100"}, local) is True


def test_v3_false_when_size_mismatches_or_local_missing(tmp_path: Path):
    local = tmp_path / "backup.db.gz"
    local.write_bytes(b"x" * 99)
    assert verify.verify_v3_size_matches_local({"size": "100"}, local) is False
    assert verify.verify_v3_size_matches_local({"size": "100"}, tmp_path / "missing.db.gz") is False


# ---------------------------------------------------------------------------
# V4
# ---------------------------------------------------------------------------


def test_v4_matches_when_sha256_equal_case_insensitive():
    assert verify.verify_v4_sha256_match("ABCDEF", "abcdef") is True


def test_v4_fails_on_mismatch_or_empty():
    assert verify.verify_v4_sha256_match("abc123", "def456") is False
    assert verify.verify_v4_sha256_match("", "abc") is False


# ---------------------------------------------------------------------------
# V5 (gzip valid)
# ---------------------------------------------------------------------------


def test_v5_true_for_valid_gzip(tmp_path: Path):
    gz_path = tmp_path / "valid.db.gz"
    with gzip.open(gz_path, "wb") as fh:
        fh.write(b"some sqlite bytes" * 1000)
    assert verify.verify_v5_gzip_valid(gz_path) is True


def test_v5_false_for_corrupt_or_missing_gzip(tmp_path: Path):
    corrupt = tmp_path / "corrupt.db.gz"
    corrupt.write_bytes(b"not actually gzip data")
    assert verify.verify_v5_gzip_valid(corrupt) is False
    assert verify.verify_v5_gzip_valid(tmp_path / "missing.db.gz") is False


# ---------------------------------------------------------------------------
# V6 (sqlite openable)
# ---------------------------------------------------------------------------


def test_v6_true_for_valid_sqlite_db(tmp_path: Path):
    db_path = tmp_path / "valid.db"
    append_snapshots(
        db_path,
        [_row("2026-07-29", 1, "Alpha", 100, "asset-a")],
        fetched_at="2026-07-29T09:00:00+00:00",
    )
    assert verify.verify_v6_sqlite_openable(db_path) is True


def test_v6_false_for_corrupt_or_missing_db(tmp_path: Path):
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"this is not a sqlite file at all, just plain bytes")
    assert verify.verify_v6_sqlite_openable(corrupt) is False
    assert verify.verify_v6_sqlite_openable(tmp_path / "missing.db") is False


# ---------------------------------------------------------------------------
# V7 (snapshot_days / rows / latest date match)
# ---------------------------------------------------------------------------


def test_v7_true_when_dbs_are_identical_copies(tmp_path: Path):
    release_db = tmp_path / "release.db"
    append_snapshots(
        release_db,
        [
            _row("2026-07-28", 1, "Alpha", 100, "asset-a"),
            _row("2026-07-29", 1, "Alpha", 200, "asset-a"),
        ],
        fetched_at="2026-07-29T09:00:00+00:00",
    )
    drive_db = tmp_path / "drive.db"
    drive_db.write_bytes(release_db.read_bytes())

    ok, detail = verify.verify_v7_snapshot_stats_match(release_db, drive_db)
    assert ok is True
    assert "snapshot_days=2" in detail
    assert "rows=2" in detail
    assert "2026-07-29" in detail


def test_v7_false_when_drive_db_missing_a_day(tmp_path: Path):
    release_db = tmp_path / "release.db"
    append_snapshots(
        release_db,
        [
            _row("2026-07-28", 1, "Alpha", 100, "asset-a"),
            _row("2026-07-29", 1, "Alpha", 200, "asset-a"),
        ],
        fetched_at="2026-07-29T09:00:00+00:00",
    )
    drive_db = tmp_path / "drive.db"
    append_snapshots(
        drive_db,
        [_row("2026-07-28", 1, "Alpha", 100, "asset-a")],
        fetched_at="2026-07-28T09:00:00+00:00",
    )

    ok, detail = verify.verify_v7_snapshot_stats_match(release_db, drive_db)
    assert ok is False
    assert "release(snapshot_days=2" in detail
    assert "drive(snapshot_days=1" in detail
