"""
Enrich rankings.json with characterAssetKey (from ranking API) and worldId (Navigator API).

Use when rankings.json exists but lacks server fields — e.g. after sync from Pages
before Navigator ran, or after the worldId parser bug.

Resume: character_meta in SQLite caches completed Navigator lookups.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import config
from main import fetch_ranking_min_level
from navigator import (
    KNOWN_WORLD_IDS,
    collect_asset_keys,
    extract_asset_key,
    navigator_character_url,
    sync_world_ids,
)
from sqlite_storage import init_db, load_character_meta

logger = logging.getLogger(__name__)


def _rank_asset_map(ranking: list[dict]) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for entry in ranking:
        if not isinstance(entry, dict):
            continue
        rank = int(entry.get("rank") or 0)
        asset_key = extract_asset_key(entry)
        if rank > 0 and asset_key:
            mapping[rank] = asset_key
    return mapping


def enrich_characters(
    characters: list[dict],
    rank_to_asset: dict[int, str],
    world_by_asset: dict[str, str],
) -> tuple[int, int]:
    keys_added = 0
    worlds_added = 0

    for character in characters:
        rank = int(character.get("rank") or 0)
        asset_key = str(character.get("characterAssetKey") or "").strip()
        if not asset_key and rank in rank_to_asset:
            asset_key = rank_to_asset[rank]
            character["characterAssetKey"] = asset_key
            keys_added += 1

        if not asset_key:
            continue

        world_id = str(character.get("worldId") or "").strip()
        if not world_id:
            world_id = world_by_asset.get(asset_key, "").strip()
            if world_id:
                character["worldId"] = world_id
                worlds_added += 1

        character["navigatorUrl"] = navigator_character_url(asset_key)

    return keys_added, worlds_added


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich rankings.json with Navigator worldId")
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        default=config.mvp_json_output_path(),
        help="Input rankings.json",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output path (default: overwrite input)",
    )
    parser.add_argument(
        "--skip-ranking-fetch",
        action="store_true",
        help="Only use characterAssetKey already present in JSON",
    )
    parser.add_argument(
        "--skip-navigator",
        action="store_true",
        help="Only apply cached worldId from SQLite",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Navigator: only process this many pending keys (0 = all)",
    )
    parser.add_argument(
        "--full-refresh",
        action="store_true",
        help="Refresh every asset key (ignore server rotation)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )

    config.load_env_file()
    output_path = args.output or args.input

    if not args.input.exists():
        logger.error("Input not found: %s", args.input)
        return 1

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    characters = payload.get("characters")
    if not isinstance(characters, list):
        logger.error("Invalid rankings.json: missing characters array")
        return 1

    rank_to_asset: dict[int, str] = {}
    if not args.skip_ranking_fetch:
        logger.info("Fetching ranking API for characterAssetKey map...")
        ranking = fetch_ranking_min_level(
            config.ranking_min_level(),
            config.ranking_request_delay_sec(),
            config.ranking_max_pages(),
        )
        rank_to_asset = _rank_asset_map(ranking)
        logger.info("Ranking map: %s ranks with asset keys", len(rank_to_asset))

    db_path = config.sqlite_db_path()
    init_db(db_path)

    asset_keys = list(
        {
            key
            for key in (
                list(rank_to_asset.values())
                + [
                    str(character.get("characterAssetKey") or "").strip()
                    for character in characters
                ]
            )
            if key
        }
    )

    if not args.skip_navigator and asset_keys:
        keys_to_sync = asset_keys
        if args.limit > 0:
            existing = load_character_meta(db_path)
            keys_to_sync = [
                key
                for key in asset_keys
                if key and not str(existing.get(key, "")).strip()
            ][: args.limit]
            logger.info("Navigator limit: processing %s keys", len(keys_to_sync))
        sync_world_ids(
            db_path,
            keys_to_sync,
            request_delay_sec=config.navigator_request_delay_sec(),
            rotation_enabled=config.navigator_rotation_enabled() and not args.limit,
            rotation_epoch=config.navigator_rotation_epoch(),
            full_refresh=args.full_refresh,
            skip_existing=bool(args.limit),
        )
    elif not asset_keys:
        logger.warning("No characterAssetKey values to fetch Navigator for")

    world_by_asset = load_character_meta(db_path)
    keys_added, worlds_added = enrich_characters(characters, rank_to_asset, world_by_asset)

    meta = payload.setdefault("meta", {})
    meta["worldIds"] = list(KNOWN_WORLD_IDS)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    with_world = sum(1 for character in characters if character.get("worldId"))
    with_key = sum(1 for character in characters if character.get("characterAssetKey"))

    logger.info(
        "Done: wrote %s (assetKey=%s worldId=%s; added keys=%s worlds=%s)",
        output_path,
        with_key,
        with_world,
        keys_added,
        worlds_added,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
