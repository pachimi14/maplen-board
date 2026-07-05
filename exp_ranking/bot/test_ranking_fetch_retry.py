from __future__ import annotations

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


def test_ranking_request_delay_defaults_to_point_eight(monkeypatch) -> None:
    monkeypatch.delenv("RANKING_REQUEST_DELAY_SEC", raising=False)
    assert config.ranking_request_delay_sec() == 0.8
