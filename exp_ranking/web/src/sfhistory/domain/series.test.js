// IMPL_PLAN_SH5 §7(a): domain/series.js pure-function tests. Fixes the
// missing-timepoint-> null behavior, the percentile formula, the period
// slice sizes, and the maxStar-bounded star options -- the four things the
// plan explicitly calls out as the minimum this suite must lock down.
import { describe, expect, it } from "vitest";
import {
  buildExpectedSeries,
  computeCurrentExpected,
  computeStats,
  currentPercentile,
  defaultPresetForMaxStar,
  DEFAULT_INITIAL_ITEM_ID,
  DEFAULT_PERIOD,
  describeCurrentPercentile,
  isPresetEnabled,
  isValidStarRange,
  PERIOD_DAYS,
  PERIOD_KEYS,
  selectInitialItem,
  sliceByPeriod,
  startStarOptions,
  STAR_RANGE_PRESETS,
  targetStarOptions,
  withDeltas,
} from "./series.js";

// A flat, plausible price for every star 0..21 -- exact values do not
// matter for most of these tests (only that they are consistent).
function flatPrices(base = 1000) {
  return Array.from({ length: 22 }, (_, i) => base + i * 100);
}

describe("buildExpectedSeries (design §9.1: missing-data gating)", () => {
  it("computes Expected when every required star is present", () => {
    const points = [{ date: "2026-01-01T00:00:00Z", prices: flatPrices() }];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series).toHaveLength(1);
    expect(series[0].date).toBe("2026-01-01T00:00:00Z");
    expect(typeof series[0].expected).toBe("number");
    expect(Number.isFinite(series[0].expected)).toBe(true);
  });

  it("is null (not interpolated) when a required star's price is missing", () => {
    const missingStar18 = flatPrices();
    missingStar18[18] = null; // (19,21) requires stars 10..20 (starforce.test.js pins this range)
    const points = [{ date: "2026-01-01T00:00:00Z", prices: missingStar18 }];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].expected).toBeNull();
  });

  it("is unaffected by a missing star the span does not need", () => {
    const missingStar5 = flatPrices();
    missingStar5[5] = null; // (19,21) only needs stars 10..20 -- star 5 is irrelevant
    const points = [{ date: "2026-01-01T00:00:00Z", prices: missingStar5 }];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].expected).not.toBeNull();
  });

  it("never interpolates: one bad point among good ones stays null, others stay non-null", () => {
    const good = flatPrices();
    const bad = flatPrices();
    bad[15] = null;
    const points = [
      { date: "2026-01-01T00:00:00Z", prices: good },
      { date: "2026-01-01T04:00:00Z", prices: bad },
      { date: "2026-01-01T08:00:00Z", prices: good },
    ];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series.map((p) => p.expected === null)).toEqual([false, true, false]);
  });
});

describe("buildExpectedSeries carries the `provisional` flag through (IMPL_PLAN_SH7 §3/§4)", () => {
  it("tags a point with provisional:true when the server marked it provisional", () => {
    const points = [
      { date: "2026-01-01T00:00:00Z", prices: flatPrices() },
      { date: "2026-01-01T04:00:00Z", prices: flatPrices(), provisional: true },
    ];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].provisional).toBe(false);
    expect(series[1].provisional).toBe(true);
  });

  it("a provisional point still goes through the exact same missing-data gating as a confirmed one", () => {
    const missing = flatPrices();
    missing[18] = null; // (19,21) requires stars 10..20
    const points = [{ date: "d", prices: missing, provisional: true }];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].expected).toBeNull();
    expect(series[0].provisional).toBe(true);
  });
});

describe("buildExpectedSeries carries `asOf` through for a provisional point only (IMPL_PLAN_SH8 §2-2)", () => {
  it("passes `asOf` through on the provisional point, leaving a confirmed point's asOf null", () => {
    const points = [
      { date: "2026-01-01T00:00:00Z", prices: flatPrices() },
      { date: "2026-01-01T04:00:00Z", prices: flatPrices(), provisional: true, asOf: "2026-01-01T05:40:00Z" },
    ];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].asOf).toBeNull();
    expect(series[1].asOf).toBe("2026-01-01T05:40:00Z");
  });

  it("is null when the provisional point had no asOf (never falls back to `date`)", () => {
    const points = [{ date: "2026-01-01T04:00:00Z", prices: flatPrices(), provisional: true }];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].asOf).toBeNull();
  });

  it("ignores a stray `asOf` on a non-provisional point (design: 確定点には asOf を付けない)", () => {
    const points = [{ date: "2026-01-01T00:00:00Z", prices: flatPrices(), asOf: "2026-01-01T00:05:00Z" }];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].asOf).toBeNull();
  });
});

describe("buildExpectedSeries carries the `closed` flag through, separate from `provisional` (IMPL_PLAN_SH19 §1/§4)", () => {
  it("defaults `closed` to true when the server omits the field (a confirmed point)", () => {
    const points = [{ date: "2026-01-01T00:00:00Z", prices: flatPrices() }];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].closed).toBe(true);
  });

  it("an elapsed-but-unaggregated bucket is provisional:true AND closed:true (not the dashed point)", () => {
    const points = [
      { date: "2026-01-01T04:00:00Z", prices: flatPrices(), provisional: true, closed: true },
    ];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].provisional).toBe(true);
    expect(series[0].closed).toBe(true);
  });

  it("the still-open bucket is provisional:true AND closed:false (the one dashed point)", () => {
    const points = [
      { date: "2026-01-01T08:00:00Z", prices: flatPrices(), provisional: true, closed: false },
    ];
    const series = buildExpectedSeries(points, 19, 21);
    expect(series[0].provisional).toBe(true);
    expect(series[0].closed).toBe(false);
  });
});

describe("computeCurrentExpected (design §6: same missing-data gating, single point)", () => {
  it("returns null (not a fallback value) when latestPrices is absent", () => {
    expect(computeCurrentExpected(null, 19, 21)).toBeNull();
    expect(computeCurrentExpected(undefined, 19, 21)).toBeNull();
  });

  it("returns null when a required star is missing", () => {
    const prices = flatPrices();
    prices[12] = null;
    expect(computeCurrentExpected(prices, 19, 21)).toBeNull();
  });

  it("matches buildExpectedSeries for the same single point/span", () => {
    const prices = flatPrices();
    const [single] = buildExpectedSeries([{ date: "d", prices }], 0, 17);
    expect(computeCurrentExpected(prices, 0, 17)).toBe(single.expected);
  });

  // IMPL_PLAN_SH36 §0/§6(d): reproduces the acceptance-criterion scenario --
  // Arcane Umbra Thief Hat (itemId 1004811), 0->22, fed the item's own
  // current per-band price for EVERY star (☆1-10/☆20-22 forming, ☆11-19
  // settled -- this is exactly what `computeCurrentExpected` already does,
  // unmodified, once `/sf-history/latest` carries a real current price for
  // every band regardless of DISCOVERY step -- design H2/fetch_latest.py's
  // Open API upstream already reads `currentPrice.price` unconditionally on
  // `step`). This fixture is a FROZEN snapshot (`GET /sf-history/discovery/
  // prices?itemId=1004811`, api.lulumi-tools.com, captured 2026-08-
  // 21T09:30:15Z) -- not a live call (DISCOVERY-period prices for ☆1-10/
  // ☆20-22 drift meaningfully hour to hour, so a live re-fetch will not
  // bit-match this or the architect's own independently-captured reference
  // value; see the SH-36 completion report for that live comparison).
  it("IMPL_PLAN_SH36 §6(d): Hat 0->22 using the frozen live-snapshot fixture", () => {
    // `computeCurrentExpected` requires an array (mirrors `/sf-history/
    // latest`'s own `prices[]` response shape) -- index = itemUpgrade.
    const sfPrices = [
      114.892432, 229.785131, 344.677717, 459.570351, 574.46295,
      689.354941, 804.247441, 919.139943, 1034.032455, 1148.924952,
      1201149.099335, 1627180.850776, 1799166.600104, 1791177.020387,
      1775197.860955, 2963863.801319, 2963863.801319, 2963863.801319,
      2963863.801319, 2.347413, 2.593298, 0.000001,
    ];
    const expected = computeCurrentExpected(sfPrices, 0, 22);
    // Frozen regression value for THIS fixture (computed by this same,
    // unmodified `computeCurrentExpected` -- not a hand re-derivation).
    expect(expected).toBeCloseTo(1498147111.4045134, 4);
  });
});

describe("percentile (design §11: Current Position)", () => {
  it("matches a hand-computed value for a known array", () => {
    // Confirmed values: [10, 20, 30, 40, 50]. Current = 30 -> 3 of 5 values
    // are <= 30 -> 60th percentile.
    const series = [10, 20, 30, 40, 50].map((expected, i) => ({ date: `d${i}`, expected }));
    expect(currentPercentile(series, 30)).toBe(60);
  });

  it("100th percentile when current is the highest value seen", () => {
    const series = [10, 20, 30].map((expected, i) => ({ date: `d${i}`, expected }));
    expect(currentPercentile(series, 30)).toBe(100);
  });

  it("ignores null points when building the distribution", () => {
    const series = [
      { date: "a", expected: 10 },
      { date: "b", expected: null },
      { date: "c", expected: 20 },
      { date: "d", expected: null },
      { date: "e", expected: 30 },
    ];
    // Distribution is [10, 20, 30] (nulls excluded) -- current=20 -> 2/3 = 66.67%
    expect(currentPercentile(series, 20)).toBeCloseTo((2 / 3) * 100, 6);
  });

  it("is null when there is no confirmed data or no current value", () => {
    expect(currentPercentile([], 30)).toBeNull();
    expect(currentPercentile([{ date: "a", expected: 10 }], null)).toBeNull();
  });

  it("IMPL_PLAN_SH7 (e): a provisional point never changes the percentile, however extreme its value", () => {
    const confirmed = [10, 20, 30, 40, 50].map((expected, i) => ({ date: `d${i}`, expected, provisional: false }));
    const withoutProvisional = currentPercentile(confirmed, 30);
    const withProvisional = currentPercentile(
      [...confirmed, { date: "p", expected: 999999, provisional: true }],
      30,
    );
    expect(withProvisional).toBe(withoutProvisional);
  });
});

describe("describeCurrentPercentile (IMPL_PLAN_SH15 §2: display-only wording, currentPercentile formula unchanged)", () => {
  it("is null when there is no percentile (no current value / no confirmed data)", () => {
    expect(describeCurrentPercentile(null)).toBeNull();
  });

  it("percentile=0 (current undercuts the whole period) -> the dedicated 'lowest' sentence, not '0%より安い'", () => {
    expect(describeCurrentPercentile(0)).toEqual({ kind: "lowest" });
  });

  it("percentile=100 (current is at/above the whole period) -> the dedicated 'highest' sentence, not '100%より安い'", () => {
    expect(describeCurrentPercentile(100)).toEqual({ kind: "highest" });
  });

  it("percentile=13 -> 'cheaper than 87% of this period' (plan §0's worked example)", () => {
    expect(describeCurrentPercentile(13)).toEqual({ kind: "cheaperThan", percent: 87 });
  });

  it("percentile=60 -> cheaper than 40%", () => {
    expect(describeCurrentPercentile(60)).toEqual({ kind: "cheaperThan", percent: 40 });
  });

  it("rounds the displayed percent (percentile=66.666...)", () => {
    expect(describeCurrentPercentile((2 / 3) * 100)).toEqual({ kind: "cheaperThan", percent: 33 });
  });

  it("clamps a near-highest, non-exact percentile away from the meaningless '0%より安い'", () => {
    // percentile=99.6 (not exactly 100) would round 100-99.6=0.4 -> 0.
    // Must not fall into "cheaperThan 0" or the "highest" sentence.
    const result = describeCurrentPercentile(99.6);
    expect(result.kind).toBe("cheaperThan");
    expect(result.percent).toBe(1);
  });

  it("clamps a near-lowest, non-exact percentile away from overclaiming 'cheaper than 100%' (the 'lowest' claim)", () => {
    // percentile=0.4 (not exactly 0) would round 100-0.4=99.6 -> 100.
    // Must not fall into "cheaperThan 100" or the "lowest" sentence.
    const result = describeCurrentPercentile(0.4);
    expect(result.kind).toBe("cheaperThan");
    expect(result.percent).toBe(99);
  });
});

describe("computeStats (design §6.1: confirmed-only statistics)", () => {
  it("computes average/high/low over non-null points only", () => {
    const series = [
      { date: "a", expected: 10 },
      { date: "b", expected: null },
      { date: "c", expected: 20 },
      { date: "d", expected: 30 },
    ];
    const stats = computeStats(series);
    expect(stats.count).toBe(3);
    expect(stats.average).toBeCloseTo(20, 10);
    expect(stats.high).toBe(30);
    expect(stats.low).toBe(10);
  });

  it("returns nulls (not zero/NaN) when there is no confirmed data at all", () => {
    const stats = computeStats([{ date: "a", expected: null }]);
    expect(stats).toEqual({ average: null, high: null, low: null, count: 0 });
  });

  it("never receives (and is not responsible for excluding) a live current value -- the caller passes only confirmed points", () => {
    // Documents the design §6.1 contract at the unit level: computeStats has
    // no special-cased "current" concept at all, so mixing it in is only
    // possible if a caller wrongly appends it to the array before calling.
    const confirmedOnly = [{ date: "a", expected: 10 }, { date: "b", expected: 20 }];
    const withLiveValueMixedIn = [...confirmedOnly, { date: "live", expected: 999999 }];
    expect(computeStats(confirmedOnly).high).toBe(20);
    expect(computeStats(withLiveValueMixedIn).high).toBe(999999); // proves mixing in changes the answer -- callers must not do this
  });

  it("IMPL_PLAN_SH7 (e): a provisional point never changes average/high/low/count, however extreme its value", () => {
    const confirmed = [
      { date: "a", expected: 10, provisional: false },
      { date: "b", expected: 20, provisional: false },
      { date: "c", expected: 30, provisional: false },
    ];
    const withoutProvisional = computeStats(confirmed);
    const withProvisionalLow = computeStats([...confirmed, { date: "p", expected: 0.01, provisional: true }]);
    const withProvisionalHigh = computeStats([...confirmed, { date: "p", expected: 999999, provisional: true }]);
    expect(withProvisionalLow).toEqual(withoutProvisional);
    expect(withProvisionalHigh).toEqual(withoutProvisional);
  });
});

describe("sliceByPeriod (design §13: period tabs cut a trailing window of the same series)", () => {
  const fullSeries = Array.from({ length: 900 }, (_, i) => ({ date: `d${i}`, expected: i }));

  it.each([
    ["7D", 7 * 6],
    ["14D", 14 * 6], // IMPL_PLAN_SH29 §3
    ["30D", 30 * 6],
    ["90D", 90 * 6],
    ["150D", 900],
  ])("%s keeps the trailing %i points", (periodKey, expectedCount) => {
    const sliced = sliceByPeriod(fullSeries, periodKey);
    expect(sliced).toHaveLength(expectedCount);
    expect(sliced[sliced.length - 1]).toEqual(fullSeries[fullSeries.length - 1]);
  });

  it("does not crash and returns everything available when the series is shorter than the period", () => {
    const short = fullSeries.slice(0, 10);
    expect(sliceByPeriod(short, "150D")).toHaveLength(10);
  });

  // IMPL_PLAN_SH29 §3 (2026-08-06, user decision): adds "14D" between 7D
  // and 30D.
  it("PERIOD_KEYS and PERIOD_DAYS agree on the same five periods", () => {
    expect(PERIOD_KEYS).toEqual(["7D", "14D", "30D", "90D", "150D"]);
    expect(Object.keys(PERIOD_DAYS)).toEqual(PERIOD_KEYS);
    expect(PERIOD_DAYS["14D"]).toBe(14);
  });

  // IMPL_PLAN_SH27 §4(c): pins the default itself, alongside pinning that it
  // stays a valid PERIOD_KEYS entry -- so a future rename of the keys (e.g.
  // "30D" -> "1M") cannot silently strand the default outside PERIOD_KEYS
  // without failing a test (same "停止せず穏当に劣化する" concern SH-26 §1(c)
  // applied to DEFAULT_INITIAL_ITEM_ID).
  it("DEFAULT_PERIOD is 30D and is a member of PERIOD_KEYS", () => {
    expect(DEFAULT_PERIOD).toBe("30D");
    expect(PERIOD_KEYS).toContain(DEFAULT_PERIOD);
  });
});

describe("maxStar-bounded star selection (design §7.1: the most safety-critical requirement in this slice)", () => {
  it("targetStarOptions never exceeds maxStar", () => {
    expect(targetStarOptions(20)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(Math.max(...targetStarOptions(20))).toBe(20);
    expect(targetStarOptions(20)).not.toContain(21);
    expect(targetStarOptions(20)).not.toContain(22);
  });

  it("targetStarOptions(22) allows up to 22 but not 23", () => {
    expect(Math.max(...targetStarOptions(22))).toBe(22);
    expect(targetStarOptions(22)).not.toContain(23);
  });

  it("startStarOptions stays below maxStar", () => {
    expect(startStarOptions(20)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(startStarOptions(20)).not.toContain(20);
  });

  it("isValidStarRange rejects a target above maxStar (the exact bug this plan calls out: 19->21 on a maxStar=20 device)", () => {
    expect(isValidStarRange(19, 21, 20)).toBe(false);
    expect(isValidStarRange(19, 20, 20)).toBe(true);
  });

  it("IMPL_PLAN_SH13 §3: exactly 3 presets, 0->21/0->22 disabled on a maxStar=20 device", () => {
    expect(STAR_RANGE_PRESETS).toEqual([
      { from: 0, to: 17 },
      { from: 0, to: 21 },
      { from: 0, to: 22 },
    ]);
    const enabled = STAR_RANGE_PRESETS.filter((p) => isPresetEnabled(p, 20));
    expect(enabled).toEqual([{ from: 0, to: 17 }]);
    const disabled = STAR_RANGE_PRESETS.filter((p) => !isPresetEnabled(p, 20));
    expect(disabled).toEqual([
      { from: 0, to: 21 },
      { from: 0, to: 22 },
    ]);
  });

  it("isPresetEnabled allows all 3 presets for maxStar=22", () => {
    expect(STAR_RANGE_PRESETS.every((p) => isPresetEnabled(p, 22))).toBe(true);
  });

  it("defaultPresetForMaxStar returns a `{ startStar, targetStar }` range object (the SAME shape `range` state uses everywhere else), never picking a span above maxStar", () => {
    // Post-review fix (統括 P0, 2026-08-05): this function's whole purpose
    // is "give me a default `range`" -- returning the raw preset's
    // `{ from, to }` shape instead was the root cause of a production
    // crash (SfHistoryRoot.jsx passed `range.startStar`/`range.targetStar`,
    // which were `undefined` on a `{ from, to }` object, straight into
    // `computeCurrentExpected`). `{ from, to }` is intentionally NOT
    // accepted here, even though it would satisfy `.toMatchObject` -- this
    // must be the exact, only shape.
    expect(defaultPresetForMaxStar(20)).toEqual({ startStar: 0, targetStar: 17 });
    expect(defaultPresetForMaxStar(22)).toEqual({ startStar: 0, targetStar: 22 });
    expect(defaultPresetForMaxStar(20)).not.toHaveProperty("from");
    expect(defaultPresetForMaxStar(20)).not.toHaveProperty("to");
  });

  it("defaultPresetForMaxStar(20)'s pick is itself a valid range for that device", () => {
    const range = defaultPresetForMaxStar(20);
    expect(isValidStarRange(range.startStar, range.targetStar, 20)).toBe(true);
  });

  it("returns null when no preset fits (maxStar below every preset's `to`)", () => {
    expect(defaultPresetForMaxStar(0)).toBeNull();
  });
});

describe("selectInitialItem (IMPL_PLAN_SH26 §1: default-open item)", () => {
  it("picks DEFAULT_INITIAL_ITEM_ID (Arcane Umbra Staff) when it is present, regardless of its position in the list", () => {
    const items = [
      { itemId: 111, itemName: "Some Other Weapon", maxStar: 22 },
      { itemId: DEFAULT_INITIAL_ITEM_ID, itemName: "Arcane Umbra Staff", maxStar: 22 },
      { itemId: 222, itemName: "Yet Another Weapon", maxStar: 22 },
    ];
    expect(selectInitialItem(items)).toEqual(items[1]);
  });

  it("(c) falls back to items[0] when DEFAULT_INITIAL_ITEM_ID is absent from the list -- must not throw or return undefined", () => {
    const items = [
      { itemId: 111, itemName: "Some Other Weapon", maxStar: 22 },
      { itemId: 222, itemName: "Yet Another Weapon", maxStar: 20 },
    ];
    expect(selectInitialItem(items)).toEqual(items[0]);
  });

  it("falls back to items[0] on a single-item list without DEFAULT_INITIAL_ITEM_ID", () => {
    const items = [{ itemId: 999, itemName: "Solo Item", maxStar: 17 }];
    expect(selectInitialItem(items)).toEqual(items[0]);
  });
});

describe("withDeltas", () => {
  it("computes delta from the previous non-null value, first point has no delta", () => {
    const series = [
      { date: "a", expected: 100 },
      { date: "b", expected: 130 },
      { date: "c", expected: 90 },
    ];
    const withD = withDeltas(series);
    expect(withD[0].delta).toBeNull();
    expect(withD[1].delta).toBe(30);
    expect(withD[2].delta).toBe(-40);
  });

  it("diffs across a gap against the last value seen before it (not against null)", () => {
    const series = [
      { date: "a", expected: 100 },
      { date: "b", expected: null },
      { date: "c", expected: 150 },
    ];
    const withD = withDeltas(series);
    expect(withD[1].delta).toBeNull();
    expect(withD[2].delta).toBe(50);
  });
});
