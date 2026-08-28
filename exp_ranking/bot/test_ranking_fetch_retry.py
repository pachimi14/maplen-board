from __future__ import annotations

import logging

import config
import main


def _page(start_rank: int, level: int = 250) -> list[dict]:
    return [
        {"rank": rank, "level": level, "characterName": f"Character{rank}"}
        for rank in range(start_rank, start_rank + main.API_MAX_PAGE_SIZE)
    ]


def test_429_waits_ten_minutes_and_resumes_failed_page(monkeypatch) -> None:
    requested_pages: list[int] = []
    sleep_calls: list[float] = []
    page_two_attempts = 0

    def fake_fetch(_session, page_no: int):
        nonlocal page_two_attempts
        requested_pages.append(page_no)
        if page_no == 1:
            return 200, _page(1), ""
        if page_no == 2:
            page_two_attempts += 1
            if page_two_attempts == 1:
                return 429, [], "rate limited"
            return 200, _page(11), ""
        return 200, _page(21, level=224), ""

    monkeypatch.setattr(main, "_make_session", object)
    monkeypatch.setattr(main, "_fetch_ranking_page", fake_fetch)
    monkeypatch.setattr(main.time, "sleep", sleep_calls.append)

    ranking = main.fetch_ranking_min_level(
        min_level=225,
        request_delay_sec=0.8,
        max_pages=10,
    )

    assert requested_pages == [1, 2, 2, 3]
    assert [row["rank"] for row in ranking] == list(range(1, 21))
    assert main.RATE_LIMIT_RETRY_WAIT_SEC in sleep_calls
    assert sleep_calls.count(main.RATE_LIMIT_RETRY_WAIT_SEC) == 1
    assert 1.5 in sleep_calls


def test_ranking_request_delay_defaults_to_point_eight(monkeypatch) -> None:
    monkeypatch.delenv("RANKING_REQUEST_DELAY_SEC", raising=False)
    assert config.ranking_request_delay_sec() == 0.8


def test_update_probe_waits_for_changed_first_page(monkeypatch) -> None:
    baseline = [
        (rank, f"Character{rank}", 250, rank * 100)
        for rank in range(1, main.API_MAX_PAGE_SIZE + 1)
    ]
    unchanged = [
        {
            "rank": rank,
            "characterName": f"Character{rank}",
            "level": 250,
            "exp": rank * 100,
        }
        for rank in range(1, main.API_MAX_PAGE_SIZE + 1)
    ]
    changed = [dict(entry) for entry in unchanged]
    changed[0]["exp"] += 1
    # Third response is the deep-page probe (condition②) fired once page 1
    # differs from baseline; a rebuild-complete page (max level >= min_level).
    deep_page_ready = [{"rank": 1, "characterName": "Deep", "level": 225, "exp": 1}]
    responses = iter(
        [(200, unchanged, ""), (200, changed, ""), (200, deep_page_ready, "")]
    )
    sleep_calls: list[float] = []

    monkeypatch.setattr(main, "_make_session", object)
    monkeypatch.setattr(main, "_fetch_ranking_page", lambda *_args: next(responses))
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
    assert sleep_calls == [45, 45]


def test_freshness_rejects_unchanged_previous_snapshot() -> None:
    baseline = [(1, "Same", 250, 123)]
    ranking = [{"rank": 1, "characterName": "Same", "level": 250, "exp": 123}]

    try:
        main.validate_ranking_freshness(ranking, baseline, min_changed=1)
    except RuntimeError as exc:
        assert "appears stale" in str(exc)
    else:
        raise AssertionError("stale ranking was accepted")


def test_freshness_accepts_changed_snapshot() -> None:
    baseline = [(1, "Same", 250, 123)]
    ranking = [{"rank": 1, "characterName": "Same", "level": 250, "exp": 124}]

    assert main.validate_ranking_freshness(ranking, baseline, min_changed=1) == 1


def test_warn_if_ranking_cap_reached_fires_at_cap(caplog) -> None:
    max_pages = 2
    cap = max_pages * main.API_MAX_PAGE_SIZE  # 20
    ranking = _page(1) + _page(11)  # exactly 20 entries -> at the cap
    logger = logging.getLogger("test_ranking_cap")

    with caplog.at_level(logging.WARNING, logger="test_ranking_cap"):
        main.warn_if_ranking_cap_reached(ranking, max_pages, logger)

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    message = warnings[0].getMessage()
    assert str(cap) in message
    assert str(len(ranking)) in message
    assert "RANKING_MAX_PAGES" in message


def test_warn_if_ranking_cap_reached_silent_below_cap(caplog) -> None:
    max_pages = 2
    ranking = _page(1) + _page(11)[:9]  # 19 entries, one short of the cap (20)
    logger = logging.getLogger("test_ranking_cap")

    with caplog.at_level(logging.WARNING, logger="test_ranking_cap"):
        main.warn_if_ranking_cap_reached(ranking, max_pages, logger)

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == []
