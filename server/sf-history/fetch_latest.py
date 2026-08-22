"""SH-3 §5: current price proxy for `enhance-price/latest` (design §6).

Design §6: "ブラウザから msu.io を直接叩かない" -- the browser calls
`GET /sf-history/latest?itemId=`, and this module is what actually reaches
the official upstream on the server's behalf, with:

  - a fixed TTL (IMPL_PLAN_SH23 §3-2, default 300s -- this supersedes
    IMPL_PLAN_SH15 §4's per-entry TTL derived from the upstream's own
    `latestUpdatedAt` stamp; see "Why a fixed TTL again" below), process-
    in-memory cache per itemId
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
  IMPL_PLAN_SH40 §3 adds `cubes`/`cubeOrder` to that same shape (both
  parsers, unconditionally) -- the legacy endpoint has no `potential` data
  at all, so its `cubes` is always `[None] * CUBE_COUNT` (plan (g)).

Why a fixed TTL again (IMPL_PLAN_SH23 §3-2): SH-15 derived each entry's TTL
from that response's own `latestUpdatedAt`, tuned for the legacy endpoint's
observed ~20-minute republish cadence ("upstream publishes -> cache should
refresh around then, not sooner"). The Open API republishes every *1
minute* -- deriving a TTL the same way would mean re-hitting upstream on
almost every request, the exact "毎リクエスト上流を叩く事故" failure mode
SH-15 was built to avoid, just triggered by a fresher upstream instead of a
stale stamp. A single fixed TTL (user-specified: 5 minutes, "負荷を考え")
sidesteps that regardless of which upstream is in play. `MIN_TTL_SECONDS`/
`MAX_TTL_SECONDS` are carried over unchanged from SH-15 §4-3 as guard rails
on the *configured* value (env var), not on any per-stamp computation.

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
from typing import Any

import requests

import cube
from fetcher import USER_AGENT

LATEST_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/latest"
OPEN_API_URL_TEMPLATE = "https://openapi.msu.io/v1rc1/enhancement/items/{item_id}/dynamicprice"

DEFAULT_TTL_SECONDS = 300.0  # IMPL_PLAN_SH23 §3-2 (5min, user-specified). Env: SF_HISTORY_LATEST_TTL_SECONDS.
MIN_TTL_SECONDS = 60.0  # guard floor (plan §3-2 "上限・下限のガードは維持"), carried over from IMPL_PLAN_SH15 §4-3.
MAX_TTL_SECONDS = 1200.0  # guard ceiling, ditto -- an env var can never push the TTL outside [60, 1200]s.

REQUEST_TIMEOUT_SECONDS = 5.0
UPGRADE_COUNT = 22  # itemUpgrade 0..21, matching `prices[]` (plan §8 condition 6)
PRICE_DIVISOR = 1e18  # design P2 / SH1_API_PROBE.md M1: closePrice / endPrice = 1e18
CUBE_COUNT = len(cube.CUBE_SUB_TYPES)  # IMPL_PLAN_SH40 §3, matching `cubes[]` below


class UpstreamLatestError(RuntimeError):
    """Upstream `latest`/Open API `dynamicprice` failed or returned an
    unusable payload.

    Callers (app.py) must map this to HTTP 503 -- never substitute a
    historical value (design §6).
    """


@dataclass
class _CacheEntry:
    fetched_at: float  # monotonic clock reading at fetch time
    result: dict[str, Any]


def parse_potential_cubes(payload: dict[str, Any]) -> list[float | None]:
    """IMPL_PLAN_SH40 §3: the CUBE (potential) counterpart of `starforce`'s
    price read, from the SAME `dynamicprice` response `parse_openapi_payload`
    already fetches (J3: "いまは starforce だけ読んで捨てている" -- this is
    the one place that stops discarding it). `data.currentPrices.potential`
    is keyed by each cube's own itemId (confirmed live 2026-08-22 probe;
    `discovery.py`'s `parse_dynamicprice_cube_points` reads the identical
    map for a different purpose) -- `cube.CUBE_ITEM_ID_BY_SUB_TYPE` maps
    each of this feature's 4 `cube.CUBE_SUB_TYPES` onto that itemId.

    Purely additive and never raises (plan §3: "上流への追加リクエストを発
    生させない" implies this can never be the reason a `latest`/`prices`
    response fails) -- a missing/malformed `potential` map, or a payload with
    no usable `data.currentPrices` at all (e.g. the legacy endpoint's
    completely different shape), yields `[None] * CUBE_COUNT` rather than
    raising (plan (g): "potential が欠けている装備でも、SF側の現在価格は
    従来どおり返る"). Index-aligned to `cube.CUBE_SUB_TYPES`'s fixed order --
    callers expose that order alongside this list (plan (c)), never
    re-derive it here.
    """
    data = payload.get("data")
    if not isinstance(data, dict):
        data = payload
    current_prices = data.get("currentPrices")
    potential = current_prices.get("potential") if isinstance(current_prices, dict) else None
    cubes: list[float | None] = [None] * CUBE_COUNT
    if not isinstance(potential, dict):
        return cubes

    for index, sub_type in enumerate(cube.CUBE_SUB_TYPES):
        entry = potential.get(str(cube.CUBE_ITEM_ID_BY_SUB_TYPE[sub_type]))
        if not isinstance(entry, dict):
            continue
        current = entry.get("currentPrice")
        if not isinstance(current, dict):
            continue
        raw_price = current.get("price")
        if raw_price is None:
            continue
        try:
            cubes[index] = float(raw_price) / PRICE_DIVISOR
        except (TypeError, ValueError):
            continue
    return cubes


def parse_latest_payload(item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Parse the legacy, unauthenticated `enhance-price/latest` response.

    IMPL_PLAN_SH40 §3/(g): this upstream has no `potential` data at all (a
    completely different payload shape, no `data.currentPrices`) -- `cubes`
    is always `[None] * CUBE_COUNT` here, never guessed at. `cubeOrder` is
    this codebase's own fixed constant (`cube.CUBE_SUB_TYPES`), not something
    read from the upstream, so it is always present regardless.
    """
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
        "cubes": [None] * CUBE_COUNT,
        "cubeOrder": list(cube.CUBE_SUB_TYPES),
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

    # IMPL_PLAN_SH40 §3 (J3): `cubes` reads the SAME response's
    # `data.currentPrices.potential` -- no additional upstream request. Added
    # strictly after every existing `starforce`/`prices`/`latestUpdatedAt`
    # line above is untouched, so the pre-SH40 result for those keys never
    # moves (plan §4: "既存の結果を変えない").
    return {
        "itemId": item_id,
        "latestUpdatedAt": latest_updated_at,
        "prices": prices,
        "cubes": parse_potential_cubes(payload),
        "cubeOrder": list(cube.CUBE_SUB_TYPES),
    }


class LatestPriceCache:
    """Per-itemId TTL cache with single-flight coalescing.

    A plain class (not module globals) so app.py can hold one instance in
    `app.state` and tests can construct independent instances with a fake
    session/clock.

    IMPL_PLAN_SH23 §3-1/§3-3: `api_key` selects the upstream for the whole
    lifetime of this instance -- set once at construction (app.py reads
    `MSU_OPEN_API_KEY` exactly once, at process startup), never re-read
    per-request. Empty/`None` means "no key configured" -> fall back to the
    legacy unauthenticated endpoint.
    """

    def __init__(
        self,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        api_key: str = "",
        session: Any = None,
        timeout_seconds: float = REQUEST_TIMEOUT_SECONDS,
        clock: Any = time.monotonic,
    ) -> None:
        # plan §3-2 guard rails: clamp regardless of what the caller passes,
        # so a misconfigured env var can never yield 0s (hammer upstream) or
        # an absurdly long TTL (serve stale prices for hours).
        self._ttl_seconds = max(MIN_TTL_SECONDS, min(ttl_seconds, MAX_TTL_SECONDS))
        self._api_key = api_key or ""
        self._session = session or requests.Session()
        self._timeout_seconds = timeout_seconds
        self._clock = clock
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
            self._entries[item_id] = _CacheEntry(fetched_at=self._clock(), result=result)
            return result

    def _fresh_entry(self, item_id: int) -> _CacheEntry | None:
        entry = self._entries.get(item_id)
        if entry is None:
            return None
        if (self._clock() - entry.fetched_at) > self._ttl_seconds:
            return None
        return entry

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
