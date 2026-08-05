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
fetch_latest.py                      SH-3 §5 / SH-7 §2: TTL (default 300s), single-flight `enhance-price/latest` proxy (design §6)
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
GET /sf-history/equipment             28-item list + aliasItemIds + aliases (itemId+itemName per group
                                       member, IMPL_PLAN_SH9 §3-2) + data-derived maxStar (design §7.1)
GET /sf-history/prices?itemId=        4h series, up to 150 days, 22-wide prices[] per point (null = missing).
                                       IMPL_PLAN_SH13 §2-2 (supersedes SH-7's "one trailing point"): the rule is
                                       "in `sf_price_history_4h` = confirmed; not there but derivable from
                                       `sf_price_history_hourly` = provisional (`"provisional": true`)". There can
                                       be MORE THAN ONE provisional point, in this order:
                                         1. any bucket whose window has already fully elapsed but that the
                                            periodic 4h-aggregation job has not re-run for yet (derived here from
                                            hourly data, last `end_price` in the bucket, never written back to
                                            `sf_price_history_4h`)
                                         2. IMPL_PLAN_SH16 §3: the one bucket still in progress, IF hourly data has
                                            already landed inside its own (not-yet-elapsed) window -- same
                                            "latest `end_price` inside the window" rule as (1), just without the
                                            elapse gate, still drawn at the bucket's own start time
                                         3. the live current-value point, sourced from the shared `latest` cache
                                            also used by `/sf-history/latest` below (unchanged SH-7 sourcing).
                                            IMPL_PLAN_SH16 §1/§3 (revises SH-8): its `date` is the upstream `asOf`
                                            timestamp itself -- not a bucket-start position -- so this point's x
                                            position and its displayed time can never disagree. Tagged
                                            `"current": true` to distinguish it from a real bucket. Falls back to
                                            the in-progress bucket's own start only when the upstream payload
                                            carried no usable `latestUpdatedAt` at all ("無い数字を発明しない" --
                                            `asOf` is omitted entirely in that case, never invented)
                                       `provisionalDate` is the MOST RECENT provisional point's date (previously:
                                       the only one that could exist) -- unchanged definition from SH-13, now just
                                       resolves to whichever of the three kinds above is present and latest.
                                       Degrades to confirmed-history-only (still 200) if the upstream `latest`
                                       call fails; the hourly-derived provisional points (1)/(2) are unaffected by
                                       that failure (they never call upstream at all).
GET /sf-history/latest?itemId=        current price (official `latest` proxied, TTL default 300s, no historical fallback)
```

`itemId` must be one of `data/sf_history_items.json`'s **representative**
IDs (not an alias) -- clients resolve alias -> representative client-side
using `equipment`'s `aliasItemIds` (design §7: "検索対象はグループ内の全
itemId、取得・表示は代表"). Unknown `itemId` -> `404`; missing/non-integer
`itemId` -> `400`.

### `aliases` (IMPL_PLAN_SH9 §3-1)

Each `equipment` item's `aliases` is `[{ itemId, itemName }, ...]`, one row
per id in that same item's `aliasItemIds` -- **including the representative
itself**. This is a deliberate choice, not an oversight: `aliasItemIds`
already contains the representative's own id (a sorted `set`, so it can
never repeat), so mapping it straight to `{itemId, itemName}` rows gives
`aliases` exactly the same members with no separate "is this the
representative" branch on either side (`gen_item_list.py` or the frontend's
`EquipmentSelector.jsx`, which flattens `aliases` into search candidates).
The representative therefore appears in `aliases` exactly once, like every
other member -- never zero times, never twice.

Every name is resolved from maplenEnhancebot's `catalog/main_equipment.json`
(`groups[].items[].{item_id, item_name}`) except one: `1003719` (Chaos
Pierre Hat), which the boss_only catalog never carries. Its name is a
one-line override in `gen_item_list.py` (`EXTRA_ITEM_NAMES`), copied from a
source-code comment in maplenEnhancebot's `priority_equipment.py` -- the only
place that name exists in the source-of-truth repo. If a future alias id has
no resolvable name at all, `gen_item_list.py` falls back to the stringified
itemId (and prints a warning to stderr) rather than crashing the generator.

## Environment

```text
SF_HISTORY_DB_PATH=./data/sf_price_history.sqlite
SF_HISTORY_ITEMS_PATH=./data/sf_history_items.json
SF_HISTORY_ALLOWED_ORIGINS=https://lulumi-tools.com
SF_HISTORY_LATEST_PUBLISH_INTERVAL_SECONDS=1200  # IMPL_PLAN_SH15 §4: default 1200 (20min) -- the
                                                  # observed upstream `latestUpdatedAt` publish cadence
                                                  # (04:00/04:20/04:40/05:00, all on a 20-min grid; 4
                                                  # samples, not a guarantee -- see MAX_TTL_SECONDS
                                                  # below for the safety rail if reality differs).
SF_HISTORY_LATEST_GRACE_SECONDS=60               # IMPL_PLAN_SH15 §4: default 60 -- slack added after
                                                  # `latestUpdatedAt + interval`, in case upstream
                                                  # publishes a little late.
```

Both are read once at process startup (app.py builds the `LatestPriceCache` singleton from
them) -- changing either requires a process restart.

**IMPL_PLAN_SH15 §4 (replaces SH-7 §2's fixed `SF_HISTORY_LATEST_TTL_SECONDS`)**: each cache
entry now gets its own TTL, computed from *that response's own* `latestUpdatedAt` --
`next_publish = latestUpdatedAt + PUBLISH_INTERVAL`, `expiry = next_publish + GRACE` -- instead
of a single fixed TTL applied to every entry regardless of when upstream actually published. The
old `SF_HISTORY_LATEST_TTL_SECONDS` env var is **removed outright** (not reinterpreted as an
upper bound): the upper bound is `fetch_latest.MAX_TTL_SECONDS` (1200s / "at most 20 minutes"),
and the lower bound is `fetch_latest.MIN_TTL_SECONDS` (60s) -- both are **hard-coded, non-
configurable safety rails**, deliberately not exposed as env vars, so a misconfigured or future
upstream change cannot push the cache past "always re-check within 20 minutes" or down to
"re-checks on every single request" (the latter being this slice's most dangerous failure mode: a
stale/old `latestUpdatedAt` must never make `expiry` land in the past).

A missing, unparsable, or future `latestUpdatedAt` never causes the cache to poll *more*
aggressively -- it falls back to the plain `PUBLISH_INTERVAL_SECONDS` outright (no
finer-than-usual guessing).

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
