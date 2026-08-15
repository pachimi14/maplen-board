-- SH-2 schema: SF price history (1-hour resolution) + resumable backfill progress.
-- SH-3 adds `sf_price_history_4h` below: a *decisive derivation* of the hourly
-- table (docs/DESIGN_SF_COST_HISTORY.md §3: "再生成でいつでも作り直せる=正では
-- ない"), never written to directly outside `aggregate.py`. See aggregate.py for
-- the derivation rule (design §9 / IMPL_PLAN_SH3 §3).
-- Source of truth for the design: docs/DESIGN_SF_COST_HISTORY.md (r2) §3, §9.1, §9.2.
-- Plan: docs/IMPL_PLAN_SH2.md §3 / docs/IMPL_PLAN_SH3.md §3.

CREATE TABLE IF NOT EXISTS sf_price_history_hourly (
    item_id           INTEGER NOT NULL,
    item_upgrade      INTEGER NOT NULL,
    price_at          TEXT    NOT NULL,   -- ISO8601 UTC ("2026-08-04T16:00:00Z")
    step              INTEGER,
    avg_price         REAL,
    max_price         REAL,
    min_price         REAL,
    end_price         REAL    NOT NULL,   -- NESO. SH-1 M1 confirmed closePrice/endPrice = 1e18;
                                           -- this column stores the API's endPrice UNCONVERTED.
                                           -- Do not write any conversion code against this column
                                           -- (see IMPL_PLAN_SH2 §3 and DESIGN_SF_COST_HISTORY §2 P2).
    sum_enhance_count INTEGER NOT NULL DEFAULT 0,
    fetched_at        TEXT    NOT NULL,
    PRIMARY KEY (item_id, item_upgrade, price_at)
);

CREATE TABLE IF NOT EXISTS sf_history_backfill_progress (
    item_id      INTEGER NOT NULL,
    item_upgrade INTEGER NOT NULL,
    status       TEXT    NOT NULL,   -- 'done' | 'error'
    row_count    INTEGER NOT NULL DEFAULT 0,
    oldest_at    TEXT,
    newest_at    TEXT,
    updated_at   TEXT    NOT NULL,
    note         TEXT,
    PRIMARY KEY (item_id, item_upgrade)
);

-- SH-3 §3: 4-hour buckets derived from sf_price_history_hourly. UTC bucket
-- boundaries 00/04/08/12/16/20; price_at is the bucket START (design §9,
-- "ラベルは区間開始時刻"); end_price is the end_price of the LAST hourly row
-- that exists inside the bucket (design §9, "区間内で最後に存在する時刻の
-- end_price"); source_hour_at records which hourly price_at was chosen, for
-- traceability. Rows are only ever written by aggregate.py, which fully
-- replaces (delete+insert) the rows it derives -- never a manual UPDATE.
CREATE TABLE IF NOT EXISTS sf_price_history_4h (
    item_id        INTEGER NOT NULL,
    item_upgrade   INTEGER NOT NULL,
    price_at       TEXT    NOT NULL,   -- 区間開始 UTC
    end_price      REAL    NOT NULL,
    source_hour_at TEXT    NOT NULL,   -- 採用した1時間足の時刻
    generated_at   TEXT    NOT NULL,
    PRIMARY KEY (item_id, item_upgrade, price_at)
);

-- IMPL_PLAN_SH32: DISCOVERY (bonus period) auto-detection/recording/page.
-- New tables only -- sf_price_history_hourly/_4h are untouched (plan §3/§4).
-- See discovery.py for the parsing/judging rules these tables feed.

-- One row per daily scan run (Component A). Summary/audit only.
CREATE TABLE IF NOT EXISTS sf_discovery_scan_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at            TEXT    NOT NULL,
    groups_total      INTEGER NOT NULL,
    items_total       INTEGER NOT NULL,
    items_failed      INTEGER NOT NULL,
    monitored_groups  INTEGER NOT NULL,
    duration_ms       REAL    NOT NULL
);

-- One row per representative *group* ever judged to have a DISCOVERY band in
-- itemUpgrade 0..21 (plan §1 judge range). `is_active` is flipped to 0 by a
-- later scan that no longer finds a qualifying band for this group -- the
-- row itself is never deleted (plan §2 A-1 / §5(k): "記録は永久に残す"), so
-- `aliases_json` stays resolvable for the "recent" page even after a group
-- goes fully quiet. `steps_consistent` is the A-1 F7-for-step check (§5(g-3)):
-- 0 means the most recent scan found the alias members' steps did not all
-- match the representative's -- upsert is then SKIPPED for that scan (this
-- row keeps whatever it last held), only the warning/scan-raw rows record it.
--
-- ★2026-08-15 fix (統括 検収差し戻し -- IMPL_PLAN_SH32 §2 A-1 の欠落を修正):
-- the group's real identity is (equip_level_type, equip_type, equip_part_type)
-- -- NOT whichever member `pick_representative_item` currently favors by
-- weekCount, which can (and does, in real data) flip from one daily scan to
-- the next. `representative_item_id` is chosen ONCE, the first time a group
-- becomes a monitoring candidate, and then kept FIXED across every later
-- scan (scan_discovery.py now looks up the existing row by group identity
-- BEFORE ever calling `pick_representative_item` again) -- re-picking a
-- representative on every scan silently created a SECOND row (and orphaned
-- `sf_discovery_price_history` under the old id, breaking `find_transition`
-- at the seam) purely because of weekCount noise, with no actual change in
-- which piece of gear this is. A representative is only ever re-picked in
-- the rare case it drops out of the group's own member list entirely
-- (scan_discovery.py logs a WARNING when that happens -- "黙って切り替わら
-- ない").
CREATE TABLE IF NOT EXISTS sf_discovery_monitored_groups (
    representative_item_id INTEGER NOT NULL PRIMARY KEY,
    item_name               TEXT,
    equip_level_type        TEXT    NOT NULL,
    equip_type               TEXT    NOT NULL,
    equip_part_type         TEXT    NOT NULL,
    alias_item_ids_json     TEXT    NOT NULL,  -- JSON array of ints (incl. representative)
    aliases_json            TEXT    NOT NULL,  -- JSON array of {itemId, itemName}
    steps_consistent        INTEGER NOT NULL,  -- 1/0
    is_active                INTEGER NOT NULL,  -- 1 while currently monitored
    first_seen_at           TEXT    NOT NULL,
    last_scan_at            TEXT    NOT NULL
);

-- Defense in depth for the fix above: at most ONE *active* row may exist per
-- group identity at any time. A PARTIAL index (WHERE is_active = 1), not a
-- plain UNIQUE constraint, so a superseded representative's row (kept
-- forever, is_active flipped to 0 by the rare re-selection path) can coexist
-- with its group's new active row -- both share the same group identity by
-- construction, and that is expected/correct, not a duplicate registration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_monitored_groups_active_group_key
    ON sf_discovery_monitored_groups (equip_level_type, equip_type, equip_part_type)
    WHERE is_active = 1;

-- Raw per-item, per-band step snapshot for every member of a *candidate*
-- group (plan §2: "走査の記録は生のまま残す(15装備ぶん)"). Append-only, one
-- set of rows per scan run -- never overwritten, kept even when that run's
-- consistency check failed (the audit trail is unconditional).
CREATE TABLE IF NOT EXISTS sf_discovery_scan_raw (
    run_id       INTEGER NOT NULL REFERENCES sf_discovery_scan_runs(id),
    item_id      INTEGER NOT NULL,
    item_upgrade INTEGER NOT NULL,
    step         TEXT,
    fetched_at   TEXT    NOT NULL,
    PRIMARY KEY (run_id, item_id, item_upgrade)
);

-- Component B: 5-minute poll of the monitored representatives ONLY (plan §2
-- B / A-1: "alias は叩かない" -- never populated for a non-representative
-- itemId). One row per (item_id, item_upgrade, price_at) -- `price_at` is
-- that point's own window start (the upstream `currentPrice`/`previousPrice`
-- `startDate`), upserted so the same window is never duplicated (§5(e)).
-- `price` is CONVERTED (divided by fetch_latest.PRICE_DIVISOR), matching
-- that module's existing convention for this exact upstream (openapi
-- dynamicprice) -- unlike sf_price_history_hourly/_4h's `end_price`, which
-- stores a DIFFERENT upstream field that is already unconverted-scale.
CREATE TABLE IF NOT EXISTS sf_discovery_price_history (
    item_id      INTEGER NOT NULL,
    item_upgrade INTEGER NOT NULL,
    price_at     TEXT    NOT NULL,   -- window start (ISO8601 UTC)
    end_at       TEXT,               -- window end
    price        REAL    NOT NULL,
    step         TEXT    NOT NULL,
    fetched_at   TEXT    NOT NULL,
    PRIMARY KEY (item_id, item_upgrade, price_at)
);
