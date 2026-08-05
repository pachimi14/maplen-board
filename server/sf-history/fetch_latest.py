"""SH-3 §5: current price proxy for `enhance-price/latest` (design §6).

Design §6: "ブラウザから msu.io を直接叩かない" -- the browser calls
`GET /sf-history/latest?itemId=`, and this module is what actually reaches
the official upstream on the server's behalf, with:

  - a per-entry TTL derived from the upstream's own `latestUpdatedAt` stamp
    (IMPL_PLAN_SH15 §4, replacing SH-7 §2's fixed 300s poll) -- process-
    in-memory cache per itemId. See `LatestPriceCache._compute_ttl_seconds`
    for the formula and its guards.
  - single-flight coalescing: concurrent requests for the same itemId while
    a fetch is already in flight share its result instead of each making
    their own upstream call
  - **no fallback to historical data on upstream failure** (design §6: "履歴
    の最終確定足で代替しない" -- callers must surface this as an error, not
    silently substitute a stale number as if it were "now")

IMPL_PLAN_SH23 §3-1/§3-3: two upstreams, chosen once per cache instance by
whether an API key is configured (never per-request -- see app.py's
`_build_latest_cache`):

  - **with `MSU_OPEN_API_KEY`**: the official Open API
    (`https://openapi.msu.io/v1rc1/enhancement/items/{item_id}/dynamicprice`,
    `x-nxopen-api-key` header), which republishes every minute instead of
    the old endpoint's ~20-minute grid (統括's realtime probe, IMPL_PLAN_SH23
    §0). `parse_openapi_payload` reads `data.currentPrices.starforce`
    (string-keyed, currently 0..24 but never assumed to be exactly that --
    only keys that parse as `int` and land in `0 <= n < UPGRADE_COUNT` are
    used) and takes `latestUpdatedAt` from the lowest-star entry with a
    usable `currentPrice.startDate` -- "その価格がいつ時点のものか" (plan
    §3-1).
  - **without a key**: the original unauthenticated `enhance-price/latest`
    endpoint (`LATEST_URL`, `parse_latest_payload`), unchanged from SH-3/
    SH-7. This is the fallback so the service keeps working before a key is
    provisioned in production (plan §3-3): "本番へキーを配る前でも画面が
    壊れないようにする".

  Both parsers return the exact same shape (`{itemId, latestUpdatedAt,
  prices}`) in the exact same units, so every caller of `LatestPriceCache`
  (app.py's `prices()`/`latest()`) is unaffected by which upstream actually
  answered -- IMPL_PLAN_SH23 §3-1: "応答のフィールド集合は変えない".

  Note: the TTL model below (`_compute_ttl_seconds`, derived from
  `latestUpdatedAt` + a ~20-minute publish interval) is still SH-15's, tuned
  for the legacy endpoint's ~20-minute republish cadence -- IMPL_PLAN_SH23's
  second commit replaces it with a fixed TTL, because the Open API's 1-minute
  cadence would otherwise make this formula re-hit upstream on almost every
  request.

SH-7 §3-1 also reuses this same cache for the `prices` endpoint's provisional
(in-progress-bucket) point -- see app.py's `prices()`: "同じ出どころ" means
the "Current" summary card and the provisional chart point never show two
different numbers for "now".

Unit conversion: both upstreams' raw price is on a different scale than this
system's stored `end_price` (design P2, confirmed in SH1_API_PROBE.md M1:
closePrice / endPrice = 1e18, to a relative deviation of 1.28e-16; IMPL_PLAN_
SH23 §0 confirmed the Open API's `price` is on the same 1e18 scale). Every
other place in this codebase deliberately avoids doing this conversion
(schema.sql's comment on `end_price`) because `endPrice` is stored
unconverted end-to-end. This module is the one new place a raw price enters
the system at all, and design §6.1 requires the "current value" to be
directly comparable to the historical `prices` series ("現在値 vs 期間統計を
比較させる") -- so it is converted exactly once, here, to the same units as
`sf_price_history_4h.end_price`.

★秘密情報: the API key (`api_key` below) is only ever read by app.py from the
`MSU_OPEN_API_KEY` environment variable and passed in here. It is never
logged (only whether a key is configured, never its value -- see app.py's
`_build_latest_cache`), never returned in any parsed result, and never
written to a file anywhere in this module.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import requests

import aggregate
from fetcher import USER_AGENT

LATEST_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/latest"
OPEN_API_URL_TEMPLATE = "https://openapi.msu.io/v1rc1/enhancement/items/{item_id}/dynamicprice"

# IMPL_PLAN_SH15 §4: statutory observation (統括, 4 samples, NOT a permanent
# guarantee -- `latestUpdatedAt` seen at 04:00/04:20/04:40/05:00, all on a
# 20-minute grid) is that upstream republishes every 20 minutes. Polling
# faster than that (SH-7's old fixed 300s TTL) was "上流より細かく叩いている
# だけ". `DEFAULT_PUBLISH_INTERVAL_SECONDS` is that observed cadence, and
# `DEFAULT_GRACE_SECONDS` is slack for upstream publishing a little late.
# Both are overridable (see app.py's env reads) but MIN_TTL_SECONDS /
# MAX_TTL_SECONDS below are NOT -- they are the unconditional safety rails
# in case the observation above turns out to be wrong for some item/stamp.
#
# IMPL_PLAN_SH23: this formula only ever applied to the legacy endpoint's
# ~20-minute cadence. It stays in this commit unmodified (Open API support
# is additive here); the next commit replaces it with a fixed TTL.
DEFAULT_PUBLISH_INTERVAL_SECONDS = 1200.0  # 20 minutes. Env: SF_HISTORY_LATEST_PUBLISH_INTERVAL_SECONDS.
DEFAULT_GRACE_SECONDS = 60.0  # Env: SF_HISTORY_LATEST_GRACE_SECONDS.
MIN_TTL_SECONDS = 60.0  # §4-3 floor: a stale/old `latestUpdatedAt` must never push the TTL near 0 (the "毎リクエスト上流を叩く事故" failure mode).
MAX_TTL_SECONDS = 1200.0  # §4-3 ceiling ("最大20分", user-specified) -- always applies, regardless of config.

REQUEST_TIMEOUT_SECONDS = 5.0
UPGRADE_COUNT = 22  # itemUpgrade 0..21, matching `prices[]` (plan §8 condition 6)
PRICE_DIVISOR = 1e18  # design P2 / SH1_API_PROBE.md M1: closePrice / endPrice = 1e18


class UpstreamLatestError(RuntimeError):
    """Upstream `latest`/Open API `dynamicprice` failed or returned an
    unusable payload.

    Callers (app.py) must map this to HTTP 503 -- never substitute a
    historical value (design §6).
    """


@dataclass
class _CacheEntry:
    fetched_at: float  # monotonic clock reading at fetch time
    ttl_seconds: float  # this entry's own TTL, computed once at fetch time (§4)
    result: dict[str, Any]


def parse_latest_payload(item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Parse the legacy, unauthenticated `enhance-price/latest` response."""
    star_force = payload.get("starForce") or []
    prices: list[float | None] = [None] * UPGRADE_COUNT
    for entry in star_force:
        upgrade = entry.get("itemUpgrade")
        close_price = entry.get("closePrice")
        if isinstance(upgrade, int) and 0 <= upgrade < UPGRADE_COUNT and close_price is not None:
            prices[upgrade] = float(close_price) / PRICE_DIVISOR
    return {
        "itemId": item_id,
        "latestUpdatedAt": payload.get("latestUpdatedAt"),
        "prices": prices,
    }


def parse_openapi_payload(item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Parse the official Open API `dynamicprice` response.

    IMPL_PLAN_SH23 §3-1: `data.currentPrices.starforce` is a **string**-keyed
    object (currently star 0..24) -- keys are `int()`-parsed defensively and
    anything outside `0 <= n < UPGRADE_COUNT` is ignored, exactly like
    `parse_latest_payload`'s `itemUpgrade` bounds check above. Never assume
    the key count (plan §5 condition (b) failure mode / stop condition 2).
    `latestUpdatedAt` is the lowest-star entry with a usable
    `currentPrice.startDate` -- "その価格がいつ時点のものか" (plan §3-1); in
    practice every star's window is the same 1-minute bucket.
    """
    data = payload.get("data")
    if not isinstance(data, dict):
        data = payload
    current_prices = data.get("currentPrices")
    starforce = current_prices.get("starforce") if isinstance(current_prices, dict) else None
    if not isinstance(starforce, dict) or not starforce:
        raise UpstreamLatestError("openapi payload missing data.currentPrices.starforce")

    numbered_entries: list[tuple[int, Any]] = []
    for key, entry in starforce.items():
        try:
            numbered_entries.append((int(key), entry))
        except (TypeError, ValueError):
            continue
    numbered_entries.sort(key=lambda pair: pair[0])

    prices: list[float | None] = [None] * UPGRADE_COUNT
    latest_updated_at: str | None = None
    for upgrade, entry in numbered_entries:
        if not (0 <= upgrade < UPGRADE_COUNT):
            continue
        current = entry.get("currentPrice") if isinstance(entry, dict) else None
        if not isinstance(current, dict):
            continue
        raw_price = current.get("price")
        if raw_price is None:
            continue
        try:
            prices[upgrade] = float(raw_price) / PRICE_DIVISOR
        except (TypeError, ValueError):
            continue
        start_date = current.get("startDate")
        if latest_updated_at is None and isinstance(start_date, str) and start_date:
            latest_updated_at = start_date

    return {"itemId": item_id, "latestUpdatedAt": latest_updated_at, "prices": prices}


def _default_wall_clock() -> datetime:
    return datetime.now(timezone.utc)


class LatestPriceCache:
    """Per-itemId TTL cache with single-flight coalescing.

    A plain class (not module globals) so app.py can hold one instance in
    `app.state` and tests can construct independent instances with a fake
    session/monotonic-clock/wall-clock.

    IMPL_PLAN_SH15 §4: unlike SH-7's fixed `ttl_seconds`, each cache entry
    gets its own TTL, computed once at fetch time from that response's own
    `latestUpdatedAt` (`_compute_ttl_seconds`). Two separate injectable
    clocks are used for two separate purposes:
      - `clock` (monotonic, unchanged from SH-3/SH-7): TTL bookkeeping --
        "how long has this cache entry been sitting" is a duration, not a
        wall-clock comparison, so it must never be affected by an NTP
        step/DST-style jump.
      - `wall_clock` (new, real UTC `datetime`): the one-time computation of
        *how long this particular entry's TTL should be*, by comparing the
        upstream's own `latestUpdatedAt` (a wall-clock stamp) against "now".

    IMPL_PLAN_SH23 §3-1/§3-3: `api_key` selects the upstream for the whole
    lifetime of this instance -- set once at construction (app.py reads
    `MSU_OPEN_API_KEY` exactly once, at process startup), never re-read
    per-request. Empty/`None` means "no key configured" -> fall back to the
    legacy unauthenticated endpoint.
    """

    def __init__(
        self,
        *,
        publish_interval_seconds: float = DEFAULT_PUBLISH_INTERVAL_SECONDS,
        grace_seconds: float = DEFAULT_GRACE_SECONDS,
        api_key: str = "",
        session: Any = None,
        timeout_seconds: float = REQUEST_TIMEOUT_SECONDS,
        clock: Any = time.monotonic,
        wall_clock: Callable[[], datetime] = _default_wall_clock,
    ) -> None:
        self._publish_interval_seconds = publish_interval_seconds
        self._grace_seconds = grace_seconds
        self._api_key = api_key or ""
        self._session = session or requests.Session()
        self._timeout_seconds = timeout_seconds
        self._clock = clock
        self._wall_clock = wall_clock
        self._registry_lock = threading.Lock()  # protects _entries / _item_locks dict access
        self._entries: dict[int, _CacheEntry] = {}
        self._item_locks: dict[int, threading.Lock] = {}
        self.upstream_call_count = 0  # test/observability hook (plan (i): "ログで確認")

    @property
    def uses_open_api(self) -> bool:
        """True when this instance was configured with an API key (Open API
        upstream), False when it falls back to the legacy endpoint. Never
        exposes the key itself -- observability only."""
        return bool(self._api_key)

    def _lock_for(self, item_id: int) -> threading.Lock:
        with self._registry_lock:
            return self._item_locks.setdefault(item_id, threading.Lock())

    def get(self, item_id: int) -> dict[str, Any]:
        """Return the parsed current-price payload for `item_id`.

        Raises `UpstreamLatestError` if there is no fresh cache entry and the
        upstream call fails. A failed fetch is never cached (no negative
        caching): the next request tries the upstream again.
        """
        cached = self._fresh_entry(item_id)
        if cached is not None:
            return cached.result

        item_lock = self._lock_for(item_id)
        with item_lock:
            # Re-check after acquiring the lock -- another thread may have
            # refreshed it while we were waiting (this is the single-flight
            # coalescing: only the first thread through this lock per
            # (currently-stale) itemId reaches _fetch_upstream).
            cached = self._fresh_entry(item_id)
            if cached is not None:
                return cached.result

            result = self._fetch_upstream(item_id)
            ttl_seconds = self._compute_ttl_seconds(result.get("latestUpdatedAt"))
            self._entries[item_id] = _CacheEntry(fetched_at=self._clock(), ttl_seconds=ttl_seconds, result=result)
            return result

    def _fresh_entry(self, item_id: int) -> _CacheEntry | None:
        entry = self._entries.get(item_id)
        if entry is None:
            return None
        if (self._clock() - entry.fetched_at) > entry.ttl_seconds:
            return None
        return entry

    def _compute_ttl_seconds(self, latest_updated_at: Any) -> float:
        """IMPL_PLAN_SH15 §4: `next_publish = latestUpdatedAt + interval`,
        `expiry = next_publish + grace` -- how long from *now* (wall-clock)
        this entry should stay fresh.

        §4-3 fallback ("推測で細かく叩かない"): a missing, unparsable, or
        future `latestUpdatedAt` never yields a shorter-than-usual TTL --
        it falls straight back to the configured publish interval (a fixed
        ~20 minutes by default), the same as if no stamp were available at
        all.

        §4-3 guard rails (unconditional, applied after the above): the
        result is always clamped to `[MIN_TTL_SECONDS, MAX_TTL_SECONDS]`.
        The floor is the important one -- an old/stale `latestUpdatedAt`
        (e.g. upstream stalled an hour ago) would otherwise put `expiry` in
        the past, making every single request re-hit the upstream ("毎リク
        エスト上流を叩く事故", this slice's most dangerous failure mode).
        """
        now_wall = self._wall_clock()
        parsed: datetime | None = None
        if isinstance(latest_updated_at, str) and latest_updated_at:
            try:
                parsed = aggregate.parse_iso_utc(latest_updated_at)
            except ValueError:
                parsed = None

        if parsed is None or parsed > now_wall:
            ttl = self._publish_interval_seconds
        else:
            next_publish = parsed + timedelta(seconds=self._publish_interval_seconds)
            expiry = next_publish + timedelta(seconds=self._grace_seconds)
            ttl = (expiry - now_wall).total_seconds()

        return max(MIN_TTL_SECONDS, min(ttl, MAX_TTL_SECONDS))

    def _fetch_upstream(self, item_id: int) -> dict[str, Any]:
        self.upstream_call_count += 1
        if self._api_key:
            return self._fetch_openapi(item_id)
        return self._fetch_legacy(item_id)

    def _fetch_legacy(self, item_id: int) -> dict[str, Any]:
        try:
            response = self._session.get(
                LATEST_URL,
                params={"itemId": item_id, "period": 0},
                timeout=self._timeout_seconds,
                headers={"Accept": "application/json, text/plain, */*", "User-Agent": USER_AGENT},
            )
        except requests.RequestException as exc:
            raise UpstreamLatestError(f"request failed: {exc}") from exc

        if response.status_code != 200:
            raise UpstreamLatestError(f"upstream status {response.status_code}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise UpstreamLatestError(f"invalid JSON body: {exc}") from exc

        if not isinstance(payload, dict) or not payload.get("starForce"):
            raise UpstreamLatestError("upstream payload missing starForce")

        return parse_latest_payload(item_id, payload)

    def _fetch_openapi(self, item_id: int) -> dict[str, Any]:
        try:
            response = self._session.get(
                OPEN_API_URL_TEMPLATE.format(item_id=item_id),
                timeout=self._timeout_seconds,
                headers={"Content-Type": "application/json", "x-nxopen-api-key": self._api_key},
            )
        except requests.RequestException as exc:
            raise UpstreamLatestError(f"request failed: {exc}") from exc

        if response.status_code != 200:
            raise UpstreamLatestError(f"upstream status {response.status_code}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise UpstreamLatestError(f"invalid JSON body: {exc}") from exc

        if not isinstance(payload, dict):
            raise UpstreamLatestError("openapi payload is not an object")

        return parse_openapi_payload(item_id, payload)
