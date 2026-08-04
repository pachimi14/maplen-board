# SF Price History -- `server/sf-history/`

SH-2 built the SQLite backfill (`sf_price_history_hourly`); SH-3 adds the
4-hour derivation, the FastAPI service, and the current-price proxy. This
directory follows the same structure and conventions as `server/img-proxy/`
(the established precedent for services under `api.lulumi-tools.com`):
FastAPI + systemd + Caddy + offline pytest, per-request CORS computed from an
env var rather than baked into middleware, and tests that call route
functions directly (no `TestClient`/`httpx` dependency).

**SH-3 does not touch the VPS.** It runs and is verified locally; VPS
deployment is SH-6 (`docs/reports/SH1B_VPS_PROBE.md` has the real Caddyfile
shape and the confirmed-free port, 8785).

## Files

```text
schema.sql                          sf_price_history_hourly + sf_history_backfill_progress + sf_price_history_4h
db.py                                connect / apply_schema / hourly + 4h read-write / progress read-write
fetcher.py                           rate-limited, 429-backoff HTTP GET for `history` (backfill.py / update.py)
aggregate.py                         SH-3 §3: deterministic hourly -> 4h derivation (design §9)
fetch_latest.py                      SH-3 §5: TTL-60s, single-flight `enhance-price/latest` proxy (design §6)
app.py                               SH-3 §4: FastAPI app (health / equipment / prices / latest)
scripts/gen_item_list.py             generates data/sf_history_items.json (reads maplenEnhancebot, read-only)
scripts/backfill.py                  resumable backfill: 28 items x itemUpgrade 0..21 x ~150 days
scripts/rebuild_4h.py                full, deterministic rebuild of sf_price_history_4h
scripts/update.py                    4-hourly differential fetch + incremental 4h re-derivation (design §5.2)
scripts/audit_high_star_plateau.py   design §9.2: do the ☆20/☆21 end_price series match exactly?
data/sf_history_items.json           committed snapshot of the target equipment list (incl. maxStar)
data/.gitignore                      *.sqlite* is never committed (SH-2 §8)
deploy/                              Caddyfile / systemd .service / .timer *.example files (SH-6 reads these)
tests/                                offline pytest (no network -- see "Offline by design" below)
```

## Local run

```bash
cd server/sf-history
python -m pip install -r requirements-dev.txt
python -m pytest .

# 1. Regenerate the target equipment list (reads maplenEnhancebot read-only,
#    and data/sf_price_history.sqlite if present, for maxStar).
python scripts/gen_item_list.py

# 2. Backfill (SH-2). Resumable: re-running skips (item, itemUpgrade)
#    combinations already marked status='done'. Ctrl-C at any time is safe.
python scripts/backfill.py

# Smoke test with a small slice:
python scripts/backfill.py --limit 5

# 3. §9.2 audit (after backfill has data for itemUpgrade 20 and 21):
python scripts/audit_high_star_plateau.py

# 4. Derive the 4h table from hourly (SH-3). Safe to re-run any time --
#    it is a pure function of the hourly data and `now`.
python scripts/rebuild_4h.py

# 5. Run the service.
python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1

# 6. The 4-hourly differential job (what a systemd timer runs in production --
#    see deploy/sf-history-update.timer.example). Safe to run any time; it
#    only ever fetches the last 8h per (item, itemUpgrade) and re-derives the
#    4h buckets that could have changed.
python scripts/update.py
```

## Endpoints

```text
GET /sf-history/health                liveness check
GET /sf-history/equipment             28-item list + aliasItemIds + data-derived maxStar (design §7.1)
GET /sf-history/prices?itemId=        4h series, up to 150 days, 22-wide prices[] per point (null = missing)
GET /sf-history/latest?itemId=        current price (official `latest` proxied, TTL 60s, no historical fallback)
```

`itemId` must be one of `data/sf_history_items.json`'s **representative**
IDs (not an alias) -- clients resolve alias -> representative client-side
using `equipment`'s `aliasItemIds` (design §7: "検索対象はグループ内の全
itemId、取得・表示は代表"). Unknown `itemId` -> `404`; missing/non-integer
`itemId` -> `400`.

## Environment

```text
SF_HISTORY_DB_PATH=./data/sf_price_history.sqlite
SF_HISTORY_ITEMS_PATH=./data/sf_history_items.json
SF_HISTORY_ALLOWED_ORIGINS=https://lulumi-tools.com
```

## Offline by design

Only `scripts/backfill.py`, `scripts/update.py`, and `fetch_latest.py` ever
call the official API, and only when actually run (backfill/update) or when
`/sf-history/latest` is actually hit with a cache miss. **No pytest test
calls the official API** -- `fetcher.Fetcher` and `LatestPriceCache` are
always exercised through fake sessions in tests.

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
