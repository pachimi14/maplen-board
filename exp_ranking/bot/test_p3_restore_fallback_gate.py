"""T12 P3 §5 commit 4/7: "cache miss・Release不達時の fallback を実証"
(verification-only commit -- no production code changes here).

These tests exercise the *real* `main.bootstrap_database()` +
`main.enforce_snapshot_integrity_guard()` call pair together (not the guard
in isolation, which test_snapshot_guard.py already covers exhaustively) to
demonstrate the layered restore chain (§2.3: cache -> Release -> v1(Pages) ->
v2(shards)) and the truncated-publish guard (§2.4) interacting correctly
under the two synthetic conditions the plan calls for:

    S3: cache miss + Release unreachable + v2-shard recovery succeeds fully
        -> the run must proceed (guard does not fire).
    S4: cache miss + Release unreachable + v2-shard recovery is incomplete
        -> the guard must fire (SnapshotGuardError), which is main.py's
        fail-closed backstop for the whole restore chain.

"Release unreachable" is simulated realistically via
`release_store.download_current_asset` raising `ReleaseStoreError` (used by
both the workflow's restore step, §2.1, and `snapshot_guard.fetch_release_
snapshot_days`, §2.4 item 2) rather than a bespoke stand-in. "v2-shard
recovery" itself (the actual shard-JSON reconstruction algorithm) is not
re-verified here -- that correctness (era-aware, bit-exact per LULU-062 B')
is already exhaustively covered by test_v2_shard_recovery.py; here
`import_missing_snapshots_from_v2_url` is monkeypatched at the call site
`main.py` uses so these tests focus purely on the *wiring* between the
recovery layer and the guard, not the recovery algorithm's internals.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

import main
import release_store
import snapshot_guard
from models import SnapshotRow
from sqlite_storage import append_snapshots, count_snapshot_dates


def _rows_for_day(snapshot_date: str, count: int) -> list[SnapshotRow]:
    return [
        SnapshotRow(
            snapshot_date,
            rank,
            0,
            f"Char{rank}",
            "",
            "",
            225,
            1_000_000 + rank,
            "",
            f"asset-{rank}",
        )
        for rank in range(1, count + 1)
    ]


def _consecutive_dates(n: int, *, end: str = "2026-07-28") -> list[str]:
    from datetime import date, timedelta

    end_date = date.fromisoformat(end)
    return [
        (end_date - timedelta(days=offset)).isoformat()
        for offset in range(n - 1, -1, -1)
    ]


class _FakeV2MetaResponse:
    """Stands in for the `urllib.request.urlopen` context manager used by
    `snapshot_guard.fetch_public_v2_snapshot_days` to fetch the *public*
    v2 rankings.json meta (§2.4 item 1) -- independent of, and reachable
    even when, our own Release Asset access (§2.4 item 2) is down."""

    def __init__(self, snapshot_days: int) -> None:
        import json

        self._payload = json.dumps({"meta": {"snapshotDays": snapshot_days}}).encode(
            "utf-8"
        )

    def __enter__(self) -> "_FakeV2MetaResponse":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self) -> bytes:
        return self._payload


def _patch_release_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    """S2/S3/S4 common setup: Release Asset download fails with a non-
    not-found error (rate limit / network), which is exactly the case
    `fetch_release_snapshot_days` (§2.4 item 2, "利用可能なら") must degrade
    to `None` for rather than crash the whole guard (already unit-tested in
    test_snapshot_guard.py; reused here as a realistic precondition)."""

    def fake_download(dest_path, tag: str = release_store.DB_STORE_TAG) -> bool:
        raise release_store.ReleaseStoreError("simulated Release outage (T12 P3 S3/S4)")

    monkeypatch.setattr(release_store, "download_current_asset", fake_download)


def _patch_public_v2_meta(monkeypatch: pytest.MonkeyPatch, snapshot_days: int) -> None:
    def fake_urlopen(url: str, timeout: int = 30) -> _FakeV2MetaResponse:
        return _FakeV2MetaResponse(snapshot_days)

    monkeypatch.setattr(snapshot_guard.urllib.request, "urlopen", fake_urlopen)


def _run_bootstrap_and_guard(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    v2_import_fake,
) -> dict[str, int]:
    db_path = tmp_path / "ranking.db"

    # cache miss + Release unreachable: nothing pre-populates db_path here,
    # and config flags mirror the workflow env for this scenario (§5 step 2/3;
    # T12 P4: the v1-Pages import layer this used to also disable here
    # -- SNAPSHOT_IMPORT_FROM_PAGES -- is removed entirely; T12 P7 removed
    # the snapshot-seed layer entirely too, so the v2 layer being tested is
    # now the only import layer left to isolate;
    # SNAPSHOT_IMPORT_FROM_V2_SHARDS=true per commit 3/7).
    monkeypatch.setattr(main.config, "snapshot_import_from_v2_shards", lambda: True)
    monkeypatch.setattr(main.config, "restore_cache_hit", lambda: False)
    monkeypatch.setattr(main.config, "restore_release_restored", lambda: False)
    monkeypatch.setattr(main, "import_missing_snapshots_from_v2_url", v2_import_fake)

    restore_info = main.bootstrap_database(db_path, logging.getLogger(__name__))
    main.enforce_snapshot_integrity_guard(db_path, logging.getLogger(__name__), restore_info)
    return restore_info


def test_s3_cache_miss_release_unreachable_v2_recovery_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """S3: cache miss + Release不達 + v2成功 -> v2シャードから復元・正常完了
    (ガードは発火しない)。"""
    _patch_release_unreachable(monkeypatch)
    _patch_public_v2_meta(monkeypatch, snapshot_days=40)

    def fake_v2_import(db_path: Path, summary_url: str) -> int:
        rows = []
        for date in _consecutive_dates(40):
            rows.extend(_rows_for_day(date, 100))
        saved, _skipped = append_snapshots(db_path, rows, fetched_at="2026-07-28T09:00:00+00:00")
        return saved

    restore_info = _run_bootstrap_and_guard(tmp_path, monkeypatch, v2_import_fake=fake_v2_import)

    assert restore_info["pages_imported"] == 0
    assert restore_info["v2_imported"] > 0
    db_path = tmp_path / "ranking.db"
    assert count_snapshot_dates(db_path) == 40


def test_s4_cache_miss_release_unreachable_v2_recovery_incomplete_fires_guard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """S4: cache miss + Release不達 + v2不完全 -> ガード発火(run が fail)。
    公開中の v2 meta は40日分あると報告しているのに、復元後の DB は30日分
    しか無い(v2シャード自体が何らかの理由で不完全にしか復元できなかった、
    という最後の砦が崩れたケース)。"""
    _patch_release_unreachable(monkeypatch)
    _patch_public_v2_meta(monkeypatch, snapshot_days=40)

    def fake_v2_import_incomplete(db_path: Path, summary_url: str) -> int:
        rows = []
        for date in _consecutive_dates(30):  # short of the public 40 days
            rows.extend(_rows_for_day(date, 100))
        saved, _skipped = append_snapshots(db_path, rows, fetched_at="2026-07-28T09:00:00+00:00")
        return saved

    with pytest.raises(snapshot_guard.SnapshotGuardError, match="snapshot_days=30"):
        _run_bootstrap_and_guard(
            tmp_path, monkeypatch, v2_import_fake=fake_v2_import_incomplete
        )


def test_s4_variant_release_baseline_reachable_but_v2_recovery_incomplete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """S4 変種: Release baseline 自体は読めるが(=Release自体は生きている)、
    その基準(60日)に対して v2 復元後の DB が大きく不足している場合も同様に
    発火すること(§2.4: 「両方取れたら大きい方を採用」)。"""

    def fake_download(dest_path: Path, tag: str = release_store.DB_STORE_TAG) -> bool:
        release_db = Path(dest_path)
        release_db.parent.mkdir(parents=True, exist_ok=True)
        source_db = release_db.parent / "release_baseline_source.db"
        rows = []
        for date in _consecutive_dates(60):
            rows.extend(_rows_for_day(date, 100))
        append_snapshots(source_db, rows, fetched_at="2026-07-28T09:00:00+00:00")

        import gzip

        with open(source_db, "rb") as src, gzip.open(release_db, "wb") as dst:
            dst.write(src.read())
        return True

    monkeypatch.setattr(release_store, "download_current_asset", fake_download)
    _patch_public_v2_meta(monkeypatch, snapshot_days=20)  # smaller than Release's 60

    def fake_v2_import_incomplete(db_path: Path, summary_url: str) -> int:
        rows = []
        for date in _consecutive_dates(35):  # short of the Release basis (60)
            rows.extend(_rows_for_day(date, 100))
        saved, _skipped = append_snapshots(db_path, rows, fetched_at="2026-07-28T09:00:00+00:00")
        return saved

    with pytest.raises(snapshot_guard.SnapshotGuardError, match="snapshot_days=35"):
        _run_bootstrap_and_guard(
            tmp_path, monkeypatch, v2_import_fake=fake_v2_import_incomplete
        )
