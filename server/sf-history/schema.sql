-- SH-2 schema: SF price history (1-hour resolution) + resumable backfill progress.
-- Source of truth for the design: docs/DESIGN_SF_COST_HISTORY.md (r2) §3, §9.1, §9.2.
-- Plan: docs/IMPL_PLAN_SH2.md §3. Do not add an `sf_price_history_4h` table here --
-- that is SH-3's job (decisively derived from `sf_price_history_hourly`, never a
-- second source of truth).

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
