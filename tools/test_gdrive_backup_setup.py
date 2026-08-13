# -*- coding: utf-8 -*-
"""
tools/gdrive_backup_setup.py のユニットテスト。

方針:
  - 実ネットワーク・実 OAuth・実秘密情報は一切使用しない
  - google_auth_oauthlib / googleapiclient はモックに置き換える
  - 「秘密情報が出力に現れないこと」を capsys で直接検証する

実行:
  python -m pytest tools/test_gdrive_backup_setup.py -q
"""

import os

import pytest

import gdrive_backup_setup as setup


FAKE_SECRET = "sooper-sekrit-value-should-never-be-printed"
FAKE_REFRESH_TOKEN = "1//fake-refresh-token-should-appear-exactly-once"
FAKE_FOLDER_ID = "fake-folder-id-000"


class _FakeCredentials:
    def __init__(self, refresh_token):
        self.refresh_token = refresh_token


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """各テストで GDRIVE_* / CI 系環境変数の汚染を避ける。"""
    for key in (
        "GDRIVE_CLIENT_ID",
        "GDRIVE_CLIENT_SECRET",
        "GITHUB_ACTIONS",
        "CI",
    ):
        monkeypatch.delenv(key, raising=False)
    yield


# 1. --client-secret は argparse に受け付けられない -----------------------


def test_client_secret_flag_is_rejected_by_argparse():
    with pytest.raises(SystemExit) as exc_info:
        setup.parse_args(["--client-id", "id123", "--client-secret", FAKE_SECRET])
    assert exc_info.value.code == 2


# 2. secret 未指定なら getpass.getpass が呼ばれる --------------------------


def test_getpass_is_called_when_secret_not_provided(monkeypatch):
    calls = []

    def fake_getpass(prompt=""):
        calls.append(prompt)
        return FAKE_SECRET

    monkeypatch.setattr(setup.getpass, "getpass", fake_getpass)
    monkeypatch.setattr(
        setup,
        "_run_oauth_flow",
        lambda **kwargs: _FakeCredentials(FAKE_REFRESH_TOKEN),
    )
    monkeypatch.setattr(
        setup,
        "_find_or_create_backup_folder",
        lambda credentials: (FAKE_FOLDER_ID, True),
    )

    rc = setup.main(["--client-id", "id123"])

    assert rc == 0
    assert len(calls) == 1


# 3. client secret が標準出力・標準エラーに一切現れない --------------------


def test_client_secret_never_appears_in_output(monkeypatch, capsys):
    monkeypatch.setattr(setup.getpass, "getpass", lambda prompt="": FAKE_SECRET)
    monkeypatch.setattr(
        setup,
        "_run_oauth_flow",
        lambda **kwargs: _FakeCredentials(FAKE_REFRESH_TOKEN),
    )
    monkeypatch.setattr(
        setup,
        "_find_or_create_backup_folder",
        lambda credentials: (FAKE_FOLDER_ID, True),
    )

    rc = setup.main(["--client-id", "id123"])
    captured = capsys.readouterr()

    assert rc == 0
    assert FAKE_SECRET not in captured.out
    assert FAKE_SECRET not in captured.err


# 4. refresh token は1回だけ表示され、警告文が併記される -------------------


def test_refresh_token_shown_once_with_warning(monkeypatch, capsys):
    monkeypatch.setattr(setup.getpass, "getpass", lambda prompt="": FAKE_SECRET)
    monkeypatch.setattr(
        setup,
        "_run_oauth_flow",
        lambda **kwargs: _FakeCredentials(FAKE_REFRESH_TOKEN),
    )
    monkeypatch.setattr(
        setup,
        "_find_or_create_backup_folder",
        lambda credentials: (FAKE_FOLDER_ID, True),
    )

    rc = setup.main(["--client-id", "id123"])
    captured = capsys.readouterr()

    assert rc == 0
    assert captured.out.count(FAKE_REFRESH_TOKEN) == 1
    assert setup.REFRESH_TOKEN_WARNING in captured.out


# 5. token.json 等のファイルが作られない -----------------------------------


def test_no_token_file_is_created(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(setup.getpass, "getpass", lambda prompt="": FAKE_SECRET)
    monkeypatch.setattr(
        setup,
        "_run_oauth_flow",
        lambda **kwargs: _FakeCredentials(FAKE_REFRESH_TOKEN),
    )
    monkeypatch.setattr(
        setup,
        "_find_or_create_backup_folder",
        lambda credentials: (FAKE_FOLDER_ID, True),
    )

    rc = setup.main(["--client-id", "id123"])

    assert rc == 0
    assert os.listdir(tmp_path) == []


# 6. 例外経路で secret / token が漏れない -----------------------------------


def test_exception_path_does_not_leak_secret_or_token(monkeypatch, capsys):
    monkeypatch.setattr(setup.getpass, "getpass", lambda prompt="": FAKE_SECRET)

    def boom(**kwargs):
        # 例外メッセージにわざと秘密情報を含めて、漏えいしないことを確認する
        raise RuntimeError(f"network error while using secret={FAKE_SECRET}")

    monkeypatch.setattr(setup, "_run_oauth_flow", boom)

    rc = setup.main(["--client-id", "id123"])
    captured = capsys.readouterr()

    assert rc == 1
    assert FAKE_SECRET not in captured.out
    assert FAKE_SECRET not in captured.err
    assert "RuntimeError" in captured.err


# 7. GITHUB_ACTIONS=true では実行を拒否する ---------------------------------


def test_refuses_to_run_under_github_actions(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")

    oauth_called = []
    monkeypatch.setattr(
        setup, "_run_oauth_flow", lambda **kwargs: oauth_called.append(True)
    )

    rc = setup.main(["--client-id", "id123"])

    assert rc == 3
    assert oauth_called == []


def test_refuses_to_run_under_generic_ci(monkeypatch):
    monkeypatch.setenv("CI", "true")

    oauth_called = []
    monkeypatch.setattr(
        setup, "_run_oauth_flow", lambda **kwargs: oauth_called.append(True)
    )

    rc = setup.main(["--client-id", "id123"])

    assert rc == 3
    assert oauth_called == []


# 8. フォルダ冪等性: 既存フォルダがあれば作成しない -------------------------


class _FakeExecutable:
    def __init__(self, result):
        self._result = result

    def execute(self):
        return self._result


class _FakeFilesResource:
    """googleapiclient の service.files() を模したフェイク。"""

    def __init__(self, existing_files):
        self._existing_files = existing_files
        self.create_called = False

    def list(self, **kwargs):
        return _FakeExecutable({"files": self._existing_files})

    def create(self, **kwargs):
        self.create_called = True
        return _FakeExecutable({"id": "should-not-be-used"})


class _FakeDriveService:
    def __init__(self, existing_files):
        self._files_resource = _FakeFilesResource(existing_files)

    def files(self):
        return self._files_resource


def test_find_or_create_backup_folder_reuses_existing(monkeypatch):
    fake_service = _FakeDriveService(
        existing_files=[{"id": "existing-folder-id", "name": setup.BACKUP_FOLDER_NAME}]
    )
    monkeypatch.setattr(
        "googleapiclient.discovery.build", lambda *a, **k: fake_service
    )

    folder_id, created = setup._find_or_create_backup_folder(credentials=object())

    assert folder_id == "existing-folder-id"
    assert created is False
    assert fake_service._files_resource.create_called is False


def test_find_or_create_backup_folder_creates_when_missing(monkeypatch):
    fake_service = _FakeDriveService(existing_files=[])
    monkeypatch.setattr(
        "googleapiclient.discovery.build", lambda *a, **k: fake_service
    )

    folder_id, created = setup._find_or_create_backup_folder(credentials=object())

    assert folder_id == "should-not-be-used"
    assert created is True
    assert fake_service._files_resource.create_called is True


def test_requirements_files_parse_under_windows_locale_encoding():
    """pip は BOM/コーディング宣言が無い requirements を OS のロケール
    エンコーディング(日本語 Windows では cp932)で読む。UTF-8 の日本語
    コメントはそこで UnicodeDecodeError になる(2026-08-13 に実発生)。
    リポジトリ内の全 requirements*.txt が「ASCII のみ」または
    「UTF-8 BOM 付き」であることを検査する(同クラスの網羅検査)。"""
    import pathlib

    repo_root = pathlib.Path(__file__).resolve().parent.parent
    checked = 0
    for path in repo_root.rglob("requirements*.txt"):
        if any(part in ("node_modules", ".git", "dist") for part in path.parts):
            continue
        raw = path.read_bytes()
        checked += 1
        if raw[:3] == b"\xef\xbb\xbf":
            raw.decode("utf-8-sig")  # BOM 付きなら UTF-8 として正当であること
            continue
        try:
            raw.decode("ascii")
        except UnicodeDecodeError as exc:
            raise AssertionError(
                f"{path.relative_to(repo_root)} は非ASCIIを含むのに UTF-8 BOM が"
                f"無い。日本語 Windows の pip (cp932) で読めず落ちる: {exc}"
            ) from None
    assert checked >= 2, "requirements ファイルが見つからない(検査対象の消失)"
