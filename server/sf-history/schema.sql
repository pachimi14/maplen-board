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
