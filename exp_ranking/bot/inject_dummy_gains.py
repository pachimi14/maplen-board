"""
Inject synthetic multi-day history and EXP gains into rankings.json for UI testing.

Does not modify SQLite. Creates rankings.json.bak before writing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import shutil
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import config

logger = logging.getLogger(__name__)

DEFAULT_HISTORY_DAYS = 35


def _stable_unit(seed: str) -> float:
    digest = hashlib.md5(seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def _daily_gain(rank: int, day_offset: int, name: str) -> int:
    """Larger gains for higher official ranks; stable per character/day."""
    rank_factor = 1.0 + max(0, 1000 - min(rank, 1000)) / 400.0
    jitter = 0.35 + _stable_unit(f"{name}:d{day_offset}") * 1.1
    tier = 8_000_000_000 if rank <= 50 else 4_000_000_000 if rank <= 200 else 1_500_000_000
    spike = 1.0 + (_stable_unit(f"{name}:spike{day_offset}") * 0.6 if day_offset % 7 == 0 else 0.0)
    return int(tier * rank_factor * jitter * spike)


def _format_chart(snapshot_day: date) -> str:
    return snapshot_day.strftime("%m/%d")


def _build_history(
    character: dict[str, Any],
    *,
    latest_day: date,
    history_days: int,
) -> list[dict[str, Any]]:
    rank = int(character.get("rank") or 1)
    name = str(character.get("name") or "")
    level = int(character.get("level") or 235)
    end_pct = float(character.get("levelExpPercent") or character.get("expPercent") or 0.0)

    history: list[dict[str, Any]] = []
    pct = end_pct

    for offset in range(history_days - 1, -1, -1):
        day = latest_day - timedelta(days=offset)
        gain = _daily_gain(rank, offset, name)

        history.append(
            {
                "date": _format_chart(day),
                "level": level,
                "levelExpPercent": round(max(0.0, min(100.0, pct)), 3),
                "expPercent": round(max(0.0, min(100.0, pct)), 3),
                "dailyGain": gain,
            }
        )

        if level < 275:
            pct_delta = min(12.0, gain / 80_000_000_000)
            pct = max(0.0, pct - pct_delta)

    return history


def _apply_gains(character: dict[str, Any], history: list[dict[str, Any]]) -> None:
    daily_values = [int(point.get("dailyGain") or 0) for point in history]
    character["history"] = history
    character["weeklyGain"] = sum(daily_values[-7:])
    character["monthlyGain"] = sum(daily_values[-30:])


def inject_dummy_gains(
    json_path: Path,
    *,
    history_days: int = DEFAULT_HISTORY_DAYS,
    backup: bool = True,
) -> Path:
    if not json_path.exists():
        raise FileNotFoundError(json_path)

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    characters = payload.get("characters")
    if not isinstance(characters, list) or not characters:
        raise ValueError("rankings.json has no characters")

    meta = payload.setdefault("meta", {})
    latest_raw = meta.get("latestSnapshotDate")
    if latest_raw:
        latest_day = date.fromisoformat(str(latest_raw))
    else:
        latest_day = date.today()

    for character in characters:
        if not isinstance(character, dict):
            continue
        history = _build_history(
            character,
            latest_day=latest_day,
            history_days=history_days,
        )
        _apply_gains(character, history)

    meta["demoGains"] = True
    meta["demoGainDays"] = history_days
    meta["demoGainsNote"] = (
        "Synthetic history for UI testing. Re-export from bot to restore real data."
    )

    if backup:
        backup_path = json_path.with_suffix(json_path.suffix + ".bak")
        shutil.copy2(json_path, backup_path)
        logger.info("Backup written: %s", backup_path)

    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(
        "Injected demo gains: %s characters, %s days, path=%s",
        len(characters),
        history_days,
        json_path,
    )
    return json_path


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="Inject dummy EXP gains into rankings.json")
    parser.add_argument(
        "--json",
        type=Path,
        default=None,
        help="Path to rankings.json (default: MVP_JSON_OUTPUT_PATH)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_HISTORY_DAYS,
        help=f"Number of synthetic history days (default {DEFAULT_HISTORY_DAYS})",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Do not create rankings.json.bak",
    )
    args = parser.parse_args()

    config.load_env_file()
    json_path = args.json or config.mvp_json_output_path()
    inject_dummy_gains(
        json_path,
        history_days=max(7, args.days),
        backup=not args.no_backup,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
