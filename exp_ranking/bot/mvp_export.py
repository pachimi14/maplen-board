"""Export ranking data to JSON for the MapleN Board frontend."""

from __future__ import annotations

import json
import hashlib
import logging
import shutil
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from analysis import build_analysis_rows, deduplicate_snapshots_by_identity
from identity import build_name_to_asset_key, resolve_snapshot_identity
from level_exp import (
    EXP_TO_NEXT_LEVEL,
    EXP_TABLE_VERSION,
    TARGET_TOTAL_EXP_250,
    TARGET_TOTAL_EXP_275,
    calculate_level_exp_percent_for_table,
    calculate_total_exp_from_240,
    exp_required_for_level,
    exp_table_for,
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

HISTORY_SHARD_COUNT = 64


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


def _assign_group_ranks(
    characters: list[dict[str, Any]],
    *,
    key_fn: Callable[[dict[str, Any]], Any],
    rank_field: str,
    total_field: str,
) -> None:
    """Populate rank_field/total_field (1-based) within groups of `characters`.

    `characters` must already be sorted in the canonical (rank, historyKey)
    order; within each group the existing relative order is preserved, so
    numbering reduces to a simple per-group sequential count. Characters
    whose `key_fn` returns a falsy value (missing job/world) get None for
    both fields instead of joining a group.
    """
    groups: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for character in characters:
        value = key_fn(character)
        if not value:
            character[rank_field] = None
            character[total_field] = None
            continue
        groups[value].append(character)

    for members in groups.values():
        total = len(members)
        for position, member in enumerate(members, start=1):
            member[rank_field] = position
            member[total_field] = total


def _job_group_value(character: dict[str, Any]) -> str | None:
    if character.get("_jobMissing"):
        return None
    return character.get("job")


def _world_group_value(character: dict[str, Any]) -> str | None:
    return character.get("worldId") or None


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
    previous_date = (latest_ranking_day - timedelta(days=1)).isoformat()
    week_start = weekly_period_start(latest_ranking_day)
    month_start = monthly_period_start(latest_ranking_day)
    analysis_by_key = _analysis_lookup(analysis_rows)
    meta = character_meta or {}
    name_to_asset_key = build_name_to_asset_key(snapshots)
    # Collapse duplicate (snapshot_date, identity) rows before grouping so a
    # single ranking day never yields two history points for the same
    # character (see docs/IMPL_PLAN_dq-dup-rows.md P-DQ-1; same rule as
    # analysis.py's build_analysis_rows, reused here to keep one source of
    # truth for the selection rule).
    deduped_snapshots = deduplicate_snapshots_by_identity(snapshots, name_to_asset_key)
    by_key: dict[str, list[SnapshotRow]] = defaultdict(list)

    for row in deduped_snapshots:
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
            # Era-correct, non-clamped percent (LULU-062): use the table in
            # effect on this history point's own date, and report overshoot
            # (>100%) as-is instead of capping it -- the top-level
            # levelExpPercent/expPercent below is the *same* metric for the
            # latest date, so this keeps that field and the last history
            # point for one character in agreement.
            level_pct = calculate_level_exp_percent_for_table(
                snap.level, snap.exp, exp_table_for(snap.snapshot_date)
            )
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

        # Same era-correct, non-clamped percent as the history loop above --
        # `latest` is always today's snapshot, so this is normally the
        # current table anyway, but must not clamp overshoot (LULU-062 §4
        # basis 8) to stay consistent with the last `history` point.
        level_pct = calculate_level_exp_percent_for_table(
            latest.level, latest.exp, exp_table_for(latest.snapshot_date)
        )
        asset_key = latest.character_asset_key
        world_id = meta.get(asset_key, "") if asset_key else ""
        name = latest.character_name

        previous_rows = [
            row for row in rows_sorted if row.snapshot_date == previous_date
        ]
        previous_rank = previous_rows[-1].rank if previous_rows else None

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
                "rankFluctuation": latest.rank_fluctuation,
                "previousRank": previous_rank,
                "_jobMissing": not str(latest.job_code or "").strip(),
            }
        if asset_key:
            character_payload["characterAssetKey"] = asset_key
            character_payload["navigatorUrl"] = navigator_character_url(asset_key)
        if world_id:
            character_payload["worldId"] = world_id
        characters.append(character_payload)

    # Full-population ranking (job/world) happens here, before export_top_n
    # truncation, so totals reflect everyone, not just the exported slice.
    characters.sort(key=lambda item: (item["rank"], _history_key(item)))

    _assign_group_ranks(
        characters,
        key_fn=_job_group_value,
        rank_field="jobRank",
        total_field="jobRankTotal",
    )
    _assign_group_ranks(
        characters,
        key_fn=_world_group_value,
        rank_field="worldRank",
        total_field="worldRankTotal",
    )
    for character in characters:
        character.pop("_jobMissing", None)

    if export_top_n is not None:
        characters = characters[:export_top_n]
    for index, character in enumerate(characters, start=1):
        character["id"] = index

    history_dates = sorted(
        {
            point["snapshotDate"]
            for character in characters
            for point in character.get("history", [])
            if point.get("snapshotDate")
        }
    )
    for snapshot_date in history_dates:
        ranked_points = []
        for character in characters:
            point = next(
                (
                    item
                    for item in character.get("history", [])
                    if item.get("snapshotDate") == snapshot_date
                ),
                None,
            )
            gain = point.get("dailyGain") if point else None
            if gain is not None and gain > 0:
                ranked_points.append((gain, point))

        ranked_points.sort(key=lambda item: -item[0])
        for daily_rank, (_, point) in enumerate(ranked_points, start=1):
            point["dailyRank"] = daily_rank

    return characters


def _history_key(character: dict[str, Any]) -> str:
    asset_key = str(character.get("characterAssetKey") or "").strip()
    if asset_key:
        return f"asset:{asset_key}"
    return f"name:{str(character.get('name') or '').strip().casefold()}"


def _history_shard(history_key: str, shard_count: int) -> int:
    digest = hashlib.sha256(history_key.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % shard_count


def build_v2_payloads(
    payload: dict[str, Any],
    *,
    shard_count: int = HISTORY_SHARD_COUNT,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    latest_date = str(payload.get("meta", {}).get("latestSnapshotDate") or "")
    history_base_path = f"history/{latest_date}" if latest_date else "history/current"
    shards: list[dict[str, Any]] = [dict() for _ in range(shard_count)]
    summary_characters: list[dict[str, Any]] = []

    for character in payload.get("characters", []):
        history_key = _history_key(character)
        shard = _history_shard(history_key, shard_count)
        summary = {key: value for key, value in character.items() if key != "history"}
        summary["historyKey"] = history_key
        summary["historyShard"] = shard
        summary_characters.append(summary)
        shards[shard][history_key] = character.get("history", [])

    meta = {
        **payload.get("meta", {}),
        "dataFormatVersion": 2,
        "historyBasePath": history_base_path,
        "historyShardCount": shard_count,
    }
    return {"meta": meta, "characters": summary_characters}, shards


def export_mvp_v2_json(
    payload: dict[str, Any],
    output_path: Path,
    *,
    shard_count: int = HISTORY_SHARD_COUNT,
) -> Path:
    v2_root = output_path.parent / "v2"
    if v2_root.exists():
        shutil.rmtree(v2_root)
    summary, shards = build_v2_payloads(payload, shard_count=shard_count)
    summary_path = v2_root / "rankings.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    history_root = v2_root / summary["meta"]["historyBasePath"]
    history_root.mkdir(parents=True, exist_ok=True)
    for shard, histories in enumerate(shards):
        shard_payload = {
            "meta": {
                "dataFormatVersion": 2,
                "latestSnapshotDate": summary["meta"]["latestSnapshotDate"],
                "shard": shard,
            },
            "histories": histories,
        }
        (history_root / f"shard-{shard:02d}.json").write_text(
            json.dumps(shard_payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    logger.info(
        "MVP v2 JSON exported: %s (shards=%s)",
        summary_path,
        shard_count,
    )
    return summary_path


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
            "updatedAt": (
                updated_at or datetime.now(timezone.utc)
            ).isoformat(timespec="seconds"),
            "source": "msu_ranking_bot",
            "characterCount": len(characters),
            "snapshotCount": len(snapshots),
            "snapshotDays": len(snapshot_dates),
            "snapshotRetentionDays": snapshot_retention_days or history_days,
            "latestSnapshotDate": latest_date,
            "rankingDayTimezone": "UTC",
            "rankingDayResetsAt": (
                "UTC 00:00 (= JST 09:00); snapshot label = prior UTC calendar day"
            ),
            "scheduledFetchAfterJst": "JST queue 08:00 (wait 09:05; skip if day captured)",
            "gainPeriods": gain_period_meta(latest_ranking_day),
            "rankingTopN": ranking_top_n,
            "rankingMinLevel": ranking_min_level,
            "mvpHistoryDays": history_days,
            "targetTotalExp250": TARGET_TOTAL_EXP_250,
            "targetTotalExp275": TARGET_TOTAL_EXP_275,
            "levelCap": 275,
            "expTableVersion": EXP_TABLE_VERSION,
            "expTable": {
                str(level): EXP_TO_NEXT_LEVEL[level]
                for level in sorted(EXP_TO_NEXT_LEVEL)
            },
            "worldIds": list(KNOWN_WORLD_IDS),
        },
        "characters": characters,
    }


