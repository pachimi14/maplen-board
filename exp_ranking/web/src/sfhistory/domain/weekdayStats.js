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

const WEEKDAY_COUNT = 7; // Sun..Sat
const BUCKET_COUNT = 6; // 4h buckets (design §9), same cadence series.js uses

// Constructing an `Intl.DateTimeFormat` is comparatively expensive (it loads
// locale/zone data); `wallClockParts` below is called once per confirmed
// point (~900 for a full 150-day series) plus once per column, so this
// caches one formatter per `timeZone` string rather than rebuilding it on
// every call -- pure perf, no behavior change (plan §3-4 / (g): keep the
// full recompute well under the 200ms stop condition).
const wallClockFormatterCache = new Map();
function wallClockFormatter(timeZone) {
  let formatter = wallClockFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    wallClockFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Converts a UTC instant into the wall-clock numbers a clock in `timeZone`
 * would show, without ever consulting a hardcoded weekday/locale table:
 * format the instant's *numeric* y/m/d/h/min/s in that zone (the "en-US"
 * locale here is only used to parse ASCII digits back out, never shown to a
 * user), then rebuild those same numbers as a synthetic UTC date so
 * `getUTCDay()`/`getUTCHours()`/`getUTCMinutes()` read back the *local*
 * weekday/time directly. This is what correctly moves a point across a
 * local midnight -- e.g. a UTC Wednesday 20:00 point is JST Thursday 05:00,
 * and must land in the "Thu" row, not "Wed" (plan §2's own worked example).
 */
function wallClockParts(date, timeZone) {
  const parts = wallClockFormatter(timeZone).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = map.hour === "24" ? "00" : map.hour; // some ICU builds emit "24" for local midnight
  const synthetic = new Date(
    Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(hour), Number(map.minute), Number(map.second)),
  );
  return { weekdayIndex: synthetic.getUTCDay(), hour: synthetic.getUTCHours(), minute: synthetic.getUTCMinutes() };
}

/**
 * plan §3-2/§2: the column key is the *original UTC* 4h-slot index (0..5,
 * `floor(utcHour / 4)`) -- not a re-derived local hour rounded to the
 * nearest 4h mark ("丸めたり詰めたりしない"). Every server point's UTC hour
 * is already one of {0,4,8,12,16,20} (design §9's 4h bucketing), so this is
 * an exact, lossless grouping key -- the column's *displayed* local time
 * (computed separately below from the most recent point in the slot) is
 * free to be a non-round local hour (plan's own JST example: 09/13/17/21/
 * 01/05).
 */
function utcBucketSlot(isoDate) {
  return Math.floor(new Date(isoDate).getUTCHours() / 4);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds the 7 (local weekday) x 6 (UTC-anchored 4h slot) grid.
 *
 * `timeZone` is required and explicit (never resolved internally) so this
 * stays a pure, deterministic function -- callers pass `localTimeZone()`
 * from `./format.js` (production: the viewer's own zone) or a pinned IANA
 * zone (tests).
 *
 * Returns `{ cells, columns }`:
 * - `cells`: one entry per (weekdayIndex, bucketSlot) pair, always exactly
 *   `WEEKDAY_COUNT * BUCKET_COUNT` (=42) entries, in row-major order
 *   (weekday 0..6, each with bucketSlot 0..5) -- `{ weekdayIndex,
 *   bucketSlot, median, n, values }`. An empty cell (`n === 0`) still gets
 *   an entry (`median: null`) so the grid is always fully rectangular.
 * - `columns`: exactly `BUCKET_COUNT` (=6) entries describing each
 *   `bucketSlot`'s column header, `{ bucketSlot, localHour, localMinute }`
 *   -- the *actual* local wall-clock start time (plan §2: never rounded),
 *   taken from the single most recent confirmed point observed anywhere in
 *   that slot (so a mid-window DST shift, if any, is reflected by the
 *   *current* label rather than blended across two different offsets).
 *   Sorted ascending by local time-of-day for a left-to-right, small-to-
 *   large layout. `localHour`/`localMinute` are `null` for a slot with no
 *   data at all (never invented).
 */
export function buildWeekdayHeatmap(series, timeZone) {
  const cellGroups = new Map(); // `${weekdayIndex}-${bucketSlot}` -> number[]
  const columnLatest = new Map(); // bucketSlot -> { date, time }

  for (const point of series) {
    if (point?.provisional || point?.expected == null) continue;
    const date = new Date(point.date);
    if (Number.isNaN(date.getTime())) continue;

    const { weekdayIndex } = wallClockParts(date, timeZone);
    const bucketSlot = utcBucketSlot(point.date);
    const key = `${weekdayIndex}-${bucketSlot}`;
    if (!cellGroups.has(key)) cellGroups.set(key, []);
    cellGroups.get(key).push(point.expected);

    const time = date.getTime();
    const latest = columnLatest.get(bucketSlot);
    if (!latest || time > latest.time) columnLatest.set(bucketSlot, { date, time });
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
    const latest = columnLatest.get(bucketSlot);
    if (!latest) {
      columns.push({ bucketSlot, localHour: null, localMinute: null });
      continue;
    }
    const { hour, minute } = wallClockParts(latest.date, timeZone);
    columns.push({ bucketSlot, localHour: hour, localMinute: minute });
  }
  columns.sort((a, b) => {
    if (a.localHour == null) return 1;
    if (b.localHour == null) return -1;
    return a.localHour * 60 + a.localMinute - (b.localHour * 60 + b.localMinute);
  });

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
