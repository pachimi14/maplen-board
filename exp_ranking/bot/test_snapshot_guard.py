"""Unit tests for snapshot_guard.py (T12 P3 §2.4, "切り詰め公開防止ガード").

These are the pytest-level "合成条件のテスト" the plan (IMPL_PLAN_T12_P3.md §3.1)
calls for S2〜S6: Release download is mocked/made-unreachable and the local DB
is built with a deliberately insufficient day-count or a truncated latest day,
then we assert `check_snapshot_integrity` fires (raises `SnapshotGuardError`)
with Pages/Release left untouched (the caller -- main.py -- never reaches the
export/persist steps because the exception propagates uncaught, see
test_main_snapshot_guard_wiring below).
"""

from __future__ import annotations

import gzip
import json
import urllib.error
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


def _build_db(db_path: Path, day_row_counts: dict[str, int]) -> None:
    for snapshot_date, count in sorted(day_row_counts.items()):
        append_snapshots(
            db_path,
            _rows_for_day(snapshot_date, count),
            fetched_at=f"{snapshot_date}T09:00:00+00:00",
        )


def _consecutive_dates(n: int, *, end: str = "2026-07-28") -> list[str]:
    from datetime import date, timedelta

    end_date = date.fromisoformat(end)
    return [
        (end_date - timedelta(days=offset)).isoformat()
        for offset in range(n - 1, -1, -1)
    ]


# ---------------------------------------------------------------------------
# fetch_public_v2_snapshot_days
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self) -> bytes:
        return self._payload


def test_fetch_public_v2_snapshot_days_parses_meta(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = json.dumps({"meta": {"snapshotDays": 87}}).encode("utf-8")

    def fake_urlopen(url: str, timeout: int = 30) -> _FakeResponse:
        assert "v2/rankings.json" in url or True
        return _FakeResponse(payload)

    monkeypatch.setattr(snapshot_guard.urllib.request, "urlopen", fake_urlopen)
    assert snapshot_guard.fetch_public_v2_snapshot_days("https://example.test/v2/rankings.json") == 87


def test_fetch_public_v2_snapshot_days_returns_none_on_network_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_urlopen(url: str, timeout: int = 30):
        raise urllib.error.URLError("boom")

    monkeypatch.setattr(snapshot_guard.urllib.request, "urlopen", fake_urlopen)
    assert snapshot_guard.fetch_public_v2_snapshot_days("https://example.test/v2/rankings.json") is None


def test_fetch_public_v2_snapshot_days_returns_none_on_malformed_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_urlopen(url: str, timeout: int = 30) -> _FakeResponse:
        return _FakeResponse(b"not json")

    monkeypatch.setattr(snapshot_guard.urllib.request, "urlopen", fake_urlopen)
    assert snapshot_guard.fetch_public_v2_snapshot_days("https://example.test/v2/rankings.json") is None


def test_fetch_public_v2_snapshot_days_returns_none_without_meta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_urlopen(url: str, timeout: int = 30) -> _FakeResponse:
        return _FakeResponse(json.dumps({"characters": []}).encode("utf-8"))

    monkeypatch.setattr(snapshot_guard.urllib.request, "urlopen", fake_urlopen)
    assert snapshot_guard.fetch_public_v2_snapshot_days("https://example.test/v2/rankings.json") is None


# ---------------------------------------------------------------------------
# fetch_release_snapshot_days
# ---------------------------------------------------------------------------


def test_fetch_release_snapshot_days_none_when_asset_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        release_store, "download_current_asset", lambda dest_path, tag=None: False
    )
    assert snapshot_guard.fetch_release_snapshot_days() is None


def test_fetch_release_snapshot_days_reads_snapshot_days_from_downloaded_asset(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    release_db = tmp_path / "release.db"
    _build_db(release_db, {d: 5 for d in _consecutive_dates(12)})
    assert count_snapshot_dates(release_db) == 12

    def fake_download(dest_path: Path, tag: str = release_store.DB_STORE_TAG) -> bool:
        dest_path = Path(dest_path)
        with open(release_db, "rb") as src, gzip.open(dest_path, "wb") as dst:
            dst.write(src.read())
        return True

    monkeypatch.setattr(release_store, "download_current_asset", fake_download)
    assert snapshot_guard.fetch_release_snapshot_days() == 12


def test_fetch_release_snapshot_days_none_on_ambiguous_download_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An ambiguous gh failure must not crash the whole guard: this baseline is
    optional (§2.4 item 2, "利用可能なら"), so we degrade to None (-> the other
    bases, ultimately the absolute floor) rather than propagate. This does not
    weaken INV-2 because this helper never calls upload_asset (read-only)."""

    def fake_download(dest_path: Path, tag: str = release_store.DB_STORE_TAG) -> bool:
        raise release_store.ReleaseStoreError("429 rate limit exceeded")

    monkeypatch.setattr(release_store, "download_current_asset", fake_download)
    assert snapshot_guard.fetch_release_snapshot_days() is None


# ---------------------------------------------------------------------------
# restore_method_label
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cache_hit", "release_restored", "pages_imported", "v2_imported", "expected"),
    [
        (True, False, 0, 0, "cache"),
        (False, True, 0, 0, "release"),
        (False, False, 3, 0, "v1"),
        (False, False, 0, 4, "v2"),
        (True, True, 2, 1, "cache+release+v1+v2"),
        (False, False, 0, 0, "unknown(no-restore-layer-signal)"),
    ],
)
def test_restore_method_label(
    cache_hit: bool,
    release_restored: bool,
    pages_imported: int,
    v2_imported: int,
    expected: str,
) -> None:
    assert (
        snapshot_guard.restore_method_label(
            cache_hit=cache_hit,
            release_restored=release_restored,
            pages_imported=pages_imported,
            v2_imported=v2_imported,
        )
        == expected
    )


# ---------------------------------------------------------------------------
# check_snapshot_integrity
# ---------------------------------------------------------------------------


def test_check_snapshot_integrity_passes_on_healthy_db(tmp_path: Path) -> None:
    """S1: 通常時は十分な履歴・安定した行数があり、ガードは発火しない。"""
    db_path = tmp_path / "ranking.db"
    dates = _consecutive_dates(35)
    _build_db(db_path, {d: 100 for d in dates})

    census = snapshot_guard.check_snapshot_integrity(
        db_path,
        method="cache",
        v2_meta_url="https://example.test/v2/rankings.json",
        fetch_public_v2_days=lambda url: 35,
        fetch_release_days=lambda: None,
    )
    assert census.snapshot_days == 35
    assert census.expected_min_days == 35 - snapshot_guard.SNAPSHOT_DAYS_TOLERANCE


def test_check_snapshot_integrity_fires_when_days_below_public_v2_basis(
    tmp_path: Path,
) -> None:
    """S4 相当: cache miss + Release不達 + v2不完全 -> 復元後の日数が公開中の
    v2 meta より大きく不足している。"""
    db_path = tmp_path / "ranking.db"
    dates = _consecutive_dates(5)
    _build_db(db_path, {d: 100 for d in dates})

    with pytest.raises(snapshot_guard.SnapshotGuardError, match="snapshot_days=5"):
        snapshot_guard.check_snapshot_integrity(
            db_path,
            method="v2",
            v2_meta_url="https://example.test/v2/rankings.json",
            fetch_public_v2_days=lambda url: 90,
            fetch_release_days=lambda: None,
        )


def test_check_snapshot_integrity_fails_closed_when_both_external_bases_unavailable(
    tmp_path: Path,
) -> None:
    """是正(統括レビュー, T12 P3 commit 1/7 検収): 公開v2 meta と Release
    baseline の両方が取得できない場合は、絶対最低30日だけを根拠に判定を通しては
    ならない(§2.4 第4基準「信頼できる基準値がどれも取得できない場合は
    fail-closed」)。これは日数の多寡に関係なく発火する -- ここでは意図的に
    90日分(絶対最低ラインを大きく超える量)を用意してもなお発火することを
    確認する(=「基準が無いから通す」の禁止そのものを検証する)。"""
    db_path = tmp_path / "ranking.db"
    _build_db(db_path, {d: 100 for d in _consecutive_dates(90)})

    with pytest.raises(
        snapshot_guard.SnapshotGuardError,
        match="no reliable snapshot_days basis available",
    ):
        snapshot_guard.check_snapshot_integrity(
            db_path,
            method="unknown(no-restore-layer-signal)",
            v2_meta_url="https://example.test/v2/rankings.json",
            fetch_public_v2_days=lambda url: None,
            fetch_release_days=lambda: None,
        )


def test_check_snapshot_integrity_judges_normally_with_only_one_real_basis(
    tmp_path: Path,
) -> None:
    """片方だけ実基準が取得できた場合は、従来どおり
    max(実基準, 30) - tolerance で判定する(fail-closed にはならない)。"""
    db_path = tmp_path / "ranking.db"
    # v2_public=60, release=None -> expected_min_days = max(60, 30) - 2 = 58.
    _build_db(db_path, {d: 100 for d in _consecutive_dates(57)})

    with pytest.raises(snapshot_guard.SnapshotGuardError, match="snapshot_days=57"):
        snapshot_guard.check_snapshot_integrity(
            db_path,
            method="release",
            v2_meta_url="https://example.test/v2/rankings.json",
            fetch_public_v2_days=lambda url: 60,
            fetch_release_days=lambda: None,
        )


def test_check_snapshot_integrity_absolute_floor_still_applies_when_real_basis_is_smaller(
    tmp_path: Path,
) -> None:
    """実基準が絶対最低ライン(30日)より小さくても、30日は追加の下限として
    維持される(実基準の値だけを採用してはならない、§2.4 第3基準)。"""
    db_path = tmp_path / "ranking.db"

    # v2_public=10 (< floor 30), so expected_min_days must still be
    # max(10, 30) - 2 = 28, not max(10) - 2 = 8.
    _build_db(db_path, {d: 100 for d in _consecutive_dates(27)})
    with pytest.raises(snapshot_guard.SnapshotGuardError, match="snapshot_days=27"):
        snapshot_guard.check_snapshot_integrity(
            db_path,
            method="unknown(no-restore-layer-signal)",
            v2_meta_url="https://example.test/v2/rankings.json",
            fetch_public_v2_days=lambda url: 10,
            fetch_release_days=lambda: None,
        )


def test_check_snapshot_integrity_passes_at_absolute_floor_boundary(tmp_path: Path) -> None:
    db_path = tmp_path / "ranking.db"
    # 28 days == floor(30) - tolerance(2): boundary, must pass (not "<").
    # A real basis (v2_public=30) must be present -- with both external bases
    # unavailable this would now fail-closed regardless of day count (see
    # test_check_snapshot_integrity_fails_closed_when_both_external_bases_unavailable).
    _build_db(db_path, {d: 100 for d in _consecutive_dates(28)})
    census = snapshot_guard.check_snapshot_integrity(
        db_path,
        method="release",
        v2_meta_url="https://example.test/v2/rankings.json",
        fetch_public_v2_days=lambda url: None,
        fetch_release_days=lambda: 30,
    )
    assert census.snapshot_days == 28


def test_check_snapshot_integrity_uses_larger_of_public_v2_and_release_basis(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "ranking.db"
    # 45 days is enough for the v2-public basis (20) but not for the (larger)
    # Release basis (50) once the -2 tolerance is applied (50-2=48 > 45).
    _build_db(db_path, {d: 100 for d in _consecutive_dates(45)})
    with pytest.raises(snapshot_guard.SnapshotGuardError, match="snapshot_days=45"):
        snapshot_guard.check_snapshot_integrity(
            db_path,
            method="release",
            v2_meta_url="https://example.test/v2/rankings.json",
            fetch_public_v2_days=lambda url: 20,
            fetch_release_days=lambda: 50,
        )


def test_check_snapshot_integrity_fires_when_latest_day_rows_truncated(
    tmp_path: Path,
) -> None:
    """S4 相当(別軸): 日数は十分でも、最新日だけがシャード欠落/部分マージで
    大きく truncate されているケースを行数比率で検出する。"""
    db_path = tmp_path / "ranking.db"
    # Enough days (35 >= floor(30)-tolerance(2)=28) that only the row-ratio
    # check -- not the day-count check -- is exercised here.
    dates = _consecutive_dates(35)
    day_counts = {d: 100 for d in dates[:-1]}
    day_counts[dates[-1]] = 40  # 40% of the recent average -> below 90% floor
    _build_db(db_path, day_counts)

    with pytest.raises(snapshot_guard.SnapshotGuardError, match="latest_day_rows=40"):
        snapshot_guard.check_snapshot_integrity(
            db_path,
            method="v2",
            v2_meta_url="https://example.test/v2/rankings.json",
            fetch_public_v2_days=lambda url: 35,
            fetch_release_days=lambda: None,
        )


def test_check_snapshot_integrity_tolerates_normal_daily_row_variation(
    tmp_path: Path,
) -> None:
    """健全な日次変動(引退/新規参入による数%のブレ)は誤検知しない。"""
    db_path = tmp_path / "ranking.db"
    dates = _consecutive_dates(35)
    day_counts = {d: 100 for d in dates[:-1]}
    day_counts[dates[-1]] = 95  # 95% of recent average -> within tolerance
    _build_db(db_path, day_counts)

    census = snapshot_guard.check_snapshot_integrity(
        db_path,
        method="v2",
        v2_meta_url="https://example.test/v2/rankings.json",
        fetch_public_v2_days=lambda url: 35,
        fetch_release_days=lambda: None,
    )
    assert census.latest_day_rows == 95


# ---------------------------------------------------------------------------
# main.py wiring: bootstrap_database return value + enforce_snapshot_integrity_guard
# ---------------------------------------------------------------------------


def test_bootstrap_database_reports_import_counts_for_method_label(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """挙動不変の確認: 既存の import 呼び出し結果を戻り値として露出するだけで、
    デフォルト設定(seed/v2 いずれもインポートなし)では 0/0 になる。
    T12 P4: v1(Pages) インポート層は撤去済み(pages_imported は常に 0)。"""
    db_path = tmp_path / "ranking.db"

    monkeypatch.setattr(main.config, "resolve_snapshot_import_path", lambda _db: None)
    monkeypatch.setattr(main.config, "snapshot_import_from_v2_shards", lambda: False)

    import logging

    restore_info = main.bootstrap_database(db_path, logging.getLogger(__name__))
    assert restore_info == {"pages_imported": 0, "v2_imported": 0}


def test_enforce_snapshot_integrity_guard_propagates_guard_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """main.py 側の呼び出し口が SnapshotGuardError を握り潰さず伝播させることを
    確認する(main() が最終的に sys.exit(1) するための前提)。"""
    db_path = tmp_path / "ranking.db"

    def fake_check(db_path_arg, *, method, v2_meta_url, **_kwargs):
        raise snapshot_guard.SnapshotGuardError("synthetic guard failure for test")

    monkeypatch.setattr(main, "check_snapshot_integrity", fake_check)

    import logging

    with pytest.raises(snapshot_guard.SnapshotGuardError):
        main.enforce_snapshot_integrity_guard(
            db_path,
            logging.getLogger(__name__),
            {"pages_imported": 0, "v2_imported": 0},
        )


def test_enforce_snapshot_integrity_guard_passes_computed_method(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "ranking.db"
    captured: dict[str, object] = {}

    def fake_check(db_path_arg, *, method, v2_meta_url, **_kwargs):
        captured["method"] = method
        captured["v2_meta_url"] = v2_meta_url
        return snapshot_guard.SnapshotCensus(
            method=method,
            snapshot_days=0,
            total_rows=0,
            latest_date=None,
            latest_day_rows=0,
            recent_avg_rows=None,
            expected_min_days=0,
            v2_public_days=None,
            release_days=None,
        )

    monkeypatch.setattr(main, "check_snapshot_integrity", fake_check)
    monkeypatch.setattr(main.config, "restore_cache_hit", lambda: False)
    monkeypatch.setattr(main.config, "restore_release_restored", lambda: True)

    import logging

    main.enforce_snapshot_integrity_guard(
        db_path,
        logging.getLogger(__name__),
        {"pages_imported": 0, "v2_imported": 3},
    )
    assert captured["method"] == "release+v2"
