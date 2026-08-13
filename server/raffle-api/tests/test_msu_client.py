from __future__ import annotations

from msu_client import DailyBudgetExceeded, GlobalStartLimiter, MsuClient


def test_global_limiter_keeps_one_second_start_interval() -> None:
    now = [10.0]
    sleeps = []

    def monotonic():
        return now[0]

    def sleeper(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    limiter = GlobalStartLimiter(interval_seconds=1.0, daily_budget=3)
    limiter._last_started = 9.0
    limiter.wait(monotonic=monotonic, sleeper=sleeper)
    now[0] += 0.25
    limiter.wait(monotonic=monotonic, sleeper=sleeper)
    assert sleeps == [0.75]


def test_global_limiter_fails_closed_at_daily_budget() -> None:
    limiter = GlobalStartLimiter(interval_seconds=1.0, daily_budget=1)
    limiter._last_started = 0.0
    limiter.wait(monotonic=lambda: 10.0, sleeper=lambda _seconds: None)
    try:
        limiter.wait(monotonic=lambda: 11.0, sleeper=lambda _seconds: None)
    except DailyBudgetExceeded:
        pass
    else:
        raise AssertionError("budget must fail closed")


def test_character_name_search_uses_navigator_then_canonical_detail(monkeypatch) -> None:
    calls = []

    def fake_request(self, base_url, path, **kwargs):
        calls.append((base_url, path, kwargs))
        return {"records": [{"type": "character", "imageUrl": "https://example.test/search.png", "character": {"characterName": "pachimi", "assetKey": "CHARfixture001"}}]}

    def fake_get_json(self, path):
        calls.append(("official", path, {}))
        return {"success": True, "data": {"character": {"assetKey": "CHARfixture001", "common": {"name": "pachimi", "level": 253, "world": {"code": 2}, "job": {"jobName": "Evan"}}, "image": {"characterImageUrl": "https://example.test/pachimi.png"}}}}

    monkeypatch.setattr(MsuClient, "_request_json", fake_request)
    monkeypatch.setattr(MsuClient, "get_json", fake_get_json)
    client = MsuClient(api_key="test-only", limiter=GlobalStartLimiter())
    result = client.search_character("pachimi")
    assert result == {"assetKey": "CHARfixture001", "displayName": "pachimi", "level": 253, "jobName": "Evan", "worldId": "2", "imageUrl": "https://example.test/pachimi.png"}
    assert calls[0][1].startswith("/navigator/api/navigator/search?")
    assert "keyword=pachimi" in calls[0][1]
    assert calls[0][2]["require_api_key"] is False
    assert calls[1][1] == "/v1rc1/characters/CHARfixture001"


def test_character_name_search_requires_an_exact_character_record(monkeypatch) -> None:
    monkeypatch.setattr(MsuClient, "_request_json", lambda self, base_url, path, **kwargs: {"records": [{"type": "character", "character": {"characterName": "pachimi", "assetKey": "CHARfixture001"}}]})
    client = MsuClient(api_key="test-only", limiter=GlobalStartLimiter())
    assert client.search_character("pachi") is None

def test_transient_upstream_status_is_retried_once(monkeypatch) -> None:
    import json
    import urllib.error

    class RecordingLimiter:
        def __init__(self):
            self.calls = 0

        def wait(self):
            self.calls += 1

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return json.dumps({"success": True, "data": {}}).encode("utf-8")

    attempts = []

    def fake_urlopen(_request, timeout):
        attempts.append(timeout)
        if len(attempts) == 1:
            raise urllib.error.HTTPError("https://openapi.msu.io", 503, "temporary", {}, None)
        return Response()

    limiter = RecordingLimiter()
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = MsuClient(api_key="test-only", limiter=limiter)
    assert client.get_json("/v1rc1/test") == {"success": True, "data": {}}
    assert len(attempts) == 2
    assert limiter.calls == 2