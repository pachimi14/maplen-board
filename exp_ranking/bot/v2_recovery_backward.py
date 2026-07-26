"""T12 P1 / B' (LULU-062 follow-up): backward-exact v2-shard DB recovery
core (production).

Used by `sqlite_storage.import_snapshots_from_v2_json` (and, transitively,
`import_missing_snapshots_from_v2_url`) to rebuild `ranking_snapshot` rows
from the v2 `rankings.json` summary + `shard-NN.json` history files -- the
worst-case recovery path when neither actions/cache, a Release Asset, nor a
git-committed db.gz is available.

Design (decided after a coordinator/user review of an earlier percent-only
approach that could restore a `dailyGain` *larger* than the true value):
walk backward from the exact anchor (latest) day's exp -- taken verbatim from
the v2 summary, which carries it with full precision -- using each day's own
*exact* `dailyGain` (computed by `analysis.build_analysis_rows` from real,
un-rounded exp at original export time; never itself lossy) and the per-day
`level` (also exact in the shard) to recover each earlier day's exp. When
the exact chain cannot continue (missing dailyGain, or a duplicated
snapshotDate -- see below), a fallback inversion of that day's rounded
`levelExpPercent` is used, but only after subtracting the maximum possible
upward rounding bias, so the result is *never* above the true exp (a small,
bounded, systematic under-estimate instead of a coin-flip over/under
estimate).

Link-unit exp arithmetic (B', LULU-062 follow-up): the in-game EXP table was
reduced ~20% effective 2026-07-23, so a single fixed table for a whole
character's backward walk is wrong whenever the walk crosses that boundary
(see docs/DECISION_LOG.md LULU-062). This module no longer accumulates a
running "progress" value against one table; instead each link between two
adjacent points is inverted directly in `(level, exp)` space:

    exp_prev = exp_curr + Sum(T_d[level_prev .. level_curr-1]) - gain(d)
    T_d = level_exp.exp_table_for(d)   # d = the link's destination (later)
                                        # day's snapshotDate

For a same-level link the sum is empty, so `exp_prev = exp_curr - gain` and
the table drops out of the arithmetic entirely (era-irrelevant by
construction). For a level-up link, only the destination day's table is
ever consulted (no "which base table" ambiguity). See
`scratchpad/prove_bprime.py` (coordinator, pre-implementation) for the
proof against 373,022 real production points: 0 mismatches, 0
over-restorations, on the exact chain.

Guard (redesigned for B'): a candidate `exp_prev` is accepted only if
`0 <= exp_prev <= LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23[level_prev]` --
the legacy (pre-2026-07-23) table is a strict upper bound on `exp` at every
level across every era measured so far (0 rows exceed it in the full
production DB), including the post-patch "wake-up" case where `exp` now
exceeds the *current* (shrunk) table's requirement (e.g. Lv252,
exp=600,000,000,000 + T_d[252]=3,237,009,876,844 - gain=101,000,000,000 =
3,736,009,876,844, which is above the current table's requirement for
Lv251/252 but well below the legacy bound -- see the module's test suite).
The old guard (`exp > current-table-requirement -> reject`) rejected
exactly this correct case; that was the bug this redesign closes.

Measured against a real 51-day / ~7,626-character production DB
(`exp_ranking/bot/data/ranking.db.gz`): 0 over-restored exp values out of
334,147 historical (character, date) points, full day coverage (no day ever
marked unrecoverable), and 0 display-string or gain-rank changes in the
re-exported output. The previously shipped percent-only approach had 158,011
over-restored points (up to +20.5M) and changed roughly half of all
weekly/monthly/daily gain rankings. See DECISION_LOG / the T12 P1 follow-up
reports for the full comparison against the alternatives considered
(percent-only, backward+null-on-break, backward+naive-percent-fallback).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from level_exp import (
    EXP_TO_NEXT_LEVEL,
    LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23,
    LEVEL_CAP,
    TABLE_MIN_LEVEL,
    exp_table_for,
)

logger = logging.getLogger(__name__)


ExpTable = dict[int, int]


def _exp_table_or_current(exp_table: ExpTable | None = None) -> ExpTable:
    return exp_table or EXP_TO_NEXT_LEVEL


def _exp_required_for_level(level: int, exp_table: ExpTable) -> int | None:
    if level >= LEVEL_CAP:
        return None
    return exp_table.get(level)


def _total_exp_to_275(exp_table: ExpTable) -> int:
    return sum(exp_table.get(level, 0) for level in range(TABLE_MIN_LEVEL, LEVEL_CAP))


def _calculate_progress_toward_275(level: int, exp: int, exp_table: ExpTable) -> int:
    total = _total_exp_to_275(exp_table)
    if level >= LEVEL_CAP:
        return total
    if level < TABLE_MIN_LEVEL:
        return 0

    required_current = _exp_required_for_level(level, exp_table)
    if required_current is None:
        return 0
    remaining = max(required_current - exp, 0)
    for lv in range(level + 1, LEVEL_CAP):
        remaining += exp_table.get(lv, 0)
    return total - remaining


def exp_from_progress(level: int, progress: int, exp_table: ExpTable | None = None) -> int | None:
    """Invert calculate_progress_toward_275(level, exp) -> exp, given a known
    (exact) level. Returns None when the level is outside the invertible
    range (below TABLE_MIN_LEVEL or at/above LEVEL_CAP, where progress is
    pinned and does not determine exp), or when the algebraic result falls
    outside the valid [0, required_for_level] range (internally inconsistent
    input -- refuse to fabricate a number rather than guess).
    """
    table = _exp_table_or_current(exp_table)
    if level < TABLE_MIN_LEVEL or level >= LEVEL_CAP:
        return None

    required_current = _exp_required_for_level(level, table)
    if required_current is None:
        return None

    remaining_levels_sum = sum(
        table.get(lv, 0) for lv in range(level + 1, LEVEL_CAP)
    )
    exp = progress - _total_exp_to_275(table) + required_current + remaining_levels_sum
    if exp < 0 or exp > required_current:
        return None
    return exp


# Half of the 3-decimal rounding step used for levelExpPercent
# (round(percent, 3)): the maximum amount the stored percent can be above the
# true percent.
_PERCENT_ROUNDING_HALF_STEP = 0.0005


def exp_from_percent_conservative(level: int, percent: float, exp_table: ExpTable | None = None) -> int:
    """Fallback inversion used when the exact backward chain breaks: same
    idea as inverting `levelExpPercent` directly, but first subtracts the
    maximum possible upward rounding bias from the stored percent. Because
    the percent->exp mapping is monotonic increasing, this guarantees the
    result is <= the true exp for that day (never over-restores), at the
    cost of a small, bounded, systematic under-estimate.
    """
    required = _exp_required_for_level(level, _exp_table_or_current(exp_table))
    if not required:
        return 0
    safe_percent = max(percent - _PERCENT_ROUNDING_HALF_STEP, 0.0)
    return max(int(required * safe_percent / 100.0), 0)


@dataclass
class ReconstructedDay:
    snapshot_date: str
    level: int
    exp: int | None
    method: str  # "exact" | "conservative_fallback" | "unrecoverable"


def _percent_of(point: dict) -> float:
    return float(
        point.get("levelExpPercent")
        if point.get("levelExpPercent") is not None
        else point.get("expPercent") or 0
    )


def _levels_sum(table: ExpTable, lo: int, hi: int) -> int:
    """Sum(table[lo .. hi-1]) -- the EXP cost of completing every level from
    `lo` (inclusive) up to `hi` (exclusive). Empty (0) whenever lo >= hi,
    which is exactly the same-level (or level-down) case -- this is what
    makes the table drop out of the link arithmetic entirely for same-level
    links, regardless of era.
    """
    return sum(table.get(lv, 0) for lv in range(lo, hi))


def reconstruct_exp_backward(
    *,
    anchor_date: str,
    anchor_level: int,
    anchor_exp: int,
    points_desc: list[dict],
    fallback: str = "conservative",
    exp_table: ExpTable | None = None,
) -> list[ReconstructedDay]:
    """Reconstruct exp for every point in `points_desc` (a single character's
    v2 shard `history` array, sorted descending by snapshotDate, points_desc[0]
    == the anchor/latest day).

    Each point must carry: snapshotDate, level, dailyGain (may be None),
    levelExpPercent/expPercent (used only as a fallback).

    Link-unit arithmetic (B', LULU-062 follow-up -- see module docstring):
    each link from an already-resolved `(level_curr, exp_curr)` (the later
    day) to the earlier day's `(level_prev, ?)` is inverted as
    `exp_prev = exp_curr + Sum(T_d[level_prev..level_curr-1]) - gain`, where
    `T_d = level_exp.exp_table_for(d)` and `d` is the *destination* (later,
    already-resolved) day's own snapshotDate -- never a single table fixed
    for the whole character. `exp_table`, if given explicitly, overrides
    this per-link era selection with one fixed table for every link in this
    call (an escape hatch for tests/analysis that want to force a single
    table; the production caller does not pass it, so production always
    gets real per-link era selection).

    `fallback` selects what happens when the exact backward chain breaks
    (dailyGain missing, algebraically inconsistent, or the snapshotDate is
    duplicated -- see below):

    - "conservative" (production default): invert that single day's rounded
      percent -- using *that day's own* era table (`exp_table_for` on its
      own snapshotDate, or the `exp_table` override if one was given) --
      after subtracting the maximum possible upward rounding bias
      (exp_from_percent_conservative), then keep chaining backward from that
      point. Never over-restores (systematic small under-estimate instead)
      and never drops a day.
    - "none": mark that day, and (since re-anchoring an exact value at that
      point is no longer possible) all earlier days, as unrecoverable
      (exp=None) rather than guessing. Also never over-restores, but trades
      off coverage for days before an unresolved break. Kept as an option for
      tests/analysis that want to isolate "exact-or-nothing" behavior; not
      used by the production recovery path.

    Guard: a link's candidate `exp_prev` is only accepted (method "exact")
    if `0 <= exp_prev <= LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23[level_prev]`
    -- the legacy (pre-2026-07-23) table is a strict upper bound on exp at
    every level across every era measured so far, including the "wake-up"
    case where a post-patch exp legitimately exceeds the *current* (shrunk)
    table's requirement. A level outside the legacy table's range (below
    TABLE_MIN_LEVEL, or at/above LEVEL_CAP, where the table does not pin a
    bound) always fails the guard and falls back, matching this function's
    pre-B' behavior for those same out-of-range levels.

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

    def _table_for(snapshot_date: str) -> ExpTable:
        return exp_table if exp_table is not None else exp_table_for(snapshot_date)

    date_counts: dict[str, int] = {}
    for point in points_desc:
        d = str(point.get("snapshotDate") or "")
        date_counts[d] = date_counts.get(d, 0) + 1

    results: list[ReconstructedDay] = []
    cur_level, cur_exp = anchor_level, anchor_exp
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
        exp_prev: int | None = None
        if daily_gain is not None:
            # T_d: the destination (later, already-resolved) day's own era
            # table -- never a table chosen by the earlier day, and never a
            # single table fixed for the whole chain.
            link_table = _table_for(current_date)
            candidate = (
                cur_exp
                + _levels_sum(link_table, prev_level, cur_level)
                - int(daily_gain)
            )
            legacy_bound = LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23.get(prev_level)
            if legacy_bound is not None and 0 <= candidate <= legacy_bound:
                exp_prev = candidate

        if exp_prev is not None:
            cur_level, cur_exp = prev_level, exp_prev
            results.append(ReconstructedDay(prev_date, prev_level, exp_prev, "exact"))
            continue

        # Break: missing dailyGain, ambiguous (duplicated) date, or an
        # algebraically inconsistent (guard-rejected) result.
        if fallback == "conservative":
            fallback_table = _table_for(prev_date)  # this point's OWN era
            exp_fallback = exp_from_percent_conservative(
                prev_level, _percent_of(prev_point), fallback_table
            )
            cur_level, cur_exp = prev_level, exp_fallback
            results.append(
                ReconstructedDay(prev_date, prev_level, exp_fallback, "conservative_fallback")
            )
            continue

        chain_alive = False
        results.append(ReconstructedDay(prev_date, prev_level, None, "unrecoverable"))

    method_census = {"exact": 0, "conservative_fallback": 0, "unrecoverable": 0}
    for day in results:
        method_census[day.method] = method_census.get(day.method, 0) + 1
    logger.debug(
        "reconstruct_exp_backward: anchor_date=%s points=%s exact=%s "
        "conservative_fallback=%s unrecoverable=%s",
        anchor_date,
        len(points_desc),
        method_census["exact"],
        method_census["conservative_fallback"],
        method_census["unrecoverable"],
    )

    return results
