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


def _latest_ttl_seconds() -> float:
    """IMPL_PLAN_SH7 §2: `SF_HISTORY_LATEST_TTL_SECONDS` overrides
    `fetch_latest.DEFAULT_TTL_SECONDS` (300s). Read once, at cache
    construction time -- unlike the per-request settings above, the TTL is
    baked into a long-lived `LatestPriceCache` instance's own state, so
    re-reading the env var on every request would not actually change
    anything after the cache has already been built.
    """
    raw = os.getenv("SF_HISTORY_LATEST_TTL_SECONDS")
    if not raw:
        return fetch_latest.DEFAULT_TTL_SECONDS
    try:
        return float(raw)
    except ValueError:
        return fetch_latest.DEFAULT_TTL_SECONDS


def _build_latest_cache() -> LatestPriceCache:
    return LatestPriceCache(ttl_seconds=_latest_ttl_seconds())


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
    finally:
        conn.close()

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

    # SH-7 §3: append the in-progress 4h bucket as a *provisional* point,
    # sourced from the same shared `latest` cache as `/sf-history/latest`
    # (§3-1: "同じ出どころ" -- never a second, independent notion of "now").
    # Never written to sf_price_history_4h (design §9 is unchanged: the
    # stored/aggregated table only ever holds buckets whose window has
    # fully elapsed) -- this point exists only in this one response.
    provisional_date: str | None = None
    now = datetime.now(timezone.utc)
    candidate_date = aggregate.bucket_start(_format_iso_utc(now))
    if candidate_date not in by_date:
        cache: LatestPriceCache = request.app.state.latest_cache
        try:
            latest_result = cache.get(item_id)
        except UpstreamLatestError:
            # §3-3: degrade -- `prices` stays 200 with confirmed history
            # only. Unlike `/sf-history/latest` (still 503 on failure),
            # losing the ability to read *history* on an upstream hiccup
            # would be a strictly worse regression than just omitting the
            # one provisional point.
            latest_result = None
        if latest_result is not None:
            provisional_prices = [
                round(p, 2) if p is not None else None for p in latest_result["prices"]
            ]
            provisional_point: dict[str, Any] = {
                "date": candidate_date,
                "prices": provisional_prices,
                "provisional": True,
            }
            # IMPL_PLAN_SH8 §2-1: `asOf` is the official API's own as-of
            # timestamp for the *value* (when the price was current), never
            # the bucket-start `date` above (which is only a draw position).
            # Sourced from the same shared `latest_cache` entry `/sf-history
            # /latest` returns as `latestUpdatedAt` -- §2-1/(e): the two must
            # never disagree, since both come from the exact same cache
            # lookup. Omitted entirely (not `null`) when the upstream payload
            # didn't carry one, per "無い数字を発明しない" -- falling back to
            # `candidate_date` here would silently reintroduce the "looks
            # stale" bug this slice exists to fix.
            as_of = latest_result.get("latestUpdatedAt")
            if isinstance(as_of, str) and as_of:
                provisional_point["asOf"] = as_of
            points.append(provisional_point)
            provisional_date = candidate_date

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
