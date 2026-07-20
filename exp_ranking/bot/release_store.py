"""Release Asset ベースの ranking.db 永続層(T12 P2)。

GitHub Releases のタグ `db-store` に単一 Asset `ranking.db.gz` を置き、
git 履歴に db.gz を毎日堆積させる代わりの耐久ストアとして使う。

書込は必ず以下の順で行う(INV-2, blind clobber 禁止):
    1. 現在の Release Asset を download
    2. additive-merge: ローカル DB を primary、ダウンロードした Release DB を
       secondary として `sqlite_storage.merge_ranking_databases`
       (`INSERT OR IGNORE`)で合流させる(既存行を退行させない・INV-3)
    3. マージ後の DB を gzip 圧縮し、`gh release upload --clobber` で差し替える

Release の存在確認・ダウンロード・作成・アップロードは `gh` CLI
(GitHub Actions ランナーにプリインストール済み)をサブプロセス経由で呼ぶ。
`gh` の呼び出しはユニットテストで全てモックし、本モジュール単体では
実 Release に一切アクセスしない。

配信経路(rankings.json / v2シャード)には一切関与しない(INV-1)。
merge のロジック本体は `sqlite_storage.merge_ranking_databases` を再利用し、
同じ意味論を二重実装しない。
"""

from __future__ import annotations

import gzip
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from sqlite_storage import checkpoint_db, merge_ranking_databases

logger = logging.getLogger(__name__)

DB_STORE_TAG = "db-store"
DB_STORE_ASSET_NAME = "ranking.db.gz"

# gh CLI が「タグ/Asset が存在しない」ことを示すために stderr に出す典型的な文言。
# これらに一致しない失敗(認証エラー・ネットワーク断など)は「存在しない」と
# みなさず例外にする(blind clobber を避けるための保守的なフォールバック)。
_NOT_FOUND_MARKERS = (
    "release not found",
    "not found",
    "404",
    "no release found",
)


class ReleaseStoreError(RuntimeError):
    """`gh` コマンドの失敗、または存在確認が不定な場合に送出する。"""


def _run_gh(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    cmd = ["gh", *args]
    logger.debug("release_store: running %s", cmd)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise ReleaseStoreError(
            f"gh command failed (rc={result.returncode}): {' '.join(cmd)}\n{result.stderr}"
        )
    return result


def release_exists(tag: str = DB_STORE_TAG) -> bool:
    """Release タグが存在するか確認する。

    確認自体が不定な失敗(ネットワーク/認証エラー等)の場合は「存在しない」と
    決め付けず `ReleaseStoreError` を送出する。ここを曖昧にすると、実際には
    Release が存在するのに「存在しない」と誤判定して additive-merge をスキップし、
    そのまま clobber upload してしまう(=blind clobber, INV-2 違反)恐れがある。
    """
    result = _run_gh(["release", "view", tag], check=False)
    if result.returncode == 0:
        return True
    stderr = (result.stderr or "").lower()
    if any(marker in stderr for marker in _NOT_FOUND_MARKERS):
        return False
    raise ReleaseStoreError(
        f"gh release view failed unexpectedly for tag '{tag}' (rc={result.returncode}): "
        f"{result.stderr}"
    )


def ensure_release(tag: str = DB_STORE_TAG) -> None:
    """Release タグが無ければ空の Release を作成する(初回シード用)。既存なら何もしない。"""
    if release_exists(tag):
        return
    _run_gh(
        [
            "release",
            "create",
            tag,
            "--title",
            "ranking.db store",
            "--notes",
            "ranking.db.gz の永続化専用 Release Asset ストア(T12 P2)。"
            "配信経路ではない(rankings.json / v2シャードとは無関係)。",
            "--prerelease",
        ]
    )


def download_current_asset(
    dest_path: Path,
    *,
    tag: str = DB_STORE_TAG,
    asset_name: str = DB_STORE_ASSET_NAME,
) -> bool:
    """現在の Release Asset を `dest_path` にダウンロードする。

    Release タグ自体が存在しない(=初回シード前)場合のみ False を返す。
    それ以外の失敗(タグはあるが Asset 未アップロード等)は `gh` の終了コードから
    判定し、Asset が存在しない場合も False を返す。
    """
    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    if not release_exists(tag):
        logger.info("release_store: release '%s' does not exist yet (first sync)", tag)
        return False

    # sqlite3 connections opened by callers downstream (merge_ranking_databases)
    # aren't always closed before this dir goes out of scope on Windows, which
    # can make cleanup fail with a file-in-use error; ignore that (best effort,
    # OS temp dir is reclaimed eventually) rather than raising.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
        result = _run_gh(
            [
                "release",
                "download",
                tag,
                "--pattern",
                asset_name,
                "--dir",
                tmp_dir,
                "--clobber",
            ],
            check=False,
        )
        downloaded = Path(tmp_dir) / asset_name
        if result.returncode != 0 or not downloaded.exists():
            logger.info(
                "release_store: asset '%s' not found on release '%s' (rc=%s)",
                asset_name,
                tag,
                result.returncode,
            )
            return False
        shutil.move(str(downloaded), str(dest_path))
        return True


def upload_asset(
    file_path: Path,
    *,
    tag: str = DB_STORE_TAG,
) -> None:
    """`file_path` を Release Asset として `--clobber` アップロードする。

    呼び出し前に additive-merge (download -> merge) を経ていることが前提
    (INV-2)。このメソッド単体は clobber を実行するだけで、additive 性の
    保証は呼び出し側(`sync_db_to_release`)の責務。
    """
    file_path = Path(file_path)
    ensure_release(tag)
    _run_gh(["release", "upload", tag, str(file_path), "--clobber"])


def _gzip_file(src_path: Path, dest_path: Path) -> None:
    with open(src_path, "rb") as src, gzip.open(dest_path, "wb") as dst:
        shutil.copyfileobj(src, dst)


def _gunzip_file(src_path: Path, dest_path: Path) -> None:
    with gzip.open(src_path, "rb") as src, open(dest_path, "wb") as dst:
        shutil.copyfileobj(src, dst)


def sync_db_to_release(
    local_db_path: Path,
    *,
    tag: str = DB_STORE_TAG,
    asset_name: str = DB_STORE_ASSET_NAME,
) -> dict:
    """`local_db_path` を Release Asset へ additive-merge した上で反映する。

    手順(INV-2):
        1. 現 Asset を download(存在しなければ初回シードとして local を採用)
        2. additive-merge: `merge_ranking_databases(local_db_path, downloaded_db)`
           で Release 側の行を local へ `INSERT OR IGNORE` (union, 退行なし)
        3. マージ後の local を gzip して `--clobber` upload

    Returns:
        {"downloaded": bool, "merged_rows": int, "uploaded": bool}
    """
    local_db_path = Path(local_db_path)
    if not local_db_path.exists():
        raise ReleaseStoreError(f"local db not found: {local_db_path}")

    result: dict = {"downloaded": False, "merged_rows": 0, "uploaded": False}

    # See comment in download_current_asset re: ignore_cleanup_errors.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        asset_gz_path = tmp_dir_path / asset_name

        downloaded = download_current_asset(asset_gz_path, tag=tag, asset_name=asset_name)
        result["downloaded"] = downloaded

        if downloaded:
            release_db_path = tmp_dir_path / "ranking.release.db"
            _gunzip_file(asset_gz_path, release_db_path)
            result["merged_rows"] = merge_ranking_databases(local_db_path, release_db_path)
            checkpoint_db(local_db_path)

        _gzip_file(local_db_path, asset_gz_path)
        upload_asset(asset_gz_path, tag=tag)
        result["uploaded"] = True

    logger.info(
        "release_store: sync complete downloaded=%s merged_rows=%s uploaded=%s",
        result["downloaded"],
        result["merged_rows"],
        result["uploaded"],
    )
    return result
