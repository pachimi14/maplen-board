"""Official ``enhance-price/history`` fetcher for the SH-2 backfill.

This follows the rate-control discipline established by SH-1's
``tools/sf_history_probe/probe.py`` (sequential requests, >=1.0s between
requests, a hard request budget, User-Agent set explicitly, every request
logged) and extends it for a much larger run (IMPL_PLAN_SH2 §2):

  - every ``Fetcher`` is given a hard request budget (not 60, SH-1's probe
    size). ``DEFAULT_MAX_REQUESTS`` (700) is a static fallback for callers
    that pick their own budget explicitly (``scripts/backfill.py`` /
    ``scripts/cube_backfill.py``, both driven by an operator-controlled
    ``--max-requests`` flag). Callers whose workload size is data-derived
    and grows over time (``scripts/update.py``'s differential update) must
    NOT hardcode a budget against a snapshot of "how many combos there are
    today" -- IMPL_PLAN_SH39 follow-up (統括, 2026-08-22 本番実測): a budget
    frozen at 700 against a docstring's stale equipment-count-derived figure
    silently truncated every run once the equipment list grew past that
    figure (more combos than the budget), dropping the list's tail-end
    updates on EVERY run with a 0 exit code nobody was watching. ``derive_max_requests``
    below exists for exactly this class of caller: it recomputes the budget
    from the actual combo count every run, so the number can never go stale
    again.
  - HTTP 429 no longer stops immediately on the first occurrence -- it backs
    off exponentially and retries the *same* request, because a large run is
    far more likely to graze a transient limit than a 45-request probe was.
    It still stops hard, and well before doing real damage: 3 consecutive
    429s, or more than 5 total 429s across the run, raise and the caller
    must stop (plan §7 condition 1). This IS the rate-limit safety net --
    the request budget above is a coarser, separate safety net ("did this
    run do roughly the amount of work it set out to do", not "are we being
    polite to the upstream").

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

# Retry headroom added on top of a workload's own combo count by
# `derive_max_requests` below. Bounded by what a run's OTHER safety net (the
# 429 counters above) can even let happen before it hard-stops the run on
# its own: at most MAX_TOTAL_429 (5) 429 responses are tolerated across an
# entire run before TotalTooManyRequestsExceededError raises, and each one
# costs at most one retried request slot -- so at most 5 request slots can
# ever be "wasted" on legitimate retries before that other safety net fires.
# 50 gives an order of magnitude of comfortable margin above that bound
# without being large enough to mask an actual runaway (this budget's job).
REQUEST_BUDGET_HEADROOM = 50

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


def fetch_prospective_history_page(
    fetcher: Fetcher,
    item_id: int,
    *,
    cube_sub_type: str,
    window_days: float,
    period: int = 2,
    note: str = "",
) -> tuple[int, dict[str, Any] | None]:
    """Fetch one (item_id, cube_sub_type) page of 1-hour CUBE price history.

    IMPL_PLAN_SH39: same ``HISTORY_URL`` as ``fetch_history_page``, with
    ``itemUpgradeType=UPGRADE_PROSPECTIVE`` and ``itemUpgradeSubType=
    <cube_sub_type>`` (one of ``cube.CUBE_SUB_TYPES``) added, and
    ``itemUpgrade`` always fixed at 0 (plan §0 I4: a cube has no star concept
    -- ``1``/``10`` are both 0-point upstream, only ``0`` is valid).

    A DELIBERATELY separate function, not a new optional parameter bolted
    onto ``fetch_history_page`` -- plan §7: "``fetch_history_page`` は SF
    専用のまま変えず、prospective 用の関数を別に足す" -- so that function's
    existing signature/behavior stays byte-for-byte unchanged (accept
    criterion (g)).
    """
    now_sec = _now_epoch_sec()
    min_sec = now_sec - int(window_days * 86400)
    params: dict[str, Any] = {
        "itemId": item_id,
        "itemUpgradeType": "UPGRADE_PROSPECTIVE",
        "itemUpgradeSubType": cube_sub_type,
        "itemUpgrade": 0,
        "period": period,
        "minTimestamp": min_sec,
        "maxTimestamp": now_sec,
    }
    status, payload, _text = fetcher.get(
        HISTORY_URL, params, endpoint="history-prospective", note=note
    )
    return status, payload


def derive_max_requests(combo_count: int, *, headroom: int = REQUEST_BUDGET_HEADROOM) -> int:
    """The request budget a workload of ``combo_count`` (item, sub-key) pairs
    needs: enough for every combo to be attempted once, plus ``headroom`` for
    legitimate retries (see ``REQUEST_BUDGET_HEADROOM``'s own comment).

    This is the fix for the class of bug IMPL_PLAN_SH39's follow-up found in
    production: a budget PINNED to a snapshot of "how many combos there were
    when this constant was written" goes stale the moment the workload grows
    (``scripts/update.py``'s ``run_update``/``run_cube_update`` now call this
    every run instead of defaulting to ``DEFAULT_MAX_REQUESTS`` -- the budget
    is always freshly derived from the ACTUAL equipment list being iterated,
    never a number frozen at some past commit).

    Deliberately does NOT clamp against ``DEFAULT_MAX_REQUESTS`` in either
    direction -- a caller with more or fewer combos than the historical 700
    figure must get a budget sized for its OWN real workload, not the old
    constant.
    """
    return combo_count + headroom
