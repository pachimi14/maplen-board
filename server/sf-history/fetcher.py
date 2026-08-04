"""Official ``enhance-price/history`` fetcher for the SH-2 backfill.

This follows the rate-control discipline established by SH-1's
``tools/sf_history_probe/probe.py`` (sequential requests, >=1.0s between
requests, a hard request budget, User-Agent set explicitly, every request
logged) and extends it for a much larger run (IMPL_PLAN_SH2 §2):

  - the request budget is 700 (616 = 28 items x 22 upgrades, plus retry
    headroom), not 60
  - HTTP 429 no longer stops immediately on the first occurrence -- it backs
    off exponentially and retries the *same* request, because a 616-request
    run is far more likely to graze a transient limit than a 45-request
    probe was. It still stops hard, and well before doing real damage:
    3 consecutive 429s, or more than 5 total 429s across the run, raise and
    the caller (scripts/backfill.py) must stop (plan §7 condition 1).

All HTTP calls in this backfill -- including the one-off ones made while
developing/debugging it -- must go through this ``Fetcher`` (SH-1's P2
retrospective: "手動確認も必ず同じ Fetcher を通す").
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import requests

LATEST_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/latest"
HISTORY_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/history"

DEFAULT_MAX_REQUESTS = 700
MIN_INTERVAL_SEC = 1.0
REQUEST_TIMEOUT_SEC = 30

# Backoff waited *before* retrying the Nth consecutive 429 (N=1,2,3,...).
# In practice only the first two entries are ever used: the 3rd consecutive
# 429 hits MAX_CONSECUTIVE_429 and raises instead of waiting/retrying again.
BACKOFF_SCHEDULE_SEC: tuple[float, ...] = (5.0, 15.0, 45.0)
MAX_CONSECUTIVE_429 = 3
MAX_TOTAL_429 = 5

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


class RequestBudgetExceededError(RuntimeError):
    """Raised if a request would push the total past ``max_requests``."""


class ConsecutiveTooManyRequestsError(RuntimeError):
    """3 consecutive HTTP 429 responses -- hard stop (plan §7 condition 1)."""


class TotalTooManyRequestsExceededError(RuntimeError):
    """More than 5 total HTTP 429 responses in this run -- hard stop (plan §7 condition 1)."""


@dataclass
class RequestLogEntry:
    seq: int
    endpoint: str
    params: dict[str, Any]
    status_code: int
    elapsed_ms: float
    at: str
    note: str = ""


@dataclass
class Fetcher:
    session: requests.Session = field(default_factory=requests.Session)
    log: list[RequestLogEntry] = field(default_factory=list)
    max_requests: int = DEFAULT_MAX_REQUESTS
    min_interval_sec: float = MIN_INTERVAL_SEC
    _last_request_at: float | None = field(default=None, repr=False)
    _consecutive_429: int = field(default=0, repr=False)
    _total_429: int = field(default=0, repr=False)

    def __post_init__(self) -> None:
        self.session.headers.update(
            {
                "Accept": "application/json, text/plain, */*",
                "User-Agent": USER_AGENT,
            }
        )

    @property
    def total_requests(self) -> int:
        return len(self.log)

    @property
    def total_429(self) -> int:
        return self._total_429

    def get(
        self, url: str, params: dict[str, Any], *, endpoint: str, note: str = ""
    ) -> tuple[int, dict[str, Any] | None, str]:
        """GET with rate-limiting, retry-on-429, and full logging.

        Returns ``(status_code, payload_or_None, raw_text)`` for any non-429
        terminal response. Raises on budget exhaustion or persistent 429s.
        """
        while True:
            if len(self.log) >= self.max_requests:
                raise RequestBudgetExceededError(
                    f"Refusing to exceed max_requests={self.max_requests} "
                    f"(already made {len(self.log)} requests)."
                )
            self._wait_for_interval()
            status, payload, text = self._do_request(url, params, endpoint=endpoint, note=note)

            if status != 429:
                self._consecutive_429 = 0
                return status, payload, text

            self._consecutive_429 += 1
            self._total_429 += 1

            if self._consecutive_429 >= MAX_CONSECUTIVE_429:
                raise ConsecutiveTooManyRequestsError(
                    f"{self._consecutive_429} consecutive HTTP 429 responses "
                    f"(last: {endpoint} {params}). Stopping per plan §7 condition 1."
                )
            if self._total_429 > MAX_TOTAL_429:
                raise TotalTooManyRequestsExceededError(
                    f"{self._total_429} total HTTP 429 responses in this run "
                    f"(last: {endpoint} {params}). Stopping per plan §7 condition 1."
                )

            wait_idx = min(self._consecutive_429 - 1, len(BACKOFF_SCHEDULE_SEC) - 1)
            wait_sec = BACKOFF_SCHEDULE_SEC[wait_idx]
            print(
                f"429 received (consecutive={self._consecutive_429}, "
                f"total={self._total_429}); backing off {wait_sec:.0f}s before retry",
                file=sys.stderr,
            )
            time.sleep(wait_sec)
            # loop back and retry the same request

    def _wait_for_interval(self) -> None:
        if self._last_request_at is not None:
            elapsed_since_last = time.monotonic() - self._last_request_at
            wait = self.min_interval_sec - elapsed_since_last
            if wait > 0:
                time.sleep(wait)

    def _do_request(
        self, url: str, params: dict[str, Any], *, endpoint: str, note: str
    ) -> tuple[int, dict[str, Any] | None, str]:
        start = time.monotonic()
        response = self.session.get(url, params=params, timeout=REQUEST_TIMEOUT_SEC)
        elapsed_ms = (time.monotonic() - start) * 1000.0
        self._last_request_at = time.monotonic()

        entry = RequestLogEntry(
            seq=len(self.log) + 1,
            endpoint=endpoint,
            params=params,
            status_code=response.status_code,
            elapsed_ms=round(elapsed_ms, 1),
            at=datetime.now(timezone.utc).isoformat(),
            note=note,
        )
        self.log.append(entry)
        print(
            f"[{entry.seq:04d}] {endpoint} {params} -> {response.status_code} "
            f"({entry.elapsed_ms:.0f}ms) {note}",
            file=sys.stderr,
        )

        try:
            payload = response.json()
        except ValueError:
            payload = None
        return response.status_code, payload, response.text

    def log_as_dicts(self) -> list[dict[str, Any]]:
        return [
            {
                "seq": e.seq,
                "endpoint": e.endpoint,
                "params": e.params,
                "status_code": e.status_code,
                "elapsed_ms": e.elapsed_ms,
                "at": e.at,
                "note": e.note,
            }
            for e in self.log
        ]


def _now_epoch_sec() -> int:
    return int(time.time())


def fetch_history_page(
    fetcher: Fetcher,
    item_id: int,
    *,
    item_upgrade: int,
    window_days: float,
    period: int = 2,
    note: str = "",
) -> tuple[int, dict[str, Any] | None]:
    """Fetch one (item_id, item_upgrade) page of 1-hour history.

    ``itemUpgrade`` must always be passed explicitly -- SH-1 M2 confirmed
    omitting it silently returns the itemUpgrade=0 series, not "all stars".
    """
    now_sec = _now_epoch_sec()
    min_sec = now_sec - int(window_days * 86400)
    params: dict[str, Any] = {
        "itemId": item_id,
        "itemUpgrade": item_upgrade,
        "period": period,
        "minTimestamp": min_sec,
        "maxTimestamp": now_sec,
    }
    status, payload, _text = fetcher.get(HISTORY_URL, params, endpoint="history", note=note)
    return status, payload
