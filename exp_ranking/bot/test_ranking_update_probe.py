"""Tests for the wait_for_ranking_update deep-page (condition②) AND gate.

docs/IMPL_PLAN_vps-trigger.md §3 basis 4-8. These are synthetic/mocked tests
only -- no real API calls (basis 13: at most +1 extra request per probe).
"""
from __future__ import annotations

import main


def _baseline_rows(count: int, *, level: int = 250) -> list[tuple[int, str, int, int]]:
    return [(rank, f"Character{rank}", level, rank * 100) for rank in range(1, count + 1)]


def _page1_signature_entries(
    baseline_rows: list[tuple[int, str, int, int]], *, changed: bool
) -> list[dict]:
    entries = [
        {
            "rank": rank,
            "characterName": name,
            "level": level,
            "exp": exp,
        }
        for rank, name, level, exp in baseline_rows[: main.API_MAX_PAGE_SIZE]
    ]
    if changed:
        entries[0] = dict(entries[0])
        entries[0]["exp"] += 1
    return entries


class _SteppingClock:
    """Deterministic fake for time.monotonic(): advances by `step` each call."""

    def __init__(self, step: float) -> None:
        self._t = 0.0
        self._step = step

    def __call__(self) -> float:
        self._t += self._step
        return self._t


def test_deep_probe_page_uses_baseline_row_count() -> None:
    # basis 8: 前日 8,804件 -> probe page 792 (= int(8804*0.9/10))
    assert main._deep_probe_page(8804) == 792


def test_deep_probe_page_has_a_floor_of_two() -> None:
    assert main._deep_probe_page(0) == 2
    assert main._deep_probe_page(5) == 2


def test_rebuild_incomplete_keeps_waiting_until_timeout(monkeypatch) -> None:
    # basis 4: deep page stays empty (rebuild not finished) -> never detected,
    # keeps polling until the timeout, only +1 request per probe once page 1
    # has changed (basis 13).
    baseline = _baseline_rows(main.API_MAX_PAGE_SIZE)
    probe_page = main._deep_probe_page(len(baseline))
    changed_page1 = _page1_signature_entries(baseline, changed=True)

    fetch_calls: list[int] = []

    def fake_fetch(_session, page_no: int):
        fetch_calls.append(page_no)
        if page_no == 1:
            return 200, changed_page1, ""
        assert page_no == probe_page
        return 200, [], ""  # rebuild still incomplete: deep page empty

    monkeypatch.setattr(main, "_make_session", object)
    monkeypatch.setattr(main, "_fetch_ranking_page", fake_fetch)
    monkeypatch.setattr(main.time, "sleep", lambda *_a: None)
    monkeypatch.setattr(main.time, "monotonic", _SteppingClock(step=10))

    detected = main.wait_for_ranking_update(
        baseline,
        poll_interval_sec=45,
        timeout_sec=25,
        settle_sec=45,
        min_level=225,
    )

    assert detected is False
    # every probe fetched page 1 AND the deep page (page 1 always "changed")
    assert fetch_calls.count(1) == fetch_calls.count(probe_page)
    assert fetch_calls.count(1) >= 2


def test_rebuild_complete_detects_and_settles(monkeypatch) -> None:
    # basis 5: deep page filled with entries >= min_level -> success on the
    # first probe where both conditions hold.
    baseline = _baseline_rows(main.API_MAX_PAGE_SIZE)
    probe_page = main._deep_probe_page(len(baseline))
    changed_page1 = _page1_signature_entries(baseline, changed=True)
    deep_page_ready = [{"rank": 1, "characterName": "Deep", "level": 225, "exp": 1}]

    fetch_calls: list[int] = []

    def fake_fetch(_session, page_no: int):
        fetch_calls.append(page_no)
        if page_no == 1:
            return 200, changed_page1, ""
        assert page_no == probe_page
        return 200, deep_page_ready, ""

    sleep_calls: list[float] = []
    monkeypatch.setattr(main, "_make_session", object)
    monkeypatch.setattr(main, "_fetch_ranking_page", fake_fetch)
    monkeypatch.setattr(main.time, "sleep", sleep_calls.append)
    monkeypatch.setattr(main.time, "monotonic", lambda: 0.0)

    detected = main.wait_for_ranking_update(
        baseline,
        poll_interval_sec=45,
        timeout_sec=1200,
        settle_sec=45,
        min_level=225,
    )

    assert detected is True
    assert fetch_calls == [1, probe_page]  # exactly one probe, +1 request (basis 13)
    assert sleep_calls == [45]  # only the settle sleep, no poll-interval sleep


def test_no_false_positive_when_page1_unchanged(monkeypatch) -> None:
    # basis 6: page 1 identical to baseline -> not detected even though the
    # deep page already looks "rebuild complete". Also proves the deep page
    # is never even fetched when ① fails (extra assurance for basis 13).
    baseline = _baseline_rows(main.API_MAX_PAGE_SIZE)
    probe_page = main._deep_probe_page(len(baseline))
    unchanged_page1 = _page1_signature_entries(baseline, changed=False)
    deep_page_ready = [{"rank": 1, "characterName": "Deep", "level": 225, "exp": 1}]

    fetch_calls: list[int] = []

    def fake_fetch(_session, page_no: int):
        fetch_calls.append(page_no)
        if page_no == 1:
            return 200, unchanged_page1, ""
        return 200, deep_page_ready, ""  # would look "ready" if ever fetched

    monkeypatch.setattr(main, "_make_session", object)
    monkeypatch.setattr(main, "_fetch_ranking_page", fake_fetch)
    monkeypatch.setattr(main.time, "sleep", lambda *_a: None)
    monkeypatch.setattr(main.time, "monotonic", _SteppingClock(step=10))

    detected = main.wait_for_ranking_update(
        baseline,
        poll_interval_sec=45,
        timeout_sec=25,
        settle_sec=45,
        min_level=225,
    )

    assert detected is False
    assert probe_page not in fetch_calls  # deep page never fetched: ① never held
    assert all(page_no == 1 for page_no in fetch_calls)


def test_cold_start_skips_probe_entirely_no_requests(monkeypatch) -> None:
    # basis 7: baseline_rows empty -> no basis to diff for ①, so this
    # returns immediately without any request (② is moot/skipped).
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("no API request should happen with an empty baseline")

    monkeypatch.setattr(main, "_make_session", object)
    monkeypatch.setattr(main, "_fetch_ranking_page", fail_if_called)
    monkeypatch.setattr(main.time, "sleep", fail_if_called)

    detected = main.wait_for_ranking_update(
        [],
        poll_interval_sec=45,
        timeout_sec=1200,
        settle_sec=45,
        min_level=225,
    )

    assert detected is False
