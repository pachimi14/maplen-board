// IMPL_PLAN_SH5 §3 / §4: pure functions over the `/sf-history/prices`
// `points` array (already 4h-bucketed, already capped to <=150 days by the
// server) and the `/sf-history/latest` `prices` array. No fetching, no
// React, no DOM -- everything here is unit-testable with plain arrays.
//
// `expectedStarforceCostExact` / `requiredPriceStars` are the vendored,
// golden-tested copy from ./starforce.js (SH-4) -- this file does not
// reimplement any part of the cost calculation itself (design §8).
import { expectedStarforceCostExact, requiredPriceStars, STAR_FORCE_MAX } from "../starforce.js";

const BUCKETS_PER_DAY = 6; // 4h buckets (design §9)

export const PERIOD_KEYS = ["7D", "30D", "90D", "150D"];

export const PERIOD_DAYS = { "7D": 7, "30D": 30, "90D": 90, "150D": 150 };

/** IMPL_PLAN_SH27 §1 (user decision, 2026-08-06): the period tab the screen
 * opens on. Named the same way as `DEFAULT_INITIAL_ITEM_ID` (SH-26) rather
 * than inlined into `SfHistoryRoot` -- so that a test can assert, alongside
 * `PERIOD_KEYS`, that the default never drifts to a key that no longer
 * exists (SH-26 §1(c)'s same "停止せず穏当に劣化する" concern; see
 * `PeriodTabs`, which already renders whatever `period` state holds without
 * validating it against `PERIOD_KEYS` itself).
 *
 * IMPL_PLAN_SH11 §3-2: the heatmap does not read `period` at all (it always
 * aggregates the full ~150-day series), so changing this default does not
 * change one bit of heatmap output -- only which trailing slice of the chart/
 * stats series `sliceByPeriod` returns.
 */
export const DEFAULT_PERIOD = "30D";

/** IMPL_PLAN_SH13 §3: exactly three presets a user can pick, before maxStar
 * filtering (design §7.1's own maxStar-disable rule is unchanged: a preset
 * whose `to` exceeds the device's maxStar stays disabled, e.g. `0->21`/
 * `0->22` on a ☆20-capped device). */
export const STAR_RANGE_PRESETS = [
  { from: 0, to: 17 },
  { from: 0, to: 21 },
  { from: 0, to: 22 },
];

/** design §7.1: "maxStar を超える目標星を出さない" / "maxStar を超えるプリセ
 * ットは無効化する". A device's `maxStar` is data-derived (never
 * hardcoded) and comes straight from `/sf-history/equipment`. */
export function isValidStarRange(startStar, targetStar, maxStar) {
  return (
    Number.isInteger(startStar) &&
    Number.isInteger(targetStar) &&
    Number.isFinite(maxStar) &&
    startStar >= 0 &&
    targetStar > startStar &&
    targetStar <= maxStar &&
    targetStar <= STAR_FORCE_MAX
  );
}

export function isPresetEnabled(preset, maxStar) {
  return Number.isFinite(maxStar) && preset.to <= maxStar;
}

/** IMPL_PLAN_SH26 §1 (user decision, 2026-08-06): the item the screen opens
 * on. Before this plan, `SfHistoryRoot` picked `items[0]` -- whatever
 * `/sf-history/equipment`'s representative-id ordering happened to put
 * first, never an intentional choice (this plan's own §0). Arcane Umbra
 * Staff was picked by the user as a more meaningful, screenshot-friendly
 * default (a high-star weapon whose price history is populated). Matched on
 * `item.itemId`, the *representative* id -- same field `selectedItemId`
 * drives everywhere else in SfHistoryRoot (prices/latest fetches).
 */
export const DEFAULT_INITIAL_ITEM_ID = 1382265; // Arcane Umbra Staff

/**
 * Picks the item `SfHistoryRoot`'s equipment-load effect selects first:
 * `DEFAULT_INITIAL_ITEM_ID` if it is present in `items`, otherwise
 * `items[0]` (IMPL_PLAN_SH26 §1(c): if the item list ever changes and
 * `DEFAULT_INITIAL_ITEM_ID` drops out of it, the screen must not break --
 * "停止せず穏当に劣化する"). Does not touch star-range selection at all;
 * the caller still runs `defaultPresetForMaxStar` on whichever item this
 * returns (IMPL_PLAN_SH26 §1: "初期の星範囲は... 任せる(変えない)").
 * `items` is assumed non-empty -- `SfHistoryRoot`'s loadEquipment effect
 * already treats an empty list as an error state before this is called.
 */
export function selectInitialItem(items) {
  return items.find((item) => item.itemId === DEFAULT_INITIAL_ITEM_ID) ?? items[0];
}

/** Achievable target-star choices (1..maxStar), never above maxStar. */
export function targetStarOptions(maxStar) {
  if (!Number.isFinite(maxStar) || maxStar < 1) return [];
  return Array.from({ length: maxStar }, (_, i) => i + 1);
}

/** Achievable start-star choices (0..maxStar-1, always leaving room for at
 * least one valid target <= maxStar). */
export function startStarOptions(maxStar) {
  if (!Number.isFinite(maxStar) || maxStar < 1) return [];
  return Array.from({ length: maxStar }, (_, i) => i); // 0..maxStar-1
}

/**
 * Deterministic default *range* for a device: the *widest* enabled preset
 * (by span size), converted to the `{ startStar, targetStar }` shape
 * `range` state uses everywhere in SfHistoryRoot (NOT the `{ from, to }`
 * shape `STAR_RANGE_PRESETS` entries use -- returning that raw shape here
 * was the root cause of a production crash: `range.startStar` /
 * `range.targetStar` were `undefined` on a `{ from, to }` object, which is
 * still truthy, so a `!range` guard did not catch it before the value
 * reached `computeCurrentExpected`). This is a mechanical tie-break, not a
 * recommendation (design §11 forbids recommending a course of action) --
 * it only decides which valid range the screen opens with.
 */
export function defaultPresetForMaxStar(maxStar) {
  const enabled = STAR_RANGE_PRESETS.filter((preset) => isPresetEnabled(preset, maxStar));
  if (!enabled.length) return null;
  const widest = enabled.reduce((best, preset) => ((preset.to - preset.from > best.to - best.from) ? preset : best));
  return { startStar: widest.from, targetStar: widest.to };
}

/**
 * Builds the Expected-cost series for one (startStar, targetStar) span from
 * the `/sf-history/prices` `points` array.
 *
 * design §9.1: a point's Expected is `null` (never interpolated) if any
 * star level `requiredPriceStars(startStar, targetStar)` needs is missing
 * (`null`) at that point ("無い数字を発明しない"). The chart is expected to
 * render this as a broken line, not a bug.
 *
 * IMPL_PLAN_SH7 §3/§4: the server may append one trailing *provisional*
 * point (`point.provisional === true`, design §0: the in-progress 4h bucket,
 * sourced from the `latest` cache, never persisted to the 4h table). That
 * flag is carried straight through onto the corresponding series entry so
 * callers (computeStats/currentPercentile below, SfHistoryChart) can tell it
 * apart from confirmed points -- this function does not otherwise treat a
 * provisional point any differently (same missing-data gating, same
 * Expected calculation).
 *
 * IMPL_PLAN_SH8 §2-2: a provisional point may also carry `point.asOf` (the
 * official API's as-of timestamp for the value -- see SfHistoryChart's
 * tooltip, which shows this instead of `date` for a provisional point).
 * Only ever set when `provisional` is true, matching the design's "確定点
 * には asOf を付けない" -- a display-only pass-through, not a change to the
 * missing-data gating or Expected calculation above.
 *
 * IMPL_PLAN_SH19 §1/§4: `point.closed` is passed through the same way, as a
 * SEPARATE flag from `provisional` -- do not confuse the two. `closed`
 * (server: app.py) answers "has this bucket's time window ended?" and is
 * what SfHistoryChart now uses to decide dashed-vs-solid / hollow marker
 * (always exactly one open point). `provisional` still answers "is this
 * persisted in sf_price_history_4h?" and is what computeStats/
 * currentPercentile below still key off of, UNCHANGED by this plan -- an
 * elapsed-but-unaggregated bucket is `closed: true` (drawn solid) but stays
 * `provisional: true` (still excluded from statistics, so a later
 * aggregation-job correction of its value can never make average/percentile/
 * heatmap numbers un-reproduce on reload). Defaults to `true` when the
 * server omits the field (a confirmed point never carries it explicitly --
 * see app.py -- but "no flag" must mean "closed", not "open").
 */
export function buildExpectedSeries(points, startStar, targetStar) {
  const required = requiredPriceStars(startStar, targetStar);
  return points.map((point) => {
    const prices = point?.prices ?? [];
    const hasAllRequired = required.every((star) => prices[star] != null);
    const provisional = point?.provisional === true;
    const asOf = provisional && typeof point?.asOf === "string" ? point.asOf : null;
    const closed = point?.closed !== false;
    if (!hasAllRequired) {
      return { date: point.date, expected: null, provisional, asOf, closed };
    }
    return {
      date: point.date,
      expected: expectedStarforceCostExact({ startStar, targetStar, sfPrices: prices }),
      provisional,
      asOf,
      closed,
    };
  });
}

/**
 * Same missing-data gating as `buildExpectedSeries`, for the single
 * current-price point (`/sf-history/latest`'s `prices` array). Returns
 * `null` if `latestPrices` is absent or missing any required star -- the
 * caller must show "current price unavailable", never substitute a
 * historical value (design §6).
 */
export function computeCurrentExpected(latestPrices, startStar, targetStar) {
  if (!Array.isArray(latestPrices)) return null;
  const required = requiredPriceStars(startStar, targetStar);
  const hasAllRequired = required.every((star) => latestPrices[star] != null);
  if (!hasAllRequired) return null;
  return expectedStarforceCostExact({ startStar, targetStar, sfPrices: latestPrices });
}

/**
 * Slices the trailing `periodKey` window (7D/30D/90D/150D) off a
 * chronologically-ascending series. The API's `points[]` is already capped
 * to 150 days, so a shorter period is just a shorter trailing slice of the
 * same series -- no re-fetch, no re-derivation (design §13: "常に全再計算
 * でよい").
 */
export function sliceByPeriod(series, periodKey) {
  const days = PERIOD_DAYS[periodKey];
  if (!days) return series;
  const count = days * BUCKETS_PER_DAY;
  return series.length <= count ? series : series.slice(series.length - count);
}

/**
 * Period statistics over *confirmed* points only. design §6.1: the current
 * (live) value must never be mixed into this array -- callers must pass a
 * series built only from `/sf-history/prices` points, never with the
 * `/sf-history/latest` value appended.
 *
 * IMPL_PLAN_SH7 (e): `points` (and therefore `series`, via
 * `buildExpectedSeries`) may now include one trailing provisional point
 * (`point.provisional === true`). It is filtered out here alongside the
 * pre-existing null-filter, so that its presence or absence never changes
 * average/high/low/count by even one bit -- the provisional point's value
 * moves every few minutes (it tracks the live `latest` cache), so mixing it
 * into a statistic that is supposed to be reproducible on reload would
 * silently break that reproducibility.
 */
export function computeStats(series) {
  const values = series
    .filter((point) => !point.provisional)
    .map((point) => point.expected)
    .filter((value) => value != null);
  if (!values.length) {
    return { average: null, high: null, low: null, count: 0 };
  }
  let sum = 0;
  for (const value of values) sum += value;
  return {
    average: sum / values.length,
    high: Math.max(...values),
    low: Math.min(...values),
    count: values.length,
  };
}

/**
 * Rank of `currentValue` within the confirmed `series` distribution, as a
 * percentage of confirmed points at or below it.
 *
 * This is design §11's "Current Position(percentile)" -- it is NOT the
 * p50/p70/p90 *quantile* lines design §12 forbids (those would be fixed
 * points carved out of `analyticStarforceCostPercentiles`'s "rough"
 * economic-scaling heuristic, which this tool deliberately does not vendor
 * at all -- see starforce.js's header). This is a rank-of-one-value
 * statistic computed from the exact same confirmed-only array already used
 * for average/high/low above; no extra data or heuristic is introduced.
 *
 * IMPL_PLAN_SH7 (e): a provisional point (`point.provisional === true`) is
 * excluded from the distribution -- same reasoning as `computeStats` above.
 */
export function currentPercentile(series, currentValue) {
  const values = series
    .filter((point) => !point.provisional)
    .map((point) => point.expected)
    .filter((value) => value != null);
  if (!values.length || currentValue == null) return null;
  const countAtOrBelow = values.filter((value) => value <= currentValue).length;
  return (countAtOrBelow / values.length) * 100;
}

/**
 * IMPL_PLAN_SH15 §2: display-only derivation of `currentPercentile`'s raw
 * number into the "この期間の N% より安い" phrasing the user asked for
 * (§0/§2-2: "数値としては正しいが、読み手が方向を自分で反転しないと意味が
 * 取れない" -- `currentPercentile` itself is unchanged, this only flips how
 * it is worded for display). Takes the exact (unrounded) `percentile` from
 * `currentPercentile` and returns a small discriminated result describing
 * which sentence to render:
 *
 *  - `null` -- no current value / no confirmed points (caller shows "--",
 *    same as before this plan).
 *  - `{ kind: "lowest" }` -- `percentile === 0` *exactly* (zero confirmed
 *    points are at-or-below current -- current undercuts the whole period).
 *  - `{ kind: "highest" }` -- `percentile === 100` *exactly* (every
 *    confirmed point is at-or-below current).
 *  - `{ kind: "cheaperThan", percent }` -- otherwise, `percent =
 *    round(100 - percentile)`, clamped to `[1, 99]`.
 *
 * The clamp (not just the `=== 0` / `=== 100` branches above) is why this
 * is a separate function instead of an inline `100 - Math.round(...)` at
 * the call site: rounding alone can land exactly on 0 or 100 for a
 * percentile that is *not* exactly 0 or 100 (e.g. percentile=0.4 rounds to
 * "100% より安い", which reads as the `lowest` claim without actually being
 * it). Deciding `lowest`/`highest` from the *exact* percentile first, then
 * clamping the leftover cases away from 0/100, is what keeps every rendered
 * sentence meaningful (design's own example of the failure mode to avoid:
 * "0% より安い").
 */
export function describeCurrentPercentile(percentile) {
  if (percentile == null) return null;
  if (percentile <= 0) return { kind: "lowest" };
  if (percentile >= 100) return { kind: "highest" };
  const percent = Math.min(99, Math.max(1, Math.round(100 - percentile)));
  return { kind: "cheaperThan", percent };
}

/**
 * Annotates each point with `delta`: the change from the previous
 * *non-null* Expected value (design §11: chart tooltip shows "前回比"). A
 * point right after a gap is diffed against the last value seen before the
 * gap, not against `null` (which would otherwise permanently break the
 * delta after any single missing point).
 */
export function withDeltas(series) {
  let previousValue = null;
  return series.map((point) => {
    const delta = point.expected != null && previousValue != null ? point.expected - previousValue : null;
    if (point.expected != null) previousValue = point.expected;
    return { ...point, delta };
  });
}
