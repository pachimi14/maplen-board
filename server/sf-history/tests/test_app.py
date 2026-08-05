from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from starlette.requests import Request

import aggregate
import app as app_module
import db


def _request(origin: str | None = None) -> Request:
    headers = []
    if origin is not None:
        headers.append((b"origin", origin.encode("utf-8")))
    return Request(
        {"type": "http", "method": "GET", "path": "/", "raw_path": b"/", "headers": headers, "app": app_module.app}
    )


ITEMS: dict[str, Any] = {
    "generatedAt": "2026-08-05T00:00:00Z",
    "sourceRepo": "maplenEnhancebot",
    "sourceCommit": "abc",
    "excluded": [{"itemId": 1113282, "reason": "test reason"}],
    "items": [
        {
            "itemId": 1001,
            "itemName": "Full 22",
            "aliasItemIds": [1001, 1099],
            "aliases": [
                {"itemId": 1001, "itemName": "Full 22"},
                {"itemId": 1099, "itemName": "Full 22 Alias"},
            ],
        },
        {"itemId": 1002, "itemName": "Capped 20", "aliasItemIds": [1002], "aliases": [{"itemId": 1002, "itemName": "Capped 20"}]},
    ],
}


def _write_items(tmp_path: Path) -> Path:
    path = tmp_path / "items.json"
    path.write_text(json.dumps(ITEMS), encoding="utf-8")
    return path


# SH-7 fix (pre-existing flake, unrelated to this slice -- see completion
# report): these used to be the literal "2026-03-08T00:00:00Z"/"...04:00:00Z"
# strings. `prices()` filters to a rolling "now - 150 days" window, and by
# the time this suite ran on 2026-08-05's real clock, that literal date had
# already drifted outside the window (150 days + a few hours), independently
# of anything in this slice -- confirmed by reproducing the failure on the
# pre-SH-7 code. Anchoring the seed to "N days ago" keeps it inside the
# window regardless of when the suite runs.
SEED_BUCKET_START = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")
SEED_BUCKET_PLUS_4H = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%dT04:00:00Z")


def _seed_db(db_path: Path) -> None:
    conn = db.connect(db_path)
    db.apply_schema(conn)
    # item 1001: full 22, two 4h points at upgrade 0.
    db.replace_4h_rows(
        conn, 1001, 0,
        [
            {"price_at": SEED_BUCKET_START, "end_price": 100.0, "source_hour_at": SEED_BUCKET_START, "generated_at": "2026-08-05T01:00:00Z"},
            {"price_at": SEED_BUCKET_PLUS_4H, "end_price": 110.0, "source_hour_at": SEED_BUCKET_PLUS_4H, "generated_at": "2026-08-05T01:00:00Z"},
        ],
    )
    # give item 1001 real hourly data through upgrade 21 (so maxStar == 22).
    for upgrade in range(22):
        db.upsert_hourly_rows(
            conn, 1001, upgrade,
            [{"date": SEED_BUCKET_START, "endPrice": 1.0, "sumEnhanceCnt": 0}],
            "2026-08-05T00:00:00Z",
        )
    # item 1002: hourly data only through upgrade 19 -- maxStar should be 20.
    for upgrade in range(20):
        db.upsert_hourly_rows(
            conn, 1002, upgrade,
            [{"date": SEED_BUCKET_START, "endPrice": 1.0, "sumEnhanceCnt": 0}],
            "2026-08-05T00:00:00Z",
        )
    conn.close()


@pytest.fixture()
def _env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    _seed_db(db_path)
    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None
    return db_path


def test_health(_env: Path) -> None:
    response = app_module.health(_request())
    assert response.status_code == 200
    assert json.loads(response.body) == {"status": "ok"}


def test_equipment_reports_data_derived_max_star(_env: Path) -> None:
    response = app_module.equipment(_request())
    body = json.loads(response.body)
    by_id = {row["itemId"]: row for row in body["items"]}
    assert by_id[1001]["maxStar"] == 22
    assert by_id[1002]["maxStar"] == 20
    assert body["excluded"] == ITEMS["excluded"]
    assert by_id[1001]["aliasItemIds"] == [1001, 1099]
    # IMPL_PLAN_SH9 §3-2: `aliases` (itemId + itemName) passes straight
    # through from data/sf_history_items.json, unmodified.
    assert by_id[1001]["aliases"] == ITEMS["items"][0]["aliases"]
    assert by_id[1002]["aliases"] == ITEMS["items"][1]["aliases"]


def test_equipment_aliases_defaults_to_empty_list_for_stale_items_json(
    _env: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A data/sf_history_items.json generated before SH9 has no `aliases`
    key at all -- the response must not crash, just omit alias names."""
    items_path = tmp_path / "stale_items.json"
    items_path.write_text(
        json.dumps(
            {
                "generatedAt": "2026-08-05T00:00:00Z",
                "sourceRepo": "maplenEnhancebot",
                "sourceCommit": "abc",
                "excluded": [],
                "items": [{"itemId": 1001, "itemName": "Full 22", "aliasItemIds": [1001, 1099]}],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None
    response = app_module.equipment(_request())
    body = json.loads(response.body)
    assert body["items"][0]["aliases"] == []


def test_prices_unknown_item_id_is_404(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="999999")
    assert response.status_code == 404


def test_prices_non_integer_item_id_is_400(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="not-a-number")
    assert response.status_code == 400


def test_prices_missing_item_id_is_400(_env: Path) -> None:
    response = app_module.prices(_request(), itemId=None)
    assert response.status_code == 400


def test_prices_shape_and_null_slots(_env: Path) -> None:
    response = app_module.prices(_request(), itemId="1001")
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["itemId"] == 1001
    assert body["interval"] == "4h"
    assert body["labelIs"] == "bucketStart"
    assert body["upgradeCount"] == 22
    assert len(body["points"]) == 2
    first = body["points"][0]
    assert first["date"] == SEED_BUCKET_START
    assert first["prices"][0] == 100.0
    assert first["prices"][1] is None  # design §9.1/§10: missing star -> null
    assert len(first["prices"]) == 22


def test_prices_filters_to_display_window(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    old_generated = (datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.replace_4h_rows(
        conn, 1001, 0,
        [
            {"price_at": "2020-01-01T00:00:00Z", "end_price": 1.0, "source_hour_at": "2020-01-01T00:00:00Z", "generated_at": old_generated},
            {"price_at": (datetime.now(timezone.utc)).strftime("%Y-%m-%dT00:00:00Z"), "end_price": 2.0, "source_hour_at": "x", "generated_at": old_generated},
        ],
    )
    conn.close()

    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None

    response = app_module.prices(_request(), itemId="1001")
    body = json.loads(response.body)
    assert len(body["points"]) == 1  # the 2020 point is outside the 150-day window
    assert body["points"][0]["prices"][0] == 2.0


def test_cors_allows_configured_origin(_env: Path) -> None:
    response = app_module.equipment(_request("https://lulumi-tools.com"))
    assert response.headers["access-control-allow-origin"] == "https://lulumi-tools.com"


def test_cors_rejects_other_origins(_env: Path) -> None:
    response = app_module.equipment(_request("https://evil.example"))
    assert response.headers["access-control-allow-origin"] != "https://evil.example"


def test_cors_is_configurable_via_env(_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SF_HISTORY_ALLOWED_ORIGINS", "https://other.example")
    response = app_module.equipment(_request("https://other.example"))
    assert response.headers["access-control-allow-origin"] == "https://other.example"


def test_latest_returns_upstream_result(_env: Path) -> None:
    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": "2026-08-05T00:00:00Z", "prices": [1.0] + [None] * 21}

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.latest(_request(), itemId="1001")
        body = json.loads(response.body)
        assert body["itemId"] == 1001
        assert body["prices"][0] == 1.0
    finally:
        app_module.app.state.latest_cache = app_module.LatestPriceCache()


def test_latest_upstream_failure_is_503_not_a_historical_fallback(_env: Path) -> None:
    class FailingCache:
        def get(self, item_id: int) -> dict[str, Any]:
            raise app_module.UpstreamLatestError("boom")

    app_module.app.state.latest_cache = FailingCache()
    try:
        response = app_module.latest(_request(), itemId="1001")
        assert response.status_code == 503
        body = json.loads(response.body)
        assert "prices" not in body  # no historical fallback value is ever substituted in
    finally:
        app_module.app.state.latest_cache = app_module.LatestPriceCache()


def test_prices_appends_a_provisional_point_from_the_shared_latest_cache(_env: Path) -> None:
    """SH-7 (b)/(3-1): the provisional point's `prices` come from the same
    `LatestPriceCache` `/sf-history/latest` uses, and `endDate`/(c) is
    untouched by it."""

    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": "now", "prices": [999.0] + [None] * 21}

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        assert response.status_code == 200
        body = json.loads(response.body)

        provisional_points = [p for p in body["points"] if p.get("provisional") is True]
        assert len(provisional_points) == 1  # (b): exactly one
        assert provisional_points[0]["prices"][0] == 999.0
        assert body["provisionalDate"] == provisional_points[0]["date"]

        confirmed_points = [p for p in body["points"] if not p.get("provisional")]
        assert len(confirmed_points) == 2  # the two seeded confirmed buckets, untouched
        assert body["endDate"] == SEED_BUCKET_PLUS_4H  # (c): last CONFIRMED bucket, not the provisional date
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_prices_provisional_point_carries_asOf_from_latestUpdatedAt(_env: Path) -> None:
    """IMPL_PLAN_SH17 §3/§1 (reverses IMPL_PLAN_SH16's "draw at asOf" fix,
    per the 2026-08-05 user decision): the still-open bucket's point is
    drawn at its own bucket-start `date` -- never at `asOf` -- while still
    carrying `asOf` (the shared `latest` cache's own `latestUpdatedAt`, the
    same value `/sf-history/latest` returns) so the frontend can show "now"
    as this point's displayed *time* without moving its *position*. There is
    no `current` flag any more (SH-17 §1: "現在値の独立点... 廃止")."""

    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": "2026-08-05T01:40:00Z", "prices": [999.0] + [None] * 21}

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        body = json.loads(response.body)
        provisional_points = [p for p in body["points"] if p.get("provisional") is True]
        assert len(provisional_points) == 1
        assert provisional_points[0]["asOf"] == "2026-08-05T01:40:00Z"
        current_bucket_start = aggregate.bucket_start(app_module._format_iso_utc(datetime.now(timezone.utc)))
        assert provisional_points[0]["date"] == current_bucket_start  # (b): position is the bucket start, not asOf
        assert "current" not in provisional_points[0]  # (a): the `current: true` point is gone

        # (b): confirmed points never carry `asOf` -- 0 of them do.
        confirmed_points = [p for p in body["points"] if not p.get("provisional")]
        assert all("asOf" not in p for p in confirmed_points)
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_prices_provisional_point_omits_asOf_when_upstream_did_not_provide_one(_env: Path) -> None:
    """IMPL_PLAN_SH8 §2-1: "無い数字を発明しない" -- if the shared cache's
    `latestUpdatedAt` is missing/None, `asOf` must be omitted entirely,
    never invented. `date` is always the in-progress bucket's own start
    (IMPL_PLAN_SH17 §3), with or without `asOf`."""

    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": None, "prices": [999.0] + [None] * 21}

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        body = json.loads(response.body)
        provisional_points = [p for p in body["points"] if p.get("provisional") is True]
        assert len(provisional_points) == 1
        assert "asOf" not in provisional_points[0]
        current_bucket_start = aggregate.bucket_start(app_module._format_iso_utc(datetime.now(timezone.utc)))
        assert provisional_points[0]["date"] == current_bucket_start
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_prices_in_progress_bucket_merges_hourly_and_live_into_one_point(_env: Path) -> None:
    """IMPL_PLAN_SH17 §1/§3: the still-open (in-progress) bucket produces
    exactly ONE point -- not the two IMPL_PLAN_SH16 used to split it into.
    When the shared `latest` cache is available, its value (not the
    hourly-derived one) wins, still drawn at the bucket's own start, tagged
    with `asOf`. Reproduces the ticket's point sequence: confirmed ->
    elapsed-provisional -> unified in-progress point (no separate `current`
    point any more)."""
    now = datetime.now(timezone.utc)
    current_bucket_start = aggregate.bucket_start(app_module._format_iso_utc(now))
    hourly_inside_current_bucket = aggregate.format_iso_utc(
        aggregate.parse_iso_utc(current_bucket_start) + timedelta(hours=1)
    )

    conn = db.connect(_env)
    for upgrade in range(22):
        db.upsert_hourly_rows(
            conn, 1001, upgrade,
            [{"date": hourly_inside_current_bucket, "endPrice": 300.0 + upgrade, "sumEnhanceCnt": 0}],
            "irrelevant",
        )
    before_count = db.count_4h_rows(conn)
    before_hash = aggregate.content_hash(conn)
    conn.close()

    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": "2026-08-05T06:20:00Z", "prices": [999.0] + [None] * 21}

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        assert response.status_code == 200
        body = json.loads(response.body)

        provisional_points = [p for p in body["points"] if p.get("provisional") is True]
        assert len(provisional_points) == 1  # (c): exactly one point for the in-progress bucket

        in_progress_point = provisional_points[0]
        assert in_progress_point["date"] == current_bucket_start  # (b): drawn at the bucket's own start
        assert in_progress_point["prices"][0] == 999.0  # (SH17 §3): value comes from `latest`, not hourly
        assert in_progress_point["asOf"] == "2026-08-05T06:20:00Z"
        assert "current" not in in_progress_point  # (a): no `current: true` flag any more

        current_points = [p for p in body["points"] if p.get("current") is True]
        assert len(current_points) == 0  # (a): the independent `current` point is gone

        assert body["provisionalDate"] == in_progress_point["date"]  # most recent provisional point
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()

    conn = db.connect(_env)
    after_count = db.count_4h_rows(conn)
    after_hash = aggregate.content_hash(conn)
    conn.close()
    assert after_count == before_count  # (f): sf_price_history_4h untouched
    assert after_hash == before_hash


def test_prices_in_progress_bucket_falls_back_to_hourly_when_upstream_fails(_env: Path) -> None:
    """IMPL_PLAN_SH17 §3: "上流失敗時: 未終了の足を出さない(または hourly
    から出す)" -- this exercises the hourly fallback: with hourly data
    already landed inside the still-open bucket's own window but the shared
    `latest` cache raising `UpstreamLatestError`, the unified in-progress
    point is still produced (from hourly), just without `asOf` (never a
    real upstream "as of" instant) -- `prices` still stays 200."""
    now = datetime.now(timezone.utc)
    current_bucket_start = aggregate.bucket_start(app_module._format_iso_utc(now))
    hourly_inside_current_bucket = aggregate.format_iso_utc(
        aggregate.parse_iso_utc(current_bucket_start) + timedelta(hours=1)
    )

    conn = db.connect(_env)
    for upgrade in range(22):
        db.upsert_hourly_rows(
            conn, 1001, upgrade,
            [{"date": hourly_inside_current_bucket, "endPrice": 300.0 + upgrade, "sumEnhanceCnt": 0}],
            "irrelevant",
        )
    conn.close()

    class FailingCache:
        def get(self, item_id: int) -> dict[str, Any]:
            raise app_module.UpstreamLatestError("boom")

    app_module.app.state.latest_cache = FailingCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        assert response.status_code == 200
        body = json.loads(response.body)

        provisional_points = [p for p in body["points"] if p.get("provisional") is True]
        assert len(provisional_points) == 1

        in_progress_point = provisional_points[0]
        assert in_progress_point["date"] == current_bucket_start
        assert in_progress_point["prices"][0] == 300.0  # last hourly end_price inside that bucket
        assert "asOf" not in in_progress_point  # no real upstream "as of" instant available
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_prices_has_no_provisional_point_when_the_current_bucket_is_already_confirmed(_env: Path) -> None:
    """(b): "無いときは0個" -- if a bucket already covers "now" (a fixed,
    far-future-seeded 4h row), there is nothing left to be "in progress"."""
    conn = db.connect(_env)
    now_bucket_start = aggregate.bucket_start(app_module._format_iso_utc(datetime.now(timezone.utc)))
    db.replace_4h_rows(
        conn, 1001, 0,
        [
            {"price_at": SEED_BUCKET_START, "end_price": 100.0, "source_hour_at": SEED_BUCKET_START, "generated_at": "2026-08-05T01:00:00Z"},
            {"price_at": SEED_BUCKET_PLUS_4H, "end_price": 110.0, "source_hour_at": SEED_BUCKET_PLUS_4H, "generated_at": "2026-08-05T01:00:00Z"},
            {"price_at": now_bucket_start, "end_price": 120.0, "source_hour_at": now_bucket_start, "generated_at": "2026-08-05T01:00:00Z"},
        ],
    )
    conn.close()

    class ExplodingCache:
        def get(self, item_id: int) -> dict[str, Any]:
            raise AssertionError("must not be called when the current bucket is already confirmed")

    app_module.app.state.latest_cache = ExplodingCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        body = json.loads(response.body)
        assert body["provisionalDate"] is None
        assert all(not p.get("provisional") for p in body["points"])
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_prices_upstream_failure_degrades_to_200_with_confirmed_history_only(_env: Path) -> None:
    """SH-7 (d): `prices` must 200 with confirmed history even when the
    shared `latest` cache's upstream call fails -- never 503 (design §3-3:
    "prices を 503 にしてはいけない")."""

    class FailingCache:
        def get(self, item_id: int) -> dict[str, Any]:
            raise app_module.UpstreamLatestError("boom")

    app_module.app.state.latest_cache = FailingCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        assert response.status_code == 200  # never 503
        body = json.loads(response.body)
        assert body["provisionalDate"] is None
        assert all(not p.get("provisional") for p in body["points"])
        assert len(body["points"]) == 2  # the confirmed history is intact
        assert body["endDate"] == SEED_BUCKET_PLUS_4H
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()


def test_prices_provisional_point_is_never_persisted_to_the_4h_table(_env: Path) -> None:
    """SH-7 (a)/§0: "保存はしない" -- calling `/sf-history/prices` (which
    appends a provisional point to the *response*) must never change
    `sf_price_history_4h`'s row count or content hash, no matter how many
    times it is called or what the (varying) current price is."""
    conn = db.connect(_env)
    before_count = db.count_4h_rows(conn)
    before_hash = aggregate.content_hash(conn)
    conn.close()

    class VaryingFakeCache:
        def __init__(self) -> None:
            self.calls = 0

        def get(self, item_id: int) -> dict[str, Any]:
            self.calls += 1
            return {"itemId": item_id, "latestUpdatedAt": "now", "prices": [float(self.calls)] + [None] * 21}

    app_module.app.state.latest_cache = VaryingFakeCache()
    try:
        for _ in range(3):
            response = app_module.prices(_request(), itemId="1001")
            assert json.loads(response.body)["points"][-1]["provisional"] is True
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()

    conn = db.connect(_env)
    after_count = db.count_4h_rows(conn)
    after_hash = aggregate.content_hash(conn)
    conn.close()

    assert after_count == before_count
    assert after_hash == before_hash


def test_prices_fills_a_completed_but_unaggregated_bucket_from_hourly_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """IMPL_PLAN_SH13 §2/(b): reproduces the exact real-world gap -- the 4h
    aggregation job has not run for one fully-elapsed bucket. The response
    must fill that bucket from `sf_price_history_hourly` (never written back
    to `sf_price_history_4h`), tagged `provisional`, with the unified
    in-progress-bucket point appended after it (unchanged SH-7 sourcing from
    the shared `latest` cache) -- 3 points, no gap. IMPL_PLAN_SH17 §1/§3: the
    in-progress point's own `date` is the bucket's own start (`current_iso`),
    carrying `asOf` alongside it, not drawn at `asOf` itself (that was
    SH-16's fix; SH-17 reverses just this position choice per the 2026-08-05
    user decision)."""
    items_path = _write_items(tmp_path)
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)

    now = datetime.now(timezone.utc)
    current_bucket = aggregate.parse_iso_utc(aggregate.bucket_start(now.strftime("%Y-%m-%dT%H:%M:%SZ")))
    missing_bucket = current_bucket - timedelta(hours=4)  # fully elapsed, never aggregated
    confirmed_bucket = missing_bucket - timedelta(hours=4)  # already in sf_price_history_4h

    confirmed_iso = aggregate.format_iso_utc(confirmed_bucket)
    missing_iso = aggregate.format_iso_utc(missing_bucket)
    current_iso = aggregate.format_iso_utc(current_bucket)

    db.replace_4h_rows(
        conn, 1001, 0,
        [{"price_at": confirmed_iso, "end_price": 100.0, "source_hour_at": confirmed_iso, "generated_at": "2026-08-05T01:00:00Z"}],
    )
    # Hourly data reaches one hour into the missing (now fully-elapsed, but
    # never re-aggregated) bucket -- the exact shape of the outage this
    # slice fixes.
    hourly_at_missing = aggregate.format_iso_utc(missing_bucket + timedelta(hours=1))
    for upgrade in range(22):
        db.upsert_hourly_rows(
            conn, 1001, upgrade,
            [{"date": hourly_at_missing, "endPrice": 200.0 + upgrade, "sumEnhanceCnt": 0}],
            "irrelevant",
        )
    before_count = db.count_4h_rows(conn)
    before_hash = aggregate.content_hash(conn)
    conn.close()

    monkeypatch.setenv("SF_HISTORY_DB_PATH", str(db_path))
    monkeypatch.setenv("SF_HISTORY_ITEMS_PATH", str(items_path))
    app_module._items_cache = None
    app_module._items_cache_key = None

    class FakeCache:
        def get(self, item_id: int) -> dict[str, Any]:
            return {"itemId": item_id, "latestUpdatedAt": "now-ish", "prices": [999.0] + [None] * 21}

    app_module.app.state.latest_cache = FakeCache()
    try:
        response = app_module.prices(_request(), itemId="1001")
        assert response.status_code == 200
        body = json.loads(response.body)

        # IMPL_PLAN_SH17 §1/§3: the in-progress point's `date` is the
        # bucket's own start (`current_iso`), not `asOf` -- this fixture has
        # no hourly data landing inside the current bucket's own window, so
        # there is only one in-progress point (no separate hourly-derived
        # one either): still exactly 3 points total.
        dates = [p["date"] for p in body["points"]]
        assert dates == [confirmed_iso, missing_iso, current_iso]  # no gap, 4h apart, then the in-progress point

        assert body["endDate"] == confirmed_iso  # (c): last CONFIRMED bucket, unaffected

        provisional_points = [p for p in body["points"] if p.get("provisional") is True]
        assert len(provisional_points) == 2  # (b): one completed-but-unaggregated + one in-progress

        completed, live = provisional_points
        assert completed["date"] == missing_iso
        assert completed["prices"][0] == 200.0  # last hourly end_price inside that bucket
        assert "asOf" not in completed  # SH-13 §2-2: only the in-progress point ever carries asOf
        assert "current" not in completed

        assert live["date"] == current_iso  # (b): date is the bucket start, not asOf (SH-17 reverses SH-16)
        assert live["prices"][0] == 999.0
        assert live["asOf"] == "now-ish"
        assert "current" not in live  # (a): no `current: true` flag any more

        assert body["provisionalDate"] == current_iso  # most recent provisional point
    finally:
        app_module.app.state.latest_cache = app_module._build_latest_cache()

    conn = db.connect(db_path)
    after_count = db.count_4h_rows(conn)
    after_hash = aggregate.content_hash(conn)
    conn.close()
    assert after_count == before_count  # (c): sf_price_history_4h untouched
    assert after_hash == before_hash


def test_latest_cache_publish_interval_defaults_to_1200_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    """IMPL_PLAN_SH15 §4: replaces the old fixed-TTL env var/test -- the
    cache is now built from a publish interval (default 1200s = 20min) and
    a grace period (default 60s), not a single `ttl_seconds`."""
    monkeypatch.delenv("SF_HISTORY_LATEST_PUBLISH_INTERVAL_SECONDS", raising=False)
    cache = app_module._build_latest_cache()
    assert cache._publish_interval_seconds == 1200.0


def test_latest_cache_publish_interval_is_overridable_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SF_HISTORY_LATEST_PUBLISH_INTERVAL_SECONDS", "600")
    cache = app_module._build_latest_cache()
    assert cache._publish_interval_seconds == 600.0


def test_latest_cache_publish_interval_falls_back_to_default_on_a_non_numeric_env_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SF_HISTORY_LATEST_PUBLISH_INTERVAL_SECONDS", "not-a-number")
    cache = app_module._build_latest_cache()
    assert cache._publish_interval_seconds == 1200.0


def test_latest_cache_grace_defaults_to_60_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SF_HISTORY_LATEST_GRACE_SECONDS", raising=False)
    cache = app_module._build_latest_cache()
    assert cache._grace_seconds == 60.0


def test_latest_cache_grace_is_overridable_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SF_HISTORY_LATEST_GRACE_SECONDS", "90")
    cache = app_module._build_latest_cache()
    assert cache._grace_seconds == 90.0


def test_latest_cache_grace_falls_back_to_default_on_a_non_numeric_env_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SF_HISTORY_LATEST_GRACE_SECONDS", "not-a-number")
    cache = app_module._build_latest_cache()
    assert cache._grace_seconds == 60.0


def test_latest_unknown_item_id_is_404_before_touching_cache(_env: Path) -> None:
    class ExplodingCache:
        def get(self, item_id: int) -> dict[str, Any]:
            raise AssertionError("must not be called for an unknown itemId")

    app_module.app.state.latest_cache = ExplodingCache()
    try:
        response = app_module.latest(_request(), itemId="999999")
        assert response.status_code == 404
    finally:
        app_module.app.state.latest_cache = app_module.LatestPriceCache()
