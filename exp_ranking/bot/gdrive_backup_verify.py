"""Google Drive バックアップの検証ロジック V0〜V7(T12 P5.5, commit2)。

docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md §2.1.1・§2.5 の実装。

各関数は §2.5 の表の1行(または §2.1.1 の V0)にちょうど対応し、それぞれ
独立して呼べる純関数にしてある。**Drive API・ネットワークI/Oはここでは
一切行わない** — 呼び出し元(gdrive_backup_job.py、commit4 で追加)が
gdrive_backup.py の関数を使って先にダウンロード・アップロードを済ませ、
その結果(ファイルパス・メタデータ dict・SHA-256文字列)をここへ渡す。
これにより各検証はネットワークをモックせずに実ファイル・実SQLiteで
テストできる。

削除(保持ポリシー、gdrive_backup_retention.py)はこのモジュールの責務外。
「V0〜V7 すべて成功した後にのみ削除呼び出しへ進む」という順序の強制は
呼び出し元(gdrive_backup_job.py)が担う(§2.1 手順6)。
"""

from __future__ import annotations

import gzip
import sqlite3
from pathlib import Path

from sqlite_storage import count_snapshot_dates, count_snapshots, latest_snapshot_date


def verify_v0_release_matches_expected(actual_sha256: str, expected_sha256: str) -> bool:
    """V0: 今回 Release Asset から再取得した実体の SHA-256 が、commit-db が
    アップロード時に job output として記録した値と一致するか。

    一致しない場合は「Release Asset が別 run で更新された可能性がある」
    (§2.1.1)ため、Drive への保存・削除のどちらも行わずに fail-closed する
    (呼び出し元の責務)。
    """
    if not actual_sha256 or not expected_sha256:
        return False
    return actual_sha256.lower() == expected_sha256.lower()


def verify_v1_exists(uploaded_metadata: dict | None) -> bool:
    """V1: Google Drive 上にファイルが存在する(アップロード応答に file id がある)。"""
    return bool(uploaded_metadata and uploaded_metadata.get("id"))


def verify_v2_nonzero_size(uploaded_metadata: dict) -> bool:
    """V2: アップロードされたファイルのサイズが0ではない。"""
    raw_size = (uploaded_metadata or {}).get("size")
    if raw_size is None:
        return False
    try:
        return int(raw_size) > 0
    except (TypeError, ValueError):
        return False


def verify_v3_size_matches_local(uploaded_metadata: dict, local_path: Path) -> bool:
    """V3: Drive 上のファイルサイズが、アップロードしたローカル db.gz のサイズと一致する。"""
    raw_size = (uploaded_metadata or {}).get("size")
    if raw_size is None:
        return False
    try:
        remote_size = int(raw_size)
    except (TypeError, ValueError):
        return False
    local_path = Path(local_path)
    if not local_path.exists():
        return False
    return remote_size == local_path.stat().st_size


def verify_v4_sha256_match(local_sha256: str, downloaded_sha256: str) -> bool:
    """V4: Drive から再ダウンロードした実体の SHA-256 が、アップロードした
    実体(=Release から取得した db.gz)の SHA-256 と一致する。

    Drive API の md5Checksum メタデータだけでは信用せず、実際にダウンロード
    した実体で確認する(§2.5 の注記)。
    """
    if not local_sha256 or not downloaded_sha256:
        return False
    return local_sha256.lower() == downloaded_sha256.lower()


def verify_v5_gzip_valid(gz_path: Path) -> bool:
    """V5: gzip として展開可能か。"""
    gz_path = Path(gz_path)
    if not gz_path.exists():
        return False
    try:
        with gzip.open(gz_path, "rb") as fh:
            while fh.read(1024 * 1024):
                pass
        return True
    except OSError:
        return False


def verify_v6_sqlite_openable(db_path: Path) -> bool:
    """V6: SQLite データベースとして open 可能か(簡単なクエリが通るか)。"""
    db_path = Path(db_path)
    if not db_path.exists():
        return False
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()
        return True
    except sqlite3.DatabaseError:
        return False


def verify_v7_snapshot_stats_match(release_db_path: Path, drive_db_path: Path) -> tuple[bool, str]:
    """V7: snapshot_days(distinct snapshot_date 数)/ 総行数 / 最新日 が、
    Release DB と Drive から取得した DB とで一致するか。

    集計ロジックは sqlite_storage.py の既存関数(count_snapshot_dates /
    count_snapshots / latest_snapshot_date)をそのまま再利用する(同じ集計
    を2箇所に実装しない)。戻り値は (一致したか, 人間可読な詳細) のペア。
    """
    release_db_path = Path(release_db_path)
    drive_db_path = Path(drive_db_path)

    release_stats = (
        count_snapshot_dates(release_db_path),
        count_snapshots(release_db_path),
        latest_snapshot_date(release_db_path),
    )
    drive_stats = (
        count_snapshot_dates(drive_db_path),
        count_snapshots(drive_db_path),
        latest_snapshot_date(drive_db_path),
    )
    detail = (
        f"release(snapshot_days={release_stats[0]}, rows={release_stats[1]}, "
        f"latest={release_stats[2]}) vs drive(snapshot_days={drive_stats[0]}, "
        f"rows={drive_stats[1]}, latest={drive_stats[2]})"
    )
    return release_stats == drive_stats, detail
