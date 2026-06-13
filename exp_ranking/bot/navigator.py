"""Fetch character world (server) from MSU Navigator API."""

from __future__ import annotations

import logging
import time
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

UTC = ZoneInfo("UTC")

NAVIGATOR_INFO_API = (
    "https://msu.io/navigator/api/navigator/characters/{asset_key}/info"
)
NAVIGATOR_CHARACTER_URL = "https://msu.io/navigator/character/{asset_key}"

KNOWN_WORLD_IDS = ("Ain", "Errai", "Fang")
# Daily refresh order: one server cohort per run (3-day full cycle).
WORLD_REFRESH_ROTATION = ("Fang", "Errai", "Ain")
DEFAULT_ROTATION_EPOCH = date(2026, 6, 12)

REQUEST_TIMEOUT_SEC = 30
MAX_RETRIES = 3
RETRY_WAIT_SEC = 10


def navigator_character_url(asset_key: str) -> str:
    return NAVIGATOR_CHARACTER_URL.format(asset_key=asset_key)


def extract_asset_key(entry: dict[str, Any]) -> str:
    for key in ("characterAssetKey", "CharacterAssetKey", "character_asset_key"):
        value = entry.get(key)
        if value:
            return str(value).strip()
    return ""


def collect_asset_keys(ranking: list[dict[str, Any]]) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for entry in ranking:
        if not isinstance(entry, dict):
            continue
        asset_key = extract_asset_key(entry)
        if not asset_key or asset_key in seen:
            continue
        seen.add(asset_key)
        keys.append(asset_key)
    return keys


def _parse_world_id(payload: dict[str, Any]) -> str:
    character = payload.get("character")
    if not isinstance(character, dict):
        return ""
    common = character.get("common")
    if not isinstance(common, dict):
        return ""
    world_id = str(common.get("worldId", "")).strip()
    if world_id in KNOWN_WORLD_IDS:
        return world_id
    return world_id


def fetch_world_id(session: requests.Session, asset_key: str) -> str:
    url = NAVIGATOR_INFO_API.format(asset_key=asset_key)
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT_SEC)
            if response.status_code != 200:
                raise RuntimeError(f"HTTP {response.status_code}")
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("invalid JSON object")
            return _parse_world_id(payload)
        except (requests.RequestException, RuntimeError, ValueError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_WAIT_SEC)

    raise RuntimeError(f"navigator info failed for {asset_key}: {last_error}")


def rotation_target_world(
    reference_date: date | None = None,
    *,
    epoch: date = DEFAULT_ROTATION_EPOCH,
) -> str:
    ref = reference_date or datetime.now(UTC).date()
    day_index = (ref - epoch).days
    return WORLD_REFRESH_ROTATION[day_index % len(WORLD_REFRESH_ROTATION)]


def select_world_sync_keys(
    asset_keys: list[str],
    existing: dict[str, str],
    *,
    reference_date: date | None = None,
    epoch: date = DEFAULT_ROTATION_EPOCH,
    always_refresh_missing: bool = True,
) -> tuple[list[str], str]:
    """Pick keys to refresh: missing worldId + today's rotation server cohort."""
    target_world = rotation_target_world(reference_date, epoch=epoch)
    pending: list[str] = []
    for key in asset_keys:
        if not key:
            continue
        cached = str(existing.get(key, "")).strip()
        if always_refresh_missing and not cached:
            pending.append(key)
            continue
        if cached == target_world:
            pending.append(key)
    return pending, target_world


def sync_world_ids(
    db_path,
    asset_keys: list[str],
    *,
    request_delay_sec: float,
    rotation_enabled: bool = True,
    rotation_epoch: date | None = None,
    reference_date: date | None = None,
    full_refresh: bool = False,
    skip_existing: bool = False,
) -> tuple[int, int, int]:
    """Return (fetched, skipped, failed).

    Default: refresh missing worldIds plus one server cohort per day (Fang/Errai/Ain).
    full_refresh=True refreshes every key. skip_existing=True (rotation off) only
    fetches keys without a cached worldId.
    """
    from sqlite_storage import load_character_meta, upsert_character_meta

    logger = logging.getLogger(__name__)
    if not asset_keys:
        return 0, 0, 0

    epoch = rotation_epoch or DEFAULT_ROTATION_EPOCH
    existing = load_character_meta(db_path)

    if full_refresh:
        pending = [key for key in asset_keys if key]
        target_world = ""
        logger.info("Navigator world sync: full refresh for %s keys", len(pending))
    elif rotation_enabled:
        pending, target_world = select_world_sync_keys(
            asset_keys,
            existing,
            reference_date=reference_date,
            epoch=epoch,
        )
        cohort_count = sum(
            1
            for key in asset_keys
            if key and str(existing.get(key, "")).strip() == target_world
        )
        missing_count = sum(
            1 for key in asset_keys if key and not str(existing.get(key, "")).strip()
        )
        logger.info(
            "Navigator world sync: rotation target=%s (cohort=%s, missing=%s, pending=%s)",
            target_world,
            cohort_count,
            missing_count,
            len(pending),
        )
    else:
        target_world = ""
        pending = [
            key
            for key in asset_keys
            if key
            and (not skip_existing or not str(existing.get(key, "")).strip())
        ]
        logger.info(
            "Navigator world sync: legacy mode pending=%s (skip_existing=%s)",
            len(pending),
            skip_existing,
        )

    skipped = len(asset_keys) - len(pending)

    if not pending:
        if rotation_enabled and not full_refresh:
            logger.info(
                "Navigator world sync: nothing to refresh for target=%s",
                target_world or rotation_target_world(reference_date, epoch=epoch),
            )
        else:
            logger.info("Navigator world sync: all %s keys already cached", len(asset_keys))
        return 0, skipped, 0

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

    fetched = 0
    failed = 0
    updated_at = datetime.now(UTC).isoformat(timespec="seconds")

    logger.info(
        "Navigator world sync: fetching %s keys (skipped=%s, delay=%ss)",
        len(pending),
        skipped,
        request_delay_sec,
    )

    for index, asset_key in enumerate(pending, start=1):
        if index > 1 and request_delay_sec > 0:
            time.sleep(request_delay_sec)

        try:
            world_id = fetch_world_id(session, asset_key)
            if not world_id:
                failed += 1
                logger.warning("Empty worldId for %s (not cached)", asset_key)
                continue
            upsert_character_meta(db_path, asset_key, world_id, updated_at)
            fetched += 1
        except Exception:
            failed += 1
            logger.warning(
                "Failed to fetch worldId for %s",
                asset_key,
                exc_info=True,
            )

        if index == 1 or index % 100 == 0 or index == len(pending):
            logger.info(
                "Navigator progress %s/%s (ok=%s failed=%s)",
                index,
                len(pending),
                fetched,
                failed,
            )

    logger.info(
        "Navigator world sync done: fetched=%s skipped=%s failed=%s",
        fetched,
        skipped,
        failed,
    )
    return fetched, skipped, failed
