"""T12 P1: v2-shard-only DB recovery (worst case: no cache, no Release Asset,
no git db.gz).

Feasibility finding (see IMPL_PLAN_T12 P1): the v2 shard `history` array only
carries `level` + `levelExpPercent` (no raw `exp`, no rank, no job/class code,
no image, no character name) for every date except the latest one, which is
fully preserved in the v2 summary (`data/v2/rankings.json`).

`import_snapshots_from_v2_json` reconstructs each historical day's exp by
walking *backward* from the summary's exact anchor (latest) day, using each
day's own exact `dailyGain` (computed by analysis.py from real, un-rounded
exp -- never itself lossy) and level (v2_recovery_backward.py). An earlier
percent-only approach (inverting each day's rounded `levelExpPercent`
independently) was evaluated and rejected: it could restore a `dailyGain`
*larger* than the true value in ~47% of cases. The shipped backward-exact +
conservative-fallback design (method D in the T12 P1 review) never does so
(see the acceptance tests below), at the cost of a small, bounded,
systematic *under*-estimate on the rare (real-data: ~0.1%) days where the
exact chain breaks (missing dailyGain, or a duplicated `snapshotDate` --  a
real, pre-existing production data-quality artifact unrelated to T12).

These tests quantify what is, and is not, exactly reproduced after recovery:
- Exact: snapshot_days, the latest day's rank/name/job/level/exp/image/
  worldId/characterAssetKey (and everything derived only from the latest
  day), level per historical day, and (for characters with no duplicate-date
  rows) dailyGain per historical day too.
- Exact after one more real fetch: rank/previousRank/jobRank/worldRank/
  dailyGain for the day that follows recovery (both operands of that day's
  gain diff -- the new real day and the recovered-but-exact anchor day --
  are exact).
- Never-over, occasionally-under: reconstructed exp/dailyGain for the rare
  days where the exact chain breaks (see v2_recovery_backward.py).
"""

from __future__ import annotations

from pathlib import Path

from analysis import build_analysis_rows
from level_exp import exp_required_for_level
from models import SnapshotRow
from mvp_export import build_mvp_payload, build_v2_payloads
from sqlite_storage import (
    append_snapshots,
    count_snapshot_dates,
    import_missing_snapshots_from_v2_url,
    import_snapshots_from_v2_json,
    load_all_snapshots,
    load_character_meta,
)
from v2_recovery_backward import reconstruct_exp_backward


# LULU-062 (2026-07-27 coordinator ruling), fully closed by B'
# (docs/IMPL_PLAN_recovery-era.md, historical note kept for context): commit
# 2 (of the earlier LULU-062 PR) made analysis.py's dailyGain era-aware
# (legacy table for destination days <= 2026-07-22, current table on/after
# 2026-07-23), which exposed a matching bug on the *recovery* side: this
# module's backward-chain reconstruction inverted with a SINGLE constant
# table for the whole chain (sourced from meta.expTable in production,
# always the current table). For a level-up whose destination day was
# <= 2026-07-22 -- possible only while that date was still inside the
# retained history window, i.e. until 2026-10-20 (2026-07-22 + the 90-day
# retention default) -- the recovered exp for the day *before* the level-up
# could come out UNDER the true value, which could make the *next* day's
# freshly-recomputed dailyGain come out OVER the true value. Measured
# against the real production DB before the fix: 27,372/359,271 = 7.62% of
# recoverable day-points affected, up to 3.07x the true value (e.g.
# Benjapol 2026-07-20: true=1,179,837,974,224, recovered=2,038,875,777,215
# = 1.73x). This was NOT the same as the file's core "never over-restores"
# guarantee for raw exp/percent, which held throughout and was never
# xfailed (see test_p1_acceptance_never_over_restores and
# test_p1_idempotency_no_over_restoration_regression below, both green).
#
# B' fix: `v2_recovery_backward.py`'s backward chain now inverts each link
# with its own destination day's era table (`level_exp.exp_table_for`)
# instead of one table for the whole chain, and
# `sqlite_storage.import_snapshots_from_v2_json` no longer forces a single
# `meta.expTable`-derived table onto that per-link selection. All three
# tests that were `xfail(strict=True)` for LULU-062
# (`test_p1_acceptance_exact_and_fallback_counts`,
# `test_v2_shard_recovery_history_level_exact_and_percent_round_trips`, and
# `test_v2_shard_recovery_daily_gain_is_exact_when_no_duplicate_dates`) are
# green again with their original (non-xfailed) assertions.


CHARACTERS = [
    # name, asset_key, start_level, start_exp, daily_gain, job_code, class_code, image_url, world_id
    ("Alpha", "asset-alpha", 250, 0, 50_000_000_000, "100200", "1002", "https://img/alpha.png", "Ain"),
    ("Beta", "asset-beta", 245, 0, 3_000_000, "200100", "2001", "https://img/beta.png", "Ain"),
    # No asset key: identity falls back to name (LULU historyKey convention still
    # requires an asset key for full rename-resistance, but the DB schema must
    # tolerate its absence).
    ("Gamma", "", 252, 500_000_000_000, 10_000_000_000, "300300", "3003", "https://img/gamma.png", "Bern"),
]

DAYS = 90


def _advance(level: int, exp: int, gain: int) -> tuple[int, int]:
    remaining = gain
    while remaining > 0:
        required = exp_required_for_level(level)
        if required is None:
            return level, exp
        room = required - exp
        if remaining < room:
            exp += remaining
            remaining = 0
        else:
            remaining -= room
            level += 1
            exp = 0
    return level, exp


def _dates(start: str, count: int) -> list[str]:
    from datetime import date, timedelta

    start_date = date.fromisoformat(start)
    return [(start_date + timedelta(days=i)).isoformat() for i in range(count)]


def _build_true_db(db_path: Path, dates: list[str]) -> None:
    """Simulate `count` days of real ranking fetches into a fresh DB."""
    state = {name: (level, exp) for name, _, level, exp, *_ in CHARACTERS}

    for day_index, snapshot_date in enumerate(dates):
        day_rows: list[tuple[str, str, int, int, str, str, str]] = []
        for name, asset_key, _, _, gain, job_code, class_code, image_url, _ in CHARACTERS:
            level, exp = state[name]
            if day_index > 0:
                level, exp = _advance(level, exp, gain)
                state[name] = (level, exp)
            day_rows.append((name, asset_key, level, exp, job_code, class_code, image_url))

        # Rank each day by descending (level, exp) -- a reasonable proxy for the
        # real API's total-exp-derived ranking.
        day_rows.sort(key=lambda item: (-item[2], -item[3]))

        rows = [
            SnapshotRow(
                snapshot_date=snapshot_date,
                rank=rank,
                rank_fluctuation=0,
                character_name=name,
                class_code=class_code,
                job_code=job_code,
                level=level,
                exp=exp,
                image_url=image_url,
                character_asset_key=asset_key,
            )
            for rank, (name, asset_key, level, exp, job_code, class_code, image_url) in enumerate(
                day_rows, start=1
            )
        ]
        append_snapshots(db_path, rows, fetched_at=f"{snapshot_date}T09:05:00+00:00")


def _export_v2(db_path: Path, *, latest_snapshot_date: str, history_days: int = DAYS):
    snapshots = load_all_snapshots(db_path)
    analysis_rows = build_analysis_rows(snapshots)
    character_meta = load_character_meta(db_path)
    payload = build_mvp_payload(
        snapshots,
        analysis_rows,
        latest_snapshot_date=latest_snapshot_date,
        history_days=history_days,
        character_meta=character_meta,
    )
    summary, shards = build_v2_payloads(payload, shard_count=8)
    return payload, summary, shards


def _shard_payloads(summary: dict, shards: list[dict]) -> dict[int, dict]:
    return {
        shard_index: {
            "meta": {
                "dataFormatVersion": 2,
                "latestSnapshotDate": summary["meta"]["latestSnapshotDate"],
                "shard": shard_index,
            },
            "histories": histories,
        }
        for shard_index, histories in enumerate(shards)
    }


def _index_by_history_key(summary: dict) -> dict[str, dict]:
    return {c["historyKey"]: c for c in summary["characters"]}


def test_v2_shard_recovery_restores_snapshot_days(tmp_path: Path) -> None:
    """Basis 3: cache-less + Release-less recovery restores ~90 snapshot days."""
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    assert count_snapshot_dates(true_db) == DAYS

    _, summary, shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)

    recovered_db = tmp_path / "recovered.db"
    imported = import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)

    assert imported > 0
    assert count_snapshot_dates(recovered_db) == DAYS
    recovered_dates = sorted({row.snapshot_date for row in load_all_snapshots(recovered_db)})
    assert recovered_dates == dates


def test_v2_shard_recovery_then_next_real_fetch_matches_ground_truth(tmp_path: Path) -> None:
    """The realistic recovery flow: reconstruct from v2 shards, then the bot's
    next real API fetch happens on top. That next export's rank/previousRank/
    jobRank/worldRank/level/exp for the *latest* day must match a DB that never
    lost data at all (ground truth), because the recovered anchor day's values
    come verbatim from the v2 summary (no reconstruction needed there).
    """
    dates = _dates("2026-01-01", DAYS)
    next_day = _dates(dates[-1], 2)[1]

    # Ground truth: an unbroken DB across DAYS + 1 real fetch.
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates + [next_day])
    true_payload, true_summary, _true_shards = _export_v2(
        true_db, latest_snapshot_date=next_day
    )

    # Recovery: v2 shards only, up to `dates[-1]`, then one real fetch for next_day.
    recovery_source_db = tmp_path / "source_for_shards.db"
    _build_true_db(recovery_source_db, dates)
    _, summary, shards = _export_v2(recovery_source_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)

    recovered_db = tmp_path / "recovered.db"
    import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)
    assert count_snapshot_dates(recovered_db) == DAYS

    # Simulate the bot's real next-day fetch appended on top of the recovered DB:
    # pull the true rows for `next_day` (as the real API would return them) and
    # append them the same way append_snapshots would during a normal run.
    next_day_rows = [row for row in load_all_snapshots(true_db) if row.snapshot_date == next_day]
    append_snapshots(recovered_db, next_day_rows, fetched_at=f"{next_day}T09:05:00+00:00")

    recovered_payload, recovered_summary, _recovered_shards = _export_v2(
        recovered_db, latest_snapshot_date=next_day
    )

    true_by_key = _index_by_history_key(true_summary)
    recovered_by_key = _index_by_history_key(recovered_summary)
    assert set(true_by_key) == set(recovered_by_key)

    exact_fields = [
        "rank",
        "name",
        "job",
        "level",
        "exp",
        "levelExpPercent",
        "expPercent",
        "expToNextLevel",
        "totalExpFrom240",
        "expTo250",
        "imageUrl",
        "rankFluctuation",
        "previousRank",
        "characterAssetKey",
        "worldId",
        "jobRank",
        "jobRankTotal",
        "worldRank",
        "worldRankTotal",
        # dailyGain for the day right after recovery diffs the new (exact) real
        # fetch against the recovered anchor day, which is also exact -- so this
        # single-day gain is exact too, unlike weekly/monthlyGain below.
        "dailyGain",
    ]
    for key, true_char in true_by_key.items():
        recovered_char = recovered_by_key[key]
        for field in exact_fields:
            assert recovered_char.get(field) == true_char.get(field), (
                f"{key}.{field}: recovered={recovered_char.get(field)!r} "
                f"true={true_char.get(field)!r}"
            )

    # weeklyGain/monthlyGain sum several days that (beyond the exact anchor day)
    # are still reconstructed from rounded levelExpPercent, so allow the same
    # bounded slack as historical dailyGain (scaled by the number of days that
    # can contribute an independent rounding error).
    max_required = max(exp_required_for_level(lvl) or 0 for lvl in range(240, 275))
    per_day_bound = max_required * 0.0005 / 100.0 + 1
    for key, true_char in true_by_key.items():
        recovered_char = recovered_by_key[key]
        for field, window_days in (("weeklyGain", 7), ("monthlyGain", 31)):
            true_value = true_char.get(field) or 0
            recovered_value = recovered_char.get(field) or 0
            diff = abs(true_value - recovered_value)
            bound = window_days * per_day_bound
            assert diff <= bound, (
                f"{key}.{field}: recovered={recovered_value} true={true_value} "
                f"diff={diff} bound={bound}"
            )


def test_v2_shard_recovery_history_level_exact_and_percent_round_trips(tmp_path: Path) -> None:
    """Per-day `level` must be exact; `levelExpPercent` must round-trip exactly
    through the lossy exp reconstruction (both are directly UI-visible chart
    values). `exp`/`dailyGain` for non-latest days are NOT expected to be
    exact -- quantified separately below.

    No longer XFAIL (B', LULU-062 follow-up): `import_snapshots_from_v2_json`
    no longer forces a single meta.expTable-derived table onto
    reconstruct_exp_backward's now per-link era-aware arithmetic, so
    `levelExpPercent`/`expPercent` (derived from that same reconstruction)
    round-trip exactly again, same as `level` (stored verbatim, never
    reconstructed).
    """
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    true_payload, true_summary, true_shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    true_shard_payloads = _shard_payloads(true_summary, true_shards)

    recovered_db = tmp_path / "recovered.db"
    import_snapshots_from_v2_json(recovered_db, true_summary, true_shard_payloads)
    _, recovered_summary, recovered_shards = _export_v2(
        recovered_db, latest_snapshot_date=dates[-1]
    )
    recovered_shard_payloads = _shard_payloads(recovered_summary, recovered_shards)

    true_histories: dict[str, list[dict]] = {}
    for shard in true_shard_payloads.values():
        true_histories.update(shard["histories"])
    recovered_histories: dict[str, list[dict]] = {}
    for shard in recovered_shard_payloads.values():
        recovered_histories.update(shard["histories"])

    assert set(true_histories) == set(recovered_histories)

    for history_key, true_points in true_histories.items():
        recovered_points = recovered_histories[history_key]
        assert len(true_points) == len(recovered_points)
        for true_point, recovered_point in zip(true_points, recovered_points):
            assert true_point["snapshotDate"] == recovered_point["snapshotDate"]
            assert true_point["level"] == recovered_point["level"]
            assert true_point["levelExpPercent"] == recovered_point["levelExpPercent"]
            assert true_point["expPercent"] == recovered_point["expPercent"]


def test_v2_shard_recovery_daily_gain_is_exact_when_no_duplicate_dates(tmp_path: Path) -> None:
    """With no duplicate-date rows (the only thing that can break the exact
    backward chain besides a missing dailyGain, which doesn't occur in a
    clean fixture), every historical day's dailyGain reconstructs exactly --
    not just "bounded".

    No longer XFAIL (B', LULU-062 follow-up): Alpha (the only character in
    this fixture whose gain is large enough to level up, repeatedly, over
    these pre-boundary days) used to hit the single-table era mismatch this
    xfail documented. With reconstruct_exp_backward's link-unit arithmetic
    and sqlite_storage.import_snapshots_from_v2_json no longer forcing a
    single table onto it, every historical dailyGain reconstructs exactly
    again.
    """
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    _, true_summary, true_shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(true_summary, true_shards)

    recovered_db = tmp_path / "recovered.db"
    import_snapshots_from_v2_json(recovered_db, true_summary, shard_payloads)
    _, recovered_summary, recovered_shards = _export_v2(
        recovered_db, latest_snapshot_date=dates[-1]
    )
    recovered_shard_payloads = _shard_payloads(recovered_summary, recovered_shards)

    true_histories: dict[str, list[dict]] = {}
    for shard in shard_payloads.values():
        true_histories.update(shard["histories"])
    recovered_histories: dict[str, list[dict]] = {}
    for shard in recovered_shard_payloads.values():
        recovered_histories.update(shard["histories"])

    checked = 0
    for history_key, true_points in true_histories.items():
        recovered_points = recovered_histories[history_key]
        for true_point, recovered_point in zip(true_points, recovered_points):
            true_gain = true_point.get("dailyGain")
            recovered_gain = recovered_point.get("dailyGain")
            if true_gain is None or recovered_gain is None:
                continue
            assert recovered_gain == true_gain, (
                f"{history_key} {true_point['snapshotDate']}: "
                f"true={true_gain} recovered={recovered_gain}"
            )
            checked += 1

    assert checked > 0


def test_v2_shard_recovery_additive_merge_does_not_regress_existing_rows(
    tmp_path: Path,
) -> None:
    """INSERT OR IGNORE semantics: rows already present in the DB (e.g. from a
    still-warm actions/cache covering the most recent few days) must survive
    v2-shard recovery untouched, not be overwritten by the lossy reconstruction.
    """
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    _, summary, shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)

    recovered_db = tmp_path / "recovered.db"
    # Pre-seed the "recovered" DB with the *true* rows for the last 3 days,
    # simulating a partially-warm cache that already has recent days right.
    preexisting_dates = set(dates[-3:])
    preexisting_rows = [
        row for row in load_all_snapshots(true_db) if row.snapshot_date in preexisting_dates
    ]
    append_snapshots(recovered_db, preexisting_rows, fetched_at=f"{dates[-1]}T09:05:00+00:00")

    imported = import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)
    assert imported > 0

    after_rows = {
        (row.snapshot_date, row.character_asset_key or row.character_name): row
        for row in load_all_snapshots(recovered_db)
    }
    for row in preexisting_rows:
        key = (row.snapshot_date, row.character_asset_key or row.character_name)
        kept = after_rows[key]
        assert kept.rank == row.rank
        assert kept.exp == row.exp
        assert kept.level == row.level
        assert kept.job_code == row.job_code
        assert kept.class_code == row.class_code
        assert kept.image_url == row.image_url

    assert count_snapshot_dates(recovered_db) == DAYS


def test_import_missing_snapshots_from_v2_url_fetches_summary_and_all_shards(
    tmp_path: Path, monkeypatch
) -> None:
    """The network wrapper downloads the v2 summary, derives historyBasePath +
    historyShardCount from its meta, downloads every shard-NN.json under that
    base path, and hands them to import_snapshots_from_v2_json.
    """
    import json as json_module
    import urllib.request

    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    _, summary, shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)

    summary_url = "https://lulumi-tools.com/data/v2/rankings.json"
    base_path = summary["meta"]["historyBasePath"]
    requested_urls: list[str] = []

    class _FakeResponse:
        def __init__(self, payload: dict):
            self._body = json_module.dumps(payload).encode("utf-8")

        def read(self) -> bytes:
            return self._body

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

    def fake_urlopen(url, timeout=120):
        requested_urls.append(url)
        if url == summary_url:
            return _FakeResponse(summary)
        for shard_index, payload in shard_payloads.items():
            if url == f"https://lulumi-tools.com/data/v2/{base_path}/shard-{shard_index:02d}.json":
                return _FakeResponse(payload)
        raise AssertionError(f"unexpected URL requested: {url}")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    recovered_db = tmp_path / "recovered.db"
    imported = import_missing_snapshots_from_v2_url(recovered_db, summary_url)

    assert imported > 0
    assert count_snapshot_dates(recovered_db) == DAYS
    # One request for the summary + one per shard actually present.
    assert requested_urls[0] == summary_url
    assert len(requested_urls) == 1 + len(shard_payloads)


# =============================================================================
# P1 acceptance criteria (user-specified, T12 P1 re-review after adopting
# method D in production). Fixture: the existing 3-character synthetic DB,
# plus one *injected* duplicate-(identity, snapshotDate) row for "Beta" --
# same shape as the real production artifact found in ranking.db.gz during
# the T12 P1 investigation (a character listed twice on the same day, at two
# different ranks, with two different exp values). This is deliberately the
# *only* source of an exact-chain break in the fixture, so criteria 1/2 can
# assert precise counts.
# =============================================================================


def _inject_duplicate_day_row(
    db_path: Path, *, snapshot_date: str, name: str, asset_key: str, level: int, exp: int
) -> None:
    """Simulate the real ranking-API artifact: a second row for an existing
    character on a date it's already present on, at a different rank and a
    different exp (see T12 P1 follow-up report, e.g. VeryAlone00 /
    CHARd0mcmnj1hovs73do3g8g on 2026-06-02/03 in the real production DB).
    """
    duplicate_rank = len(CHARACTERS) + 1  # any rank not already used that day
    append_snapshots(
        db_path,
        [
            SnapshotRow(
                snapshot_date=snapshot_date,
                rank=duplicate_rank,
                rank_fluctuation=0,
                character_name=name,
                class_code="",
                job_code="",
                level=level,
                exp=exp,
                image_url="",
                character_asset_key=asset_key,
            )
        ],
        fetched_at=f"{snapshot_date}T09:05:00+00:00",
    )


def _build_fixture_with_duplicate_row(tmp_path: Path):
    """Ground-truth DB: DAYS of clean data for all 3 characters, plus one
    injected duplicate row for Beta partway through the window."""
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true_with_dupe.db"
    _build_true_db(true_db, dates)

    dupe_date = dates[DAYS // 2]
    beta_row = next(
        row
        for row in load_all_snapshots(true_db)
        if row.snapshot_date == dupe_date and row.character_name == "Beta"
    )
    _inject_duplicate_day_row(
        true_db,
        snapshot_date=dupe_date,
        name="Beta",
        asset_key="asset-beta",
        level=beta_row.level,
        exp=beta_row.exp + 500_000,  # a plausible, slightly different exp
    )
    return true_db, dates, dupe_date


def _inject_negative_gain_row(
    db_path: Path, *, snapshot_date: str, name: str, asset_key: str, level: int, exp: int
) -> None:
    """Simulate a real data-quality artifact: overwrite an existing day's row
    for a character with a level/exp that regresses below the previous
    calendar day's value -- e.g. a bad snapshot pair from an API glitch (see
    DECISION_LOG LULU-055). `analysis.build_analysis_rows`'s negative-
    dailyGain guard (analysis.py:143-152) nulls that day's `dailyGain` rather
    than showing a fabricated negative number, which is exactly the
    exact-chain-breaking condition `reconstruct_exp_backward`'s
    `conservative_fallback` path is designed to survive.
    """
    import sqlite3

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE ranking_snapshot SET level = ?, exp = ? "
            "WHERE snapshot_date = ? AND character_name = ? AND character_asset_key = ?",
            (level, exp, snapshot_date, name, asset_key),
        )
        conn.commit()


def _build_fixture_with_null_daily_gain_break(tmp_path: Path):
    """Ground-truth DB: DAYS of clean data for all 3 characters, plus a
    realistic data-quality glitch for Beta on one day: its recorded
    level/exp regresses below the previous calendar day's value (a real
    production artifact -- see analysis.py:143-152 / DECISION_LOG LULU-055),
    which makes `analysis.build_analysis_rows` null that day's `dailyGain`
    instead of fabricating a negative one.

    This -- not an injected duplicate (identity, snapshotDate) row -- is the
    realistic trigger for `reconstruct_exp_backward`'s exact-chain break in
    *current* production data: P-DQ-1 (`analysis.
    deduplicate_snapshots_by_identity`) now collapses duplicate rows to one
    before the v2 export ever builds the shard history a recovering client
    downloads, so a duplicated snapshotDate no longer reaches the shard at
    all (see `test_duplicate_date_injection_no_longer_breaks_chain_after_p_dq_1`
    below).
    """
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true_with_glitch.db"
    _build_true_db(true_db, dates)

    glitch_index = DAYS // 2
    glitch_date = dates[glitch_index]
    prev_date = dates[glitch_index - 1]
    prev_row = next(
        row
        for row in load_all_snapshots(true_db)
        if row.snapshot_date == prev_date and row.character_name == "Beta"
    )
    # Regress Beta's progress strictly below the previous day's -- by exp if
    # there's enough headroom, else by level -- so the resulting dailyGain is
    # unambiguously negative (and therefore nulled by analysis.py) regardless
    # of exactly where in the level table this fixture lands.
    if prev_row.exp >= 1_000_000:
        glitch_level = prev_row.level
        glitch_exp = prev_row.exp - 1_000_000
    else:
        glitch_level = prev_row.level - 1
        glitch_exp = 0
    _inject_negative_gain_row(
        true_db,
        snapshot_date=glitch_date,
        name="Beta",
        asset_key="asset-beta",
        level=glitch_level,
        exp=glitch_exp,
    )
    return true_db, dates, glitch_date


# JS port of rankingUtils.js:124-134 (formatExp) -- the display rounding
# quantum applied to daily/weekly/monthly gain in RankingTable.jsx,
# TopGainHighlights.jsx, CharacterDetail.jsx.
def _format_exp(value) -> str:
    if value is None:
        return "None"
    if value >= 1_000_000_000_000:
        return f"{value / 1_000_000_000_000:.2f}T"
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.1f}B"
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    return f"{int(round(value)):,}"


# Port of rankingUtils.js:218-229 (computeGainRankMaps): descending sort by
# gain amount, 1-based rank.
def _gain_rank_map(characters: list[dict], field: str) -> dict[int, int]:
    ordered = sorted(characters, key=lambda c: -(c.get(field) or 0))
    return {c["id"]: i + 1 for i, c in enumerate(ordered)}


def test_p1_acceptance_exact_and_fallback_counts(tmp_path: Path) -> None:
    """Criteria 1+2: normal characters reconstruct 100% "exact" (fallback
    never fires for them); the character with a null-dailyGain break is the
    *only* source of fallback, and it fires exactly at that break.

    Trigger note (post P-DQ-1): this test used to inject a *duplicate*
    (identity, snapshotDate) row to break the exact chain. Since main gained
    P-DQ-1 (`analysis.deduplicate_snapshots_by_identity`), such duplicates
    are collapsed to a single row *before* the v2 export builds the shard
    history a recovering client downloads, so that trigger no longer reaches
    the shard at all and `conservative_fallback` stayed at 0 -- see
    `test_duplicate_date_injection_no_longer_breaks_chain_after_p_dq_1`
    below, which now records that (desirable) interaction explicitly.
    `conservative_fallback` itself is still real and reachable in current
    production data, most plausibly via a null `dailyGain` (analysis.py's
    negative-gain guard, analysis.py:143-152) -- the trigger used here.

    No longer XFAIL (B', LULU-062 follow-up): "Alpha" (gain=50B/day) levels
    up repeatedly over these 90 pre-boundary days, which used to hit the
    single-table era mismatch this test's old xfail documented. With
    `reconstruct_exp_backward`'s link-unit exp arithmetic (each link now
    picks its own destination day's era table instead of one table for the
    whole chain), Alpha reconstructs 100% exact again, same as before
    LULU-062's gain fix exposed the recovery-side bug.
    """
    true_db, dates, glitch_date = _build_fixture_with_null_daily_gain_break(tmp_path)
    _, true_summary, true_shards = _export_v2(true_db, latest_snapshot_date=dates[-1])

    histories_by_key: dict[str, list[dict]] = {}
    for shard in true_shards:
        histories_by_key.update(shard)

    stats_by_character: dict[str, dict[str, int]] = {}
    for character in true_summary["characters"]:
        history_key = character["historyKey"]
        history = histories_by_key[history_key]
        points_desc = sorted(history, key=lambda p: p["snapshotDate"], reverse=True)
        reconstructed = reconstruct_exp_backward(
            anchor_date=dates[-1],
            anchor_level=character["level"],
            anchor_exp=character["exp"],
            points_desc=points_desc,
        )
        counts = {"exact": 0, "conservative_fallback": 0, "unrecoverable": 0}
        for day in reconstructed:
            counts[day.method] += 1
        stats_by_character[character["name"]] = counts

    # Criterion 1: normal characters (no null dailyGain) are 100% exact.
    assert stats_by_character["Alpha"] == {"exact": DAYS, "conservative_fallback": 0, "unrecoverable": 0}
    assert stats_by_character["Gamma"] == {"exact": DAYS, "conservative_fallback": 0, "unrecoverable": 0}

    # Criterion 2: fallback fires only for Beta, only because of the injected
    # null-dailyGain break (not a systemic/frequent occurrence).
    beta_stats = stats_by_character["Beta"]
    assert beta_stats["unrecoverable"] == 0
    assert beta_stats["conservative_fallback"] > 0
    assert beta_stats["conservative_fallback"] < DAYS // 4, (
        "fallback should be confined to the neighborhood of the single "
        f"injected null-dailyGain break, not pervasive: {beta_stats}"
    )
    # DAYS: the glitch overwrites an existing day's row in place (no extra
    # history point), unlike the retired duplicate-row trigger.
    assert beta_stats["exact"] + beta_stats["conservative_fallback"] == DAYS


def test_duplicate_date_injection_no_longer_breaks_chain_after_p_dq_1(tmp_path: Path) -> None:
    """Documents an interaction between P-DQ-1 (`analysis.
    deduplicate_snapshots_by_identity`, see DECISION_LOG) and T12 P1: an
    injected duplicate (identity, snapshotDate) row -- the real production
    artifact `_inject_duplicate_day_row` / `_build_fixture_with_duplicate_row`
    simulate, and the original trigger for this file's acceptance test --
    no longer breaks `reconstruct_exp_backward`'s exact chain, because
    P-DQ-1 deterministically collapses such duplicates to a single row
    *before* the v2 export ever builds the shard history a recovering
    client downloads. The shard-level "ambiguous date" guard in
    v2_recovery_backward.py (kept for defensive/back-compat reasons -- e.g.
    shards exported before P-DQ-1 shipped, or a future shard producer that
    doesn't dedupe) is therefore not exercised by current exports.

    This is the intended, desirable effect of P-DQ-1 (duplicates are fixed
    at the source instead of merely tolerated downstream), not a
    regression: see `test_p1_acceptance_exact_and_fallback_counts` above for
    the trigger that *is* still current (a null dailyGain).
    """
    true_db, dates, dupe_date = _build_fixture_with_duplicate_row(tmp_path)
    _, true_summary, true_shards = _export_v2(true_db, latest_snapshot_date=dates[-1])

    histories_by_key: dict[str, list[dict]] = {}
    for shard in true_shards:
        histories_by_key.update(shard)

    beta_char = next(c for c in true_summary["characters"] if c["name"] == "Beta")
    beta_history = histories_by_key[beta_char["historyKey"]]

    # P-DQ-1 collapses the injected duplicate to exactly one point for
    # dupe_date -- the shard never carries two points on the same date.
    dupe_date_points = [p for p in beta_history if p["snapshotDate"] == dupe_date]
    assert len(dupe_date_points) == 1
    assert len(beta_history) == DAYS

    points_desc = sorted(beta_history, key=lambda p: p["snapshotDate"], reverse=True)
    reconstructed = reconstruct_exp_backward(
        anchor_date=dates[-1],
        anchor_level=beta_char["level"],
        anchor_exp=beta_char["exp"],
        points_desc=points_desc,
    )
    counts = {"exact": 0, "conservative_fallback": 0, "unrecoverable": 0}
    for day in reconstructed:
        counts[day.method] += 1
    assert counts == {"exact": DAYS, "conservative_fallback": 0, "unrecoverable": 0}


def test_p1_acceptance_never_over_restores(tmp_path: Path) -> None:
    """Criterion 3: reconstructed exp never exceeds the true exp, for every
    character and every historical day, including at the injected break.
    """
    true_db, dates, dupe_date = _build_fixture_with_duplicate_row(tmp_path)
    true_snapshots = load_all_snapshots(true_db)
    true_exp_by = {
        (row.character_asset_key or row.character_name, row.snapshot_date): row.exp
        for row in true_snapshots
    }

    _, true_summary, true_shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(true_summary, true_shards)

    recovered_db = tmp_path / "recovered_never_over.db"
    imported = import_snapshots_from_v2_json(recovered_db, true_summary, shard_payloads)
    assert imported > 0

    recovered_snapshots = load_all_snapshots(recovered_db)
    checked = 0
    over_restored = []
    for row in recovered_snapshots:
        key = (row.character_asset_key or row.character_name, row.snapshot_date)
        true_exp = true_exp_by.get(key)
        if true_exp is None:
            continue
        checked += 1
        if row.exp > true_exp:
            over_restored.append((key, true_exp, row.exp))

    assert checked > 0
    assert over_restored == [], f"over-restored exp found: {over_restored}"


def test_p1_acceptance_no_display_or_rank_impact(tmp_path: Path) -> None:
    """Criterion 4: re-exporting the recovered DB (after the bot's next real
    fetch, the realistic post-recovery flow) produces the same formatExp
    display strings and the same daily/weekly/monthly gain rank ordering as
    a DB that never lost data, for every character.
    """
    true_db, dates, dupe_date = _build_fixture_with_duplicate_row(tmp_path)
    next_day = _dates(dates[-1], 2)[1]

    # Ground truth: continue the *same* (duplicate-including) history one
    # more real day.
    true_db_plus_one = tmp_path / "true_plus_one.db"
    _build_true_db(true_db_plus_one, dates + [next_day])
    _inject_duplicate_day_row(
        true_db_plus_one,
        snapshot_date=dupe_date,
        name="Beta",
        asset_key="asset-beta",
        level=next(
            row.level
            for row in load_all_snapshots(true_db_plus_one)
            if row.snapshot_date == dupe_date and row.character_name == "Beta"
        ),
        exp=next(
            row.exp
            for row in load_all_snapshots(true_db_plus_one)
            if row.snapshot_date == dupe_date and row.character_name == "Beta"
        )
        + 500_000,
    )
    _, true_summary_next, _ = _export_v2(true_db_plus_one, latest_snapshot_date=next_day)

    # Recovery: v2 shards (with the duplicate baked in) up to dates[-1], then
    # the bot's real next-day fetch on top.
    _, summary, shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)
    recovered_db = tmp_path / "recovered_display.db"
    import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)

    next_day_rows = [
        row for row in load_all_snapshots(true_db_plus_one) if row.snapshot_date == next_day
    ]
    append_snapshots(recovered_db, next_day_rows, fetched_at=f"{next_day}T09:05:00+00:00")
    _, recovered_summary_next, _ = _export_v2(recovered_db, latest_snapshot_date=next_day)

    true_characters = true_summary_next["characters"]
    recovered_characters = recovered_summary_next["characters"]
    true_by_key = {c["historyKey"]: c for c in true_characters}
    recovered_by_key = {c["historyKey"]: c for c in recovered_characters}
    assert set(true_by_key) == set(recovered_by_key)

    display_mismatches = []
    for field in ("dailyGain", "weeklyGain", "monthlyGain"):
        for key, true_char in true_by_key.items():
            recovered_char = recovered_by_key[key]
            true_display = _format_exp(true_char.get(field))
            recovered_display = _format_exp(recovered_char.get(field))
            if true_display != recovered_display:
                display_mismatches.append((key, field, true_display, recovered_display))
    assert display_mismatches == [], f"display string changed: {display_mismatches}"

    rank_mismatches = []
    for field in ("dailyGain", "weeklyGain", "monthlyGain"):
        true_ranks = _gain_rank_map(true_characters, field)
        recovered_ranks = _gain_rank_map(recovered_characters, field)
        for key, true_char in true_by_key.items():
            true_rank = true_ranks[true_char["id"]]
            recovered_rank = recovered_ranks[recovered_by_key[key]["id"]]
            if true_rank != recovered_rank:
                rank_mismatches.append((key, field, true_rank, recovered_rank))
    assert rank_mismatches == [], f"gain rank changed: {rank_mismatches}"


# =============================================================================
# Idempotency / additive guard (T12 P1, added after the method-D re-review):
# skip reconstructed (snapshot_date, identity) rows that already exist in the
# DB *before* insertion, so re-running recovery never adds a duplicate row
# for a character/day that's already there -- regardless of what synthetic
# rank the reconstruction would have assigned it.
# =============================================================================


def _identity_date_duplicates(db_path: Path) -> list[tuple]:
    """Direct SQL for acceptance criterion 5: any (snapshot_date, identity)
    with more than one row. identity = asset key, or name for legacy rows
    without one (mirrors the guard's own convention).
    """
    import sqlite3

    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT snapshot_date,
                   COALESCE(NULLIF(character_asset_key, ''), 'name:' || lower(character_name)) AS identity,
                   COUNT(*) AS n
            FROM ranking_snapshot
            GROUP BY snapshot_date, identity
            HAVING COUNT(*) > 1
            """
        ).fetchall()
    return rows


def test_p1_idempotency_normal_recovery_into_empty_db_unaffected(tmp_path: Path) -> None:
    """Criterion 1: the guard must not change the already-verified behavior
    of a normal recovery into a completely empty DB (no existing rows to
    filter against -> imported count matches the un-guarded D-method
    baseline: every reconstructed row is new).
    """
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    _, summary, shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)

    recovered_db = tmp_path / "recovered.db"
    imported = import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)

    expected_rows = sum(1 for row in load_all_snapshots(true_db))
    assert imported == expected_rows
    assert count_snapshot_dates(recovered_db) == DAYS
    assert _identity_date_duplicates(recovered_db) == []


def test_p1_idempotency_partial_db_adds_only_missing_days(tmp_path: Path) -> None:
    """Criterion 2: pre-seed whole days (the realistic partial-DB shape --
    the bot always fetches a complete day or none at all), recover from v2
    shards, and confirm the pre-seeded days are byte-for-byte unchanged while
    only the missing days are added.
    """
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    _, summary, shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)

    preseeded_dates = set(dates[10:15])  # 5 whole days already "warm"
    recovered_db = tmp_path / "recovered.db"
    preseeded_rows = [
        row for row in load_all_snapshots(true_db) if row.snapshot_date in preseeded_dates
    ]
    append_snapshots(recovered_db, preseeded_rows, fetched_at=f"{dates[14]}T09:05:00+00:00")
    assert count_snapshot_dates(recovered_db) == 5

    import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)

    assert count_snapshot_dates(recovered_db) == DAYS
    recovered_rows_by_date: dict[str, list] = {}
    for row in load_all_snapshots(recovered_db):
        recovered_rows_by_date.setdefault(row.snapshot_date, []).append(row)

    # Pre-seeded days: same row count, unchanged (rank, exp, level).
    preseeded_by_date: dict[str, list] = {}
    for row in preseeded_rows:
        preseeded_by_date.setdefault(row.snapshot_date, []).append(row)
    for date in preseeded_dates:
        before = sorted((r.rank, r.exp, r.level, r.character_name) for r in preseeded_by_date[date])
        after = sorted(
            (r.rank, r.exp, r.level, r.character_name) for r in recovered_rows_by_date[date]
        )
        assert before == after, f"pre-seeded day {date} changed: before={before} after={after}"

    # Missing days: now present, with the expected character count.
    for date in dates:
        if date in preseeded_dates:
            continue
        assert len(recovered_rows_by_date.get(date, [])) == len(CHARACTERS)

    assert _identity_date_duplicates(recovered_db) == []


def test_p1_idempotency_no_duplicate_when_existing_rank_differs(tmp_path: Path) -> None:
    """Criterion 3: reproduce the "method A masking" condition -- an existing
    row for (date, identity) whose rank differs from whatever the
    reconstruction's synthetic sort_rank would assign -- and confirm the
    guard still skips it (no duplicate), since it filters on (date, identity)
    *before* any rank is computed, not by relying on a rank collision.
    """
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    _, summary, shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)

    dupe_date = dates[20]
    recovered_db = tmp_path / "recovered.db"
    # Existing row for Beta on dupe_date, deliberately at a rank (99) that the
    # reconstruction's own sort_rank/enumerate assignment (1..len(CHARACTERS))
    # would never independently produce -- guaranteeing no accidental match.
    append_snapshots(
        recovered_db,
        [
            SnapshotRow(
                snapshot_date=dupe_date,
                rank=99,
                rank_fluctuation=0,
                character_name="Beta",
                class_code="",
                job_code="",
                level=246,
                exp=123_456,
                image_url="",
                character_asset_key="asset-beta",
            )
        ],
        fetched_at=f"{dupe_date}T09:05:00+00:00",
    )

    import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)

    beta_rows_that_day = [
        row
        for row in load_all_snapshots(recovered_db)
        if row.snapshot_date == dupe_date and row.character_asset_key == "asset-beta"
    ]
    assert len(beta_rows_that_day) == 1, f"expected no duplicate, got {beta_rows_that_day}"
    # The pre-existing row must be untouched (not overwritten), same as the
    # additive-merge guarantee elsewhere in this file.
    assert beta_rows_that_day[0].rank == 99
    assert beta_rows_that_day[0].exp == 123_456
    assert beta_rows_that_day[0].level == 246

    assert _identity_date_duplicates(recovered_db) == []


def test_p1_idempotency_running_recovery_twice_is_a_no_op(tmp_path: Path) -> None:
    """Criterion 4: running the same recovery twice against the same DB
    produces identical row count and content (idempotent)."""
    dates = _dates("2026-01-01", DAYS)
    true_db = tmp_path / "true.db"
    _build_true_db(true_db, dates)
    _, summary, shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(summary, shards)

    recovered_db = tmp_path / "recovered.db"
    first_imported = import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)
    assert first_imported > 0
    rows_after_first = sorted(
        (r.snapshot_date, r.rank, r.character_asset_key, r.exp, r.level)
        for r in load_all_snapshots(recovered_db)
    )

    second_imported = import_snapshots_from_v2_json(recovered_db, summary, shard_payloads)
    rows_after_second = sorted(
        (r.snapshot_date, r.rank, r.character_asset_key, r.exp, r.level)
        for r in load_all_snapshots(recovered_db)
    )

    assert second_imported == 0, f"second run should be a pure no-op, imported={second_imported}"
    assert rows_after_first == rows_after_second
    assert _identity_date_duplicates(recovered_db) == []


def test_p1_idempotency_no_over_restoration_regression(tmp_path: Path) -> None:
    """Criterion 6: the idempotency guard must not weaken the D-method
    never-over-restore guarantee (it only removes candidate rows before
    insertion; it must never change a reconstructed exp value).
    """
    true_db, dates, dupe_date = _build_fixture_with_duplicate_row(tmp_path)
    true_snapshots = load_all_snapshots(true_db)
    true_exp_by = {
        (row.character_asset_key or row.character_name, row.snapshot_date): row.exp
        for row in true_snapshots
    }

    _, true_summary, true_shards = _export_v2(true_db, latest_snapshot_date=dates[-1])
    shard_payloads = _shard_payloads(true_summary, true_shards)

    recovered_db = tmp_path / "recovered_never_over_with_guard.db"
    # Pre-seed a few days (partial DB) so the idempotency guard is actually
    # exercised in the same run as the over-restoration check.
    preseeded_dates = set(dates[:5])
    preseeded_rows = [row for row in true_snapshots if row.snapshot_date in preseeded_dates]
    append_snapshots(recovered_db, preseeded_rows, fetched_at=f"{dates[4]}T09:05:00+00:00")

    imported = import_snapshots_from_v2_json(recovered_db, true_summary, shard_payloads)
    assert imported > 0

    over_restored = []
    checked = 0
    for row in load_all_snapshots(recovered_db):
        key = (row.character_asset_key or row.character_name, row.snapshot_date)
        true_exp = true_exp_by.get(key)
        if true_exp is None:
            continue
        checked += 1
        if row.exp > true_exp:
            over_restored.append((key, true_exp, row.exp))

    assert checked > 0
    assert over_restored == [], f"over-restored exp found: {over_restored}"
    assert _identity_date_duplicates(recovered_db) == []
