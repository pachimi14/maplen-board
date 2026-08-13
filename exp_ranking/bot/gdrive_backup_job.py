"""CI エントリポイント: 日次 Google Drive バックアップの実行(T12 P5.5, commit4)。

docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md §2.1・§2.1.1 の手順を、
gdrive_backup.py(Drive API)/ gdrive_backup_verify.py(V0〜V7)/
gdrive_backup_retention.py(保持・削除計画)の3モジュールをこの順で束ねて
実行する。呼び出すのは workflow の ``backup-gdrive`` ジョブのみ(commit-db
=Release persist が成功した後にのみ実行される、§2.1)。

手順(§2.1.1、厳守: 削除は最後):
    1. commit-db が Release Asset を更新し、そのとき upload した db.gz の
       SHA-256 を job output(``GDRIVE_BACKUP_EXPECTED_SHA256``)として渡す
       (workflow 側)。
    2. その Release Asset を再ダウンロードする。
    3. 再ダウンロードした実体の SHA-256 を 1 の記録値と照合する(V0)。
       不一致なら Drive への保存・削除のどちらも行わずに失敗する。
    4. gzip 展開 → SQLite open で Release DB 自体の健全性を確認する
       (V5/V6 を Drive アップロード前にも先んじて適用する多層防御)。
    5. Google Drive へアップロードする。
    6. Drive から再ダウンロードして V1〜V7 を通過させる。
    7. すべて成功した後にのみ、保持ポリシー(gdrive_backup_retention)に
       従って古い世代を削除する。

秘密情報(§2.6): client_id/client_secret/refresh_token/folder_id は環境変数
からのみ読む。例外はすべて要約してから外へ出す(gdrive_backup.py が担う
認証まわりの要約に加え、このモジュール自身も secrets を保持する変数を
例外メッセージへ直接埋め込まない)。
"""

from __future__ import annotations

import gzip
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import gdrive_backup as gd
import gdrive_backup_retention as retention
import gdrive_backup_verify as verify
from release_store import ReleaseStoreError, download_current_asset

logger = logging.getLogger(__name__)

DEFAULT_WORK_DIR = Path("data/gdrive_backup_tmp")


class BackupJobError(RuntimeError):
    """バックアップ run 全体の失敗。メッセージは常に要約済み(秘密情報を含まない)。"""


def _summarize(context: str, exc: Exception) -> str:
    return f"{context}に失敗しました({type(exc).__name__})。詳細は秘密情報を含みうるため要約のみ表示します。"


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise BackupJobError(f"必須の環境変数 {name} が設定されていません。")
    return value


def run(*, work_dir: Path = DEFAULT_WORK_DIR, now_utc: datetime | None = None) -> int:
    expected_sha256 = os.environ.get("GDRIVE_BACKUP_EXPECTED_SHA256", "").strip()
    if not expected_sha256:
        print(
            "backup-gdrive: GDRIVE_BACKUP_EXPECTED_SHA256 が空のため、"
            "今回バックアップする対象がありません(no-op)。"
        )
        return 0

    run_id = os.environ.get("GDRIVE_BACKUP_RUN_ID", "unknown")
    client_id = _require_env("GDRIVE_CLIENT_ID")
    client_secret = _require_env("GDRIVE_CLIENT_SECRET")
    refresh_token = _require_env("GDRIVE_REFRESH_TOKEN")
    folder_id = _require_env("GDRIVE_BACKUP_FOLDER_ID")

    now_utc = (now_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)

    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    release_gz = work_dir / "release.db.gz"

    # §2.1.1 手順2: commit-db が更新した Release Asset を再取得する。
    try:
        found = download_current_asset(release_gz)
    except ReleaseStoreError as exc:
        raise BackupJobError(_summarize("Release Asset の再取得", exc)) from None
    if not found:
        raise BackupJobError(
            "Release Asset が見つかりません(commit-db 成功直後としては異常です)。"
        )

    # §2.1.1 手順3 / V0: 同一DBであることの証明。
    actual_sha256 = gd.compute_sha256(release_gz)
    if not verify.verify_v0_release_matches_expected(actual_sha256, expected_sha256):
        raise BackupJobError(
            "V0失敗: Release Asset の SHA-256 が commit-db の記録値と一致しません"
            "(Release Asset が別 run で更新された可能性があります)。"
            f" expected_sha256={expected_sha256[:12]}... actual_sha256={actual_sha256[:12]}..."
            f" backup_run_id={run_id}."
            " Google Drive への保存・古い世代の削除のどちらも行いません。"
        )

    # V5/V6 を Drive アップロード前の Release Asset 自体にも先に適用する
    # (多層防御。V7 で Drive 側との突合にも使う実体をここで用意する)。
    if not verify.verify_v5_gzip_valid(release_gz):
        raise BackupJobError("V5失敗: Release Asset の gzip 展開に失敗しました。")
    release_db = work_dir / "release.db"
    with gzip.open(release_gz, "rb") as src, open(release_db, "wb") as dst:
        dst.write(src.read())
    if not verify.verify_v6_sqlite_openable(release_db):
        raise BackupJobError("V6失敗: Release DB を SQLite として open できません。")

    # §2.1.1 手順5: Google Drive へアップロードする。
    filename = gd.build_backup_filename(now_utc, run_id)
    try:
        service = gd.build_drive_service(client_id, client_secret, refresh_token)
        created = gd.upload_backup(service, folder_id, release_gz, filename)
    except gd.GDriveBackupError as exc:
        raise BackupJobError(str(exc)) from None

    if not verify.verify_v1_exists(created):
        raise BackupJobError("V1失敗: アップロード応答に file id がありません。")
    if not verify.verify_v2_nonzero_size(created):
        raise BackupJobError("V2失敗: アップロードされたファイルのサイズが0です。")
    if not verify.verify_v3_size_matches_local(created, release_gz):
        raise BackupJobError("V3失敗: アップロードされたファイルサイズがローカルと一致しません。")

    # §2.1.1 手順6: Drive から再ダウンロードして検証する。
    drive_gz = work_dir / "drive.db.gz"
    try:
        gd.download_backup(service, created["id"], drive_gz)
    except gd.GDriveBackupError as exc:
        raise BackupJobError(str(exc)) from None

    downloaded_sha256 = gd.compute_sha256(drive_gz)
    if not verify.verify_v4_sha256_match(actual_sha256, downloaded_sha256):
        raise BackupJobError("V4失敗: Drive から再取得したファイルの SHA-256 が一致しません。")

    if not verify.verify_v5_gzip_valid(drive_gz):
        raise BackupJobError("V5失敗: Drive から取得したファイルの gzip 展開に失敗しました。")

    drive_db = work_dir / "drive.db"
    with gzip.open(drive_gz, "rb") as src, open(drive_db, "wb") as dst:
        dst.write(src.read())
    if not verify.verify_v6_sqlite_openable(drive_db):
        raise BackupJobError("V6失敗: Drive から取得した DB を SQLite として open できません。")

    stats_ok, stats_detail = verify.verify_v7_snapshot_stats_match(release_db, drive_db)
    if not stats_ok:
        raise BackupJobError(f"V7失敗: Release DB と Drive DB の統計が一致しません({stats_detail})。")

    print(
        f"backup-gdrive: 検証V0-V7すべて成功 (file={filename}, "
        f"size={created.get('size')}, sha256={actual_sha256[:12]}...)"
    )

    # §2.1 手順6 / §2.1.1 手順7: すべての検証が成功した後にのみ削除へ進む。
    try:
        existing_files = gd.list_backups(service, folder_id)
    except gd.GDriveBackupError as exc:
        # 新規バックアップは既にアップロード・検証済み。一覧取得の失敗を
        # 「削除対象なし」と静かに扱うのではなく、可視の失敗として扱う
        # (§2.7 の精神を一覧取得にも適用する)。新規バックアップ自体は
        # 失わない。
        raise BackupJobError(
            f"保持ポリシー用のファイル一覧取得に失敗しました(新規バックアップは保持済みです): {exc}"
        ) from None

    new_entry = retention.parse_entry(created)
    if new_entry is None:
        # build_backup_filename で組み立てた名前なので通常は到達しないが、
        # 万一パースできなければ保持ポリシーの帳簿から外れてしまうため、
        # 削除は行わずに可視の失敗として扱う(fail closed)。
        raise BackupJobError(
            f"新規アップロードしたファイル名を保持ポリシーが解釈できませんでした(filename={filename})。"
            "削除は行いません。"
        )

    existing_entries = [
        entry
        for entry in (retention.parse_entry(item) for item in existing_files)
        if entry is not None and entry.file_id != new_entry.file_id
    ]

    plan = retention.plan_retention(existing_entries, new_entry, now_utc=now_utc)

    if plan.warning:
        print(f"backup-gdrive: 保持ポリシーの安全ガードにより削除をスキップしました: {plan.warning}")
        return 0

    delete_errors: list[str] = []
    for entry in plan.delete:
        try:
            gd.delete_backup(service, entry.file_id)
        except gd.GDriveBackupError as exc:
            delete_errors.append(f"{entry.name}: {exc}")

    if delete_errors:
        # §2.7: 削除失敗時は新規バックアップを保持したまま、エラーを明示する。
        raise BackupJobError(
            "古い世代の削除に失敗しました(新規バックアップは保持済みです): " + "; ".join(delete_errors)
        )

    print(f"backup-gdrive: 保持ポリシーにより{len(plan.delete)}件の古い世代を削除しました。")
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    try:
        return run()
    except BackupJobError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - 秘密情報を含みうる例外は要約してから出す
        print(
            f"エラー: 予期しない失敗です({type(exc).__name__})。"
            "詳細は秘密情報を含みうるため要約のみ表示します。",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
