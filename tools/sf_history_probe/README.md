# sf_history_probe

Investigation script for SH-1 (`docs/IMPL_PLAN_SH1.md`). Measures the **official**
MapleStory N dynamic-pricing APIs so `docs/DESIGN_SF_COST_HISTORY.md` §2's
`要検証` premises (P1–P4, P10-adjacent) can be decided from real numbers
instead of assumption.

**This tool does not write to any database and is not used in production.**
It is a one-shot investigation script; SH-2+ build the real fetch/store
pipeline separately (and will not import from here).

## Run

```bash
python tools/sf_history_probe/probe.py --item-id 1382265 --out docs/reports
```

Re-running fetches everything live again (nothing is cached, nothing assumes
a prior run happened). Writes:

- `docs/reports/sh1_samples/*.json` — thinned raw response samples (≤50KB each)
  and a full `request_log.json` of every HTTP call made
- `docs/reports/sh1_samples/probe_summary.json` — the computed M1–M7 values
- stdout: the same summary as pretty JSON; stderr: one line per request

## Hard limits (do not relax without updating IMPL_PLAN_SH1 §2.1)

- Sequential requests only (`Prober.get` blocks internally — no `asyncio`/threads)
- ≥1.0s between requests (enforced by `Prober.get`, not just "please sleep")
- ≤60 requests per run (`MAX_REQUESTS`; the script raises rather than exceed it)
- **Stops immediately on HTTP 429** (`TooManyRequestsError`) — it never retries
  and never probes where the rate limit actually is

A single run makes **14 requests** (1 `latest` + 13 `history`) against
`itemId=1382265`. See `docs/reports/sh1_samples/request_log.json` for the
exact sequence, parameters, status codes, and timings of the run that
produced `docs/reports/SH1_API_PROBE.md`.

## What each measurement maps to (IMPL_PLAN_SH1 §3)

| Function in `probe.py` | Answers |
|---|---|
| `fetch_latest` | M1 (raw `closePrice` per `itemUpgrade`), M4 (the `itemUpgrade` set `latest` itself reports) |
| `fetch_history(item_upgrade=0, window_days=200)` × 5, timed | M6 (median request time, point count, whether the request is paginated), and its `points` feed M3 (oldest returned `date`) and M5 (`sumEnhanceCnt==0` rows vs. `endPrice` non-null count) |
| `fetch_history(item_upgrade=10/17/21, window_days=10)` | M1 cross-check across `itemUpgrade` |
| `fetch_history(item_upgrade=None, window_days=10)` | M2 (does omitting `itemUpgrade` return all stars, or a default single star?) |
| `fetch_history(item_upgrade=22/23/24/25, window_days=10)` | M4 (valid `itemUpgrade` range on the `history` endpoint specifically) |
| dates in the M6 wide-window response | M7 (spacing between consecutive `date` values at `period=2`) |

## Parameters discovered empirically (not documented anywhere upstream)

These were **not** knowable from the design doc or from reading
`maplenEnhancebot` (which only ever calls `enhance-price/latest`, never
`history`). They were found by minimal exploratory calls before writing this
script, and are now baked into `probe.py`:

- `minTimestamp` / `maxTimestamp` are **Unix epoch seconds**, not milliseconds
  (milliseconds are silently accepted — no error — but return `"points": []`
  because the value is astronomically outside any real data window; this
  fails **silently**, so anyone integrating this endpoint must know this
  up front)
- `period=0`, `period=6`, `period=7` → HTTP 400 (`failed command validation`).
  `period=1..5` → HTTP 200. Only `period=2` was verified to mean "1 hour"
  (see M7 in the report); the meaning of 1/3/4/5 was **not** determined
  (out of scope for SH-1's M7, which only asks about `period=2`)
- Omitting `itemUpgrade` does not return "all stars" — the response comes
  back with `itemUpgrade: 0` and the same data as explicitly passing
  `itemUpgrade=0` (see M2 in the report)
- `itemUpgrade=25` on the `history` endpoint returns **HTTP 500**, not 400
  or an empty body
