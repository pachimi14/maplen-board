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

/** design §7.1: presets a user can pick, before maxStar filtering. */
export const STAR_RANGE_PRESETS = [
  { from: 0, to: 17 },
  { from: 17, to: 18 },
  { from: 18, to: 19 },
  { from: 19, to: 20 },
  { from: 20, to: 21 },
  { from: 21, to: 22 },
  { from: 19, to: 21 },
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
 */
export function buildExpectedSeries(points, startStar, targetStar) {
  const required = requiredPriceStars(startStar, targetStar);
  return points.map((point) => {
    const prices = point?.prices ?? [];
    const hasAllRequired = required.every((star) => prices[star] != null);
    if (!hasAllRequired) {
      return { date: point.date, expected: null };
    }
    return { date: point.date, expected: expectedStarforceCostExact({ startStar, targetStar, sfPrices: prices }) };
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
 */
export function computeStats(series) {
  const values = series.map((point) => point.expected).filter((value) => value != null);
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
 */
export function currentPercentile(series, currentValue) {
  const values = series.map((point) => point.expected).filter((value) => value != null);
  if (!values.length || currentValue == null) return null;
  const countAtOrBelow = values.filter((value) => value <= currentValue).length;
  return (countAtOrBelow / values.length) * 100;
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
