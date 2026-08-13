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

// IMPL_PLAN_SH18 §4 (2026-08-05, user decision, reverses design §8): a
// point's `date` is still the bucket's own *start* (server/DB convention,
// unchanged -- SH-18 plan §2 "サーバー・DB は触らない"), but the grid now
// groups each point by its bucket's *end* weekday/hour, not its start --
// the same "the value is really the bucket's last instant" reasoning
// `domain/format.js`'s `bucketDisplayDate` applies to the chart. A point at
// `date="...T20:00:00Z"` (Wed) now lands under Thursday's `00:00` column,
// not Wednesday's `20:00` one -- see `WeekdayHeatmap.jsx`'s own note on why
// this makes the top-left cell "Thu 00:00 UTC". No future-time guard is
// needed here the way `bucketDisplayDate` needs one for the chart's
// still-open point: this function already excludes every `provisional`
// point below (SH-7's regulation), so every point reaching the `+4h` shift
// is a *confirmed*, already-persisted bucket -- its end is necessarily
// already in the past.

const WEEKDAY_COUNT = 7; // Sun..Sat
const BUCKET_COUNT = 6; // 4h buckets (design §9), same cadence series.js uses
const HOURS_PER_BUCKET = 24 / BUCKET_COUNT; // 4
const BUCKET_MS = HOURS_PER_BUCKET * 60 * 60 * 1000;

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
 *   `weekdayIndex`/`bucketSlot` are keyed by each point's bucket *end*
 *   (IMPL_PLAN_SH18 §4), so `weekdayIndex` matches
 *   `Date#getUTCDay()` of `date + 4h`, not of `date` itself; which order the
 *   caller *displays* those 7 rows in (IMPL_PLAN_SH14 §4: Thu-first) is a
 *   presentation concern of `WeekdayHeatmap.jsx`, not of this aggregation.
 * - `columns`: exactly `BUCKET_COUNT` (=6) entries describing each
 *   `bucketSlot`'s column header, `{ bucketSlot, hour, minute }` -- always
 *   `hour: bucketSlot * 4, minute: 0` (IMPL_PLAN_SH14 §4: a fixed UTC
 *   00/04/08/12/16/20, never derived from which points happened to be
 *   observed). IMPL_PLAN_SH18 §4: this is now the bucket's *end* hour, not
 *   its start -- the same fixed 6-value set either way, just naming what a
 *   column now groups by.
 */
export function buildWeekdayHeatmap(series) {
  const cellGroups = new Map(); // `${weekdayIndex}-${bucketSlot}` -> number[]

  for (const point of series) {
    if (point?.provisional || point?.expected == null) continue;
    const start = new Date(point.date);
    if (Number.isNaN(start.getTime())) continue;
    // IMPL_PLAN_SH18 §4: group by the bucket's *end*, not its start -- see
    // the file-header note above for why this needs no future-time guard
    // (every point here is already `!provisional`, i.e. confirmed/past).
    const end = new Date(start.getTime() + BUCKET_MS);

    const weekdayIndex = end.getUTCDay();
    const bucketSlot = Math.floor(end.getUTCHours() / HOURS_PER_BUCKET);
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
 * IMPL_PLAN_SH29 §4-1: floor/ceil split of the average confirmed-point
 * count per cell (`totalHeatmapCount(cells) / cells.length`) -- the single
 * aggregate "1セルあたり約N点" disclosure the now period-linked heatmap
 * (plan §4) needs, so a period whose cells mostly hold one point does not
 * silently call that one point a "median" without saying so. NOT a
 * per-cell `n=` revival (SH-13 already removed printing that on all 42
 * cells) -- one number (well, one range) for the whole grid.
 *
 * `low`/`high` differ rather than a single rounded average because 42
 * cells rarely divides a period's confirmed-point count evenly, so some
 * cells naturally hold one more point than others -- `Math.floor`/
 * `Math.ceil` of the average is exactly that spread (verified in
 * `weekdayStats.test.js` against the統括's own measured 7D/14D/30D/90D/
 * 150D figures from the plan's §4-1 table).
 */
export function heatmapSampleRange(cells) {
  if (!cells.length) return { low: 0, high: 0 };
  const average = totalHeatmapCount(cells) / cells.length;
  return { low: Math.floor(average), high: Math.ceil(average) };
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
