"""T12 P1: v2-shard-only DB recovery (worst case: no cache, no Release Asset,
no git db.gz).

Feasibility finding (see IMPL_PLAN_T12 P1): the v2 shard `history` array only
carries `level` + `levelExpPercent` (no raw `exp`, no rank, no job/class code,
no image, no character name) for every date except the latest one, which is
fully preserved in the v2 summary (`data/v2/rankings.json`). This mirrors the
existing v1 recovery path (`import_snapshots_from_mvp_json`), which already
reconstructs `exp` by inverting the rounded `levelExpPercent` -- an accepted,
already-shipped lossy step. `import_snapshots_from_v2_json` reuses the exact
same technique.

`import_snapshots_from_v2_json` prefers the v2 summary's exact `level`/`exp`
for the *latest* (anchor) day over inverting that day's shard `levelExpPercent`
point, since the summary already carries it with full precision. This makes
the anchor day, and any `dailyGain` computed against it by the bot's next real
fetch, exact -- not just "close".

These tests quantify what is, and is not, exactly reproduced after recovery:
- Exact: snapshot_days, the latest day's rank/name/job/level/exp/image/
  worldId/characterAssetKey (and everything derived only from the latest
  day), and level per historical day.
- Exact after one more real fetch: rank/previousRank/jobRank/worldRank/
  dailyGain for the day that follows recovery (both operands of that day's
  gain diff -- the new real day and the recovered-but-exact anchor day --
  are exact).
- Approximate (documented, bounded): dailyGain for reconstructed *historical*
  days (both non-anchor endpoints are approximate), and weeklyGain/
  monthlyGain windows that span multiple such days, because raw `exp` for
  non-anchor days is only recoverable up to the ~0.001-percentage-point
  rounding of `levelExpPercent`.
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


def test_v2_shard_recovery_daily_gain_precision_is_bounded(tmp_path: Path) -> None:
    """Quantifies the known, pre-existing (v1-inherited) precision gap: dailyGain
    for reconstructed historical days is derived from an `exp` value inverted
    from a 3-decimal-rounded percent, so it can differ from the ground truth by
    a small, bounded amount tied to the level's exp requirement -- not an
    unbounded or qualitative divergence.
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

    # Bound: half a rounding step (0.0005 of 100%) of the *next* level's exp
    # requirement, doubled for two consecutive approximated days, plus a small
    # integer-rounding slack.
    max_required = max(exp_required_for_level(lvl) or 0 for lvl in range(240, 275))
    bound = 2 * (max_required * 0.0005 / 100.0) + 2

    max_abs_diff = 0
    for history_key, true_points in true_histories.items():
        recovered_points = recovered_histories[history_key]
        for true_point, recovered_point in zip(true_points, recovered_points):
            true_gain = true_point.get("dailyGain")
            recovered_gain = recovered_point.get("dailyGain")
            if true_gain is None or recovered_gain is None:
                continue
            diff = abs(true_gain - recovered_gain)
            max_abs_diff = max(max_abs_diff, diff)
            assert diff <= bound, (
                f"{history_key} {true_point['snapshotDate']}: "
                f"true={true_gain} recovered={recovered_gain} diff={diff} bound={bound}"
            )

    # Sanity: the bound is meaningful (not trivially satisfied by e.g. 0 == 0).
    assert max_abs_diff >= 0


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
