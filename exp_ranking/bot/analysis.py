"""Build ranking_analysis rows from snapshot data."""

from __future__ import annotations

from datetime import date, timedelta

from identity import build_name_to_asset_key, resolve_snapshot_identity
from models import AnalysisRow, SnapshotRow
from level_exp import (
    calculate_exp_to_250,
    calculate_progress_toward_250,
    calculate_total_exp_from_240,
)
from utils import normalize_int


def snapshot_identity_key(
    row: SnapshotRow,
    name_to_asset_key: dict[str, str] | None = None,
) -> str:
    """Stable key across ranking days (prefer asset key over name)."""
    return resolve_snapshot_identity(row, name_to_asset_key)


def build_analysis_rows(
    snapshots: list[SnapshotRow],
    benchmark_character: str = "pachimi",
) -> list[AnalysisRow]:
    if not snapshots:
        return []

    ordered = sorted(
        snapshots,
        key=lambda row: (row.snapshot_date, row.rank),
    )
    name_to_asset_key = build_name_to_asset_key(ordered)

    progress_by_date_identity: dict[tuple[str, str], int] = {}
    totals_by_date: dict[str, dict[str, int]] = {}

    for row in ordered:
        identity = snapshot_identity_key(row, name_to_asset_key)
        progress = calculate_progress_toward_250(row.level, row.exp)
        progress_by_date_identity[(row.snapshot_date, identity)] = progress

        total_exp = calculate_total_exp_from_240(row.level, row.exp)
        date_totals = totals_by_date.setdefault(row.snapshot_date, {})
        date_totals[row.character_name.casefold()] = total_exp

    def previous_ranking_date(snapshot_date: str) -> str | None:
        """Calendar previous UTC gain day, not the previous date stored in DB."""
        try:
            current = date.fromisoformat(snapshot_date)
        except ValueError:
            return None
        return (current - timedelta(days=1)).isoformat()

    analysis_rows: list[AnalysisRow] = []

    for row in ordered:
        identity = snapshot_identity_key(row, name_to_asset_key)
        progress = progress_by_date_identity[(row.snapshot_date, identity)]
        prev_date = previous_ranking_date(row.snapshot_date)

        daily_gain: int | None = None
        if prev_date:
            prev_progress = progress_by_date_identity.get((prev_date, identity))
            if prev_progress is not None:
                daily_gain = progress - prev_progress

        analysis_rows.append(
            AnalysisRow(
                snapshot_date=row.snapshot_date,
                rank=row.rank,
                character_name=row.character_name,
                level=row.level,
                exp=row.exp,
                total_exp_from_240=calculate_total_exp_from_240(row.level, row.exp),
                daily_exp_gain=daily_gain,
                exp_to_250=calculate_exp_to_250(row.level, row.exp),
                diff_from_pachimi=None,
                rank_fluctuation=row.rank_fluctuation,
            )
        )

    benchmark_key = benchmark_character.casefold()
    for index, row in enumerate(analysis_rows):
        pachimi_total = totals_by_date.get(row.snapshot_date, {}).get(benchmark_key)
        if pachimi_total is None:
            continue
        current = analysis_rows[index]
        analysis_rows[index] = AnalysisRow(
            snapshot_date=current.snapshot_date,
            rank=current.rank,
            character_name=current.character_name,
            level=current.level,
            exp=current.exp,
            total_exp_from_240=current.total_exp_from_240,
            daily_exp_gain=current.daily_exp_gain,
            exp_to_250=current.exp_to_250,
            diff_from_pachimi=current.total_exp_from_240 - pachimi_total,
            rank_fluctuation=current.rank_fluctuation,
        )

    return analysis_rows


def snapshot_from_record(record: dict[str, object]) -> SnapshotRow:
    return SnapshotRow(
        snapshot_date=str(record.get("snapshot_date", "")).strip(),
        rank=normalize_int(record.get("rank")),
        rank_fluctuation=normalize_int(record.get("rankFluctuation")),
        character_name=str(record.get("characterName", "")).strip(),
        class_code=str(record.get("classCode", "")).strip(),
        job_code=str(record.get("jobCode", "")).strip(),
        level=normalize_int(record.get("level")),
        exp=normalize_int(record.get("exp")),
        image_url=str(record.get("imageUrl", "")).strip(),
    )
