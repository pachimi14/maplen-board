"""
MapleN Board ranking snapshot bot (MSU API).

Fetches ranking characters at or above min level (default 225+), stores in SQLite.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import requests

import config
from analysis import build_analysis_rows
from identity import build_name_to_asset_key_from_ranking
from jst_schedule import wait_until_jst_fetch_window
from ranking_day import apply_ranking_day_label_migration, ranking_day_from_fetch
from ranking_day_skip import (
    clear_ranking_day_skip_marker,
    log_skip_ranking_fetch_only,
    should_skip_ranking_fetch,
    try_skip_entire_run,
)
from models import SnapshotRow
from mvp_export import build_mvp_payload, export_mvp_v2_json, filter_snapshots_for_history
from navigator import collect_asset_keys, extract_asset_key, rotation_target_world, sync_world_ids
from snapshot_guard import check_snapshot_integrity, restore_method_label
from sqlite_storage import (
    append_snapshots,
    backfill_character_asset_keys,
    checkpoint_db,
    count_character_meta,
    count_snapshot_dates,
    count_snapshots_for_date,
    delete_snapshots_before,
    export_character_meta_file,
    ensure_ranking_fetched_at_meta,
    get_app_meta,
    import_character_meta_file,
    init_db,
    import_missing_snapshots_from_v2_url,
    import_snapshots_from_mvp_json,
    latest_snapshot_date,
    latest_snapshot_fetched_at,
    list_snapshot_dates,
    load_all_snapshots,
    load_character_meta,
    load_snapshot_state_before,
    merge_ranking_databases,
    parse_iso_datetime,
    reconcile_ranking_fetched_at_meta,
    set_app_meta,
    snapshot_dates_in_mvp_json,
    LAST_RANKING_FETCHED_AT_KEY,
)
from utils import normalize_int

UTC = ZoneInfo("UTC")
JST = ZoneInfo("Asia/Tokyo")

# Official reset UTC 00:00 (= JST 09:00); label = prior UTC calendar day (ranking_day.py).
RANKING_DAY_TIMEZONE = UTC

LOG_DIR = config.BASE_DIR / "logs"
LOG_PATH = LOG_DIR / "msu_ranking_bot.log"

NAVIGATOR_LAST_SUCCESS_KEY = "navigator_last_success"


def navigator_success_payload(
    *,
    run_date: date,
    target_world: str,
    snapshot_date: str,
) -> str:
    return json.dumps(
        {
            "runDate": run_date.isoformat(),
            "targetWorld": target_world,
            "snapshotDate": snapshot_date,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def navigator_success_matches(
    raw: str | None,
    *,
    run_date: date,
    target_world: str,
    snapshot_date: str,
) -> bool:
    if not raw:
        return False
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return False
    if not isinstance(payload, dict):
        return False
    return (
        str(payload.get("runDate") or "") == run_date.isoformat()
        and str(payload.get("targetWorld") or "") == target_world
        and str(payload.get("snapshotDate") or "") == snapshot_date
    )


def should_store_navigator_success_marker(
    *,
    rotation_enabled: bool,
    snapshot_date: str,
    failed_count: int,
) -> bool:
    return rotation_enabled and bool(snapshot_date) and failed_count == 0


RANKING_API_BASE = "https://msu.io/maplestoryn/api/msn/ranking"
RANKING_QUERY = (
    "rankingFilter.classCode=-1&rankingFilter.jobCode=-1"
    "&paginationParam.pageSize=15"
)

API_MAX_PAGE_SIZE = 10
MAX_RETRIES = 10
RETRY_WAIT_SEC = 60
RATE_LIMIT_RETRY_WAIT_SEC = 600
REQUEST_TIMEOUT_SEC = 30


def setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s - %(message)s"
    )

    file_handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.INFO)
    root.addHandler(file_handler)
    root.addHandler(stream_handler)


def now_utc() -> datetime:
    return datetime.now(UTC)


def snapshot_date_ranking(dt: datetime | None = None) -> str:
    """Ranking day id: UTC gain day (fetch UTC date minus one calendar day)."""
    return ranking_day_from_fetch(dt or now_utc())


def ranking_api_url(page_no: int) -> str:
    return f"{RANKING_API_BASE}?{RANKING_QUERY}&paginationParam.pageNo={page_no}"


def _fetch_ranking_page(
    session: requests.Session, page_no: int
) -> tuple[int, list[dict[str, Any]], str]:
    response = session.get(ranking_api_url(page_no), timeout=REQUEST_TIMEOUT_SEC)
    body_text = response.text
    if response.status_code != 200:
        return response.status_code, [], body_text

    try:
        payload = response.json()
    except ValueError:
        return response.status_code, [], body_text

    ranking = payload.get("ranking")
    if not isinstance(ranking, list):
        return response.status_code, [], body_text

    entries = [entry for entry in ranking if isinstance(entry, dict)]
    return response.status_code, entries, body_text


def _make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "Accept": "application/json, text/plain, */*",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        }
    )
    return session


def _entry_level(entry: dict[str, Any]) -> int:
    return normalize_int(entry.get("level"))


def _api_ranking_signature(entries: list[dict[str, Any]]) -> tuple[tuple[Any, ...], ...]:
    return tuple(
        (
            normalize_int(entry.get("rank")),
            str(entry.get("characterName", "")).strip().casefold(),
            normalize_int(entry.get("level")),
            normalize_int(entry.get("exp")),
        )
        for entry in entries
    )


def _snapshot_signature(
    rows: list[tuple[int, str, int, int]],
) -> tuple[tuple[Any, ...], ...]:
    return tuple(
        (rank, name.strip().casefold(), level, exp)
        for rank, name, level, exp in rows
    )


def wait_for_ranking_update(
    baseline_rows: list[tuple[int, str, int, int]],
    *,
    poll_interval_sec: float,
    timeout_sec: float,
    settle_sec: float,
) -> bool:
    """Poll one lightweight page until the official ranking changes."""
    logger = logging.getLogger(__name__)
    baseline = _snapshot_signature(baseline_rows[:API_MAX_PAGE_SIZE])
    if not baseline or timeout_sec <= 0:
        logger.info("Ranking update probe skipped: no baseline or timeout disabled")
        return False

    session = _make_session()
    deadline = time.monotonic() + timeout_sec
    probe_count = 0
    while True:
        probe_count += 1
        try:
            status, ranking, _ = _fetch_ranking_page(session, 1)
        except requests.RequestException as exc:
            logger.warning("Ranking update probe %s failed: %s", probe_count, exc)
        else:
            if status == 200 and ranking:
                if _api_ranking_signature(ranking[:API_MAX_PAGE_SIZE]) != baseline:
                    logger.info(
                        "Official ranking update detected after %s probes; settling for %ss",
                        probe_count,
                        settle_sec,
                    )
                    if settle_sec > 0:
                        time.sleep(settle_sec)
                    return True
                logger.info("Official ranking not updated yet (probe %s)", probe_count)
            else:
                logger.warning(
                    "Ranking update probe %s returned HTTP %s", probe_count, status
                )

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            logger.warning(
                "Ranking update was not detected within %ss; continuing to full fetch",
                timeout_sec,
            )
            return False
        time.sleep(min(poll_interval_sec, remaining))


def validate_ranking_freshness(
    ranking: list[dict[str, Any]],
    baseline_rows: list[tuple[int, str, int, int]],
    min_changed: int,
) -> int:
    """Reject a stale full fetch that still matches the previous ranking day."""
    if not baseline_rows:
        return len(ranking)

    baseline = {
        name.strip().casefold(): (level, exp)
        for _, name, level, exp in baseline_rows
    }
    changed = 0
    for entry in ranking:
        name = str(entry.get("characterName", "")).strip().casefold()
        previous = baseline.get(name)
        current = (normalize_int(entry.get("level")), normalize_int(entry.get("exp")))
        if previous is None or previous != current:
            changed += 1

    if changed < min_changed:
        raise RuntimeError(
            "Fetched ranking appears stale: "
            f"changed={changed}, required={min_changed}, baseline={len(baseline_rows)}"
        )
    return changed


def fetch_ranking_min_level(
    min_level: int,
    request_delay_sec: float,
    max_pages: int,
) -> list[dict[str, Any]]:
    """Fetch all ranked characters with level >= min_level (stops when API drops below)."""
    logger = logging.getLogger(__name__)
    session = _make_session()
    last_status = 0
    last_body = ""
    collected: list[dict[str, Any]] = []
    next_page = 1
    last_page = 0
    current_delay_sec = request_delay_sec

    for attempt in range(1, MAX_RETRIES + 1):
        logger.info(
            "Fetching ranking API (attempt %s/%s, start_page=%s, min_level=%s, max_pages=%s)",
            attempt,
            MAX_RETRIES,
            next_page,
            min_level,
            max_pages,
        )
        try:
            failed = False

            for page_no in range(next_page, max_pages + 1):
                if page_no > 1 and current_delay_sec > 0:
                    time.sleep(current_delay_sec)

                last_status = 0
                status, ranking, body_text = _fetch_ranking_page(session, page_no)
                last_status = status
                last_body = body_text
                last_page = page_no

                if status != 200:
                    failed = True
                    break

                if not ranking:
                    logger.info("Empty ranking page %s, stopping", page_no)
                    break

                if len(ranking) < API_MAX_PAGE_SIZE:
                    logger.info(
                        "Short page %s (%s entries), treating as last page",
                        page_no,
                        len(ranking),
                    )

                page_levels = [_entry_level(entry) for entry in ranking]
                matched = [
                    entry for entry in ranking if _entry_level(entry) >= min_level
                ]
                collected.extend(matched)
                next_page = page_no + 1

                if page_levels and max(page_levels) < min_level:
                    logger.info(
                        "Stopping at page %s: max level %s < min_level %s",
                        page_no,
                        max(page_levels),
                        min_level,
                    )
                    break

                log_step = 50 if max_pages > 100 else 20
                if page_no == 1 or page_no % log_step == 0:
                    logger.info(
                        "Fetched page %s (matched=%s, total=%s)",
                        page_no,
                        len(matched),
                        len(collected),
                    )

                if len(ranking) < API_MAX_PAGE_SIZE:
                    break

            if failed:
                merged: list[dict[str, Any]] = []
            else:
                merged = sorted(collected, key=lambda entry: normalize_int(entry.get("rank")))

            if last_status != 200:
                logger.warning(
                    "HTTP status %s (attempt %s/%s)",
                    last_status,
                    attempt,
                    MAX_RETRIES,
                )
            elif not merged:
                logger.warning(
                    "No characters at level %s+ (last_page=%s, attempt %s/%s)",
                    min_level,
                    last_page,
                    attempt,
                    MAX_RETRIES,
                )
            else:
                logger.info(
                    "Ranking API fetch succeeded: %s characters (level>=%s, pages=%s)",
                    len(merged),
                    min_level,
                    last_page,
                )
                return merged

        except requests.RequestException as exc:
            logger.warning(
                "Request failed on attempt %s/%s: %s",
                attempt,
                MAX_RETRIES,
                exc,
            )

        if attempt < MAX_RETRIES:
            if last_status == 429:
                current_delay_sec = max(current_delay_sec, 1.5)
                logger.warning(
                    "Rate limit detected; subsequent request delay increased to %ss",
                    current_delay_sec,
                )
            wait_sec = (
                RATE_LIMIT_RETRY_WAIT_SEC if last_status == 429 else RETRY_WAIT_SEC
            )
            logger.info(
                "Retrying from page %s in %s seconds...",
                next_page,
                wait_sec,
            )
            time.sleep(wait_sec)

    raise RuntimeError(
        f"Failed to fetch valid ranking after {MAX_RETRIES} attempts "
        f"(last_status={last_status}, body_head={last_body[:300]!r})"
    )


def bootstrap_database(
    db_path: Path, logger: logging.Logger
) -> dict[str, int]:
    """DB を初期化し、legacy/seed/v2(シャード) の順で復元・補完する。

    T12 P4: v1(Pages) の取り込み・hydrate 段(旧 `SNAPSHOT_IMPORT_FROM_PAGES`
    / `HYDRATE_META_FROM_PAGES` / 旧 `json_path` 引数)は撤去済み。worldId
    復旧は Release 復元(character_meta ごと保持)・v2シャード復元
    (`import_missing_snapshots_from_v2_url` が character_meta も再水和)・
    navigator の `sync_world_ids` の3経路で担保されることを事前実証済み
    (docs/IMPL_PLAN_T12_P4.md §3.4.1 W1-W4)。

    戻り値の `v2_imported` は、切り詰め公開防止ガード
    (snapshot_guard.py, T12 P3 §2.4)がログの「復元方法」を組み立てるための
    診断用カウント(既存の import 呼び出しの戻り値そのものを再利用しているだけ
    で、判定ロジックの複製ではない)。呼び出し元が戻り値を無視しても挙動は
    変わらない(この関数自体が行う処理は従来通り)。`pages_imported` は v1
    撤去により常に 0 のまま保持している(`restore_method_label`/
    `snapshot_guard.py` の呼び出し互換性のため。§1 "触らないもの")。
    """
    init_db(db_path)
    if apply_ranking_day_label_migration(db_path):
        logger.info("Applied one-time ranking-day label migration (UTC gain day)")

    restore_info = {"pages_imported": 0, "v2_imported": 0}

    legacy_db_path = db_path.parent / "ranking.legacy.db"
    if legacy_db_path.exists():
        merged = merge_ranking_databases(db_path, legacy_db_path)
        if merged:
            logger.info(
                "Ranking snapshot days after legacy merge: %s",
                count_snapshot_dates(db_path),
            )

    import_json = config.resolve_snapshot_import_path(db_path)
    if import_json:
        seed_dates = snapshot_dates_in_mvp_json(import_json)
        db_dates_before = set(list_snapshot_dates(db_path))
        missing = sorted(seed_dates - db_dates_before)
        logger.info(
            "Importing snapshot seed: %s (missing dates: %s)",
            import_json,
            missing or "none",
        )
        imported_rows = import_snapshots_from_mvp_json(db_path, import_json)
        if imported_rows:
            logger.info(
                "Snapshot days after JSON import: %s (from %s)",
                count_snapshot_dates(db_path),
                import_json,
            )

    if config.snapshot_import_from_v2_shards():
        v2_imported = import_missing_snapshots_from_v2_url(
            db_path,
            config.pages_v2_rankings_url(),
        )
        restore_info["v2_imported"] = v2_imported
        if v2_imported:
            logger.info(
                "Snapshot days after v2 shard import: %s (+%s rows)",
                count_snapshot_dates(db_path),
                v2_imported,
            )

    ensure_ranking_fetched_at_meta(db_path)
    if reconcile_ranking_fetched_at_meta(db_path):
        logger.info(
            "Raised last_ranking_fetched_at from latest snapshot fetched_at in DB"
        )

    return restore_info


def enforce_snapshot_integrity_guard(
    db_path: Path,
    logger: logging.Logger,
    restore_info: dict[str, int],
) -> None:
    """切り詰め公開防止ガード(T12 P3 §2.4)を呼び出す。

    呼び出し位置は必ず `bootstrap_database()`(cache・Release・v2 の復元が
    全て完了する箇所。v1 段は T12 P4 で撤去済み)の直後、かつランキングAPI
    取得・Pages export・Release
    persist より前であること(§2.4)。`run()` / `run_navigator_only()` の両方
    から、それぞれの `bootstrap_database()` 呼び出し直後に呼ぶ(navigator-only
    runもコミットジョブでRelease persistを行うため対象になる)。

    `SnapshotGuardError` はここで捕捉せずそのまま伝播させる――呼び出し元の
    `main()` が捕捉して `sys.exit(1)` することで run 自体を fail させ、
    GitHub Actions 上で後続の Pages export / Release persist ステップを
    スキップさせる(=fail-closed の実体化)。
    """
    method = restore_method_label(
        cache_hit=config.restore_cache_hit(),
        release_restored=config.restore_release_restored(),
        pages_imported=restore_info.get("pages_imported", 0),
        v2_imported=restore_info.get("v2_imported", 0),
    )
    census = check_snapshot_integrity(
        db_path,
        method=method,
        v2_meta_url=config.pages_v2_rankings_url(),
    )
    logger.info(
        "Snapshot integrity guard passed: method=%s snapshot_days=%s "
        "(expected_min=%s) total_rows=%s",
        census.method,
        census.snapshot_days,
        census.expected_min_days,
        census.total_rows,
    )


def collect_asset_keys_from_db(db_path: Path) -> list[str]:
    snapshots = load_all_snapshots(db_path)
    if not snapshots:
        return []

    latest_date = latest_snapshot_date(db_path) or max(
        row.snapshot_date for row in snapshots
    )
    keys: list[str] = []
    seen: set[str] = set()
    for row in snapshots:
        if row.snapshot_date != latest_date:
            continue
        asset_key = str(row.character_asset_key or "").strip()
        if not asset_key or asset_key in seen:
            continue
        seen.add(asset_key)
        keys.append(asset_key)
    return keys


def resolve_ranking_updated_at(
    db_path: Path,
    logger: logging.Logger,
    *,
    prefer: datetime | None = None,
) -> datetime:
    """Resolve the ranking updatedAt timestamp, DB-derived only (T12 P4).

    Previously also fell back to the local v1 rankings.json's meta.updatedAt
    (`read_json_updated_at`) and, failing that, the deployed Pages v1 JSON
    (`read_json_updated_at_from_url`/`config.pages_rankings_url()`). Both v1
    fallbacks are removed here; the from_db priority below (app_meta, then
    the latest snapshot's own fetched_at) is unchanged.
    """
    if prefer is not None:
        resolved = prefer.astimezone(UTC) if prefer.tzinfo else prefer.replace(tzinfo=UTC)
        logger.info("Using ranking updatedAt from current fetch: %s", resolved.isoformat())
        return resolved

    reconcile_ranking_fetched_at_meta(db_path)

    stored = get_app_meta(db_path, LAST_RANKING_FETCHED_AT_KEY)
    if stored:
        parsed = parse_iso_datetime(stored)
        if parsed:
            logger.info("Using ranking updatedAt from SQLite app_meta: %s", parsed.isoformat())
            return parsed

    from_db = latest_snapshot_fetched_at(db_path)
    if from_db:
        logger.info(
            "Using ranking updatedAt from latest snapshot fetched_at: %s",
            from_db.isoformat(),
        )
        return from_db

    fallback = now_utc()
    logger.warning(
        "No prior ranking updatedAt found; falling back to export time: %s",
        fallback.isoformat(),
    )
    return fallback


def export_rankings_from_db(
    db_path: Path,
    logger: logging.Logger,
    *,
    updated_at: datetime | None = None,
) -> Path:
    exported_at = updated_at or now_utc()
    min_level = config.ranking_min_level()
    meta_json_path = config.character_meta_json_path()

    snapshots = load_all_snapshots(db_path)
    if not snapshots:
        raise RuntimeError("No snapshot rows loaded from SQLite")

    ranking_day = latest_snapshot_date(db_path) or max(
        row.snapshot_date for row in snapshots
    )
    ranking_top_n = count_snapshots_for_date(db_path, ranking_day)
    retention_days = config.snapshot_retention_days()
    history_days = config.mvp_history_days()
    export_top_n = config.mvp_export_top_n()

    analysis_rows = build_analysis_rows(
        snapshots,
        benchmark_character=config.benchmark_character_name(),
    )
    export_snapshots = filter_snapshots_for_history(
        snapshots,
        latest_date=ranking_day,
        history_days=history_days,
    )
    character_meta = load_character_meta(db_path)

    # T12 P4: the v1 JSON file (`export_mvp_json`) is retired -- only the
    # payload-building step it used internally (`build_mvp_payload`, shared
    # with v2) and the v2 export it always also called (`export_mvp_v2_json`,
    # §1 "触らないもの", unchanged) are kept. `config.mvp_export_dir()`
    # supplies the same directory the old v1 file lived in, which
    # `export_mvp_v2_json` still uses to derive its `v2/` subfolder.
    payload = build_mvp_payload(
        export_snapshots,
        analysis_rows,
        updated_at=exported_at,
        export_top_n=export_top_n,
        ranking_top_n=ranking_top_n,
        latest_snapshot_date=ranking_day,
        history_days=history_days,
        snapshot_retention_days=retention_days,
        ranking_min_level=min_level,
        character_meta=character_meta,
    )
    mvp_path = export_mvp_v2_json(payload, config.mvp_export_dir() / "rankings.json")

    meta_exported = export_character_meta_file(db_path, meta_json_path)
    checkpoint_db(db_path)
    logger.info(
        "character_meta after export: %s in DB, %s in character_meta.json",
        count_character_meta(db_path),
        meta_exported,
    )
    logger.info(
        "Exported rankings: ranking_day=%s ranking_top_n=%s analysis_rows=%s mvp_json=%s",
        ranking_day,
        ranking_top_n,
        len(analysis_rows),
        mvp_path,
    )
    return mvp_path


def run_navigator_only() -> int:
    logger = logging.getLogger(__name__)
    db_path = config.sqlite_db_path()
    meta_json_path = config.character_meta_json_path()

    restore_info = bootstrap_database(db_path, logger)
    enforce_snapshot_integrity_guard(db_path, logger, restore_info)
    import_character_meta_file(db_path, meta_json_path)

    asset_keys = collect_asset_keys_from_db(db_path)
    logger.info(
        "Navigator-only run: %s asset keys from latest snapshot in DB",
        len(asset_keys),
    )
    if not asset_keys:
        raise RuntimeError(
            "No character_asset_key values in latest snapshot; run ranking fetch first"
        )

    navigator_run_date = datetime.now(UTC).date()
    rotation_enabled = config.navigator_rotation_enabled()
    rotation_epoch = config.navigator_rotation_epoch()
    current_snapshot_date = latest_snapshot_date(db_path) or ""
    target_world = ""
    if rotation_enabled:
        # This is a duplicate-run marker, not an interprocess lock. GitHub Actions
        # serializes Pages/Navigator via the shared `maplen-board-pages` concurrency group.
        target_world = rotation_target_world(
            navigator_run_date,
            epoch=rotation_epoch,
        )
        if current_snapshot_date and navigator_success_matches(
            get_app_meta(db_path, NAVIGATOR_LAST_SUCCESS_KEY),
            run_date=navigator_run_date,
            target_world=target_world,
            snapshot_date=current_snapshot_date,
        ):
            logger.info(
                "Navigator-only skipped: target=%s already synced on %s for snapshot=%s",
                target_world,
                navigator_run_date.isoformat(),
                current_snapshot_date,
            )
            return 0

    fetched_count, skipped_count, failed_count = sync_world_ids(
        db_path,
        asset_keys,
        request_delay_sec=config.navigator_request_delay_sec(),
        rotation_enabled=rotation_enabled,
        rotation_epoch=rotation_epoch,
        reference_date=navigator_run_date,
    )

    # `sync_world_ids` commits character_meta upserts before returning. Store the
    # duplicate-run marker only after those DB updates complete without failures.
    if should_store_navigator_success_marker(
        rotation_enabled=rotation_enabled,
        snapshot_date=current_snapshot_date,
        failed_count=failed_count,
    ):
        set_app_meta(
            db_path,
            NAVIGATOR_LAST_SUCCESS_KEY,
            navigator_success_payload(
                run_date=navigator_run_date,
                target_world=target_world,
                snapshot_date=current_snapshot_date,
            ),
        )
        logger.info(
            "Navigator-only success marker stored: target=%s run_date=%s snapshot=%s fetched=%s skipped=%s",
            target_world,
            navigator_run_date.isoformat(),
            current_snapshot_date,
            fetched_count,
            skipped_count,
        )
    elif failed_count:
        logger.warning(
            "Navigator-only success marker not stored because failed=%s",
            failed_count,
        )

    if config.navigator_export_rankings_json():
        export_rankings_from_db(
            db_path,
            logger,
            updated_at=resolve_ranking_updated_at(db_path, logger),
        )
    else:
        checkpoint_db(db_path)
        logger.info(
            "Navigator-only rankings JSON export skipped "
            "(NAVIGATOR_EXPORT_RANKINGS_JSON=false)"
        )
    return 0

def build_snapshot_rows(
    ranking: list[dict[str, Any]], fetched: datetime
) -> list[SnapshotRow]:
    snap_date = snapshot_date_ranking(fetched)
    rows: list[SnapshotRow] = []

    for entry in ranking:
        if not isinstance(entry, dict):
            continue
        rows.append(
            SnapshotRow(
                snapshot_date=snap_date,
                rank=normalize_int(entry.get("rank")),
                rank_fluctuation=normalize_int(entry.get("rankFluctuation")),
                character_name=str(entry.get("characterName", "")).strip(),
                class_code=str(entry.get("classCode", "")).strip(),
                job_code=str(entry.get("jobCode", "")).strip(),
                level=normalize_int(entry.get("level")),
                exp=normalize_int(entry.get("exp")),
                image_url=str(entry.get("imageUrl", "")).strip(),
                character_asset_key=extract_asset_key(entry),
            )
        )
    return rows


def run() -> int:
    config.load_env_file()
    logger = logging.getLogger(__name__)
    if config.navigator_only():
        return run_navigator_only()

    clear_ranking_day_skip_marker()

    fetched = now_utc()
    snap_date = snapshot_date_ranking(fetched)
    min_level = config.ranking_min_level()
    max_pages = config.ranking_max_pages()

    db_path = config.sqlite_db_path()
    meta_json_path = config.character_meta_json_path()
    ranking_data_fetched_at: datetime | None = None
    restore_info = bootstrap_database(db_path, logger)
    enforce_snapshot_integrity_guard(db_path, logger, restore_info)

    if config.enforce_jst_fetch_window():
        wait_until_jst_fetch_window(logger)
        fetched = now_utc()
        snap_date = snapshot_date_ranking(fetched)

    if try_skip_entire_run(db_path, snap_date):
        return 0

    skip_ranking_fetch = should_skip_ranking_fetch(db_path, snap_date)
    if skip_ranking_fetch:
        log_skip_ranking_fetch_only(db_path, snap_date)
        ranking_top_n = count_snapshots_for_date(db_path, snap_date)
        sqlite_saved = 0
        sqlite_skipped = 0
    else:
        baseline_date, baseline_rows = load_snapshot_state_before(db_path, snap_date)
        logger.info(
            "MapleN Board bot started (ranking_day=%s UTC, local=%s JST, min_level=%s)",
            snap_date,
            fetched.astimezone(JST).strftime("%Y-%m-%d %H:%M:%S"),
            min_level,
        )
        logger.info(
            "Freshness baseline: date=%s rows=%s",
            baseline_date or "none",
            len(baseline_rows),
        )

        if config.enforce_jst_fetch_window():
            wait_for_ranking_update(
                baseline_rows,
                poll_interval_sec=config.ranking_update_poll_interval_sec(),
                timeout_sec=config.ranking_update_poll_timeout_sec(),
                settle_sec=config.ranking_update_settle_sec(),
            )

        import_character_meta_file(db_path, meta_json_path)
        cached_meta = count_character_meta(db_path)
        logger.info("character_meta in DB after file import: %s with worldId", cached_meta)

        ranking = fetch_ranking_min_level(
            min_level,
            config.ranking_request_delay_sec(),
            max_pages,
        )
        changed_count = validate_ranking_freshness(
            ranking,
            baseline_rows,
            config.ranking_freshness_min_changed(),
        )
        logger.info(
            "Ranking freshness validated: changed=%s required=%s",
            changed_count,
            config.ranking_freshness_min_changed(),
        )

        if config.navigator_fetch_enabled():
            asset_keys = collect_asset_keys(ranking)
            logger.info(
                "Navigator sync starting: %s ranking keys, %s cached worldIds in DB",
                len(asset_keys),
                cached_meta,
            )
            sync_world_ids(
                db_path,
                asset_keys,
                request_delay_sec=config.navigator_request_delay_sec(),
                rotation_enabled=config.navigator_rotation_enabled(),
                rotation_epoch=config.navigator_rotation_epoch(),
            )
        else:
            logger.info("Navigator world sync skipped (NAVIGATOR_FETCH_ENABLED=false)")

        fetched = now_utc()
        ranking_data_fetched_at = fetched
        set_app_meta(
            db_path,
            LAST_RANKING_FETCHED_AT_KEY,
            fetched.isoformat(timespec="seconds"),
        )
        snap_date = snapshot_date_ranking(fetched)
        snapshot_rows = build_snapshot_rows(ranking, fetched)
        if not snapshot_rows:
            raise RuntimeError(f"No snapshot rows for level>={min_level}")

        ranking_top_n = len(snapshot_rows)
        fetched_at = fetched.isoformat(timespec="seconds")
        sqlite_saved, sqlite_skipped = append_snapshots(
            db_path,
            snapshot_rows,
            fetched_at,
        )

        name_to_asset_key = build_name_to_asset_key_from_ranking(ranking)
        backfilled = backfill_character_asset_keys(
            db_path,
            name_to_asset_key=name_to_asset_key,
        )
        if backfilled:
            logger.info(
                "Complemented asset keys from today's ranking: %s names, %s rows",
                len(name_to_asset_key),
                backfilled,
            )

    fetched = now_utc()

    ranking_day = snap_date
    retention_days = config.snapshot_retention_days()
    retention_cutoff = (
        date.fromisoformat(ranking_day) - timedelta(days=retention_days - 1)
    ).isoformat()
    deleted_rows = delete_snapshots_before(db_path, retention_cutoff)

    snapshots = load_all_snapshots(db_path)
    snapshot_days = count_snapshot_dates(db_path)
    logger.info("Ranking snapshot days in DB: %s", snapshot_days)
    if snapshot_days < 2:
        logger.warning(
            "Fewer than 2 snapshot days; daily/weekly/monthly gains will be 0 "
            "until another ranking day is stored."
        )

    logger.info(
        "Loaded %s snapshot rows (retention=%s days, deleted_old=%s)",
        len(snapshots),
        retention_days,
        deleted_rows,
    )

    mvp_path = export_rankings_from_db(
        db_path,
        logger,
        updated_at=resolve_ranking_updated_at(
            db_path,
            logger,
            prefer=ranking_data_fetched_at,
        ),
    )

    logger.info(
        "Completed: ranking_top_n=%s sqlite_saved=%s sqlite_skipped=%s "
        "retention_days=%s deleted_old=%s mvp_json=%s",
        ranking_top_n,
        sqlite_saved,
        sqlite_skipped,
        retention_days,
        deleted_rows,
        mvp_path,
    )
    return 0


def main() -> None:
    setup_logging()
    logger = logging.getLogger(__name__)
    try:
        raise SystemExit(run())
    except Exception:
        logger.exception("MapleN Board bot failed")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
