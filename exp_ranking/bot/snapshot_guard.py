"""切り詰め公開防止ガード(T12 P3 §2.4)。

`ranking.db.gz` の git 日次コミットを永続層の正から外す(P3 出血停止本体)と、
「cache・Release・v1(Pages)・v2(シャード) の復元が全て失敗したまま部分DBで
Pages公開/Release上書きしてしまう」経路が新たに生まれる(既存の
`SKIP_RUN_MIN_SNAPSHOT_ROWS` は当日行数のみを見る仕組みで、これを防げない)。

本モジュールは、cache/Release/v1/v2 の復元が **全て完了した直後**(main.py の
`bootstrap_database()` 呼び出し直後)に呼び出され、ランキングAPI取得・Pages
export・Release persist の **前** に、復元後の DB が「切り詰められた部分DB」で
ないことを確認する。異常を検出したら `SnapshotGuardError` を送出して run
そのものを失敗させる(呼び出し元の main.py はこれを捕捉せず伝播させ、
`sys.exit(1)` する。GitHub Actions 上ではこれにより後続の Pages export /
Release persist ステップがスキップされる=「基準が無いから通す」を禁止し、
fail-closed を徹底する)。

期待下限の取得元(§2.4・優先順、実装裁量なし):
    1. 現在公開中の v2 メタデータの `meta.snapshotDays`
    2. (利用可能なら)直近の正常 Release DB の `snapshot_days` も照合
       (両方取れたら大きい方を採用)
    3. 絶対最低ライン = 30日(1,2 がこれ未満でも 30 を下回る復元は許さない)
    4. 信頼できる基準値がどれも取得できない場合は fail-closed

1,2 は外部/Releaseへの読み取りアクセスに依存するため、取得できなくても
(ネットワーク不達等)ここでは例外にしない――3 の絶対最低ラインが常に
存在するため、`expected_min_days` は必ず計算できる(=判定基準は必ず得られる)。
判定そのものの計算(このモジュール内のロジック)が予期せぬ例外を起こした
場合は、呼び出し元で捕捉せずそのまま伝播させること(=それこそが「基準が
無ければfail-closed」の実体化。ここを try/except で握り潰して素通りさせては
ならない)。
"""

from __future__ import annotations

import json
import logging
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import release_store
from sqlite_storage import (
    count_snapshot_dates,
    count_snapshots,
    count_snapshots_for_date,
    latest_snapshot_date,
    list_snapshot_dates,
)

logger = logging.getLogger(__name__)

# 絶対最低ライン(§2.4 第3基準)。v2公開メタ/Release がどちらも取得できなくても
# これより下回る復元は許さない(=常に判定基準が存在することを保証する)。
ABSOLUTE_MIN_SNAPSHOT_DAYS = 30

# 保持期間境界(90日ローテーション)によるスナップショット日数の正常な増減
# (retention cutoffの計算タイミング差などで±1日程度動き得る)を吸収するための
# 許容(§2.4 で確定した値そのもの、"-2")。
SNAPSHOT_DAYS_TOLERANCE = 2

# 直近正常値(=このDB自身の直近履歴)に対する、最新日の行数の下限比率。
# 日々のランキング対象人数は引退/新規参入で自然に増減するが、その変動は
# 通常数%程度に収まる。B'(LULU-062②)以前の切り詰め事故ではシャード欠落や
# 部分マージにより行数が半分以下に落ちる事象が実際に観測されており、90%は
# 健全な日次変動を誤検知せず、桁違いの部分DB化を確実に捕捉するための閾値
# として選定した(§2.4: 「総行数は固定値で判定しない・直近正常値に対する
# 割合で判定する」の実装)。
LATEST_DAY_ROW_RATIO_MIN = 0.90

# 「直近正常値」を算出する際に遡る日数(最新日を除く直近何日分の平均を取るか)。
ROW_RATIO_LOOKBACK_DAYS = 7


class SnapshotGuardError(RuntimeError):
    """切り詰め公開の疑いを検出した(=ガード発火)。呼び出し元は run を fail させる。"""


@dataclass(frozen=True)
class SnapshotCensus:
    method: str
    snapshot_days: int
    total_rows: int
    latest_date: str | None
    latest_day_rows: int
    recent_avg_rows: float | None
    expected_min_days: int
    v2_public_days: int | None
    release_days: int | None


def fetch_public_v2_snapshot_days(url: str, *, timeout: int = 30) -> int | None:
    """現在公開中の v2 rankings.json (`meta.snapshotDays`) を取得する(§2.4 第1基準)。

    取得できない(ネットワーク不達・JSON異常等)場合は `None` を返す。これは
    「基準が無いから通す」には該当しない――呼び出し元は他の基準(絶対最低
    30日)へフォールバックするだけで、判定自体は必ず行われる。
    """
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("snapshot_guard: cannot fetch public v2 meta from %s: %s", url, exc)
        return None

    meta = payload.get("meta") if isinstance(payload, dict) else None
    if not isinstance(meta, dict):
        logger.warning("snapshot_guard: public v2 payload at %s has no meta", url)
        return None

    raw = meta.get("snapshotDays")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def fetch_release_snapshot_days(*, tag: str = release_store.DB_STORE_TAG) -> int | None:
    """直近の正常 Release DB の snapshot_days を取得する(§2.4 第2基準、任意)。

    Release Asset が未作成(初回シード前)、または取得不能な場合は `None` を
    返す(呼び出し元は他の基準へフォールバックする)。本関数は Release Asset
    を read-only で参照するだけで `release_store.upload_asset` を一切呼ばない
    ため、INV-2(blind clobber防止のfail-closed)を弱めるものではない――ここで
    例外を握り潰しても、Release への書き込みが誤って行われるリスクは無い。
    """
    try:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
            tmp_dir_path = Path(tmp_dir)
            asset_gz_path = tmp_dir_path / release_store.DB_STORE_ASSET_NAME
            downloaded = release_store.download_current_asset(asset_gz_path, tag=tag)
            if not downloaded:
                return None
            release_db_path = tmp_dir_path / "ranking.release_baseline.db"
            release_store._gunzip_file(asset_gz_path, release_db_path)
            return count_snapshot_dates(release_db_path)
    except release_store.ReleaseStoreError as exc:
        logger.warning("snapshot_guard: cannot establish Release baseline: %s", exc)
        return None


def restore_method_label(
    *,
    cache_hit: bool,
    release_restored: bool,
    pages_imported: int,
    v2_imported: int,
) -> str:
    """ログ要件「復元方法(cache・Release・v1・v2 のどれか)」用のラベルを組み立てる。

    優先順位は復旧レイヤの優先順(§2.3: cache -> Release -> v1(Pages) ->
    v2(シャード))と一致させて列挙する。移行期間中の並行運用(P3 コミット2〜4)
    や、cache が不完全で v1/v2 が追加で寄与したケースなど、複数レイヤが実際に
    寄与した場合は単一ラベルに丸めず全て連結する(情報を失わない)。
    """
    layers: list[str] = []
    if cache_hit:
        layers.append("cache")
    if release_restored:
        layers.append("release")
    if pages_imported > 0:
        layers.append("v1")
    if v2_imported > 0:
        layers.append("v2")
    return "+".join(layers) if layers else "unknown(no-restore-layer-signal)"


def check_snapshot_integrity(
    db_path: Path,
    *,
    method: str,
    v2_meta_url: str,
    fetch_public_v2_days=fetch_public_v2_snapshot_days,
    fetch_release_days=fetch_release_snapshot_days,
) -> SnapshotCensus:
    """復元完了直後の `db_path` を検査する。切り詰めを検出したら
    `SnapshotGuardError` を送出する(呼び出し元は捕捉せず run を fail させる)。

    実行位置は必ず「cache・Release・v1・v2 の復元が全て完了した後」かつ
    「ランキングAPI取得・Pages export・Release persist より前」であること
    (§2.4、呼び出し元 main.py の責務)。
    """
    snapshot_days = count_snapshot_dates(db_path)
    total_rows = count_snapshots(db_path)
    latest_date = latest_snapshot_date(db_path)
    latest_day_rows = count_snapshots_for_date(db_path, latest_date) if latest_date else 0

    history_dates = [d for d in list_snapshot_dates(db_path) if d != latest_date]
    window_dates = history_dates[-ROW_RATIO_LOOKBACK_DAYS:]
    window_counts = [
        count
        for count in (count_snapshots_for_date(db_path, d) for d in window_dates)
        if count > 0
    ]
    recent_avg_rows = (sum(window_counts) / len(window_counts)) if window_counts else None

    v2_public_days = fetch_public_v2_days(v2_meta_url)
    release_days = fetch_release_days()
    basis_candidates = [
        value
        for value in (v2_public_days, release_days, ABSOLUTE_MIN_SNAPSHOT_DAYS)
        if value is not None
    ]
    # basis_candidates は ABSOLUTE_MIN_SNAPSHOT_DAYS を必ず含むため空になり得ない
    # (=判定基準は常に得られる。§2.4 第4基準「信頼できる基準値がどれも取得でき
    # ない場合はfail-closed」は、この計算自体が予期せぬ例外を起こした場合に
    # 呼び出し元がそれを握り潰さず伝播させることで実体化する)。
    expected_min_days = max(basis_candidates) - SNAPSHOT_DAYS_TOLERANCE

    census = SnapshotCensus(
        method=method,
        snapshot_days=snapshot_days,
        total_rows=total_rows,
        latest_date=latest_date,
        latest_day_rows=latest_day_rows,
        recent_avg_rows=recent_avg_rows,
        expected_min_days=expected_min_days,
        v2_public_days=v2_public_days,
        release_days=release_days,
    )

    logger.info(
        "snapshot_guard: census method=%s snapshot_days=%s total_rows=%s "
        "latest_date=%s latest_day_rows=%s recent_avg_rows=%s window_dates=%s "
        "expected_min_days=%s (basis: v2_public=%s release=%s floor=%s tolerance=-%s)",
        method,
        snapshot_days,
        total_rows,
        latest_date,
        latest_day_rows,
        f"{recent_avg_rows:.1f}" if recent_avg_rows is not None else None,
        window_dates,
        expected_min_days,
        v2_public_days,
        release_days,
        ABSOLUTE_MIN_SNAPSHOT_DAYS,
        SNAPSHOT_DAYS_TOLERANCE,
    )

    reasons: list[str] = []
    if snapshot_days < expected_min_days:
        reasons.append(
            f"snapshot_days={snapshot_days} below expected_min_days={expected_min_days} "
            f"(basis: v2_public={v2_public_days}, release={release_days}, "
            f"floor={ABSOLUTE_MIN_SNAPSHOT_DAYS}, tolerance=-{SNAPSHOT_DAYS_TOLERANCE})"
        )
    if recent_avg_rows is not None and latest_day_rows < recent_avg_rows * LATEST_DAY_ROW_RATIO_MIN:
        reasons.append(
            f"latest_day_rows={latest_day_rows} for {latest_date} is below "
            f"{LATEST_DAY_ROW_RATIO_MIN:.0%} of recent_avg_rows={recent_avg_rows:.1f} "
            f"(lookback_dates={window_dates})"
        )

    if reasons:
        message = f"snapshot integrity guard fired (method={method}): " + "; ".join(reasons)
        logger.error("snapshot_guard: %s", message)
        raise SnapshotGuardError(message)

    return census
