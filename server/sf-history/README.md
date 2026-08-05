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
fetch_latest.py                      SH-3 §5 / SH-7 §2 / IMPL_PLAN_SH23: TTL (default 300s), single-flight proxy for the
                                      current price -- official Open API `dynamicprice` when `MSU_OPEN_API_KEY` is
                                      configured, else the legacy unauthenticated `enhance-price/latest` (design §6)
app.py                               SH-3 §4: FastAPI app (health / equipment / prices / latest)
scripts/gen_item_list.py             generates data/sf_history_items.json (reads maplenEnhancebot, read-only)
scripts/backfill.py                  resumable backfill: 30 items x itemUpgrade 0..21 x ~150 days (SH-22: 28 + 2)
scripts/rebuild_4h.py                full, deterministic rebuild of sf_price_history_4h
scripts/update.py                    4-hourly differential fetch + incremental 4h re-derivation (design §5.2)
scripts/audit_high_star_plateau.py   design §9.2: do the ☆20/☆21 end_price series match exactly?
data/sf_history_items.json           committed snapshot of the target equipment list (incl. maxStar)
data/.gitignore                      *.sqlite* is never committed (SH-2 §8)
deploy/                              Caddyfile / systemd .service / .timer *.example files (SH-6 reads these)
contract/response_fields.json        IMPL_PLAN_SH20: the response/normalization field contract (see below)
tests/                                offline pytest (no network -- see "Offline by design" below)
```

## Response/normalization field contract (IMPL_PLAN_SH20)

`contract/response_fields.json` is the single, shared source of truth for
which JSON keys `equipment`/`prices`/`latest` above may return. **Both**
sides read the same file -- nobody duplicates the field list:

- `tests/test_response_contract.py` asserts the ACTUAL response key sets
  from this app against the contract (a key the response returns that is
  not in the contract fails; a key the contract lists that the response
  stops returning also fails).
- The frontend's `exp_ranking/web/src/sfhistory/integrations/
  contract.test.js` asserts `normalizeEquipmentPayload`/`normalizePricesPayload`/
  `normalizeLatestPayload`'s output keeps every field the contract lists,
  unless that field is explicitly listed in that file's own
  `INTENTIONALLY_DROPPED` map (documented, never silent).

This exists because the frontend's normalizer used to be a hand-written
whitelist with no cross-check against this server: three separate times
(`provisional`/`provisionalDate` in SH-9, `asOf` in SH-16, `closed` in
SH-19 -- the last one shipped a P0, an entirely empty dashed-line series)
a new field landed here and the frontend silently dropped it because
nothing forced anyone to update the whitelist. Adding a field to this
service's response now requires adding it to `contract/response_fields.json`
first, which fails `test_response_contract.py` until the field is actually
present, and fails the frontend's `contract.test.js` until the frontend
either passes the new field through or documents the drop.

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
GET /sf-history/equipment             30-item list (SH-22: 28 + 2) + aliasItemIds + aliases (itemId+itemName per group
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
                                         2. IMPL_PLAN_SH17 §1/§3 (supersedes SH-16 §1/§3, per the 2026-08-05 user
                                            decision): the ONE still-open ("未終了") bucket -- SH-16 used to split
                                            this into a separate hourly-derived point plus a second, independent
                                            live-value point (`"current": true`, drawn at `asOf`); SH-17 merges
                                            those back into a single point, always drawn at the bucket's own start
                                            (`date` == bucket start, matching every other point's x-position
                                            rule), with `asOf` attached (not used for position) whenever the
                                            shared `latest` cache -- also used by `/sf-history/latest` below,
                                            unchanged SH-7 sourcing -- carries a `latestUpdatedAt`. Its `prices`
                                            come from that same `latest` cache when available; only when the
                                            upstream call raises `UpstreamLatestError` does it fall back to the
                                            hourly-derived value (last `end_price` inside the bucket's own window,
                                            no `asOf` in that case -- "無い数字を発明しない"). If neither source
                                            has anything, no point is produced for the still-open bucket at all.
                                       `provisionalDate` is the MOST RECENT provisional point's date (previously:
                                       the only one that could exist) -- unchanged definition from SH-13, now just
                                       resolves to whichever of the two kinds above is present and latest.
                                       Degrades to confirmed-history-only (still 200) if the upstream `latest`
                                       call fails and no hourly fallback is available; the hourly-derived
                                       elapsed-bucket points (1) are unaffected by that failure (they never call
                                       upstream at all).
GET /sf-history/latest?itemId=        current price (IMPL_PLAN_SH23: official Open API `dynamicprice` when
                                       `MSU_OPEN_API_KEY` is configured, else the legacy `enhance-price/latest` --
                                       same response shape either way; TTL default 300s, no historical fallback)
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
SF_HISTORY_LATEST_TTL_SECONDS=300   # IMPL_PLAN_SH23 §3-2: default 300 (5min, user-specified: "負荷を考え").
                                     # Clamped to [60, 1200]s regardless (fetch_latest.MIN_TTL_SECONDS /
                                     # MAX_TTL_SECONDS -- hard-coded, non-configurable safety rails; a
                                     # misconfigured value can never reach 0s or an absurdly long TTL).
MSU_OPEN_API_KEY=                   # ★秘密情報 -- see "Current-price upstream & secrets" below. Read once
                                     # at process startup; never logged, never returned in any response.
```

Both are read once at process startup (app.py builds the `LatestPriceCache` singleton from
them) -- changing either requires a process restart.

## Current-price upstream & secrets (IMPL_PLAN_SH23)

`GET /sf-history/latest` (and `prices`' provisional in-progress point, which shares the same
cache) picks its upstream once per process, by whether `MSU_OPEN_API_KEY` is set:

- **configured**: the official Open API, `GET openapi.msu.io/v1rc1/enhancement/items/{itemId}/
  dynamicprice` (`x-nxopen-api-key` header) -- republishes every **1 minute**, star 0..24
  (string-keyed; never hardcode the key count).
- **not configured**: the legacy, unauthenticated `enhance-price/latest` (unchanged from SH-3/
  SH-7) -- republishes on a ~20-minute grid. This is the fallback: the service must keep working
  before a key is provisioned in production ("本番へキーを配る前でも画面が壊れないようにする").

Both parsers (`fetch_latest.parse_openapi_payload` / `parse_latest_payload`) return the exact
same `{itemId, latestUpdatedAt, prices}` shape in the exact same units, so which upstream
actually answered is invisible to every caller and to the response contract. Which one is in use
is printed once, at startup, to stderr (`sf-history: current-price upstream = ...`) -- **the key
value itself is never printed, logged, returned in any response, or written to a file**.

**Why the TTL went back to a single fixed number**: IMPL_PLAN_SH15 §4 used to derive each cache
entry's TTL from that response's own `latestUpdatedAt`, tuned for the legacy endpoint's observed
~20-minute republish cadence. The Open API republishes every 1 minute -- deriving a TTL from its
stamp the same way would mean re-hitting upstream on almost every request (the exact "毎リクエ
スト上流を叩く事故" failure mode SH-15 was built to avoid, just triggered by a fresher upstream
instead of a stale one). `SF_HISTORY_LATEST_TTL_SECONDS` (a single fixed TTL, back to SH-7's
model) sidesteps that regardless of which upstream is configured.

**Key handling, same discipline as `server/raffle-api/README.md`**:

- Only ever read from the `MSU_OPEN_API_KEY` environment variable (`app.py`'s `_open_api_key()`)
  -- never hardcoded, never committed (`.env`/fixtures/tests/docs/reports, this file included).
- Local dev: put it in `C:\Users\<user>\.lulumi-tools\raffle-api.env` (Git-外, already used by the
  raffle API) and source that file into the process environment before starting uvicorn. Do not
  paste the value into shell history, `.env` inside this repo, or any web build.
- Production: `/etc/lulumi-tools/*.env` (root-owned, `0600`), same as raffle-api. Not deployed by
  this plan -- SH-23 only ships the code path; provisioning the key on the VPS is a separate,
  explicit step.
- Never sent to the browser: `/sf-history/latest`'s response never includes it (only
  `{itemId, latestUpdatedAt, prices}`), and it is server-side-only end to end.

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
  retry headroom; SH-22's 2 additions add 44 more requests, still well under
  budget)
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
