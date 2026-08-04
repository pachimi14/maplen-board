"""SH-3 §5: current price proxy for `enhance-price/latest` (design §6).

Design §6: "ブラウザから msu.io を直接叩かない" -- the browser calls
`GET /sf-history/latest?itemId=`, and this module is what actually reaches
the official upstream on the server's behalf, with:

  - a 60-second TTL, process-in-memory cache per itemId
  - single-flight coalescing: concurrent requests for the same itemId while
    a fetch is already in flight share its result instead of each making
    their own upstream call
  - **no fallback to historical data on upstream failure** (design §6: "履歴
    の最終確定足で代替しない" -- callers must surface this as an error, not
    silently substitute a stale number as if it were "now")

Unit conversion: the official `latest` endpoint's `closePrice` is on a
different scale than this system's stored `end_price` (design P2, confirmed
in SH1_API_PROBE.md M1: closePrice / endPrice = 1e18, to a relative
deviation of 1.28e-16). Every other place in this codebase deliberately
avoids doing this conversion (schema.sql's comment on `end_price`) because
`endPrice` is stored unconverted end-to-end. This module is the one new
place a raw `closePrice` enters the system at all, and design §6.1 requires
the "current value" to be directly comparable to the historical `prices`
series ("現在値 vs 期間統計を比較させる") -- so it is converted exactly once,
here, to the same units as `sf_price_history_4h.end_price`.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

import requests

from fetcher import USER_AGENT

LATEST_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/latest"
DEFAULT_TTL_SECONDS = 60.0
REQUEST_TIMEOUT_SECONDS = 5.0
UPGRADE_COUNT = 22  # itemUpgrade 0..21, matching `prices[]` (plan §8 condition 6)
PRICE_DIVISOR = 1e18  # design P2 / SH1_API_PROBE.md M1: closePrice / endPrice = 1e18


class UpstreamLatestError(RuntimeError):
    """Upstream `enhance-price/latest` failed or returned an unusable payload.

    Callers (app.py) must map this to HTTP 503 -- never substitute a
    historical value (design §6).
    """


@dataclass
class _CacheEntry:
    fetched_at: float
    result: dict[str, Any]


def parse_latest_payload(item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
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


class LatestPriceCache:
    """Per-itemId TTL cache with single-flight coalescing.

    A plain class (not module globals) so app.py can hold one instance in
    `app.state` and tests can construct independent instances with a fake
    session/clock.
    """

    def __init__(
        self,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        session: Any = None,
        timeout_seconds: float = REQUEST_TIMEOUT_SECONDS,
        clock: Any = time.monotonic,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._session = session or requests.Session()
        self._timeout_seconds = timeout_seconds
        self._clock = clock
        self._registry_lock = threading.Lock()  # protects _entries / _item_locks dict access
        self._entries: dict[int, _CacheEntry] = {}
        self._item_locks: dict[int, threading.Lock] = {}
        self.upstream_call_count = 0  # test/observability hook (plan (i): "ログで確認")

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
