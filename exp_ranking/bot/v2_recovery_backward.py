"""T12 P1 follow-up investigation (not wired into main.py / config.py).

Candidate "backward-exact" DB recovery from v2 shards, as requested by the
coordinator after P1 review: instead of inverting each historical day's
rounded `levelExpPercent` independently (lossy, and can restore a dailyGain
*larger* than the true value -- unacceptable per the user's accuracy bar),
walk backward from the exact anchor (latest) day's exp using each day's own
*exact* `dailyGain` (already computed by analysis.py from real, un-rounded
exp at original export time -- see `analysis.build_analysis_rows`) and the
per-day `level` (also exact in the shard) to recover each earlier day's exp
via the level_exp.py level-requirement table.

This module intentionally does NOT touch sqlite_storage.py's shipped
P1 function (`import_snapshots_from_v2_json`, which uses the percent-inversion
method, "method A" below) or mvp_export.py / the v2 JSON format. It exists so
"method A" (already shipped), "method B" (backward, percent-fallback on
break), "method C" (backward, null/skip on break) and "method D" (backward,
conservative/never-over percent-fallback on break) can be measured
side-by-side against real production data before any decision is made.

Measured against a real 51-day / ~7626-character production DB
(exp_ranking/bot/data/ranking.db.gz), methods C and D both achieve 0
over-restored exp values out of 334,147 historical (character, date) points
(method A: 158,011 over-restored, up to +20.5M; method B: 28, up to +1.56M).
See the T12 P1 follow-up report for full numbers.
"""

from __future__ import annotations

from dataclasses import dataclass

from level_exp import (
    EXP_TO_NEXT_LEVEL,
    LEVEL_CAP,
    TABLE_MIN_LEVEL,
    TOTAL_EXP_225_TO_275,
    calculate_progress_toward_275,
    exp_required_for_level,
)


def exp_from_progress(level: int, progress: int) -> int | None:
    """Invert calculate_progress_toward_275(level, exp) -> exp, given a known
    (exact) level. Returns None when the level is outside the invertible
    range (below TABLE_MIN_LEVEL or at/above LEVEL_CAP, where progress is
    pinned and does not determine exp), or when the algebraic result falls
    outside the valid [0, required_for_level] range (internally inconsistent
    input -- refuse to fabricate a number rather than guess).
    """
    if level < TABLE_MIN_LEVEL or level >= LEVEL_CAP:
        return None

    required_current = exp_required_for_level(level)
    if required_current is None:
        return None

    remaining_levels_sum = sum(
        EXP_TO_NEXT_LEVEL.get(lv, 0) for lv in range(level + 1, LEVEL_CAP)
    )
    exp = progress - TOTAL_EXP_225_TO_275 + required_current + remaining_levels_sum
    if exp < 0 or exp > required_current:
        return None
    return exp


def exp_from_percent(level: int, percent: float) -> int:
    """Method A (already shipped in sqlite_storage.import_snapshots_from_v2_json):
    invert the rounded levelExpPercent directly. Lossy; kept here only so all
    candidate methods can share one measurement harness. `levelExpPercent` is
    stored rounded to 3 decimals, so this can land up to ~0.0005 percentage
    points *above* the true percent -- i.e. this can over-restore.
    """
    required = exp_required_for_level(level)
    return int(required * percent / 100.0) if required else 0


# Half of the 3-decimal rounding step used for levelExpPercent
# (round(percent, 3)): the maximum amount the stored percent can be above the
# true percent.
_PERCENT_ROUNDING_HALF_STEP = 0.0005


def exp_from_percent_conservative(level: int, percent: float) -> int:
    """Method D fallback: same inversion as exp_from_percent, but first
    subtracts the maximum possible upward rounding bias from the stored
    percent. Because the percent->exp mapping is monotonic increasing, this
    guarantees the result is <= the true exp for that day (never
    over-restores), at the cost of a small, bounded, systematic
    under-estimate instead of a coin-flip over/under estimate.
    """
    required = exp_required_for_level(level)
    if not required:
        return 0
    safe_percent = max(percent - _PERCENT_ROUNDING_HALF_STEP, 0.0)
    return max(int(required * safe_percent / 100.0), 0)


@dataclass
class ReconstructedDay:
    snapshot_date: str
    level: int
    exp: int | None
    method: str  # "exact" | "percent_fallback" | "unrecoverable"


def _percent_of(point: dict) -> float:
    return float(
        point.get("levelExpPercent")
        if point.get("levelExpPercent") is not None
        else point.get("expPercent") or 0
    )


def reconstruct_exp_backward(
    *,
    anchor_date: str,
    anchor_level: int,
    anchor_exp: int,
    points_desc: list[dict],
    fallback: str = "none",
) -> list[ReconstructedDay]:
    """Reconstruct exp for every point in `points_desc` (a single character's
    v2 shard `history` array, sorted descending by snapshotDate, points_desc[0]
    == the anchor/latest day).

    Each point must carry: snapshotDate, level, dailyGain (may be None),
    levelExpPercent/expPercent (used only as a fallback / cross-check).

    `fallback` selects what happens when the exact backward chain breaks
    (dailyGain missing, algebraically inconsistent, or the snapshotDate is
    duplicated -- see below):

    - "none" (method C): mark that day, and (since re-anchoring an exact
      progress value at that point is no longer possible) all earlier days,
      as unrecoverable (exp=None) rather than guessing. Never over-restores;
      trades off coverage for days before an unresolved break.
    - "percent" (method B): invert that single day's rounded percent
      (exp_from_percent), then keep chaining backward from that approximate
      point. Maximizes coverage but this specific inversion can land above
      the true exp (over-restore) by design (percent rounding is
      direction-agnostic).
    - "conservative" (method D): invert that single day's rounded percent
      after subtracting the maximum possible upward rounding bias
      (exp_from_percent_conservative), then keep chaining backward from that
      point. Maximizes coverage AND is guaranteed to never over-restore
      (systematic small under-estimate instead).

    Real production data can contain more than one row for the same
    (identity, snapshotDate) -- e.g. the ranking API listing a character at
    two different ranks on the same day. `analysis.build_analysis_rows`
    resolves that ambiguity via a plain dict keyed by (date, identity), so
    whichever row is processed last (by ascending rank) silently donates its
    `dailyGain` to *all* rows sharing that date, even rows with a different
    `exp`. Chaining through such a link algebraically "works" (it produces a
    number) but that number does not correspond to any real progress value,
    and can be wildly wrong. This function treats any point whose
    snapshotDate repeats elsewhere in `points_desc` -- and any transition
    into/out of it -- as untrustworthy, same as a missing dailyGain.
    """
    if not points_desc:
        return []

    date_counts: dict[str, int] = {}
    for point in points_desc:
        d = str(point.get("snapshotDate") or "")
        date_counts[d] = date_counts.get(d, 0) + 1

    results: list[ReconstructedDay] = []
    progress = calculate_progress_toward_275(anchor_level, anchor_exp)
    results.append(
        ReconstructedDay(anchor_date, anchor_level, anchor_exp, "exact")
    )

    chain_alive = True
    for i in range(1, len(points_desc)):
        current_point = points_desc[i - 1]  # later date, already resolved
        prev_point = points_desc[i]  # earlier date, to resolve now
        prev_date = str(prev_point.get("snapshotDate") or "")
        current_date = str(current_point.get("snapshotDate") or "")
        prev_level = int(prev_point.get("level") or 0)

        ambiguous = (
            date_counts.get(prev_date, 0) > 1
            or date_counts.get(current_date, 0) > 1
            or prev_date == current_date
        )

        if not chain_alive:
            results.append(
                ReconstructedDay(prev_date, prev_level, None, "unrecoverable")
            )
            continue

        daily_gain = None if ambiguous else current_point.get("dailyGain")
        if daily_gain is not None:
            candidate_progress = progress - int(daily_gain)
            exp_prev = exp_from_progress(prev_level, candidate_progress)
            if exp_prev is not None:
                progress = candidate_progress
                results.append(ReconstructedDay(prev_date, prev_level, exp_prev, "exact"))
                continue

        # Break: missing dailyGain, ambiguous (duplicated) date, or an
        # algebraically inconsistent result.
        if fallback == "percent":
            exp_fallback = exp_from_percent(prev_level, _percent_of(prev_point))
        elif fallback == "conservative":
            exp_fallback = exp_from_percent_conservative(prev_level, _percent_of(prev_point))
        else:
            chain_alive = False
            results.append(ReconstructedDay(prev_date, prev_level, None, "unrecoverable"))
            continue

        progress = calculate_progress_toward_275(prev_level, exp_fallback)
        results.append(
            ReconstructedDay(prev_date, prev_level, exp_fallback, "percent_fallback")
        )

    return results
