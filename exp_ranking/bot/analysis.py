"""Build ranking_analysis rows from snapshot data."""

from __future__ import annotations

from datetime import date, timedelta

from identity import build_name_to_asset_key, resolve_snapshot_identity
from models import AnalysisRow, SnapshotRow
from level_exp import (
    calculate_exp_to_250,
    calculate_progress_for_table,
    calculate_total_exp_from_240,
    exp_table_for,
)
from utils import normalize_int


def snapshot_identity_key(
    row: SnapshotRow,
    name_to_asset_key: dict[str, str] | None = None,
) -> str:
    """Stable key across ranking days (prefer asset key over name)."""
    return resolve_snapshot_identity(row, name_to_asset_key)


def select_canonical_snapshot_row(rows: list[SnapshotRow]) -> SnapshotRow:
    """Deterministically pick one row out of duplicate `(snapshot_date, identity)` rows.

    `ranking_snapshot` only enforces `UNIQUE(snapshot_date, rank)`, not
    `(snapshot_date, identity)`; a 2026-05-29..06-03 recovery re-import produced
    118 duplicate (date, identity) groups (167 excess rows; see
    docs/IMPL_PLAN_dq-dup-rows.md P-DQ-1). This picks the row that represents the
    genuine daily API fetch rather than a recovery/reimport artifact:

    1. Prefer rows with a non-empty `class_code`/`job_code`. A real ranking-API
       fetch always populates both; JSON-recovery reimports (via the
       snapshot-seed JSON import path retired in T12 P7) always leave both
       blank, so this alone resolves 77/118 real duplicate groups (verified
       against the production DB, `exp_ranking/bot/data/ranking.db.gz`,
       decompressed and queried 2026-07-20). One group has *no* row with
       class/job populated (both duplicate rows are themselves reimport
       artifacts); that group falls through unfiltered to step 2.
    2. Among the remaining candidates, take the lowest `rank`. Because
       `ranking_snapshot` enforces `UNIQUE(snapshot_date, rank)`, two rows for
       the same `snapshot_date` can never share a `rank` -- this step is always
       decisive (a true tie is schema-impossible). The originally proposed
       tie-break was "oldest `fetched_at`", but `fetched_at` is not present on
       `SnapshotRow`/`load_all_snapshots` (would require a data-model change
       needing separate approval). Verified instead that `rank`-min agrees with
       `fetched_at`-oldest on all 118 real duplicate groups (0 disagreements),
       including the 41 groups where the class/job filter alone left more than
       one candidate: reimport rows are always assigned the class/job-empty
       AND, in every observed case, the numerically higher rank, so `rank`-min
       reproduces the same selection `fetched_at`-oldest would have made.
    """
    with_class = [
        row
        for row in rows
        if (row.class_code or "").strip() or (row.job_code or "").strip()
    ]
    candidates = with_class if with_class else rows
    return min(candidates, key=lambda row: row.rank)


def deduplicate_snapshots_by_identity(
    snapshots: list[SnapshotRow],
    name_to_asset_key: dict[str, str] | None = None,
) -> list[SnapshotRow]:
    """Collapse rows sharing `(snapshot_date, identity)` to one canonical row each.

    No-op (returns an equivalent list) when there are no duplicates, which is
    true for 99.5% of rows/characters -- see `select_canonical_snapshot_row`.
    Input order is preserved for the surviving rows; call sites that need a
    specific order should sort the result themselves.
    """
    if not snapshots:
        return []
    if name_to_asset_key is None:
        name_to_asset_key = build_name_to_asset_key(snapshots)

    groups: dict[tuple[str, str], list[SnapshotRow]] = {}
    group_order: list[tuple[str, str]] = []
    for row in snapshots:
        identity = snapshot_identity_key(row, name_to_asset_key)
        key = (row.snapshot_date, identity)
        if key not in groups:
            groups[key] = []
            group_order.append(key)
        groups[key].append(row)

    deduped: list[SnapshotRow] = []
    for key in group_order:
        rows = groups[key]
        deduped.append(rows[0] if len(rows) == 1 else select_canonical_snapshot_row(rows))
    return deduped


def build_analysis_rows(
    snapshots: list[SnapshotRow],
    benchmark_character: str = "pachimi",
) -> list[AnalysisRow]:
    if not snapshots:
        return []

    name_to_asset_key = build_name_to_asset_key(snapshots)
    deduped = deduplicate_snapshots_by_identity(snapshots, name_to_asset_key)
    ordered = sorted(
        deduped,
        key=lambda row: (row.snapshot_date, row.rank),
    )

    # (snapshot_date, identity) -> (level, exp), kept raw (not pre-collapsed
    # into a progress number) because the era-correct gain formula (LULU-062)
    # needs to evaluate *both* the current and the previous day's (level,
    # exp) under the *destination* day's table -- see the loop below.
    raw_by_date_identity: dict[tuple[str, str], tuple[int, int]] = {}
    totals_by_date: dict[str, dict[str, int]] = {}

    for row in ordered:
        identity = snapshot_identity_key(row, name_to_asset_key)
        raw_by_date_identity[(row.snapshot_date, identity)] = (row.level, row.exp)

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
        prev_date = previous_ranking_date(row.snapshot_date)

        daily_gain: int | None = None
        if prev_date:
            prev_raw = raw_by_date_identity.get((prev_date, identity))
            if prev_raw is not None:
                prev_level, prev_exp = prev_raw
                # gain(d) = P(T_d, level_d, exp_d) - P(T_d, level_{d-1}, exp_{d-1}):
                # both operands use the *destination* day d's table (LULU-062
                # §2.1), not each day's own table -- that is what makes a
                # same-era-and-level pair telescope to a pure exp diff even
                # right across the 2026-07-23 table-reduction boundary, and
                # what makes a wake-up (overshoot -> level-up) day resolve
                # without the old clamp's ~1,744x overcount.
                table_d = exp_table_for(row.snapshot_date)
                progress = calculate_progress_for_table(row.level, row.exp, table_d)
                prev_progress = calculate_progress_for_table(
                    prev_level, prev_exp, table_d
                )
                daily_gain = progress - prev_progress
                if daily_gain < 0:
                    # Cumulative EXP only increases; a negative delta is never a
                    # genuine gain (it is an artifact of a bad snapshot pair --
                    # e.g. a bootstrap-era recovery row derived from a rounded
                    # levelExpPercent, see docs/DECISION_LOG.md LULU-055). Null
                    # it out rather than showing a fabricated 0 or a negative
                    # number; downstream consumers (sum_daily_gains_in_period,
                    # mvp_export dailyRank) already treat None as "unknown", not
                    # as a zero-gain day.
                    daily_gain = None

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
