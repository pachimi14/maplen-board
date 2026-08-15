"""IMPL_PLAN_SH32 §2 B: 5-minute poll of the monitored representatives ONLY.

Intended to run under a systemd timer every 5 minutes
(`deploy/sf-history-discovery-poll.timer.example`). Reads
`sf_discovery_monitored_groups` (`is_active = 1`, written exclusively by
`scripts/scan_discovery.py`'s Component A) and, for each representative
`itemId` -- never an alias, plan §2 A-1: "叩くのは代表 itemId のみ" -- GETs
the same official Open API `dynamicprice` endpoint scan_discovery.py and
`fetch_latest.py` already use, then upserts BOTH `currentPrice` and
`previousPrice` for every band 0..24 into `sf_discovery_price_history`
(`discovery.parse_dynamicprice_points` / `db.upsert_discovery_price_points`,
plan §5(d)/(e)).

★狙い (plan §2 B): catching the DISCOVERY -> CHANGE flip the moment it
happens. Since `history` never replays a DISCOVERY band after the fact
(plan §0 F2/F3), a poll that is skipped is data lost forever, not merely
delayed -- which is also why a failed representative is logged and skipped
rather than aborting the whole run (plan §2: same "部分成功でよい" discipline
as scan_discovery.py).

If there are no active monitored groups, this makes ZERO upstream requests
and exits immediately (plan §5(l)) -- the DB peek that decides this needs no
API key, so a missing `MSU_OPEN_API_KEY` is only ever a hard-stop when there
is actually something to poll.

Usage:
    python scripts/poll_discovery.py
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import discovery  # noqa: E402
import fetch_latest  # noqa: E402
import fetcher as fetcher_mod  # noqa: E402

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"

# plan §0 F8-style pacing (short interval, small request count -- currently
# 3 representatives, one GET each): sequential, still logged, still subject
# to fetcher.py's unchanged 429 backoff/hard-stop discipline.
POLL_MIN_INTERVAL_SEC = 0.25
DEFAULT_MAX_REQUESTS = 100


def run_poll(*, db_path: Path, fetcher: fetcher_mod.Fetcher, now: datetime | None = None) -> dict[str, Any]:
    """Poll every currently-active monitored representative once. `fetcher`
    is always pre-built by the caller (tests inject a fake session; `main()`
    builds the real one) -- this function is the single source of truth for
    "what happens given a fetcher and a DB", including the plan §5(l)
    zero-groups short-circuit (0 requests made in that case, regardless of
    whether `fetcher` itself was ever primed with an API key).
    """
    if now is None:
        now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    conn = db.connect(db_path)
    db.apply_schema(conn)
    groups = db.list_active_discovery_monitored_groups(conn)

    polled = 0
    failed = 0
    rows_written = 0

    for group in groups:
        item_id = group["itemId"]
        url = fetch_latest.OPEN_API_URL_TEMPLATE.format(item_id=item_id)
        try:
            status, payload, _text = fetcher.get(url, {}, endpoint="dynamicprice", note=f"poll item={item_id}")
        except requests.RequestException as exc:
            failed += 1
            print(f"poll_discovery: dynamicprice failed for representative item={item_id}: {exc}", file=sys.stderr)
            continue
        if status != 200 or payload is None:
            failed += 1
            print(f"poll_discovery: dynamicprice HTTP {status} for representative item={item_id}", file=sys.stderr)
            continue
        try:
            points_by_band = discovery.parse_dynamicprice_points(payload)
        except discovery.InvalidDynamicPricePayload as exc:
            failed += 1
            print(f"poll_discovery: dynamicprice payload invalid for representative item={item_id}: {exc}", file=sys.stderr)
            continue

        for item_upgrade, points in points_by_band.items():
            rows_written += db.upsert_discovery_price_points(conn, item_id, item_upgrade, points, now_iso)
        polled += 1

    conn.close()

    return {
        "monitoredGroups": len(groups),
        "polled": polled,
        "failed": failed,
        "rowsWritten": rows_written,
        "requestsMade": fetcher.total_requests,
        "total429": fetcher.total_429,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--max-requests", type=int, default=DEFAULT_MAX_REQUESTS)
    args = parser.parse_args()

    # plan §5(l): decide "is there anything to do at all" BEFORE requiring an
    # API key -- a quiet period (no monitored groups) must never demand key
    # provisioning just to confirm it is quiet.
    conn = db.connect(args.db)
    db.apply_schema(conn)
    groups = db.list_active_discovery_monitored_groups(conn)
    conn.close()
    if not groups:
        print("poll_discovery: no active monitored groups -- nothing to do", file=sys.stderr)
        return 0

    api_key = os.getenv("MSU_OPEN_API_KEY", "")  # ★秘密情報 -- never logged, same discipline as app.py's _open_api_key()
    if not api_key:
        print("poll_discovery: MSU_OPEN_API_KEY is not set -- cannot query the Open API. Aborting.", file=sys.stderr)
        return 2

    ftr = fetcher_mod.Fetcher(min_interval_sec=POLL_MIN_INTERVAL_SEC, max_requests=args.max_requests)
    ftr.session.headers["x-nxopen-api-key"] = api_key
    ftr.session.headers["Content-Type"] = "application/json"

    try:
        result = run_poll(db_path=args.db, fetcher=ftr)
    except (
        fetcher_mod.RequestBudgetExceededError,
        fetcher_mod.ConsecutiveTooManyRequestsError,
        fetcher_mod.TotalTooManyRequestsExceededError,
    ) as exc:
        print(f"poll_discovery: stopped early: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    print(
        f"poll_discovery: monitoredGroups={result['monitoredGroups']} polled={result['polled']} "
        f"failed={result['failed']} rowsWritten={result['rowsWritten']} "
        f"requests={result['requestsMade']} x429={result['total429']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
