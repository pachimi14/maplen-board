"""
MSU official ranking snapshot bot.

Fetches ranking characters at or above min level (default 225+), stores in SQLite.
"""

from __future__ import annotations

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
from ranking_day_skip import clear_ranking_day_skip_marker, try_skip_entire_run
from models import SnapshotRow
from mvp_export import export_mvp_json, filter_snapshots_for_history
from navigator import collect_asset_keys, extract_asset_key, sync_world_ids
from sqlite_storage import (
    append_snapshots,
    backfill_character_asset_keys,
    checkpoint_db,
    count_character_meta,
    count_snapshot_dates,
    count_snapshots_for_date,
    delete_snapshots_before,
    export_character_meta_file,
    hydrate_character_meta_from_json,
    hydrate_character_meta_from_url,
    import_character_meta_file,
    init_db,
    import_snapshots_from_mvp_json,
    list_snapshot_dates,
    load_all_snapshots,
    load_character_meta,
    merge_ranking_databases,
    snapshot_dates_in_mvp_json,
)
from utils import normalize_int

UTC = ZoneInfo("UTC")
JST = ZoneInfo("Asia/Tokyo")

# Official ranking day resets at UTC 00:00 (= JST 09:00)
RANKING_DAY_TIMEZONE = UTC

LOG_DIR = config.BASE_DIR / "logs"
LOG_PATH = LOG_DIR / "msu_ranking_bot.log"

RANKING_API_BASE = "https://msu.io/maplestoryn/api/msn/ranking"
RANKING_QUERY = (
    "rankingFilter.classCode=-1&rankingFilter.jobCode=-1"
    "&paginationParam.pageSize=15"
)

API_MAX_PAGE_SIZE = 10
MAX_RETRIES = 10
RETRY_WAIT_SEC = 60
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
    """Ranking day id (UTC calendar date; rolls at UTC 00:00 = JST 09:00)."""
    current = dt or now_utc()
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    else:
        current = current.astimezone(UTC)
    return current.date().isoformat()


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

    for attempt in range(1, MAX_RETRIES + 1):
        logger.info(
            "Fetching ranking API (attempt %s/%s, min_level=%s, max_pages=%s)",
            attempt,
            MAX_RETRIES,
            min_level,
            max_pages,
        )
        try:
            collected: list[dict[str, Any]] = []
            failed = False
            last_page = 0

            for page_no in range(1, max_pages + 1):
                if page_no > 1 and request_delay_sec > 0:
                    time.sleep(request_delay_sec)

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
            logger.info("Retrying in %s seconds...", RETRY_WAIT_SEC)
            time.sleep(RETRY_WAIT_SEC)

    raise RuntimeError(
        f"Failed to fetch valid ranking after {MAX_RETRIES} attempts "
        f"(last_status={last_status}, body_head={last_body[:300]!r})"
    )


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
    clear_ranking_day_skip_marker()

    fetched = now_utc()
    snap_date = snapshot_date_ranking(fetched)
    min_level = config.ranking_min_level()
    max_pages = config.ranking_max_pages()

    db_path = config.sqlite_db_path()
    json_path = config.mvp_json_output_path()
    meta_json_path = config.character_meta_json_path()
    init_db(db_path)

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

    if config.enforce_jst_fetch_window():
        wait_until_jst_fetch_window(logger)
        fetched = now_utc()
        snap_date = snapshot_date_ranking(fetched)

    if try_skip_entire_run(db_path, snap_date):
        return 0

    logger.info(
        "MSU ranking bot started (ranking_day=%s UTC, local=%s JST, min_level=%s)",
        snap_date,
        fetched.astimezone(JST).strftime("%Y-%m-%d %H:%M:%S"),
        min_level,
    )

    import_character_meta_file(db_path, meta_json_path)
    cached_meta = count_character_meta(db_path)
    logger.info("character_meta in DB after file import: %s with worldId", cached_meta)

    if json_path.exists():
        hydrated = hydrate_character_meta_from_json(db_path, json_path)
        if hydrated:
            cached_meta = count_character_meta(db_path)
            logger.info("character_meta after local rankings.json: %s", cached_meta)

    if config.hydrate_meta_from_pages():
        pages_hydrated = hydrate_character_meta_from_url(
            db_path, config.pages_rankings_url()
        )
        if pages_hydrated:
            cached_meta = count_character_meta(db_path)
            logger.info(
                "character_meta after Pages hydrate: %s (imported %s)",
                cached_meta,
                pages_hydrated,
            )

    ranking = fetch_ranking_min_level(
        min_level,
        config.ranking_request_delay_sec(),
        max_pages,
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
        )
    else:
        logger.info("Navigator world sync skipped (NAVIGATOR_FETCH_ENABLED=false)")

    fetched = now_utc()
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

    ranking_day = snap_date
    retention_days = config.snapshot_retention_days()
    retention_cutoff = (
        date.fromisoformat(ranking_day) - timedelta(days=retention_days - 1)
    ).isoformat()
    deleted_rows = delete_snapshots_before(db_path, retention_cutoff)

    snapshots = load_all_snapshots(db_path)
    if not snapshots:
        raise RuntimeError("No snapshot rows loaded from SQLite")

    snapshot_days = count_snapshot_dates(db_path)
    logger.info("Ranking snapshot days in DB: %s", snapshot_days)
    if snapshot_days < 2:
        logger.warning(
            "Fewer than 2 snapshot days; daily/weekly/monthly gains will be 0 "
            "until another ranking day is stored."
        )

    # MVP は今回保存したランキング日（UTC）を表示
    latest_date = ranking_day

    logger.info(
        "Loaded %s snapshot rows (retention=%s days, deleted_old=%s)",
        len(snapshots),
        retention_days,
        deleted_rows,
    )

    analysis_rows = build_analysis_rows(
        snapshots,
        benchmark_character=config.benchmark_character_name(),
    )
    history_days = config.mvp_history_days()
    export_snapshots = filter_snapshots_for_history(
        snapshots,
        latest_date=latest_date,
        history_days=history_days,
    )
    export_top_n = config.mvp_export_top_n()

    character_meta = load_character_meta(db_path)

    mvp_path = export_mvp_json(
        export_snapshots,
        analysis_rows,
        config.mvp_json_output_path(),
        updated_at=fetched,
        export_top_n=export_top_n,
        ranking_top_n=ranking_top_n,
        latest_snapshot_date=latest_date,
        history_days=history_days,
        snapshot_retention_days=retention_days,
        ranking_min_level=min_level,
        character_meta=character_meta,
    )

    meta_exported = export_character_meta_file(db_path, meta_json_path)
    checkpoint_db(db_path)
    logger.info(
        "character_meta after run: %s in DB, %s in character_meta.json",
        count_character_meta(db_path),
        meta_exported,
    )

    logger.info(
        "Completed: ranking_top_n=%s sqlite_saved=%s sqlite_skipped=%s "
        "retention_days=%s deleted_old=%s analysis_rows=%s mvp_json=%s",
        ranking_top_n,
        sqlite_saved,
        sqlite_skipped,
        retention_days,
        deleted_rows,
        len(analysis_rows),
        mvp_path,
    )
    return 0


def main() -> None:
    setup_logging()
    logger = logging.getLogger(__name__)
    try:
        raise SystemExit(run())
    except Exception:
        logger.exception("MSU ranking bot failed")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
