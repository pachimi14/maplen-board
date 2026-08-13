"""Unit tests for gdrive_backup.py (T12 P5.5, commit1).

方針(release_store のテストと同じ流儀):
    - 実 Drive API・実 OAuth・実トークンには一切アクセスしない
    - google-auth / google-api-python-client はフェイクへ差し替える
      (monkeypatch で実パッケージのシンボルを直接置き換える。
      これらは requirements-backup.txt でインストール済みの前提)
    - 秘密情報(client secret / refresh token)が例外メッセージに
      現れないことを直接検証する
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

import pytest

import gdrive_backup as gd


# ---------------------------------------------------------------------------
# build_backup_filename / parse_backup_filename (§2.3)
# ---------------------------------------------------------------------------


def test_build_backup_filename_matches_spec_example():
    now_utc = datetime(2026, 7, 29, 9, 5, 0, tzinfo=timezone.utc)
    name = gd.build_backup_filename(now_utc, "30370939192")
    assert name == "ranking-db-2026-07-29T090500Z-run-30370939192.db.gz"


def test_build_backup_filename_rejects_naive_datetime():
    with pytest.raises(ValueError):
        gd.build_backup_filename(datetime(2026, 7, 29, 9, 5, 0), "123")


def test_build_backup_filename_converts_non_utc_timezone():
    # JST 18:05 == UTC 09:05
    from datetime import timedelta, timezone as tz

    jst = tz(timedelta(hours=9))
    now_jst = datetime(2026, 7, 29, 18, 5, 0, tzinfo=jst)
    name = gd.build_backup_filename(now_jst, "1")
    assert name == "ranking-db-2026-07-29T090500Z-run-1.db.gz"


def test_parse_backup_filename_round_trips_with_build():
    now_utc = datetime(2026, 7, 29, 9, 5, 0, tzinfo=timezone.utc)
    name = gd.build_backup_filename(now_utc, "30370939192")
    parsed = gd.parse_backup_filename(name)
    assert parsed == {"date": "2026-07-29", "time": "090500", "run_id": "30370939192"}


@pytest.mark.parametrize(
    "name",
    [
        "not-a-backup.db.gz",
        "ranking-db-2026-07-29-run-1.db.gz",  # missing T..Z time
        "ranking-db-2026-07-29T090500Z-run-1.db",  # missing .gz
        "ranking-db-2026-13-99T090500Z-run-1.db.gz",  # not validated numerically but shape differs (still matches regex though) -- see below
        "",
    ],
)
def test_parse_backup_filename_returns_none_for_non_matching_names(name):
    if name == "ranking-db-2026-13-99T090500Z-run-1.db.gz":
        # This one *does* match the shape (regex doesn't validate calendar
        # validity), so skip it here -- covered separately below.
        pytest.skip("shape-only regex; calendar validity is not this module's job")
    assert gd.parse_backup_filename(name) is None


def test_parse_backup_filename_does_not_validate_calendar_correctness():
    """The filename regex is shape-only; retention.py's date.fromisoformat
    would reject an invalid calendar date, but gd.parse_backup_filename
    itself just extracts the substrings."""
    parsed = gd.parse_backup_filename("ranking-db-2026-13-99T090500Z-run-1.db.gz")
    assert parsed == {"date": "2026-13-99", "time": "090500", "run_id": "1"}


# ---------------------------------------------------------------------------
# compute_sha256
# ---------------------------------------------------------------------------


def test_compute_sha256_matches_hashlib_direct(tmp_path: Path):
    payload = b"hello world" * 1000
    file_path = tmp_path / "sample.bin"
    file_path.write_bytes(payload)

    expected = hashlib.sha256(payload).hexdigest()
    assert gd.compute_sha256(file_path) == expected


def test_compute_sha256_handles_small_chunk_size(tmp_path: Path):
    payload = bytes(range(256)) * 10
    file_path = tmp_path / "sample.bin"
    file_path.write_bytes(payload)

    expected = hashlib.sha256(payload).hexdigest()
    assert gd.compute_sha256(file_path, chunk_size=7) == expected


# ---------------------------------------------------------------------------
# build_drive_service (§2.6 認証)
# ---------------------------------------------------------------------------


class _FakeCredentials:
    def __init__(self, refresh_token, **kwargs):
        self.refresh_token = refresh_token
        self.kwargs = kwargs
        self.refreshed_with = None

    def refresh(self, request):
        self.refreshed_with = request


def test_build_drive_service_refreshes_credentials_and_builds_service(monkeypatch):
    created_credentials = {}

    def fake_credentials_ctor(token, **kwargs):
        cred = _FakeCredentials(**kwargs)
        created_credentials["instance"] = cred
        return cred

    monkeypatch.setattr("google.oauth2.credentials.Credentials", fake_credentials_ctor)
    monkeypatch.setattr("google.auth.transport.requests.Request", lambda: "fake-request")

    build_calls = []

    def fake_build(*args, **kwargs):
        build_calls.append((args, kwargs))
        return "fake-drive-service"

    monkeypatch.setattr("googleapiclient.discovery.build", fake_build)

    service = gd.build_drive_service("client-id", "client-secret", "refresh-token")

    assert service == "fake-drive-service"
    assert created_credentials["instance"].refreshed_with == "fake-request"
    assert build_calls[0][1]["credentials"] is created_credentials["instance"]


def test_build_drive_service_summarizes_refresh_failure_without_leaking_secret(monkeypatch):
    secret_value = "sooper-sekrit-client-secret"
    refresh_token_value = "1//fake-refresh-token-value"

    class _BoomCredentials:
        def __init__(self, token, **kwargs):
            self._kwargs = kwargs

        def refresh(self, request):
            raise RuntimeError(
                f"invalid_grant: client_secret={secret_value} refresh_token={refresh_token_value}"
            )

    monkeypatch.setattr("google.oauth2.credentials.Credentials", _BoomCredentials)
    monkeypatch.setattr("google.auth.transport.requests.Request", lambda: object())

    with pytest.raises(gd.GDriveBackupError) as exc_info:
        gd.build_drive_service("client-id", secret_value, refresh_token_value)

    message = str(exc_info.value)
    assert secret_value not in message
    assert refresh_token_value not in message
    assert "RuntimeError" in message


# ---------------------------------------------------------------------------
# upload_backup / download_backup / list_backups / delete_backup
# ---------------------------------------------------------------------------


class _FakeExecutable:
    def __init__(self, result=None, error=None):
        self._result = result
        self._error = error

    def execute(self):
        if self._error is not None:
            raise self._error
        return self._result


class _FakeFilesResource:
    def __init__(self):
        self.create_calls = []
        self.delete_calls = []
        self.list_calls = []
        self.get_media_calls = []
        self._list_pages = []
        self._create_result = None
        self._create_error = None
        self._delete_error = None

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return _FakeExecutable(self._create_result, self._create_error)

    def delete(self, **kwargs):
        self.delete_calls.append(kwargs)
        return _FakeExecutable({}, self._delete_error)

    def list(self, **kwargs):
        self.list_calls.append(kwargs)
        page = self._list_pages[len(self.list_calls) - 1]
        return _FakeExecutable(page)

    def get_media(self, **kwargs):
        self.get_media_calls.append(kwargs)
        return _FakeRequest(payload=b"drive-file-bytes")


class _FakeRequest:
    def __init__(self, payload: bytes):
        self.payload = payload


class _FakeDriveService:
    def __init__(self):
        self._files = _FakeFilesResource()

    def files(self):
        return self._files


def test_upload_backup_sends_expected_metadata_and_returns_response(monkeypatch, tmp_path: Path):
    service = _FakeDriveService()
    service._files._create_result = {"id": "file-123", "name": "x.db.gz", "size": "42"}

    fake_media = object()
    monkeypatch.setattr(
        "googleapiclient.http.MediaFileUpload", lambda *a, **k: fake_media
    )

    local_path = tmp_path / "backup.db.gz"
    local_path.write_bytes(b"gz-bytes")

    result = gd.upload_backup(service, "folder-1", local_path, "ranking-db-x.db.gz")

    assert result == {"id": "file-123", "name": "x.db.gz", "size": "42"}
    call = service._files.create_calls[0]
    assert call["body"] == {"name": "ranking-db-x.db.gz", "parents": ["folder-1"]}
    assert call["media_body"] is fake_media


def test_upload_backup_wraps_error(monkeypatch, tmp_path: Path):
    service = _FakeDriveService()
    service._files._create_error = RuntimeError("quota exceeded")
    monkeypatch.setattr("googleapiclient.http.MediaFileUpload", lambda *a, **k: object())

    local_path = tmp_path / "backup.db.gz"
    local_path.write_bytes(b"gz-bytes")

    with pytest.raises(gd.GDriveBackupError) as exc_info:
        gd.upload_backup(service, "folder-1", local_path, "ranking-db-x.db.gz")
    assert "RuntimeError" in str(exc_info.value)


def test_download_backup_writes_bytes_to_dest(monkeypatch, tmp_path: Path):
    service = _FakeDriveService()

    class _FakeDownloader:
        def __init__(self, fh, request):
            self._fh = fh
            self._request = request

        def next_chunk(self):
            self._fh.write(self._request.payload)
            return None, True

    monkeypatch.setattr("googleapiclient.http.MediaIoBaseDownload", _FakeDownloader)

    dest = tmp_path / "nested" / "downloaded.db.gz"
    gd.download_backup(service, "file-123", dest)

    assert dest.read_bytes() == b"drive-file-bytes"
    assert service._files.get_media_calls == [{"fileId": "file-123"}]


def test_download_backup_wraps_error(monkeypatch, tmp_path: Path):
    service = _FakeDriveService()

    class _BoomDownloader:
        def __init__(self, fh, request):
            pass

        def next_chunk(self):
            raise RuntimeError("network reset")

    monkeypatch.setattr("googleapiclient.http.MediaIoBaseDownload", _BoomDownloader)

    dest = tmp_path / "downloaded.db.gz"
    with pytest.raises(gd.GDriveBackupError) as exc_info:
        gd.download_backup(service, "file-123", dest)
    assert "RuntimeError" in str(exc_info.value)


def test_list_backups_aggregates_across_pages(tmp_path: Path):
    service = _FakeDriveService()
    service._files._list_pages = [
        {"files": [{"id": "a", "name": "a.db.gz"}], "nextPageToken": "page2"},
        {"files": [{"id": "b", "name": "b.db.gz"}]},
    ]

    files = gd.list_backups(service, "folder-1")

    assert files == [{"id": "a", "name": "a.db.gz"}, {"id": "b", "name": "b.db.gz"}]
    assert service._files.list_calls[0]["q"] == "'folder-1' in parents and trashed=false"
    assert service._files.list_calls[1]["pageToken"] == "page2"


def test_list_backups_wraps_error():
    service = _FakeDriveService()
    service._files._list_pages = []

    # No pages configured -> list() called once with no matching page index,
    # simulate error path directly by monkeypatching list() to raise.
    def boom(**kwargs):
        raise RuntimeError("rate limited")

    service._files.list = boom

    with pytest.raises(gd.GDriveBackupError) as exc_info:
        gd.list_backups(service, "folder-1")
    assert "RuntimeError" in str(exc_info.value)


def test_delete_backup_calls_delete_with_file_id():
    service = _FakeDriveService()
    gd.delete_backup(service, "file-123")
    assert service._files.delete_calls == [{"fileId": "file-123"}]


def test_delete_backup_wraps_error():
    service = _FakeDriveService()
    service._files._delete_error = RuntimeError("not found")

    with pytest.raises(gd.GDriveBackupError) as exc_info:
        gd.delete_backup(service, "file-123")
    assert "RuntimeError" in str(exc_info.value)
