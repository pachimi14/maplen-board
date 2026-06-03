"""Export ranking data to JSON for the EXP Ranking MVP frontend."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from analysis import build_analysis_rows
from identity import build_name_to_asset_key, resolve_snapshot_identity
from level_exp import (
    EXP_TO_NEXT_LEVEL,
    TARGET_TOTAL_EXP_250,
    calculate_level_exp_percent,
    calculate_total_exp_from_240,
    exp_required_for_level,
)
from job_names import format_job_name
from models import AnalysisRow, SnapshotRow
from navigator import KNOWN_WORLD_IDS, navigator_character_url
from ranking_periods import (
    gain_period_meta,
    monthly_period_start,
    sum_daily_gains_in_period,
    weekly_period_start,
)

logger = logging.getLogger(__name__)


def _format_chart_date(snapshot_date: str) -> str:
    try:
        parsed = datetime.strptime(snapshot_date, "%Y-%m-%d")
        return parsed.strftime("%m/%d")
    except ValueError:
        return snapshot_date


def _analysis_lookup(analysis_rows: list[AnalysisRow]) -> dict[tuple[str, str], AnalysisRow]:
    lookup: dict[tuple[str, str], AnalysisRow] = {}
    for row in analysis_rows:
        lookup[(row.snapshot_date, row.character_name.casefold())] = row
    return lookup


def _history_cutoff_date(latest_date: str, history_days: int | None) -> str | None:
    if not history_days:
        return None
    latest = date.fromisoformat(latest_date)
    cutoff = latest - timedelta(days=history_days - 1)
    return cutoff.isoformat()


def filter_snapshots_for_history(
    snapshots: list[SnapshotRow],
    *,
    latest_date: str,
    history_days: int | None,
) -> list[SnapshotRow]:
    cutoff = _history_cutoff_date(latest_date, history_days)
    if not cutoff:
        return snapshots
    return [row for row in snapshots if row.snapshot_date >= cutoff]


def build_mvp_characters(
    snapshots: list[SnapshotRow],
    analysis_rows: list[AnalysisRow],
    *,
    export_top_n: int | None = None,
    latest_snapshot_date: str | None = None,
    character_meta: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    if not snapshots:
        return []

    latest_date = latest_snapshot_date or max(row.snapshot_date for row in snapshots)
    latest_ranking_day = date.fromisoformat(latest_date)
    week_start = weekly_period_start(latest_ranking_day)
    month_start = monthly_period_start(latest_ranking_day)
    analysis_by_key = _analysis_lookup(analysis_rows)
    meta = character_meta or {}
    name_to_asset_key = build_name_to_asset_key(snapshots)
    by_key: dict[str, list[SnapshotRow]] = defaultdict(list)

    for row in snapshots:
        if row.character_name or row.character_asset_key:
            group_key = resolve_snapshot_identity(row, name_to_asset_key)
            if group_key:
                by_key[group_key].append(row)

    characters: list[dict[str, Any]] = []

    for index, (group_key, rows) in enumerate(
        sorted(by_key.items(), key=lambda item: item[0].casefold()),
        start=1,
    ):
        rows_sorted = sorted(rows, key=lambda row: row.snapshot_date)
        on_latest_date = [row for row in rows_sorted if row.snapshot_date == latest_date]
        if not on_latest_date:
            continue
        latest = on_latest_date[-1]

        latest_analysis = analysis_by_key.get(
            (latest.snapshot_date, latest.character_name.casefold())
        )

        history: list[dict[str, Any]] = []
        daily_by_date: list[tuple[str, int | None]] = []
        for snap in rows_sorted:
            analysis = analysis_by_key.get(
                (snap.snapshot_date, snap.character_name.casefold())
            )
            daily_gain: int | None = None
            if analysis and analysis.daily_exp_gain is not None:
                daily_gain = analysis.daily_exp_gain

            daily_by_date.append((snap.snapshot_date, daily_gain))
            level_pct = calculate_level_exp_percent(snap.level, snap.exp)
            history.append(
                {
                    "date": _format_chart_date(snap.snapshot_date),
                    "snapshotDate": snap.snapshot_date,
                    "level": snap.level,
                    "levelExpPercent": level_pct,
                    "expPercent": level_pct,
                    "dailyGain": daily_gain,
                }
            )

        weekly_gain = sum_daily_gains_in_period(
            daily_by_date,
            period_start=week_start,
            period_end=latest_ranking_day,
        )
        monthly_gain = sum_daily_gains_in_period(
            daily_by_date,
            period_start=month_start,
            period_end=latest_ranking_day,
        )
        daily_gains = [gain for _, gain in daily_by_date if gain is not None]
        if latest_analysis and latest_analysis.daily_exp_gain is not None:
            latest_daily_gain = latest_analysis.daily_exp_gain
        elif daily_gains:
            latest_daily_gain = daily_gains[-1]
        else:
            latest_daily_gain = 0

        total_exp = (
            latest_analysis.total_exp_from_240
            if latest_analysis
            else calculate_total_exp_from_240(latest.level, latest.exp)
        )

        level_pct = calculate_level_exp_percent(latest.level, latest.exp)
        asset_key = latest.character_asset_key
        world_id = meta.get(asset_key, "") if asset_key else ""
        name = latest.character_name
        character_payload: dict[str, Any] = {
                "id": index,
                "rank": latest.rank,
                "name": name,
                "job": format_job_name(latest.job_code),
                "level": latest.level,
                "exp": latest.exp,
                "levelExpPercent": level_pct,
                "expPercent": level_pct,
                "expToNextLevel": exp_required_for_level(latest.level),
                "totalExpFrom240": total_exp,
                "expTo250": latest_analysis.exp_to_250 if latest_analysis else 0,
                "dailyGain": latest_daily_gain,
                "weeklyGain": weekly_gain,
                "monthlyGain": monthly_gain,
                "imageUrl": latest.image_url or f"https://placehold.co/96x96?text={index}",
                "history": history,
            }
        if asset_key:
            character_payload["characterAssetKey"] = asset_key
            character_payload["navigatorUrl"] = navigator_character_url(asset_key)
        if world_id:
            character_payload["worldId"] = world_id
        characters.append(character_payload)

    characters.sort(key=lambda item: item["rank"])
    if export_top_n is not None:
        characters = characters[:export_top_n]
    for index, character in enumerate(characters, start=1):
        character["id"] = index

    return characters


def build_mvp_payload(
    snapshots: list[SnapshotRow],
    analysis_rows: list[AnalysisRow],
    *,
    updated_at: datetime | None = None,
    export_top_n: int | None = None,
    ranking_top_n: int | None = None,
    ranking_min_level: int | None = None,
    latest_snapshot_date: str | None = None,
    history_days: int | None = None,
    snapshot_retention_days: int | None = None,
    character_meta: dict[str, str] | None = None,
) -> dict[str, Any]:
    latest_date = latest_snapshot_date or (
        max(row.snapshot_date for row in snapshots) if snapshots else ""
    )
    characters = build_mvp_characters(
        snapshots,
        analysis_rows,
        export_top_n=export_top_n,
        latest_snapshot_date=latest_date or None,
        character_meta=character_meta,
    )
    snapshot_dates = sorted({row.snapshot_date for row in snapshots})
    latest_ranking_day = date.fromisoformat(latest_date) if latest_date else date.today()

    return {
        "meta": {
            "updatedAt": (updated_at or datetime.now()).isoformat(timespec="seconds"),
            "source": "msu_ranking_bot",
            "characterCount": len(characters),
            "snapshotCount": len(snapshots),
            "snapshotDays": len(snapshot_dates),
            "snapshotRetentionDays": snapshot_retention_days or history_days,
            "latestSnapshotDate": latest_date,
            "rankingDayTimezone": "UTC",
            "rankingDayResetsAt": "JST 09:00 (= UTC 00:00)",
            "scheduledFetchAfterJst": "JST queue 04:20/05:20/06:20/09:20 (~+5h delay; skip if day captured)",
            "gainPeriods": gain_period_meta(latest_ranking_day),
            "rankingTopN": ranking_top_n,
            "rankingMinLevel": ranking_min_level,
            "mvpHistoryDays": history_days,
            "targetTotalExp250": TARGET_TOTAL_EXP_250,
            "expTable": {
                str(level): EXP_TO_NEXT_LEVEL[level]
                for level in sorted(EXP_TO_NEXT_LEVEL)
            },
            "worldIds": list(KNOWN_WORLD_IDS),
        },
        "characters": characters,
    }


def export_mvp_json(
    snapshots: list[SnapshotRow],
    analysis_rows: list[AnalysisRow] | None,
    output_path: Path,
    *,
    updated_at: datetime | None = None,
    export_top_n: int | None = None,
    ranking_top_n: int | None = None,
    ranking_min_level: int | None = None,
    latest_snapshot_date: str | None = None,
    history_days: int | None = None,
    snapshot_retention_days: int | None = None,
    character_meta: dict[str, str] | None = None,
) -> Path:
    rows = analysis_rows if analysis_rows is not None else build_analysis_rows(snapshots)
    payload = build_mvp_payload(
        snapshots,
        rows,
        updated_at=updated_at,
        export_top_n=export_top_n,
        ranking_top_n=ranking_top_n,
        ranking_min_level=ranking_min_level,
        latest_snapshot_date=latest_snapshot_date,
        history_days=history_days,
        snapshot_retention_days=snapshot_retention_days,
        character_meta=character_meta,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(
        "MVP JSON exported: %s (characters=%s snapshot_days=%s)",
        output_path,
        len(payload["characters"]),
        payload["meta"]["snapshotDays"],
    )
    return output_path
