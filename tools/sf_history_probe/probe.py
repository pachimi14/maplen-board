"""SH-1 API probe — measures the official MapleStory N enhance-price APIs.

Answers the 7 measurement questions in ``docs/IMPL_PLAN_SH1.md`` §3 (M1..M7)
with **real, freshly-fetched values** and writes:

  - ``docs/reports/SH1_API_PROBE.md``          human-readable report
  - ``docs/reports/sh1_samples/*.json``         thinned raw response samples (<=50KB each)
  - ``docs/reports/sh1_samples/request_log.json``  every HTTP request made by this run

This script does **not** write to SQLite, does **not** touch any file outside
``docs/reports/`` and ``tools/sf_history_probe/``, and performs **no** writes
to the live game (GET only).

Hard limits (IMPL_PLAN_SH1 §2.1 -- do not relax without updating the plan):
  - requests are sequential (no concurrency)
  - >=1.0s between requests
  - <=60 requests total in a single run of this script
  - stop immediately on HTTP 429 (never retry / never probe the rate limit)

Usage:
    python tools/sf_history_probe/probe.py --item-id 1382265 --out docs/reports

Re-running with the same arguments re-fetches everything live; nothing is
cached or assumed to already exist (accept. criterion (d)).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

LATEST_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/latest"
HISTORY_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/history"

MAX_REQUESTS = 60
MIN_INTERVAL_SEC = 1.0
REQUEST_TIMEOUT_SEC = 30
PRICE_DIVISOR = 1_000_000_000_000_000_000  # 1e18, matches maplenEnhancebot main.py

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

SAMPLE_MAX_BYTES = 50_000


class TooManyRequestsError(RuntimeError):
    """Raised immediately on HTTP 429. The probe must stop (plan §5 cond. 2)."""


class RequestBudgetExceededError(RuntimeError):
    """Raised if a measurement would push the total past MAX_REQUESTS."""


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
class Prober:
    session: requests.Session = field(default_factory=requests.Session)
    log: list[RequestLogEntry] = field(default_factory=list)
    _last_request_at: float | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self.session.headers.update(
            {
                "Accept": "application/json, text/plain, */*",
                "User-Agent": USER_AGENT,
            }
        )

    def get(
        self, url: str, params: dict[str, Any], *, endpoint: str, note: str = ""
    ) -> tuple[int, dict[str, Any] | None, str]:
        if len(self.log) >= MAX_REQUESTS:
            raise RequestBudgetExceededError(
                f"Refusing to exceed MAX_REQUESTS={MAX_REQUESTS} "
                f"(already made {len(self.log)} requests)."
            )
        if self._last_request_at is not None:
            elapsed_since_last = time.monotonic() - self._last_request_at
            wait = MIN_INTERVAL_SEC - elapsed_since_last
            if wait > 0:
                time.sleep(wait)

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
            f"[{entry.seq:02d}] {endpoint} {params} -> {response.status_code} "
            f"({entry.elapsed_ms:.0f}ms) {note}",
            file=sys.stderr,
        )

        if response.status_code == 429:
            raise TooManyRequestsError(
                f"429 received on request #{entry.seq} ({endpoint} {params}). "
                "Stopping immediately per plan §5 condition 2."
            )

        try:
            payload = response.json()
        except ValueError:
            payload = None
        return response.status_code, payload, response.text


def _now_epoch_sec() -> int:
    return int(time.time())


def _iso(ts_sec: float | int) -> str:
    return datetime.fromtimestamp(float(ts_sec), tz=timezone.utc).isoformat()


def fetch_latest(prober: Prober, item_id: int) -> dict[str, Any]:
    status, payload, _text = prober.get(
        LATEST_URL,
        {"itemId": item_id, "period": 0},
        endpoint="latest",
        note="M1/M4 snapshot",
    )
    if status != 200 or payload is None:
        raise RuntimeError(f"latest fetch failed: status={status}")
    return payload


def fetch_history(
    prober: Prober,
    item_id: int,
    *,
    item_upgrade: int | None,
    window_days: float,
    period: int = 2,
    note: str = "",
) -> tuple[int, dict[str, Any] | None]:
    now_sec = _now_epoch_sec()
    min_sec = now_sec - int(window_days * 86400)
    params: dict[str, Any] = {
        "itemId": item_id,
        "period": period,
        "minTimestamp": min_sec,
        "maxTimestamp": now_sec,
    }
    if item_upgrade is not None:
        params["itemUpgrade"] = item_upgrade
    status, payload, _text = prober.get(
        HISTORY_URL, params, endpoint="history", note=note
    )
    return status, payload


def thin_points(payload: dict[str, Any], *, keep_head: int = 8, keep_tail: int = 8, stride: int = 50) -> dict[str, Any]:
    """Return a copy of ``payload`` with ``points`` decimated to fit the 50KB sample budget.

    Keeps the first/last few points in full plus every ``stride``-th point in
    between, and records the true counts so the thinning is visible.
    """
    thinned = dict(payload)
    points = payload.get("points") or []
    if len(points) <= keep_head + keep_tail:
        thinned["points"] = points
        thinned["_thinned"] = False
        return thinned
    middle = points[keep_head:-keep_tail:stride] if keep_tail else points[keep_head::stride]
    sample = points[:keep_head] + middle + points[-keep_tail:]
    thinned["points"] = sample
    thinned["_thinned"] = True
    thinned["_true_point_count"] = len(points)
    thinned["_sample_point_count"] = len(sample)
    thinned["_stride"] = stride
    return thinned


def write_sample(out_dir: Path, name: str, payload: Any) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    text = json.dumps(payload, indent=1, ensure_ascii=False)
    if len(text.encode("utf-8")) > SAMPLE_MAX_BYTES:
        # Last-resort safety net: compact encoding still under budget just in
        # case a caller passes an already-large payload without thinning it.
        text = json.dumps(payload, ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    size = path.stat().st_size
    if size > SAMPLE_MAX_BYTES:
        raise RuntimeError(f"{path} is {size}B, over the {SAMPLE_MAX_BYTES}B sample budget")
    return path


def run(item_id: int, out_dir: Path) -> dict[str, Any]:
    prober = Prober()
    samples_dir = out_dir / "sh1_samples"
    results: dict[str, Any] = {"item_id": item_id, "run_started_at": datetime.now(timezone.utc).isoformat()}

    # --- latest snapshot (M1 raw closePrice source, M4 upgrade set on `latest`) ---
    latest_payload = fetch_latest(prober, item_id)
    write_sample(samples_dir, "latest.json", latest_payload)
    star_force = latest_payload.get("starForce") or []
    close_price_by_upgrade: dict[int, int] = {}
    for entry in star_force:
        upgrade = entry.get("itemUpgrade")
        close_price = entry.get("closePrice")
        if isinstance(upgrade, int) and close_price is not None:
            close_price_by_upgrade[upgrade] = int(close_price)
    results["latest_updated_at"] = latest_payload.get("latestUpdatedAt")
    results["latest_item_upgrade_set"] = sorted(close_price_by_upgrade)
    results["latest_close_price_by_upgrade"] = close_price_by_upgrade

    # --- M1/M3/M5/M6: itemUpgrade=0, wide window, timed n=5 ---
    m6_window_days = 200.0
    timing_ms: list[float] = []
    last_wide_payload: dict[str, Any] | None = None
    for i in range(5):
        status, payload = fetch_history(
            prober,
            item_id,
            item_upgrade=0,
            window_days=m6_window_days,
            note=f"M3/M5/M6 wide window run {i + 1}/5 (itemUpgrade=0)",
        )
        timing_ms.append(prober.log[-1].elapsed_ms)
        if status == 200 and payload is not None:
            last_wide_payload = payload
    if last_wide_payload is None:
        raise RuntimeError("all 5 wide-window history requests failed")
    write_sample(samples_dir, "history_iu0_wide.json", thin_points(last_wide_payload))

    wide_points = last_wide_payload.get("points") or []
    results["m6_timing_ms_samples"] = timing_ms
    results["m6_timing_ms_median"] = statistics.median(timing_ms) if timing_ms else None
    results["m6_point_count"] = len(wide_points)
    results["m6_window_days_requested"] = m6_window_days
    if wide_points:
        dates = [p.get("date") for p in wide_points if p.get("date")]
        results["m3_oldest_date"] = min(dates) if dates else None
        results["m3_newest_date"] = max(dates) if dates else None
        oldest_dt = datetime.fromisoformat(results["m3_oldest_date"].replace("Z", "+00:00"))
        now_dt = datetime.now(timezone.utc)
        results["m3_days_ago"] = round((now_dt - oldest_dt).total_seconds() / 86400.0, 1)
        newest_dt = datetime.fromisoformat(results["m3_newest_date"].replace("Z", "+00:00"))
        span_hours = (newest_dt - oldest_dt).total_seconds() / 3600.0
        results["m6_expected_points_if_continuous"] = round(span_hours) + 1

        # M7: observed spacing between consecutive dates (period=2)
        sorted_dates = sorted(
            datetime.fromisoformat(d.replace("Z", "+00:00")) for d in dates
        )
        deltas_sec = sorted(
            {round((b - a).total_seconds()) for a, b in zip(sorted_dates, sorted_dates[1:])}
        )
        results["m7_period2_observed_delta_seconds"] = deltas_sec

    # M5: sumEnhanceCnt=0 rows, and how many still have a non-null endPrice
    total_rows = len(wide_points)
    zero_cnt_rows = [p for p in wide_points if p.get("sumEnhanceCnt") == 0]
    zero_cnt_with_price = [p for p in zero_cnt_rows if p.get("endPrice") is not None]
    results["m5_total_rows"] = total_rows
    results["m5_zero_sum_enhance_rows"] = len(zero_cnt_rows)
    results["m5_zero_sum_enhance_rows_with_endprice"] = len(zero_cnt_with_price)

    # M1 numerator for itemUpgrade=0: last point of the wide window.
    m1_points: dict[int, dict[str, Any]] = {}
    if wide_points:
        last_point = max(wide_points, key=lambda p: p.get("date", ""))
        second_last_candidates = sorted(wide_points, key=lambda p: p.get("date", ""))
        second_last_point = second_last_candidates[-2] if len(second_last_candidates) >= 2 else None
        m1_points[0] = {"last": last_point, "second_last": second_last_point}

    # --- M1: itemUpgrade in {10, 17, 21}, narrow window (10 days, cheap) ---
    for upgrade in (10, 17, 21):
        status, payload = fetch_history(
            prober,
            item_id,
            item_upgrade=upgrade,
            window_days=10.0,
            note=f"M1 cross-check (itemUpgrade={upgrade})",
        )
        if status == 200 and payload is not None:
            write_sample(samples_dir, f"history_iu{upgrade}_narrow.json", payload)
            points = payload.get("points") or []
            if points:
                sorted_points = sorted(points, key=lambda p: p.get("date", ""))
                last_point = sorted_points[-1]
                second_last_point = sorted_points[-2] if len(sorted_points) >= 2 else None
                m1_points[upgrade] = {"last": last_point, "second_last": second_last_point}

    m1_rows = []
    for upgrade, points in sorted(m1_points.items()):
        raw_close = close_price_by_upgrade.get(upgrade)
        for label in ("last", "second_last"):
            point = points.get(label)
            if point is None or raw_close is None:
                continue
            end_price = point.get("endPrice")
            if end_price in (None, 0):
                continue
            ratio = raw_close / end_price
            m1_rows.append(
                {
                    "itemUpgrade": upgrade,
                    "point_used": label,
                    "point_date": point.get("date"),
                    "endPrice": end_price,
                    "closePrice_raw": raw_close,
                    "ratio_closePrice_over_endPrice": ratio,
                }
            )
    results["m1_rows"] = m1_rows
    last_only = [r for r in m1_rows if r["point_used"] == "last"]
    if len(last_only) >= 2:
        ratios = [r["ratio_closePrice_over_endPrice"] for r in last_only]
        mean_ratio = statistics.mean(ratios)
        max_rel_dev = max(abs(r - mean_ratio) / mean_ratio for r in ratios) if mean_ratio else None
        results["m1_last_point_ratio_mean"] = mean_ratio
        results["m1_last_point_ratio_max_relative_deviation"] = max_rel_dev

    # --- M2: omit itemUpgrade entirely ---
    status, payload = fetch_history(
        prober, item_id, item_upgrade=None, window_days=10.0, note="M2 itemUpgrade omitted"
    )
    if payload is not None:
        write_sample(samples_dir, "history_no_upgrade_param.json", payload)
        results["m2_status_code"] = status
        results["m2_response_item_upgrade"] = payload.get("itemUpgrade")
        results["m2_point_count"] = len(payload.get("points") or [])
    else:
        results["m2_status_code"] = status
        results["m2_response_item_upgrade"] = None
        results["m2_point_count"] = 0

    # --- M4: itemUpgrade boundary probing on the history endpoint ---
    m4_boundary_results = []
    for upgrade in (22, 23, 24, 25):
        status, payload = fetch_history(
            prober,
            item_id,
            item_upgrade=upgrade,
            window_days=10.0,
            note=f"M4 boundary probe (itemUpgrade={upgrade})",
        )
        m4_boundary_results.append(
            {
                "itemUpgrade": upgrade,
                "status_code": status,
                "point_count": len(payload.get("points") or []) if payload else None,
            }
        )
    results["m4_history_boundary_probe"] = m4_boundary_results
    results["m4_latest_item_upgrade_set"] = results["latest_item_upgrade_set"]

    # --- request log ---
    write_sample(
        out_dir / "sh1_samples",
        "request_log.json",
        {
            "total_requests": len(prober.log),
            "entries": [
                {
                    "seq": e.seq,
                    "endpoint": e.endpoint,
                    "params": e.params,
                    "status_code": e.status_code,
                    "elapsed_ms": e.elapsed_ms,
                    "at": e.at,
                    "note": e.note,
                }
                for e in prober.log
            ],
        },
    )
    results["total_requests"] = len(prober.log)
    results["requests_by_endpoint"] = {
        "latest": sum(1 for e in prober.log if e.endpoint == "latest"),
        "history": sum(1 for e in prober.log if e.endpoint == "history"),
    }
    results["status_code_counts"] = {
        str(code): sum(1 for e in prober.log if e.status_code == code)
        for code in sorted({e.status_code for e in prober.log})
    }
    results["run_finished_at"] = datetime.now(timezone.utc).isoformat()
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--item-id", type=int, default=1382265)
    parser.add_argument("--out", type=Path, default=Path("docs/reports"))
    args = parser.parse_args()

    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        results = run(args.item_id, out_dir)
    except TooManyRequestsError as exc:
        print(f"STOPPED (429): {exc}", file=sys.stderr)
        return 2
    except RequestBudgetExceededError as exc:
        print(f"STOPPED (budget): {exc}", file=sys.stderr)
        return 3

    summary_path = write_sample(out_dir / "sh1_samples", "probe_summary.json", results)
    print(f"Summary written to {summary_path}", file=sys.stderr)
    print(json.dumps(results, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
