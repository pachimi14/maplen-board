"""SH-3 §4: FastAPI service for SF price history (server/sf-history/).

Follows `server/img-proxy/`'s structure and conventions (design §5.1: "前例を
発明し直さない"): a small `app.py` wiring routes to a data-access module
(`db.py` here; `proxy_core.py` there), CORS computed per-request from an env
var rather than baked into middleware at import time (same
`cors_origin_for_request`-style pattern as img-proxy's `proxy_core.py`, so
`SF_HISTORY_ALLOWED_ORIGINS` can be read fresh on every request the same way
`IMG_PROXY_ALLOWED_ORIGINS` is), and routes callable directly from tests with
a hand-built `Request` (img-proxy's `tests/test_app.py` pattern) instead of
adding a new `httpx`/`TestClient` dependency (plan §1: "新規依存が必要になっ
た" is a stop condition).

Memory discipline (plan §2 / docs/reports/SH1B_VPS_PROBE.md): 1 uvicorn
worker, no 28-equipment table held in memory -- every request opens its own
SQLite connection, queries only the one itemId it needs, and closes it
before returning.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

import aggregate
import db
import fetch_latest
from fetch_latest import LatestPriceCache, UpstreamLatestError

APP_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = APP_DIR / "data" / "sf_price_history.sqlite"
DEFAULT_ITEMS_PATH = APP_DIR / "data" / "sf_history_items.json"
DEFAULT_ALLOWED_ORIGINS = ("https://lulumi-tools.com",)

DISPLAY_WINDOW_DAYS = 150  # design §10: "4時間足・最大150日"
UPGRADE_COUNT = 22  # itemUpgrade 0..21 (plan §8 condition 6)


def _latest_publish_interval_seconds() -> float:
    """IMPL_PLAN_SH15 §4: `SF_HISTORY_LATEST_PUBLISH_INTERVAL_SECONDS`
    overrides `fetch_latest.DEFAULT_PUBLISH_INTERVAL_SECONDS` (1200s = the
    observed upstream publish cadence). Read once, at cache construction
    time -- unlike the per-request settings above, this value is baked into
    a long-lived `LatestPriceCache` instance's own state, so re-reading the
    env var on every request would not actually change anything after the
    cache has already been built.

    Replaces SH-7 §2's `SF_HISTORY_LATEST_TTL_SECONDS` (a single fixed TTL
    for every entry). That variable is removed outright, not reinterpreted
    as an upper bound: SH-15 §4-3's upper bound (`fetch_latest.
    MAX_TTL_SECONDS`, 1200s / "最大20分") is a hard, non-configurable safety
    rail by design, not something an env var should be able to raise past
    the ceiling the plan calls "必ず守るガード". See README.md.
    """
    raw = os.getenv("SF_HISTORY_LATEST_PUBLISH_INTERVAL_SECONDS")
    if not raw:
        return fetch_latest.DEFAULT_PUBLISH_INTERVAL_SECONDS
    try:
        return float(raw)
    except ValueError:
        return fetch_latest.DEFAULT_PUBLISH_INTERVAL_SECONDS


def _latest_grace_seconds() -> float:
    """IMPL_PLAN_SH15 §4: `SF_HISTORY_LATEST_GRACE_SECONDS` overrides
    `fetch_latest.DEFAULT_GRACE_SECONDS` (60s slack added after
    `latestUpdatedAt + interval`, in case upstream publishes a little late).
    Read once, at cache construction time -- same reasoning as
    `_latest_publish_interval_seconds` above.
    """
    raw = os.getenv("SF_HISTORY_LATEST_GRACE_SECONDS")
    if not raw:
        return fetch_latest.DEFAULT_GRACE_SECONDS
    try:
        return float(raw)
    except ValueError:
        return fetch_latest.DEFAULT_GRACE_SECONDS


def _build_latest_cache() -> LatestPriceCache:
    return LatestPriceCache(
        publish_interval_seconds=_latest_publish_interval_seconds(),
        grace_seconds=_latest_grace_seconds(),
    )


app = FastAPI(title="Lulumi Tools SF price history", docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=500)
app.state.latest_cache = _build_latest_cache()


# --- settings (env read per-request, like img-proxy's proxy_core.load_settings_from_env) ---


def _db_path() -> Path:
    return Path(os.getenv("SF_HISTORY_DB_PATH", str(DEFAULT_DB_PATH)))


def _items_path() -> Path:
    return Path(os.getenv("SF_HISTORY_ITEMS_PATH", str(DEFAULT_ITEMS_PATH)))


def _allowed_origins() -> tuple[str, ...]:
    raw = os.getenv("SF_HISTORY_ALLOWED_ORIGINS")
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    origins = tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())
    return origins or DEFAULT_ALLOWED_ORIGINS


def cors_origin_for_request(request_origin: str | None, allowed_origins: tuple[str, ...]) -> str:
    """Same pattern as img-proxy's `proxy_core.cors_origin_for_request`: always
    return a fixed, allow-listed origin string rather than echoing the
    caller's `Origin` header. A disallowed caller's `Origin` will not match
    this value, so the browser enforces the block even though a header is
    always present.
    """
    if request_origin:
        normalized = request_origin.rstrip("/")
        if normalized in allowed_origins:
            return normalized
    return allowed_origins[0]


def _cors_headers(request: Request) -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": cors_origin_for_request(
            request.headers.get("origin"), _allowed_origins()
        ),
        "Vary": "Origin",
    }


def _json(payload: Any, request: Request, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status_code, headers=_cors_headers(request))


def _error(message: str, request: Request, *, status_code: int) -> JSONResponse:
    return _json({"error": message}, request, status_code=status_code)


# --- items.json (small metadata, not the memory-heavy per-price-series data) ---

_items_cache: dict[str, Any] | None = None
_items_cache_key: tuple[str, float] | None = None


def load_items() -> dict[str, Any]:
    """Load `data/sf_history_items.json`, re-reading if the path or its mtime
    changed. This is a few KB of static metadata (28 items) -- caching it is
    not the "28装備分を常駐メモリに載せない" concern (plan §2), which is about
    per-request *price series* data, never held across requests.
    """
    global _items_cache, _items_cache_key
    path = _items_path()
    mtime = path.stat().st_mtime
    key = (str(path), mtime)
    if _items_cache is None or _items_cache_key != key:
        _items_cache = json.loads(path.read_text(encoding="utf-8"))
        _items_cache_key = key
    return _items_cache


def _item_by_id(item_id: int) -> dict[str, Any] | None:
    for item in load_items()["items"]:
        if int(item["itemId"]) == item_id:
            return item
    return None


def _parse_item_id(raw: str | None, request: Request) -> tuple[int | None, JSONResponse | None]:
    if raw is None or raw == "":
        return None, _error("itemId is required", request, status_code=400)
    try:
        return int(raw), None
    except ValueError:
        return None, _error("itemId must be an integer", request, status_code=400)


def _format_iso_utc(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# --- routes -------------------------------------------------------------


@app.get("/sf-history/health")
def health(request: Request) -> JSONResponse:
    return _json({"status": "ok"}, request)


@app.get("/sf-history/equipment")
def equipment(request: Request) -> JSONResponse:
    payload = load_items()
    conn = db.connect(_db_path())
    try:
        max_upgrade_by_item = db.max_upgrade_by_item(conn)
    finally:
        conn.close()

    items = []
    for item in payload["items"]:
        item_id = int(item["itemId"])
        max_upgrade = max_upgrade_by_item.get(item_id)
        # design §7.1: maxStar is *derived from the data*, never hardcoded.
        max_star = (max_upgrade + 1) if max_upgrade is not None else None
        items.append(
            {
                "itemId": item_id,
                "itemName": item.get("itemName"),
                "aliasItemIds": item.get("aliasItemIds", []),
                "maxStar": max_star,
                # IMPL_PLAN_SH9 §3-2: passed through as-is from
                # data/sf_history_items.json -- every other field on this
                # response is unchanged. `[]` for items.json snapshots
                # generated before SH9 (no new-field crash on stale data).
                "aliases": item.get("aliases", []),
            }
        )

    return _json(
        {
            "generatedAt": payload.get("generatedAt"),
            "excluded": payload.get("excluded", []),
            "items": items,
        },
        request,
    )


@app.get("/sf-history/prices")
def prices(request: Request, itemId: str | None = None) -> JSONResponse:
    item_id, error_response = _parse_item_id(itemId, request)
    if error_response is not None:
        return error_response

    if _item_by_id(item_id) is None:
        return _error(f"unknown itemId {item_id}", request, status_code=404)

    conn = db.connect(_db_path())
    try:
        rows = db.four_h_rows_for_item(conn, item_id)
        price_version = db.latest_generated_at_for_item(conn, item_id)

        cutoff = _format_iso_utc(datetime.now(timezone.utc) - timedelta(days=DISPLAY_WINDOW_DAYS))
        by_date: dict[str, list[float | None]] = {}
        for upgrade, price_at, end_price in rows:
            if price_at < cutoff:
                continue
            if not (0 <= upgrade < UPGRADE_COUNT):
                continue
            slot = by_date.setdefault(price_at, [None] * UPGRADE_COUNT)
            # Rounded to 2 decimals at the transport boundary only (the stored
            # sf_price_history_4h.end_price keeps full precision) -- values here
            # are NESO prices in the hundreds-of-thousands to low-millions range,
            # so sub-cent digits are display noise, not signal. This is what
            # keeps gzip'd response size under the plan §7(d) 100KB budget: full
            # precision measured ~117-127KB gzip'd, 2 decimals ~80-90KB.
            slot[upgrade] = round(end_price, 2)

        dates = sorted(by_date)
        points = [{"date": d, "prices": by_date[d]} for d in dates]
        last_confirmed_date = dates[-1] if dates else None

        # IMPL_PLAN_SH13 §2-2: the simplified rule is "in sf_price_history_4h
        # = confirmed; not there but derivable from hourly = provisional" --
        # this closes the gap that used to appear whenever the 4h aggregation
        # job hadn't run yet for a bucket that had already fully elapsed
        # (previously: the response just stopped at the last row the 4h
        # table happened to hold, with nothing standing in for the completed
        # buckets in between). `sf_price_history_4h` itself is only ever read
        # here -- never written -- so (c)'s determinism guarantee (row
        # count/hash unchanged) holds no matter how many times this route runs.
        provisional_points: list[dict[str, Any]] = []
        max_upgrade_by_item = db.max_upgrade_by_item(conn)
        confirmed_max_upgrade = max_upgrade_by_item.get(item_id)
        now = datetime.now(timezone.utc)
        # IMPL_PLAN_SH16 §1/§3 (kept by SH17 §3): the bucket that has not
        # fully elapsed yet -- "in progress" as of `now` -- is computed up
        # front so both the hourly-derived loop below and the unified
        # in-progress-bucket point further down share the exact same notion
        # of "which bucket is this".
        candidate_date = aggregate.bucket_start(_format_iso_utc(now))
        candidate_bucket_end = aggregate.bucket_end(candidate_date)
        # IMPL_PLAN_SH17 §3: `in_progress_prices`/`in_progress_has_data` are
        # the hourly-derived *fallback* value for the unified in-progress
        # point built after `conn` closes below -- only used if the shared
        # `latest` cache is unavailable (upstream failure). Declared here
        # (not only inside the `confirmed_max_upgrade is not None` branch)
        # so they are always defined by the time that point is built.
        in_progress_prices: list[float | None] = [None] * UPGRADE_COUNT
        in_progress_has_data = False
        if confirmed_max_upgrade is not None:
            derived_by_date: dict[str, list[float | None]] = {}
            for upgrade in range(confirmed_max_upgrade + 1):
                hourly_rows = db.hourly_series(conn, item_id, upgrade, since=last_confirmed_date)
                # `aggregate.compute_buckets` already excludes any bucket
                # whose window has not fully elapsed as of `now` -- the
                # still-open "current" bucket is deliberately never produced
                # by this call (design §9: "進行中の区間は確定しない").
                for bucket in aggregate.compute_buckets(hourly_rows, now=now):
                    bucket_date = bucket["price_at"]
                    if last_confirmed_date is not None and bucket_date <= last_confirmed_date:
                        continue  # already confirmed -- sf_price_history_4h stays authoritative
                    if bucket_date < cutoff:
                        continue  # same 150-day display window as the confirmed points above
                    if not (0 <= upgrade < UPGRADE_COUNT):
                        continue
                    slot = derived_by_date.setdefault(bucket_date, [None] * UPGRADE_COUNT)
                    slot[upgrade] = round(bucket["end_price"], 2)

                # IMPL_PLAN_SH17 §3: this is now only a *fallback* source for
                # the unified in-progress-bucket point built below (used only
                # when the shared `latest` cache is unavailable). SH-16 used
                # to turn this into its own separate provisional point, drawn
                # next to a second, separate live-value point; the ユーザー裁
                # 定 (2026-08-05) collapses those two back into the single
                # "未終了の足" point IMPL_PLAN_SH17 §1 describes.
                if 0 <= upgrade < UPGRADE_COUNT:
                    in_progress_rows = [
                        (price_at, end_price)
                        for price_at, end_price in hourly_rows
                        if candidate_date <= price_at < candidate_bucket_end
                    ]
                    if in_progress_rows:
                        _, latest_end_price = max(in_progress_rows, key=lambda row: row[0])
                        in_progress_prices[upgrade] = round(latest_end_price, 2)
                        in_progress_has_data = True
            for bucket_date in sorted(derived_by_date):
                provisional_points.append(
                    {"date": bucket_date, "prices": derived_by_date[bucket_date], "provisional": True}
                )
    finally:
        conn.close()

    # IMPL_PLAN_SH17 §3/§1: the still-open bucket gets exactly ONE point --
    # not the two SH-16 produced. Its `date` is always the bucket's own
    # start (the "足の枠" position), never `asOf` -- SH-17 reverses SH-16's
    # "draw at asOf" fix in favor of a range-note tooltip that explains the
    # position instead (see SfHistoryChart.jsx / domain/format.js). `asOf`,
    # when the upstream payload carries one, is still attached (not used for
    # position) so the frontend can show "the current time" as this point's
    # displayed time (plan §4-1). Values are sourced from the shared
    # `latest` cache (SH-7 sourcing, unchanged) whenever available; only on
    # upstream failure does this fall back to the hourly-derived
    # `in_progress_prices` computed above (no `asOf` in that case -- "無い
    # 数字を発明しない"). If neither source has anything, no point is
    # produced at all (plan §3: "上流失敗時: 未終了の足を出さない").
    in_progress_point: dict[str, Any] | None = None
    if candidate_date not in by_date:
        cache: LatestPriceCache = request.app.state.latest_cache
        try:
            latest_result = cache.get(item_id)
        except UpstreamLatestError:
            # §3-3: degrade -- `prices` stays 200 with confirmed history
            # only. Unlike `/sf-history/latest` (still 503 on failure),
            # losing the ability to read *history* on an upstream hiccup
            # would be a strictly worse regression than falling back to (or
            # omitting) the one in-progress point.
            latest_result = None
        if latest_result is not None:
            provisional_prices = [
                round(p, 2) if p is not None else None for p in latest_result["prices"]
            ]
            # IMPL_PLAN_SH8 §2-1 (kept by SH17 §3): `asOf` is the official
            # API's own as-of timestamp for the *value* -- sourced from the
            # same shared `latest_cache` entry `/sf-history/latest` returns
            # as `latestUpdatedAt`, so the two can never disagree. "無い数字
            # を発明しない": when the upstream payload carried no usable
            # `latestUpdatedAt`, `asOf` is omitted entirely, never invented
            # (the point still gets drawn at `candidate_date`, same as ever).
            as_of = latest_result.get("latestUpdatedAt")
            has_as_of = isinstance(as_of, str) and bool(as_of)
            in_progress_point = {
                "date": candidate_date,
                "prices": provisional_prices,
                "provisional": True,
            }
            if has_as_of:
                in_progress_point["asOf"] = as_of
        elif in_progress_has_data:
            # Upstream failed but hourly data has already landed inside this
            # bucket's own window -- plan §3's "(または hourly から出す)"
            # fallback. No `asOf` here: this value's "as of" instant is not
            # a real upstream timestamp, just the last hourly row seen.
            in_progress_point = {
                "date": candidate_date,
                "prices": in_progress_prices,
                "provisional": True,
            }
    if in_progress_point is not None:
        provisional_points.append(in_progress_point)

    points.extend(provisional_points)
    # IMPL_PLAN_SH13 §2-2 (kept by SH17): "暫定点は複数になりうる" --
    # `provisionalDate` means the MOST RECENT provisional point.
    # `provisional_points` is always chronologically ascending: (1)
    # elapsed-but-unaggregated buckets, sorted, (2) the unified in-progress
    # point last (if any) -- so the last entry is always the most recent one.
    provisional_date = provisional_points[-1]["date"] if provisional_points else None

    return _json(
        {
            "itemId": item_id,
            "interval": "4h",
            "labelIs": "bucketStart",
            "startDate": dates[0] if dates else None,
            "endDate": dates[-1] if dates else None,  # unchanged: last CONFIRMED bucket (plan §3-2/(c))
            "provisionalDate": provisional_date,
            "priceVersion": price_version,
            "upgradeCount": UPGRADE_COUNT,
            "points": points,
        },
        request,
    )


@app.get("/sf-history/latest")
def latest(request: Request, itemId: str | None = None) -> JSONResponse:
    item_id, error_response = _parse_item_id(itemId, request)
    if error_response is not None:
        return error_response

    if _item_by_id(item_id) is None:
        return _error(f"unknown itemId {item_id}", request, status_code=404)

    cache: LatestPriceCache = request.app.state.latest_cache
    try:
        result = cache.get(item_id)
    except UpstreamLatestError as exc:
        # design §6: "上流失敗時は 404/503 を返し、履歴の最終確定足で代替しない".
        return _error(f"upstream enhance-price/latest failed: {exc}", request, status_code=503)

    return _json(result, request)
