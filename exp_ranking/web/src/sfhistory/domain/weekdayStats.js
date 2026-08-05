// IMPL_PLAN_SH11 §3-1: pure aggregation for the weekday x time-of-day
// heatmap. No React, no DOM, no fetching -- and no new *calculation* code
// (design/plan: the values aggregated here are the same already-computed
// `expected` numbers `domain/series.js`'s `buildExpectedSeries` produces;
// this file only groups and takes the median of them).
//
// Input contract: `series` is a `buildExpectedSeries(...)` result -- rows of
// `{ date, expected, provisional }`. A provisional row (SH-7's regulation,
// carried through unchanged here) and a `null` `expected` (missing-data gap,
// design §9.1) are both excluded, exactly like `computeStats`/
// `currentPercentile` in series.js already exclude them -- this keeps the
// heatmap's "n" and median reproducible on reload, and never invents a
// number for a gap.
//
// IMPL_PLAN_SH14 §2 (2026-08-05, user decision): reverts IMPL_PLAN_SH11 §2's
// local-timezone grouping back to a fixed UTC basis. `series[].date` is
// already a UTC instant (design §9's 4h bucketing: every point's UTC hour is
// one of {0,4,8,12,16,20}), so grouping by weekday/time-of-day no longer
// needs any `Intl`/timezone-conversion machinery at all -- `Date#getUTCDay`/
// `getUTCHours` read the grouping key directly. `buildWeekdayHeatmap` no
// longer takes a `timeZone` argument; there is nothing left to parameterize.

const WEEKDAY_COUNT = 7; // Sun..Sat
const BUCKET_COUNT = 6; // 4h buckets (design §9), same cadence series.js uses
const HOURS_PER_BUCKET = 24 / BUCKET_COUNT; // 4

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds the 7 (UTC weekday) x 6 (UTC 4h slot) grid.
 *
 * Returns `{ cells, columns }`:
 * - `cells`: one entry per (weekdayIndex, bucketSlot) pair, always exactly
 *   `WEEKDAY_COUNT * BUCKET_COUNT` (=42) entries, in row-major order
 *   (weekday 0..6, each with bucketSlot 0..5) -- `{ weekdayIndex,
 *   bucketSlot, median, n, values }`. An empty cell (`n === 0`) still gets
 *   an entry (`median: null`) so the grid is always fully rectangular.
 *   `weekdayIndex` matches `Date#getUTCDay()` (0=Sun..6=Sat); which order the
 *   caller *displays* those 7 rows in (IMPL_PLAN_SH14 §4: Thu-first) is a
 *   presentation concern of `WeekdayHeatmap.jsx`, not of this aggregation.
 * - `columns`: exactly `BUCKET_COUNT` (=6) entries describing each
 *   `bucketSlot`'s column header, `{ bucketSlot, hour, minute }` -- always
 *   `hour: bucketSlot * 4, minute: 0` (IMPL_PLAN_SH14 §4: a fixed UTC
 *   00/04/08/12/16/20, never derived from which points happened to be
 *   observed -- unlike SH-11's local-time columns, a UTC bucket's start time
 *   is already fully determined by its `bucketSlot`, data or no data).
 */
export function buildWeekdayHeatmap(series) {
  const cellGroups = new Map(); // `${weekdayIndex}-${bucketSlot}` -> number[]

  for (const point of series) {
    if (point?.provisional || point?.expected == null) continue;
    const date = new Date(point.date);
    if (Number.isNaN(date.getTime())) continue;

    const weekdayIndex = date.getUTCDay();
    const bucketSlot = Math.floor(date.getUTCHours() / HOURS_PER_BUCKET);
    const key = `${weekdayIndex}-${bucketSlot}`;
    if (!cellGroups.has(key)) cellGroups.set(key, []);
    cellGroups.get(key).push(point.expected);
  }

  const cells = [];
  for (let weekdayIndex = 0; weekdayIndex < WEEKDAY_COUNT; weekdayIndex++) {
    for (let bucketSlot = 0; bucketSlot < BUCKET_COUNT; bucketSlot++) {
      const values = cellGroups.get(`${weekdayIndex}-${bucketSlot}`) ?? [];
      cells.push({
        weekdayIndex,
        bucketSlot,
        median: values.length ? median(values) : null,
        n: values.length,
        values,
      });
    }
  }

  const columns = [];
  for (let bucketSlot = 0; bucketSlot < BUCKET_COUNT; bucketSlot++) {
    columns.push({ bucketSlot, hour: bucketSlot * HOURS_PER_BUCKET, minute: 0 });
  }

  return { cells, columns };
}

/** Sum of every cell's `n` -- plan (d)'s "n の合計 = 確定点の総数" (no
 * confirmed point silently dropped by the bucketing above). */
export function totalHeatmapCount(cells) {
  return cells.reduce((sum, cell) => sum + cell.n, 0);
}

/**
 * The lowest/highest-median cell among cells that actually have data (plan
 * §3-3: "最安セル・最高セルを視覚的に示す"). Both `null` if no cell has any
 * data. Not a recommendation (§3-3/§11 forbids one) -- purely which cell to
 * visually mark; the caller still shows every cell's own median and n.
 */
export function extremeHeatmapCells(cells) {
  const withData = cells.filter((cell) => cell.median != null);
  if (!withData.length) return { lowest: null, highest: null };
  let lowest = withData[0];
  let highest = withData[0];
  for (const cell of withData) {
    if (cell.median < lowest.median) lowest = cell;
    if (cell.median > highest.median) highest = cell;
  }
  return { lowest, highest };
}
