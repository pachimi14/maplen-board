# SF Price History -- SH-2 (Backfill)

SH-2 builds the SQLite database that later slices (SH-3 service, SH-5 UI)
read from. It runs entirely on the main PC -- it does not touch the VPS
(design: `docs/DESIGN_SF_COST_HISTORY.md` §5.3, plan: `docs/IMPL_PLAN_SH2.md`).

This directory follows the same structure as `server/img-proxy/` (the
established precedent for services under `api.lulumi-tools.com`), but SH-2
only needs `requests` -- FastAPI/uvicorn are SH-3's concern (`app.py` does not
exist yet).

## Files

```text
schema.sql                          sf_price_history_hourly + sf_history_backfill_progress
db.py                                connect / apply_schema / upsert / progress read-write
fetcher.py                           rate-limited, 429-backoff HTTP GET (all requests go through this)
scripts/gen_item_list.py             generates data/sf_history_items.json (reads maplenEnhancebot, read-only)
scripts/backfill.py                  resumable backfill: 28 items x itemUpgrade 0..21 x ~150 days
scripts/audit_high_star_plateau.py   design §9.2: do the ☆20/☆21 end_price series match exactly?
data/sf_history_items.json           committed snapshot of the target equipment list
data/.gitignore                      *.sqlite* is never committed (SH-2 §8)
tests/                                offline pytest (no network)
```

## Local run

```bash
cd server/sf-history
python -m pip install -r requirements-dev.txt
python -m pytest .

# 1. Regenerate the target equipment list (reads maplenEnhancebot read-only).
python scripts/gen_item_list.py

# 2. Backfill. Resumable: re-running skips (item, itemUpgrade) combinations
#    already marked status='done'. Ctrl-C at any time is safe.
python scripts/backfill.py

# Smoke test with a small slice:
python scripts/backfill.py --limit 5

# 3. §9.2 audit (after backfill has data for itemUpgrade 20 and 21):
python scripts/audit_high_star_plateau.py
```

## Rate-limit discipline (IMPL_PLAN_SH2 §2)

All HTTP requests -- including any ad-hoc/manual checks -- must go through
`fetcher.Fetcher`, which the scripts above already use:

- sequential (no concurrency), >=1.0s between requests
- request budget: 700 per process run (616 = 28 items x 22 upgrades, plus
  retry headroom)
- HTTP 429: exponential backoff (5s / 15s / 45s) and retry the same request;
  3 consecutive 429s, or more than 5 total 429s in one run, raise and stop
  the whole backfill
- explicit `User-Agent`; every request (success or failure) is logged

## `end_price` is never converted

`sf_price_history_hourly.end_price` stores the official API's `endPrice`
value **unconverted**. SH-1 confirmed `closePrice / endPrice = 1e18`
(`docs/reports/SH1_API_PROBE.md` M1); this table is deliberately in the same
NESO units as `endPrice`, not `closePrice`. Do not add a `* 1e18` or
`/ 1e18` anywhere against this column -- see the comment in `schema.sql`.

## itemUpgrade 22 is intentionally not fetched

The tool's ceiling is reaching 22 stars, so the most advanced price ever
needed is the 21->22 step, i.e. `itemUpgrade=21`. `itemUpgrade` ranges over
`0..21` (22 values) in this backfill; `itemUpgrade=22` is out of scope
(design §9.1's `requiredPriceStars` never needs it).

## §9.2: the ☆20/☆21/☆22 plateau question

`docs/DESIGN_SF_COST_HISTORY.md` §9.2 records that a single `latest`
snapshot showed itemUpgrade 20/21/22 sharing the exact same `closePrice`.
`scripts/audit_high_star_plateau.py` reports, over the full backfill, how
often the itemUpgrade=20 and itemUpgrade=21 `end_price` series match exactly
per equipment -- `itemUpgrade=22` cannot be checked here because SH-2 never
fetches it. **This script only reports counts; it does not decide** whether
the result reflects real market behavior or an API clamp (that judgment is
U6 in the design doc, reserved for 統括 + ユーザー, per IMPL_PLAN_SH2 §7).
