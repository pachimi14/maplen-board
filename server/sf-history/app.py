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
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

import aggregate
import cube
import db
import discovery
import fetch_latest
from fetch_latest import LatestPriceCache, UpstreamLatestError

APP_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = APP_DIR / "data" / "sf_price_history.sqlite"
DEFAULT_ITEMS_PATH = APP_DIR / "data" / "sf_history_items.json"
DEFAULT_ALLOWED_ORIGINS = ("https://lulumi-tools.com",)

DISPLAY_WINDOW_DAYS = 150  # design §10: "4時間足・最大150日"
UPGRADE_COUNT = 22  # itemUpgrade 0..21 (plan §8 condition 6)

# IMPL_PLAN_SH40 §2: `/sf-history/cube-prices` -- same DISPLAY_WINDOW_DAYS
# window as `/sf-history/prices` (plan §2: "期間の指定方法を SF と揃える" --
# `/sf-history/prices` itself takes no `?days=`, a fixed 150-day window, so
# this route matches that, not a new per-request parameter). `CUBE_COUNT`/
# `CUBE_INDEX` are this route's `UPGRADE_COUNT` counterpart -- `cube.
# CUBE_SUB_TYPES`'s fixed order IS the "応答から順序が分かる情報" (plan §2(c)),
# exposed as `cubeOrder` on the response root.
CUBE_COUNT = len(cube.CUBE_SUB_TYPES)
CUBE_INDEX: dict[str, int] = {sub_type: i for i, sub_type in enumerate(cube.CUBE_SUB_TYPES)}

# IMPL_PLAN_SH32 §2 C: the `/sf-history/discovery/*` routes below are pure DB
# reads (plan §5(i): "上流を叩かない") -- `app.state.latest_cache` (the only
# upstream-call path this service has) is never referenced by any of them.
# `discovery.UPGRADE_COUNT` (25, itemUpgrade 0..24 -- plan §1's DISPLAY
# range) is deliberately wider than `UPGRADE_COUNT` above (22, the existing
# chart endpoints' range) -- do not conflate the two.
DEFAULT_DISCOVERY_RECENT_DAYS = 30  # plan §5(k), overridable per env below AND per-request ?days=


def _latest_ttl_seconds() -> float:
    """IMPL_PLAN_SH23 §3-2: `SF_HISTORY_LATEST_TTL_SECONDS` overrides
    `fetch_latest.DEFAULT_TTL_SECONDS` (300s / 5min, user-specified). Read
    once, at cache construction time -- unlike the per-request settings
    above, this value is baked into a long-lived `LatestPriceCache`
    instance's own state, so re-reading the env var on every request would
    not actually change anything after the cache has already been built.

    Supersedes IMPL_PLAN_SH15 §4's `SF_HISTORY_LATEST_PUBLISH_INTERVAL_SECONDS`
    / `SF_HISTORY_LATEST_GRACE_SECONDS` pair (removed outright, not
    reinterpreted): that per-stamp derivation assumed the legacy endpoint's
    ~20-minute republish cadence, which does not hold for the Open API's
    1-minute cadence (fetch_latest.py's "Why a fixed TTL again"). The
    resulting TTL is still clamped to `[fetch_latest.MIN_TTL_SECONDS,
    fetch_latest.MAX_TTL_SECONDS]` regardless of what this returns -- that
    guard is unconditional and lives in `LatestPriceCache.__init__`, not
    here. See README.md.
    """
    raw = os.getenv("SF_HISTORY_LATEST_TTL_SECONDS")
    if not raw:
        return fetch_latest.DEFAULT_TTL_SECONDS
    try:
        return float(raw)
    except ValueError:
        return fetch_latest.DEFAULT_TTL_SECONDS


def _open_api_key() -> str:
    """IMPL_PLAN_SH23 §2/§3-3: ★秘密情報 -- the ONLY place this service reads
    `MSU_OPEN_API_KEY`. Read once, at cache construction time, and passed
    straight into `LatestPriceCache` -- never logged, never returned in any
    response, never written to a file. An unset/empty value means "no key
    configured", which `LatestPriceCache` treats as "fall back to the legacy
    unauthenticated endpoint" (plan §3-3: "本番へキーを配る前でも画面が
    壊れないようにする").
    """
    return os.getenv("MSU_OPEN_API_KEY", "")


def _build_latest_cache() -> LatestPriceCache:
    api_key = _open_api_key()
    # plan §3-3: "どちらを使ったかをログに1行" -- the key itself is never
    # printed, only whether one is configured (fetcher.py's existing
    # print(..., file=sys.stderr) convention -- this codebase does not use
    # the `logging` module elsewhere).
    print(
        "sf-history: current-price upstream ="
        f" {'openapi.msu.io (MSU_OPEN_API_KEY configured)' if api_key else 'legacy enhance-price/latest (no MSU_OPEN_API_KEY)'}",
        file=sys.stderr,
    )
    return LatestPriceCache(ttl_seconds=_latest_ttl_seconds(), api_key=api_key)


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


def _discovery_recent_days_default() -> int:
    """plan §5(k): "日数が設定で変えられる" -- env-configured default,
    additionally overridable per-request via `?days=` (see
    `discovery_recent` below). A non-positive or unparseable value falls
    back to `DEFAULT_DISCOVERY_RECENT_DAYS` rather than producing an
    always-empty or unbounded window.
    """
    raw = os.getenv("SF_HISTORY_DISCOVERY_RECENT_DAYS")
    if not raw:
        return DEFAULT_DISCOVERY_RECENT_DAYS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_DISCOVERY_RECENT_DAYS
    return value if value > 0 else DEFAULT_DISCOVERY_RECENT_DAYS


# --- routes -------------------------------------------------------------


@app.get("/sf-history/health")
def health(request: Request) -> JSONResponse:
    return _json({"status": "ok"}, request)


@app.get("/sf-history/equipment")
def equipment(request: Request) -> JSONResponse:
    payload = load_items()
    conn = db.connect(_db_path())
    try:
        # IMPL_PLAN_SH36: `db.max_star_by_item` unions the hourly-history
        # derivation with the DISCOVERY-presence derivation (`db.
        # discovery_max_upgrade_by_item`) -- for the pre-SH-36 31 items
        # (never a `sf_discovery_price_history` row) this is byte-identical
        # to the old `max_upgrade_by_item(conn).get(id) + 1` computation
        # (plan §6(g)/(b)).
        max_star_by_item = db.max_star_by_item(conn)
    finally:
        conn.close()

    items = []
    for item in payload["items"]:
        item_id = int(item["itemId"])
        # design §7.1: maxStar is *derived from the data*, never hardcoded.
        max_star = max_star_by_item.get(item_id)
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

        # IMPL_PLAN_SH36 §3/§4: an item that is (or was) a DISCOVERY-
        # monitored representative may have bands with no real
        # `sf_price_history_hourly`/`_4h` row at all yet (still
        # price-forming -- design H5). `forming_prices` (upgrade -> current
        # price, step-judged, never a price threshold -- plan §6(e)) and
        # `forming_ranges` (☆ ranges, for the `formingBands` note) are both
        # computed here, inside this route's one `conn`, and applied further
        # below AFTER every point (confirmed + provisional) has been built.
        # `db.get_discovery_monitored_group` returns `None` for every one of
        # the pre-SH-36 31 items -- both stay at their empty defaults and
        # every line below this comment is then a strict no-op for them
        # (plan §6(g): existing equipment's calculation does not move).
        forming_prices: dict[int, float] = {}
        forming_ranges: list[tuple[int, int]] = []
        discovery_group = db.get_discovery_monitored_group(conn, item_id)
        if discovery_group is not None:
            discovery_bands, _discovery_observed_at = db.latest_discovery_bands_for_item(conn, item_id)
            forming_prices = discovery.forming_band_current_prices(discovery_bands, upgrade_count=UPGRADE_COUNT)
            forming_ranges = discovery.forming_star_ranges(discovery_bands, upgrade_count=UPGRADE_COUNT)

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
        # IMPL_PLAN_SH19 §1/§3: `closed` (line style) vs `provisional`
        # (statistics eligibility) are deliberately DIFFERENT axes -- see the
        # big note above `provisional_points` below for why. A confirmed,
        # `sf_price_history_4h`-backed point is closed (its bucket has
        # ended) and not provisional (it is persisted, safe to statisticize).
        points = [{"date": d, "prices": by_date[d], "closed": True} for d in dates]
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
        #
        # IMPL_PLAN_SH19 §1/§3 (2026-08-05, user decision, corrects a 統括
        # misreading of the original SH-17 instruction): every point below
        # ALSO carries a `closed` flag, separate from `provisional`:
        #   - `closed` = has the bucket's own time window ended as of `now`?
        #     Drives ONLY the frontend's line style (dashed vs solid) / hollow
        #     marker. True for every point except the one still-open bucket.
        #   - `provisional` = is the value persisted in `sf_price_history_4h`?
        #     Drives ONLY statistics eligibility (computeStats/
        #     currentPercentile/heatmap keep excluding `provisional: True`,
        #     unchanged). An elapsed-but-unaggregated bucket is `closed: True`
        #     (nothing left to wait for -- its own 4h window is over) but
        #     stays `provisional: True` (its value can still shift the next
        #     time the 4h aggregation job runs, and folding an about-to-change
        #     value into a statistic that must reproduce on reload would
        #     silently break that reproducibility -- same reasoning
        #     domain/series.js's `computeStats` docstring already gives for
        #     excluding the live in-progress point). Do not merge these two
        #     flags back into one: doing so is what produced the "two dashed
        #     segments" bug this plan fixes.
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
                # IMPL_PLAN_SH19 §1/§3: this bucket's window has already
                # fully elapsed -- only its *persistence* to
                # `sf_price_history_4h` is pending (the periodic aggregation
                # job just has not run yet). `closed: True` (drawn as a solid
                # line, matching a confirmed point) even though `provisional`
                # stays True (still excluded from computeStats/
                # currentPercentile/the heatmap -- its value can still change
                # the next time this job runs, and mixing an
                # about-to-change value into a "reproducible on reload"
                # statistic would silently break that reproducibility, same
                # reasoning as domain/series.js's computeStats docstring).
                # `closed` and `provisional` are answering two different
                # questions on purpose: "has the bucket's time window ended"
                # (line style) vs. "is the value durably persisted" (stats
                # eligibility) -- do not collapse them back into one flag.
                provisional_points.append(
                    {
                        "date": bucket_date,
                        "prices": derived_by_date[bucket_date],
                        "provisional": True,
                        "closed": True,
                    }
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
            # IMPL_PLAN_SH19 §1/§3: `closed: False` -- the ONLY point this
            # route ever marks as not-yet-ended. This is what makes the
            # dashed line/hollow marker always exactly one point (§0 of that
            # plan): every other point (confirmed or elapsed-but-unaggregated
            # above) is `closed: True`.
            in_progress_point = {
                "date": candidate_date,
                "prices": provisional_prices,
                "provisional": True,
                "closed": False,
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
                "closed": False,  # IMPL_PLAN_SH19 §1/§3: still the in-progress bucket
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

    # IMPL_PLAN_SH36 §3: "履歴のある帯は実履歴、履歴の無い帯は現在価格を全期間
    # の定数として使う" -- applied here, AFTER every point (confirmed +
    # provisional) already exists, as the very last mutation before the
    # response is built. Only ever touches a slot that is still `None` (a
    # band with a real historical value at this exact point keeps that real
    # value -- this never overwrites confirmed history, plan §3-1: "過去の
    # 足について正直であること" is satisfied by filling only what would
    # otherwise be a gap, not by replacing anything real). `forming_prices`
    # is `{}` for every item that is not a DISCOVERY-monitored representative
    # (plan §6(g): a strict no-op for the pre-SH-36 31 items).
    if forming_prices:
        for point in points:
            point_prices = point["prices"]
            for upgrade, forming_price in forming_prices.items():
                if point_prices[upgrade] is None:
                    point_prices[upgrade] = round(forming_price, 2)

    # IMPL_PLAN_SH36 §4: `formingBands` -- which ☆ ranges are currently
    # price-forming (empty list when none, plan §6(h): "形成中の帯が無ければ
    # 出ない" is a frontend concern this empty list enables; never omitted --
    # a stable, always-present field, same discipline as `cubes` on
    # `/sf-history/discovery/prices`).
    forming_bands_payload = [
        {"startStar": start_star, "endStar": end_star} for start_star, end_star in forming_ranges
    ]

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
            "formingBands": forming_bands_payload,
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


# --- IMPL_PLAN_SH40 §2: CUBE (Red/Black/Bonus Potential/White Bonus) price
# series -- "既存 /sf-history/prices と同じ流儀" (plan §2): same root shape,
# same `closed`/`provisional` semantics, same DISPLAY_WINDOW_DAYS window, one
# request returns all 4 cube sub-types for one item, index-aligned to
# `cube.CUBE_SUB_TYPES` (`cubeOrder` on the response root is this route's
# `upgradeCount` counterpart). Unlike `prices()`, there is no per-item
# "confirmed max upgrade" concept to bound iteration -- every item is always
# iterated over the same fixed 4 `CUBE_SUB_TYPES` (a band with no data at a
# given point, e.g. White before 2026-06-11 -- J2 -- simply never gets a row
# at that `price_at`, so its slot stays `None`; no special-casing needed,
# same "absent row = None slot" mechanism `prices()` already relies on for a
# missing upgrade). No `formingBands`/DISCOVERY-fill logic here -- that is
# `/sf-history/discovery/prices`'s own domain (plan §4: touches neither).
@app.get("/sf-history/cube-prices")
def cube_prices(request: Request, itemId: str | None = None) -> JSONResponse:
    item_id, error_response = _parse_item_id(itemId, request)
    if error_response is not None:
        return error_response

    if _item_by_id(item_id) is None:
        return _error(f"unknown itemId {item_id}", request, status_code=404)

    now = datetime.now(timezone.utc)
    cutoff = _format_iso_utc(now - timedelta(days=DISPLAY_WINDOW_DAYS))
    candidate_date = aggregate.bucket_start(_format_iso_utc(now))
    candidate_bucket_end = aggregate.bucket_end(candidate_date)

    conn = db.connect(_db_path())
    try:
        rows = db.cube_four_h_rows_for_item(conn, item_id)
        price_version = db.cube_latest_generated_at_for_item(conn, item_id)

        by_date: dict[str, list[float | None]] = {}
        for cube_sub_type, price_at, end_price in rows:
            if price_at < cutoff:
                continue
            index = CUBE_INDEX.get(cube_sub_type)
            if index is None:
                continue
            slot = by_date.setdefault(price_at, [None] * CUBE_COUNT)
            # Same 2-decimal transport rounding as `prices()` -- see that
            # route's comment on `sf_price_history_4h.end_price` for why
            # (the stored value keeps full precision; only this response
            # boundary rounds it).
            slot[index] = round(end_price, 2)

        dates = sorted(by_date)
        points = [{"date": d, "cubes": by_date[d], "closed": True} for d in dates]
        last_confirmed_date = dates[-1] if dates else None

        # Elapsed-but-unaggregated buckets (IMPL_PLAN_SH19 §1/§3's rule,
        # mirrored from `prices()`): a bucket whose own 4h window has already
        # ended but that the periodic aggregation job has not persisted yet.
        # `in_progress_cubes`/`in_progress_has_data` are the hourly-derived
        # *fallback* for the still-open bucket, used only if the shared
        # `latest` cache has no `cubes` for this item (upstream failure or a
        # legacy-endpoint cache with no potential data at all).
        derived_by_date: dict[str, list[float | None]] = {}
        in_progress_cubes: list[float | None] = [None] * CUBE_COUNT
        in_progress_has_data = False
        for cube_sub_type in cube.CUBE_SUB_TYPES:
            index = CUBE_INDEX[cube_sub_type]
            hourly_rows = db.cube_hourly_series(conn, item_id, cube_sub_type, since=last_confirmed_date)
            for bucket in aggregate.compute_buckets(hourly_rows, now=now):
                bucket_date = bucket["price_at"]
                if last_confirmed_date is not None and bucket_date <= last_confirmed_date:
                    continue  # already confirmed -- sf_cube_price_history_4h stays authoritative
                if bucket_date < cutoff:
                    continue
                slot = derived_by_date.setdefault(bucket_date, [None] * CUBE_COUNT)
                slot[index] = round(bucket["end_price"], 2)

            in_progress_rows = [
                (price_at, end_price)
                for price_at, end_price in hourly_rows
                if candidate_date <= price_at < candidate_bucket_end
            ]
            if in_progress_rows:
                _, latest_end_price = max(in_progress_rows, key=lambda row: row[0])
                in_progress_cubes[index] = round(latest_end_price, 2)
                in_progress_has_data = True

        provisional_points: list[dict[str, Any]] = []
        for bucket_date in sorted(derived_by_date):
            provisional_points.append(
                {
                    "date": bucket_date,
                    "cubes": derived_by_date[bucket_date],
                    "provisional": True,
                    "closed": True,
                }
            )
    finally:
        conn.close()

    # The single still-open-bucket point -- same sourcing rule as `prices()`:
    # the shared `latest` cache (no extra upstream call, plan §3/(e)) when
    # available, falling back to the hourly-derived value above only on
    # upstream failure or when that cache entry carries no usable `cubes`.
    in_progress_point: dict[str, Any] | None = None
    if candidate_date not in by_date:
        cache: LatestPriceCache = request.app.state.latest_cache
        try:
            latest_result = cache.get(item_id)
        except UpstreamLatestError:
            latest_result = None

        cubes_from_cache = latest_result.get("cubes") if latest_result is not None else None
        if cubes_from_cache is not None:
            provisional_cubes = [round(p, 2) if p is not None else None for p in cubes_from_cache]
            as_of = latest_result.get("latestUpdatedAt")
            has_as_of = isinstance(as_of, str) and bool(as_of)
            in_progress_point = {
                "date": candidate_date,
                "cubes": provisional_cubes,
                "provisional": True,
                "closed": False,
            }
            if has_as_of:
                in_progress_point["asOf"] = as_of
        elif in_progress_has_data:
            in_progress_point = {
                "date": candidate_date,
                "cubes": in_progress_cubes,
                "provisional": True,
                "closed": False,
            }
    if in_progress_point is not None:
        provisional_points.append(in_progress_point)

    points.extend(provisional_points)
    provisional_date = provisional_points[-1]["date"] if provisional_points else None

    return _json(
        {
            "itemId": item_id,
            "interval": "4h",
            "labelIs": "bucketStart",
            "startDate": dates[0] if dates else None,
            "endDate": dates[-1] if dates else None,
            "provisionalDate": provisional_date,
            "priceVersion": price_version,
            "cubeOrder": list(cube.CUBE_SUB_TYPES),
            "points": points,
        },
        request,
    )


# --- IMPL_PLAN_SH32 §2 C: DISCOVERY (bonus period) page -- DB reads only ----
# None of these three routes ever touches `request.app.state.latest_cache`
# (or any other upstream) -- plan §5(i): "リクエスト時の上流アクセスはゼロ".
# `sf_discovery_monitored_groups`/`sf_discovery_price_history` are written
# exclusively by scripts/scan_discovery.py (Component A) and
# scripts/poll_discovery.py (Component B); nothing under `/sf-history/
# discovery/*` ever writes to them.


@app.get("/sf-history/discovery/equipment")
def discovery_equipment(request: Request) -> JSONResponse:
    """plan §5(g): the monitored-equipment list -- one row per ACTIVE
    representative group (job-variant aliases folded, never one row per
    alias -- §5(g): "3行にする。15行にしない").

    IMPL_PLAN_SH33 follow-up (post-review): ALSO includes any group
    deactivated within the last `SF_HISTORY_DISCOVERY_RECENT_DAYS` days
    (same env var/default `discovery_recent` below already uses -- one
    retention window, not a second one invented for this) --
    `db.list_visible_discovery_monitored_groups` -- so a fully-settled item
    does not vanish from the picker/selector the instant every one of its
    bands settles, which would otherwise make its own transition-time table
    in `discovery_prices` below unreachable. `isActive` is exposed so a
    caller can tell the two cases apart without a second request.
    """
    since_iso = _format_iso_utc(datetime.now(timezone.utc) - timedelta(days=_discovery_recent_days_default()))
    conn = db.connect(_db_path())
    try:
        groups = db.list_visible_discovery_monitored_groups(conn, since_iso=since_iso)
    finally:
        conn.close()

    items = [
        {
            "itemId": group["itemId"],
            "itemName": group["itemName"],
            "aliasItemIds": group["aliasItemIds"],
            "aliases": group["aliases"],
            "stepsConsistent": group["stepsConsistent"],
            "lastScanAt": group["lastScanAt"],
            "isActive": group["isActive"],
        }
        for group in groups
    ]
    return _json({"items": items}, request)


@app.get("/sf-history/discovery/prices")
def discovery_prices(request: Request, itemId: str | None = None) -> JSONResponse:
    """plan §1/§5(h)/(j): the full ☆1-25 (itemUpgrade 0..24) price/step list
    for one monitored representative, plus `observedAt` -- the freshest poll
    timestamp across every band (plan §5(j): "観測時刻を必ず表示する", so a
    stalled poller is visible to the caller rather than silently serving an
    old value as if it were current). `itemId` must be a representative
    (never an alias) -- unlike `/sf-history/prices`, there is no alias ->
    representative resolution here because `discovery_equipment` above never
    exposes an alias as its own selectable row in the first place.

    IMPL_PLAN_SH33 follow-up (post-review): each band also carries
    `windowStart`/`windowEnd` -- the observed DISCOVERY -> CHANGE flip for
    THAT band (`db.find_discovery_transitions_for_item`,
    `discovery.find_transition`'s own 5-minute-poll uncertainty window,
    same field names `discovery_recent` below already uses for the same
    concept). Both `null` when this band's flip was never observed (still
    DISCOVERY, or already CHANGE in the very first recorded row -- settled
    before monitoring started, so the true instant is unknowable and is
    never guessed at).

    IMPL_PLAN_SH34 §3: also carries `cubes` -- a SEPARATE array, parallel to
    (never merged into) `bands` (plan: "bands の中に混ぜない"), one entry per
    cube this item has ever had a `sf_discovery_cube_price_history` row for
    (`db.latest_discovery_cubes_for_item` -- an item with none yet returns
    `cubes: []`, never a placeholder row; plan §4: "キューブが1件も無い装備
    では、表ごと出さない" is a frontend concern this empty list enables).
    Order is `cube_item_id` ascending (`latest_discovery_cubes_for_item`'s
    own `ORDER BY`) -- deterministic, no invented ranking (plan §3: "序列を
    発明しない"). `cubeName` resolves via `discovery.cube_display_name`
    (static 6-entry table, §2-2 revised) -- an unrecognized cube itemId
    falls back to the code itself, never a guessed name.
    """
    item_id, error_response = _parse_item_id(itemId, request)
    if error_response is not None:
        return error_response

    conn = db.connect(_db_path())
    try:
        group = db.get_discovery_monitored_group(conn, item_id)
        if group is None:
            return _error(f"unknown discovery itemId {item_id}", request, status_code=404)
        bands, observed_at = db.latest_discovery_bands_for_item(conn, item_id)
        transitions = db.find_discovery_transitions_for_item(conn, item_id)
        cubes, _cube_observed_at = db.latest_discovery_cubes_for_item(conn, item_id)
        cube_transitions = db.find_discovery_cube_transitions_for_item(conn, item_id)
    finally:
        conn.close()

    band_payload = []
    for upgrade in range(discovery.UPGRADE_COUNT):
        band = bands.get(upgrade)
        transition = transitions.get(upgrade)
        band_payload.append(
            {
                "itemUpgrade": upgrade,
                "price": band["price"] if band else None,
                "step": band["step"] if band else None,
                "priceAt": band["priceAt"] if band else None,
                "isDiscovery": bool(band and band["step"] == discovery.DISCOVERY_STEP),
                "windowStart": transition[0] if transition else None,
                "windowEnd": transition[1] if transition else None,
            }
        )

    cube_payload = []
    for cube_item_id, cube in cubes.items():
        cube_transition = cube_transitions.get(cube_item_id)
        cube_payload.append(
            {
                "cubeItemId": cube_item_id,
                "cubeName": discovery.cube_display_name(cube_item_id),
                "price": cube["price"],
                "step": cube["step"],
                "priceAt": cube["priceAt"],
                "isDiscovery": bool(cube["step"] == discovery.DISCOVERY_STEP),
                "windowStart": cube_transition[0] if cube_transition else None,
                "windowEnd": cube_transition[1] if cube_transition else None,
            }
        )

    return _json(
        {
            "itemId": item_id,
            "itemName": group["itemName"],
            "upgradeCount": discovery.UPGRADE_COUNT,
            "observedAt": observed_at,
            "bands": band_payload,
            "cubes": cube_payload,
        },
        request,
    )


@app.get("/sf-history/discovery/recent")
def discovery_recent(request: Request, days: str | None = None) -> JSONResponse:
    """plan §2 C / §5(k): bands that flipped DISCOVERY -> CHANGE within the
    last `days` (default `SF_HISTORY_DISCOVERY_RECENT_DAYS`, itself defaulting
    to 30) -- across every group this service has EVER monitored, active or
    since deactivated (plan §5(k): "記録は永久に残す(表示期間だけの話)").
    `windowStart`/`windowEnd` are the last-seen-DISCOVERY / first-seen-CHANGE
    poll timestamps (plan §2 B: "「5分の幅」までしか特定できない" -- never a
    single invented instant).
    """
    if days is not None and days.strip():
        try:
            requested = int(days)
        except ValueError:
            return _error("days must be an integer", request, status_code=400)
        window_days = requested if requested > 0 else _discovery_recent_days_default()
    else:
        window_days = _discovery_recent_days_default()

    since_iso = _format_iso_utc(datetime.now(timezone.utc) - timedelta(days=window_days))

    conn = db.connect(_db_path())
    try:
        transitions = db.find_recent_discovery_transitions(conn, since_iso=since_iso)
        names_by_item_id = {
            group["itemId"]: group["itemName"] for group in db.list_all_discovery_monitored_groups(conn)
        }
    finally:
        conn.close()

    items = [
        {
            "itemId": transition["itemId"],
            "itemName": names_by_item_id.get(transition["itemId"]),
            "itemUpgrade": transition["itemUpgrade"],
            "windowStart": transition["windowStart"],
            "windowEnd": transition["windowEnd"],
        }
        for transition in transitions
    ]
    return _json({"days": window_days, "items": items}, request)
