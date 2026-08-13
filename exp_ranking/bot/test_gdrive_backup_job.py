"""Unit tests for gdrive_backup_job.py (T12 P5.5, commit4 orchestrator).

Only the network/secret-touching Drive calls (gd.build_drive_service /
upload_backup / download_backup / list_backups / delete_backup) and
release_store.download_current_asset are faked here. Everything else
(SHA-256, gzip, SQLite, retention math, V0-V7) runs for real against
tmp_path files, matching the "verify against real behaviour, not a mock"
convention already used by test_release_store.py / test_gdrive_backup_*.py.
"""

from __future__ import annotations

import gzip
from datetime import datetime, timezone
from pathlib import Path

import pytest

import gdrive_backup as gd
import gdrive_backup_job as job
from models import SnapshotRow
from release_store import ReleaseStoreError
from sqlite_storage import append_snapshots

NOW = datetime(2026, 8, 13, 9, 5, 0, tzinfo=timezone.utc)

REQUIRED_ENV = {
    "GDRIVE_CLIENT_ID": "client-id",
    "GDRIVE_CLIENT_SECRET": "client-secret",
    "GDRIVE_REFRESH_TOKEN": "refresh-token",
    "GDRIVE_BACKUP_FOLDER_ID": "folder-id",
    "GDRIVE_BACKUP_RUN_ID": "999",
}


def _row(date: str, rank: int, name: str, exp: int, asset_key: str) -> SnapshotRow:
    return SnapshotRow(date, rank, 0, name, "", "", 225, exp, "", asset_key)


def _set_required_env(monkeypatch, sha256: str) -> None:
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("GDRIVE_BACKUP_EXPECTED_SHA256", sha256)


def _make_release_gz_bytes(tmp_path: Path) -> bytes:
    db_path = tmp_path / "source.db"
    append_snapshots(
        db_path,
        [_row("2026-08-13", 1, "Alpha", 100, "asset-a")],
        fetched_at="2026-08-13T09:00:00+00:00",
    )
    gz_path = tmp_path / "source.db.gz"
    with open(db_path, "rb") as src, gzip.open(gz_path, "wb") as dst:
        dst.write(src.read())
    return gz_path.read_bytes()


class _DriveState:
    """In-memory fake standing in for the whole Drive API surface used by
    gdrive_backup.py's functions (build_drive_service/upload_backup/
    download_backup/list_backups/delete_backup)."""

    def __init__(self, existing_files: list[dict] | None = None):
        self.existing_files = list(existing_files or [])
        self.stored: dict[str, bytes] = {}
        self.deleted_ids: list[str] = []
        self.build_service_calls = 0
        self._next_id = 1

    def build_drive_service(self, client_id, client_secret, refresh_token):
        self.build_service_calls += 1
        return "fake-service"

    def upload_backup(self, service, folder_id, local_path, filename):
        file_id = f"file-{self._next_id}"
        self._next_id += 1
        payload = Path(local_path).read_bytes()
        self.stored[file_id] = payload
        metadata = {"id": file_id, "name": filename, "size": str(len(payload))}
        self.existing_files.append(metadata)
        return metadata

    def download_backup(self, service, file_id, dest_path):
        dest_path = Path(dest_path)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(self.stored[file_id])

    def list_backups(self, service, folder_id):
        return list(self.existing_files)

    def delete_backup(self, service, file_id):
        self.deleted_ids.append(file_id)
        self.existing_files = [f for f in self.existing_files if f["id"] != file_id]


def _wire_drive_fakes(monkeypatch, state: _DriveState) -> None:
    monkeypatch.setattr(job.gd, "build_drive_service", state.build_drive_service)
    monkeypatch.setattr(job.gd, "upload_backup", state.upload_backup)
    monkeypatch.setattr(job.gd, "download_backup", state.download_backup)
    monkeypatch.setattr(job.gd, "list_backups", state.list_backups)
    monkeypatch.setattr(job.gd, "delete_backup", state.delete_backup)


# ---------------------------------------------------------------------------
# no-op / env guard
# ---------------------------------------------------------------------------


def test_run_is_noop_when_expected_sha256_missing(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("GDRIVE_BACKUP_EXPECTED_SHA256", raising=False)
    calls = []
    monkeypatch.setattr(job, "download_current_asset", lambda *a, **k: calls.append(1))

    rc = job.run(work_dir=tmp_path / "work", now_utc=NOW)

    assert rc == 0
    assert calls == []


def test_run_raises_when_required_env_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("GDRIVE_BACKUP_EXPECTED_SHA256", "abc123")
    monkeypatch.delenv("GDRIVE_CLIENT_ID", raising=False)

    with pytest.raises(job.BackupJobError, match="GDRIVE_CLIENT_ID"):
        job.run(work_dir=tmp_path / "work", now_utc=NOW)


# ---------------------------------------------------------------------------
# Release Asset re-fetch / V0
# ---------------------------------------------------------------------------


def test_run_raises_when_release_asset_not_found(monkeypatch, tmp_path: Path):
    _set_required_env(monkeypatch, "deadbeef")
    monkeypatch.setattr(job, "download_current_asset", lambda dest, **k: False)

    with pytest.raises(job.BackupJobError, match="Release Asset"):
        job.run(work_dir=tmp_path / "work", now_utc=NOW)


def test_run_summarizes_release_store_error_without_raw_message(monkeypatch, tmp_path: Path):
    _set_required_env(monkeypatch, "deadbeef")

    def boom(dest, **kwargs):
        raise ReleaseStoreError("gh release download failed: token=SUPER-SECRET-abc")

    monkeypatch.setattr(job, "download_current_asset", boom)

    with pytest.raises(job.BackupJobError) as exc_info:
        job.run(work_dir=tmp_path / "work", now_utc=NOW)
    assert "SUPER-SECRET-abc" not in str(exc_info.value)
    assert "ReleaseStoreError" in str(exc_info.value)


def test_run_raises_on_v0_mismatch_and_never_calls_drive(monkeypatch, tmp_path: Path):
    payload = _make_release_gz_bytes(tmp_path)

    def fake_download(dest, **kwargs):
        Path(dest).write_bytes(payload)
        return True

    monkeypatch.setattr(job, "download_current_asset", fake_download)
    _set_required_env(monkeypatch, "0000000000000000000000000000000000000000000000000000000000000000")

    state = _DriveState()
    _wire_drive_fakes(monkeypatch, state)

    with pytest.raises(job.BackupJobError, match="V0失敗"):
        job.run(work_dir=tmp_path / "work", now_utc=NOW)

    assert state.build_service_calls == 0
    assert state.stored == {}


# ---------------------------------------------------------------------------
# full success path (V0-V7 + retention delete)
# ---------------------------------------------------------------------------


def test_run_full_success_deletes_old_generation_and_keeps_recent(monkeypatch, tmp_path: Path):
    payload = _make_release_gz_bytes(tmp_path)
    import hashlib

    expected_sha256 = hashlib.sha256(payload).hexdigest()

    def fake_download(dest, **kwargs):
        Path(dest).write_bytes(payload)
        return True

    monkeypatch.setattr(job, "download_current_asset", fake_download)
    _set_required_env(monkeypatch, expected_sha256)

    old_deletable = {
        "id": "file-old",
        "name": "ranking-db-2000-01-01T090000Z-run-1.db.gz",
        "size": "10",
    }
    recent_keep = {
        "id": "file-recent",
        "name": "ranking-db-2026-08-12T090000Z-run-2.db.gz",
        "size": "10",
    }
    state = _DriveState(existing_files=[old_deletable, recent_keep])
    _wire_drive_fakes(monkeypatch, state)

    rc = job.run(work_dir=tmp_path / "work", now_utc=NOW)

    assert rc == 0
    assert state.build_service_calls == 1
    # exactly one new file uploaded, with real content matching the Release asset
    new_files = [f for f in state.existing_files if f["id"] not in ("file-old", "file-recent")]
    assert len(new_files) == 1
    assert state.stored[new_files[0]["id"]] == payload
    # 2000-01-01 is far more than 8 days before "now" -> deleted; recent kept
    assert state.deleted_ids == ["file-old"]
    remaining_ids = {f["id"] for f in state.existing_files}
    assert remaining_ids == {"file-recent", new_files[0]["id"]}


def test_run_skips_deletion_when_min_keep_guard_triggers(monkeypatch, tmp_path: Path):
    payload = _make_release_gz_bytes(tmp_path)
    import hashlib

    expected_sha256 = hashlib.sha256(payload).hexdigest()

    def fake_download(dest, **kwargs):
        Path(dest).write_bytes(payload)
        return True

    monkeypatch.setattr(job, "download_current_asset", fake_download)
    _set_required_env(monkeypatch, expected_sha256)

    # Only one existing (old, deletable) generation -- deleting it would
    # leave just the brand-new upload (1 total), below min_keep(2).
    only_old = {
        "id": "file-old",
        "name": "ranking-db-2000-01-01T090000Z-run-1.db.gz",
        "size": "10",
    }
    state = _DriveState(existing_files=[only_old])
    _wire_drive_fakes(monkeypatch, state)

    rc = job.run(work_dir=tmp_path / "work", now_utc=NOW)

    assert rc == 0
    assert state.deleted_ids == []
    remaining_ids = {f["id"] for f in state.existing_files}
    assert "file-old" in remaining_ids  # nothing was deleted


def test_run_raises_but_keeps_new_backup_when_deletion_fails(monkeypatch, tmp_path: Path):
    payload = _make_release_gz_bytes(tmp_path)
    import hashlib

    expected_sha256 = hashlib.sha256(payload).hexdigest()

    def fake_download(dest, **kwargs):
        Path(dest).write_bytes(payload)
        return True

    monkeypatch.setattr(job, "download_current_asset", fake_download)
    _set_required_env(monkeypatch, expected_sha256)

    old_deletable = {
        "id": "file-old",
        "name": "ranking-db-2000-01-01T090000Z-run-1.db.gz",
        "size": "10",
    }
    recent_keep = {
        "id": "file-recent",
        "name": "ranking-db-2026-08-12T090000Z-run-2.db.gz",
        "size": "10",
    }
    state = _DriveState(existing_files=[old_deletable, recent_keep])
    _wire_drive_fakes(monkeypatch, state)

    def boom_delete(service, file_id):
        raise gd.GDriveBackupError(f"delete failed for {file_id}")

    monkeypatch.setattr(job.gd, "delete_backup", boom_delete)

    with pytest.raises(job.BackupJobError, match="削除に失敗"):
        job.run(work_dir=tmp_path / "work", now_utc=NOW)

    # The new backup itself must still be present (upload already completed
    # and was verified before deletion was ever attempted).
    new_files = [
        f for f in state.existing_files if f["id"] not in ("file-old", "file-recent")
    ]
    assert len(new_files) == 1
    assert state.stored[new_files[0]["id"]] == payload
