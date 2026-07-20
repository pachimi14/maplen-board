"""Unit tests for release_store.py (T12 P2).

All `gh` CLI calls are mocked via monkeypatch. These tests never touch a real
GitHub Release. The additive-merge assertions exercise real SQLite DBs
through `sqlite_storage.merge_ranking_databases` (the same function reused by
`release_store.sync_db_to_release`), so the union/no-regression property is
verified against real behaviour, not a mock.
"""

from __future__ import annotations

import gzip
import subprocess
from pathlib import Path

import pytest

import release_store
from models import SnapshotRow
from sqlite_storage import append_snapshots, load_all_snapshots


def _row(date: str, rank: int, name: str, exp: int, asset_key: str) -> SnapshotRow:
    return SnapshotRow(date, rank, 0, name, "", "", 225, exp, "", asset_key)


def _fake_completed(returncode: int, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=["gh"], returncode=returncode, stdout=stdout, stderr=stderr)


# ---------------------------------------------------------------------------
# release_exists
# ---------------------------------------------------------------------------


def test_release_exists_true_when_gh_view_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        calls.append(cmd)
        return _fake_completed(0)

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    assert release_store.release_exists("db-store") is True
    assert calls == [["gh", "release", "view", "db-store"]]


def test_release_exists_false_when_gh_reports_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        return _fake_completed(1, stderr="release not found")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    assert release_store.release_exists("db-store") is False


def test_release_exists_raises_on_unexpected_error_instead_of_assuming_absence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A transient/auth failure must NOT be treated as 'release absent', or a
    caller could skip additive-merge and blind-clobber real data (INV-2)."""

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        return _fake_completed(1, stderr="error connecting to api.github.com: timeout")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    with pytest.raises(release_store.ReleaseStoreError):
        release_store.release_exists("db-store")


# ---------------------------------------------------------------------------
# download_current_asset
# ---------------------------------------------------------------------------


def test_download_current_asset_returns_false_when_release_absent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        assert cmd[:3] == ["gh", "release", "view"]
        return _fake_completed(1, stderr="release not found")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    dest = tmp_path / "ranking.db.gz"
    assert release_store.download_current_asset(dest, tag="db-store") is False
    assert not dest.exists()


def test_download_current_asset_writes_file_on_success(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    payload = b"fake-gzip-bytes"
    calls: list[list[str]] = []

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        calls.append(cmd)
        if cmd[:3] == ["gh", "release", "view"]:
            return _fake_completed(0)
        if cmd[:3] == ["gh", "release", "download"]:
            dir_index = cmd.index("--dir") + 1
            target_dir = Path(cmd[dir_index])
            (target_dir / "ranking.db.gz").write_bytes(payload)
            return _fake_completed(0)
        raise AssertionError(f"unexpected gh call: {cmd}")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    dest = tmp_path / "downloaded.db.gz"
    ok = release_store.download_current_asset(dest, tag="db-store")
    assert ok is True
    assert dest.read_bytes() == payload
    # order: view before download
    assert calls[0][:3] == ["gh", "release", "view"]
    assert calls[1][:3] == ["gh", "release", "download"]
    assert "--clobber" in calls[1]


def test_download_current_asset_returns_false_when_asset_missing_on_existing_release(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        if cmd[:3] == ["gh", "release", "view"]:
            return _fake_completed(0)
        if cmd[:3] == ["gh", "release", "download"]:
            return _fake_completed(1, stderr="no assets match pattern")
        raise AssertionError(f"unexpected gh call: {cmd}")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    dest = tmp_path / "downloaded.db.gz"
    assert release_store.download_current_asset(dest, tag="db-store") is False


def test_download_current_asset_raises_on_ambiguous_failure_instead_of_assuming_absence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Regression for the P1 gap flagged in code-review: a transient download
    failure (network/rate-limit/auth — NOT a confirmed 'asset absent' message)
    must raise, not return False. Returning False here would make
    `sync_db_to_release` skip additive-merge and `--clobber` upload the local
    DB as-is, silently dropping any rows that only exist on the current
    Release Asset (blind clobber, INV-2 violation)."""

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        if cmd[:3] == ["gh", "release", "view"]:
            return _fake_completed(0)
        if cmd[:3] == ["gh", "release", "download"]:
            return _fake_completed(1, stderr="error connecting to api.github.com: timeout")
        raise AssertionError(f"unexpected gh call: {cmd}")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    dest = tmp_path / "downloaded.db.gz"
    with pytest.raises(release_store.ReleaseStoreError):
        release_store.download_current_asset(dest, tag="db-store")
    assert not dest.exists()


def test_download_current_asset_raises_when_gh_reports_success_but_file_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Anomalous case: gh exits 0 but produced no file. Must not be silently
    treated as 'no asset' — fail closed."""

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        if cmd[:3] == ["gh", "release", "view"]:
            return _fake_completed(0)
        if cmd[:3] == ["gh", "release", "download"]:
            return _fake_completed(0)  # success, but no file written to --dir
        raise AssertionError(f"unexpected gh call: {cmd}")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    dest = tmp_path / "downloaded.db.gz"
    with pytest.raises(release_store.ReleaseStoreError):
        release_store.download_current_asset(dest, tag="db-store")


def test_sync_db_to_release_aborts_without_uploading_on_ambiguous_download_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """End-to-end (through sync_db_to_release, not a mocked download_current_asset):
    an ambiguous gh failure during download must propagate and `upload_asset`
    must never be called — i.e. no blind clobber happens."""
    local_db = tmp_path / "local.db"
    append_snapshots(
        local_db,
        [_row("2026-07-19", 1, "Alpha", 500, "asset-a")],
        fetched_at="2026-07-19T09:00:00+00:00",
    )

    upload_calls = 0

    def fake_upload_asset(*args: object, **kwargs: object) -> None:
        nonlocal upload_calls
        upload_calls += 1

    monkeypatch.setattr(release_store, "upload_asset", fake_upload_asset)

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        if cmd[:3] == ["gh", "release", "view"]:
            return _fake_completed(0)
        if cmd[:3] == ["gh", "release", "download"]:
            return _fake_completed(1, stderr="429 rate limit exceeded")
        raise AssertionError(f"unexpected gh call: {cmd}")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)

    with pytest.raises(release_store.ReleaseStoreError):
        release_store.sync_db_to_release(local_db, tag="db-store")

    assert upload_calls == 0


# ---------------------------------------------------------------------------
# ensure_release / upload_asset
# ---------------------------------------------------------------------------


def test_ensure_release_creates_when_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        calls.append(cmd)
        if cmd[:3] == ["gh", "release", "view"]:
            return _fake_completed(1, stderr="release not found")
        if cmd[:3] == ["gh", "release", "create"]:
            return _fake_completed(0)
        raise AssertionError(f"unexpected gh call: {cmd}")

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    release_store.ensure_release("db-store")
    assert calls[0][:3] == ["gh", "release", "view"]
    assert calls[1][:3] == ["gh", "release", "create"]
    assert "--prerelease" in calls[1]


def test_ensure_release_no_op_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        calls.append(cmd)
        return _fake_completed(0)

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    release_store.ensure_release("db-store")
    assert len(calls) == 1
    assert calls[0][:3] == ["gh", "release", "view"]


def test_upload_asset_ensures_release_then_uploads_with_clobber(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        calls.append(cmd)
        return _fake_completed(0)

    monkeypatch.setattr(release_store.subprocess, "run", fake_run)
    file_path = tmp_path / "ranking.db.gz"
    file_path.write_bytes(b"data")
    release_store.upload_asset(file_path, tag="db-store")

    assert calls[0][:3] == ["gh", "release", "view"]  # ensure_release check
    assert calls[1][:3] == ["gh", "release", "upload"]
    assert calls[1][3] == "db-store"
    assert calls[1][4] == str(file_path)
    assert "--clobber" in calls[1]


# ---------------------------------------------------------------------------
# sync_db_to_release: additive-merge behaviour (real SQLite, mocked gh layer)
# ---------------------------------------------------------------------------


def test_sync_db_to_release_first_time_seed_uploads_local_as_is(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    local_db = tmp_path / "local.db"
    append_snapshots(
        local_db,
        [_row("2026-07-18", 1, "Alpha", 100, "asset-a")],
        fetched_at="2026-07-18T09:00:00+00:00",
    )

    monkeypatch.setattr(release_store, "release_exists", lambda tag=release_store.DB_STORE_TAG: False)

    uploaded_paths: list[Path] = []

    def fake_upload_asset(file_path: Path, *, tag: str = release_store.DB_STORE_TAG) -> None:
        # Capture bytes now — sync_db_to_release uploads from within a
        # TemporaryDirectory that is cleaned up before the test can inspect it.
        captured = tmp_path / "captured_first_seed.db.gz"
        captured.write_bytes(Path(file_path).read_bytes())
        uploaded_paths.append(captured)

    monkeypatch.setattr(release_store, "upload_asset", fake_upload_asset)

    result = release_store.sync_db_to_release(local_db, tag="db-store")

    assert result == {"downloaded": False, "merged_rows": 0, "uploaded": True}
    assert len(uploaded_paths) == 1
    with gzip.open(uploaded_paths[0], "rb") as f:
        assert f.read() == local_db.read_bytes()


def test_sync_db_to_release_additive_merge_preserves_release_only_rows(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Uploading a locally-fresh-but-incomplete DB must not drop rows that
    only exist on the current Release Asset (union, monotonic increase —
    acceptance criterion 4: 'fresh -> stale の順で merge しても現Asset行が保持')."""
    local_db = tmp_path / "local.db"
    append_snapshots(
        local_db,
        [_row("2026-07-19", 1, "Alpha", 500, "asset-a")],
        fetched_at="2026-07-19T09:00:00+00:00",
    )

    release_db = tmp_path / "release_side.db"
    append_snapshots(
        release_db,
        [
            _row("2026-07-18", 1, "Alpha", 100, "asset-a"),
            _row("2026-07-18", 2, "Beta", 50, "asset-b"),
        ],
        fetched_at="2026-07-18T09:00:00+00:00",
    )
    release_gz = tmp_path / "release_asset.db.gz"
    release_store._gzip_file(release_db, release_gz)

    def fake_download_current_asset(
        dest_path: Path, *, tag: str = release_store.DB_STORE_TAG, asset_name: str = release_store.DB_STORE_ASSET_NAME
    ) -> bool:
        dest_path = Path(dest_path)
        dest_path.write_bytes(release_gz.read_bytes())
        return True

    monkeypatch.setattr(release_store, "download_current_asset", fake_download_current_asset)

    uploaded_paths: list[Path] = []

    def fake_upload_asset(file_path: Path, *, tag: str = release_store.DB_STORE_TAG) -> None:
        # Capture the bytes now — sync_db_to_release uploads from within a
        # TemporaryDirectory that is cleaned up on return.
        captured = tmp_path / "captured_upload.db.gz"
        captured.write_bytes(Path(file_path).read_bytes())
        uploaded_paths.append(captured)

    monkeypatch.setattr(release_store, "upload_asset", fake_upload_asset)

    result = release_store.sync_db_to_release(local_db, tag="db-store")

    assert result["downloaded"] is True
    assert result["merged_rows"] == 2  # both 2026-07-18 rows added from release
    assert result["uploaded"] is True

    # local_db itself was merged in place (primary), so it now holds the union.
    merged_rows = {(r.snapshot_date, r.rank, r.character_name) for r in load_all_snapshots(local_db)}
    assert merged_rows == {
        ("2026-07-18", 1, "Alpha"),
        ("2026-07-18", 2, "Beta"),
        ("2026-07-19", 1, "Alpha"),
    }

    # the uploaded gz also reflects the union (what actually lands back on Release).
    uploaded_db = tmp_path / "uploaded.db"
    release_store._gunzip_file(uploaded_paths[0], uploaded_db)
    uploaded_rows = {(r.snapshot_date, r.rank, r.character_name) for r in load_all_snapshots(uploaded_db)}
    assert uploaded_rows == merged_rows


def test_sync_db_to_release_aborts_without_uploading_on_unexpected_download_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """If we cannot reliably determine the current Release state, we must not
    proceed to clobber-upload (fail closed, INV-2)."""
    local_db = tmp_path / "local.db"
    append_snapshots(
        local_db,
        [_row("2026-07-19", 1, "Alpha", 500, "asset-a")],
        fetched_at="2026-07-19T09:00:00+00:00",
    )

    def fake_download_current_asset(*args: object, **kwargs: object) -> bool:
        raise release_store.ReleaseStoreError("gh release view failed unexpectedly")

    monkeypatch.setattr(release_store, "download_current_asset", fake_download_current_asset)

    upload_called = False

    def fake_upload_asset(*args: object, **kwargs: object) -> None:
        nonlocal upload_called
        upload_called = True

    monkeypatch.setattr(release_store, "upload_asset", fake_upload_asset)

    with pytest.raises(release_store.ReleaseStoreError):
        release_store.sync_db_to_release(local_db, tag="db-store")

    assert upload_called is False


def test_sync_db_to_release_raises_when_local_db_missing(tmp_path: Path) -> None:
    with pytest.raises(release_store.ReleaseStoreError):
        release_store.sync_db_to_release(tmp_path / "does-not-exist.db")
