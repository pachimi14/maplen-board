"""Unit tests for daily_fetch gates and helpers (no network, no gh)."""

from __future__ import annotations

from datetime import datetime

import daily_fetch as df


def _ok(**kw):
    base = dict(main_rc=0, expected_day="2026-11-22", latest_day="2026-11-22",
                expected_day_rows=10601, days_after=88)
    base.update(kw)
    return df.GateInput(**base)


def test_gates_pass():
    assert df.evaluate_gates(_ok()) == []


def test_each_gate_blocks_alone():
    cases = {
        "G1": _ok(main_rc=1),
        "G2": _ok(latest_day="2026-11-21"),
        "G3": _ok(expected_day_rows=9999),
        "G4a": _ok(days_after=84),
    }
    for gate, g in cases.items():
        failed = df.evaluate_gates(g)
        assert len(failed) == 1 and failed[0].startswith(gate), (gate, failed)


def test_g2_none_latest_blocks():
    assert df.evaluate_gates(_ok(latest_day=None))[0].startswith("G2")


def test_g3_boundary_ok():
    assert df.evaluate_gates(_ok(expected_day_rows=10_000)) == []


def test_g4a_real_numbers_shrunk_db_passes():
    # measured: Release holds 173 days, main.py's 90-day retention leaves ~88
    assert df.evaluate_gates(_ok(days_after=88)) == []
    assert df.evaluate_gates(_ok(days_after=85)) == []
    assert df.evaluate_gates(_ok(days_after=84))[0].startswith("G4a")


def test_g4b_post_sync():
    assert df.evaluate_post_sync(173, 173, True, 623712) == []
    assert df.evaluate_post_sync(173, 174, True, 10) == []
    assert df.evaluate_post_sync(173, 172, True, 10)[0].startswith("G4b")
    assert df.evaluate_post_sync(173, 173, True, 0)[0].startswith("G4b")
    assert df.evaluate_post_sync(0, 88, False, 0) == []


def test_extract_latest_snapshot_date():
    head = '{"meta":{"updatedAt":"x","snapshotDays":87,"latestSnapshotDate":"2026-11-21","r'
    assert df.extract_latest_snapshot_date(head) == "2026-11-21"
    assert df.extract_latest_snapshot_date('{"meta":{"snapshotDays":8') is None


def test_should_wait_for_update_window():
    assert df.should_wait_for_update(datetime(2026, 11, 23, 9, 5))
    assert df.should_wait_for_update(datetime(2026, 11, 23, 10, 29))
    assert not df.should_wait_for_update(datetime(2026, 11, 23, 10, 30))
    assert not df.should_wait_for_update(datetime(2026, 11, 23, 13, 0))
    assert not df.should_wait_for_update(datetime(2026, 11, 23, 8, 59))


def test_marker_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    p = df.write_failure_marker("2026-11-22", "boom\nmulti line", tmp_path / "x.log")
    assert p.name == "LULUMI_FETCH_FAILED_2026-11-22.txt"
    assert p.read_text(encoding="utf-8").splitlines()[0] == "boom multi line"
    df.clear_failure_marker("2026-11-22")
    assert not p.exists()
    df.clear_failure_marker("2026-11-22")  # idempotent


def test_main_env_never_forces_fetch(monkeypatch):
    monkeypatch.setenv("FORCE_RANKING_FETCH", "true")
    env = df.build_main_env({"GH_TOKEN": "t", "GH_REPO": "o/r"}, datetime(2026, 11, 23, 13, 0))
    assert env["FORCE_RANKING_FETCH"] == "" and env["ENFORCE_JST_FETCH_WINDOW"] == ""
    assert env["RANKING_MAX_PAGES"] == "2000" and env["SKIP_RUN_IF_RANKING_DAY_EXISTS"] == "true"


def test_force_fetch_only_when_requested():
    env = df.build_main_env({}, datetime(2026, 11, 23, 9, 5), force_fetch=True)
    assert env["FORCE_RANKING_FETCH"] == "true"
