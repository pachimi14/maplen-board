"""Google Drive バックアップ: Drive API 呼び出しの薄いラッパー(T12 P5.5, commit1)。

docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md の実装。本モジュールが担うのは
以下の3点のみ(§1 スコープ・§2.6/§2.6.1):
    1. ファイル名の生成・解析(§2.3)
    2. SHA-256 の計算(§2.1.1/§2.5 の各検証で使う共通処理)
    3. OAuth 2.0 (refresh token) 経由での Drive API 呼び出し
       (認証・アップロード・ダウンロード・一覧・削除)

**この時点ではどの workflow からも呼ばれない(未配線)**。検証(V0〜V7、
gdrive_backup_verify.py)・保持ポリシー(gdrive_backup_retention.py)・
workflow への実際の配線は後続コミットで追加する。

認証・秘密情報の扱い(§2.6):
    - client_id / client_secret / refresh_token は呼び出し元が環境変数から
      渡す(このモジュール自身は環境変数を読まない)。
    - Google 認証ライブラリ(google-auth / google-api-python-client)は
      関数内で遅延 import する(import 時の副作用を避ける。
      tools/gdrive_backup_setup.py と同じ方針)。
    - 例外はすべて要約してから re-raise する(スタックトレース・元の例外
      メッセージに token/secret が含まれている可能性があるため、生のまま
      出さない)。

Drive API のスコープは `drive.file`(このアプリが作成したファイル/フォルダ
のみ)。フォルダ自体は tools/gdrive_backup_setup.py が事前に作成済みの前提
(folder_id を呼び出し元が渡す)。
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

# ファイル名フォーマット(§2.3):
#   ranking-db-<YYYY-MM-DD>T<HHMMSS>Z-run-<run_id>.db.gz
# 例) ranking-db-2026-07-29T090500Z-run-30370939192.db.gz
_FILENAME_RE = re.compile(
    r"^ranking-db-(?P<date>\d{4}-\d{2}-\d{2})T(?P<time>\d{6})Z-run-(?P<run_id>[0-9A-Za-z]+)\.db\.gz$"
)

DRIVE_TOKEN_URI = "https://oauth2.googleapis.com/token"
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]
DRIVE_BACKUP_MIME_TYPE = "application/gzip"


class GDriveBackupError(RuntimeError):
    """Drive API 呼び出しの失敗(認証・アップロード・ダウンロード・一覧・削除)。

    メッセージは常に要約済み(秘密情報を含まない)。生の例外は原則
    ``from None`` で連鎖を切る(token 系)か、``from exc`` で連鎖を保持する
    (秘密情報を含まない HTTP エラー系)かを呼び出し箇所ごとに使い分ける。
    """


# ---------------------------------------------------------------------------
# ファイル名(§2.3)
# ---------------------------------------------------------------------------


def build_backup_filename(now_utc: datetime, run_id: str | int) -> str:
    """UTC の日時と run_id からバックアップファイル名を組み立てる(§2.3)。

    ``now_utc`` は必ず timezone-aware でなければならない(UTC 変換を明示的に
    行うため。naive datetime を渡すと呼び出し側のタイムゾーン取り違えに
    気付けないので、ここで拒否する)。
    """
    if now_utc.tzinfo is None or now_utc.utcoffset() is None:
        raise ValueError("now_utc must be timezone-aware (UTC)")
    stamp = now_utc.astimezone(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    return f"ranking-db-{stamp}-run-{run_id}.db.gz"


def parse_backup_filename(name: str) -> dict[str, str] | None:
    """バックアップファイル名から date/time/run_id を取り出す。

    フォーマットに一致しない場合は ``None`` を返す(例外にしない)。
    バックアップ用フォルダに想定外のファイルが混在していても、それを
    無理に解釈しない(保持ポリシー側が誤って削除対象にしないための前提、
    §2.4)。
    """
    match = _FILENAME_RE.match(name)
    if not match:
        return None
    return {
        "date": match.group("date"),
        "time": match.group("time"),
        "run_id": match.group("run_id"),
    }


# ---------------------------------------------------------------------------
# SHA-256(§2.1.1/§2.5 の各検証で共通利用)
# ---------------------------------------------------------------------------


def compute_sha256(path: Path, *, chunk_size: int = 1024 * 1024) -> str:
    """ファイルの SHA-256 を(全体をメモリに載せずに)計算する。"""
    path = Path(path)
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# 認証(§2.6: OAuth 2.0 + refresh token)
# ---------------------------------------------------------------------------


def build_drive_service(client_id: str, client_secret: str, refresh_token: str):
    """refresh token から Drive API v3 の service オブジェクトを構築する。

    ``google.oauth2.credentials.Credentials`` + ``google-api-python-client``
    のみを使う(JWT/OAuth のトークン処理を独自実装しない、§2.6.1)。
    access token への更新に失敗した場合は、生の例外(token/secret を含み
    うる)をそのまま外へ出さず、要約したメッセージの ``GDriveBackupError``
    に変換する(§2.6)。
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    credentials = Credentials(
        None,
        refresh_token=refresh_token,
        token_uri=DRIVE_TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
        scopes=DRIVE_SCOPES,
    )
    try:
        credentials.refresh(Request())
    except Exception as exc:  # noqa: BLE001 - 秘密情報をトレースに出さないため要約する
        raise GDriveBackupError(
            "Google Drive の認証(refresh token -> access token の更新)に"
            f"失敗しました({type(exc).__name__})。refresh token または "
            "client secret が無効・失効している可能性があります。詳細は"
            "秘密情報を含みうるため要約のみ表示します。"
        ) from None

    from googleapiclient.discovery import build

    return build("drive", "v3", credentials=credentials, cache_discovery=False)


# ---------------------------------------------------------------------------
# Drive API 操作(アップロード・ダウンロード・一覧・削除)
# ---------------------------------------------------------------------------


def upload_backup(service, folder_id: str, local_path: Path, filename: str) -> dict:
    """``local_path`` を ``folder_id`` 配下へ ``filename`` としてアップロードする。

    戻り値は Drive API のファイルメタデータ(id/name/size/md5Checksum等)。
    """
    from googleapiclient.http import MediaFileUpload

    local_path = Path(local_path)
    media = MediaFileUpload(str(local_path), mimetype=DRIVE_BACKUP_MIME_TYPE, resumable=False)
    body = {"name": filename, "parents": [folder_id]}
    try:
        return (
            service.files()
            .create(body=body, media_body=media, fields="id,name,size,md5Checksum,createdTime")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise GDriveBackupError(
            f"Google Drive へのアップロードに失敗しました({type(exc).__name__}): {filename}"
        ) from exc


def download_backup(service, file_id: str, dest_path: Path) -> None:
    """Drive 上のファイル ``file_id`` を ``dest_path`` へダウンロードする。"""
    from googleapiclient.http import MediaIoBaseDownload

    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        request = service.files().get_media(fileId=file_id)
        with open(dest_path, "wb") as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
    except Exception as exc:  # noqa: BLE001
        raise GDriveBackupError(
            f"Google Drive からのダウンロードに失敗しました({type(exc).__name__}): file_id={file_id}"
        ) from exc


def list_backups(service, folder_id: str) -> list[dict]:
    """``folder_id`` 配下(かつ trashed でない)ファイルの一覧を返す(全ページ)。"""
    files: list[dict] = []
    page_token = None
    query = f"'{folder_id}' in parents and trashed=false"
    try:
        while True:
            response = (
                service.files()
                .list(
                    q=query,
                    spaces="drive",
                    fields="nextPageToken, files(id, name, size, createdTime)",
                    pageToken=page_token,
                    pageSize=100,
                )
                .execute()
            )
            files.extend(response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break
    except Exception as exc:  # noqa: BLE001
        raise GDriveBackupError(
            f"Google Drive のファイル一覧取得に失敗しました({type(exc).__name__})"
        ) from exc
    return files


def delete_backup(service, file_id: str) -> None:
    """Drive 上のファイル ``file_id`` を削除する。"""
    try:
        service.files().delete(fileId=file_id).execute()
    except Exception as exc:  # noqa: BLE001
        raise GDriveBackupError(
            f"Google Drive のファイル削除に失敗しました({type(exc).__name__}): file_id={file_id}"
        ) from exc
