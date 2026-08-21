// IMPL_PLAN_SH5 post-review fix (統括 P0, 2026-08-05): regression coverage
// for the "app went completely blank" defect. The defect was a *mounting/
// integration* bug (an async-derived piece of state reached a compute
// function before it was confirmed/well-formed), which `series.js`'s
// pure-function tests could not catch because they only ever called those
// functions with valid arguments directly. `buildScreenModel` is the
// extraction the review asked for: SfHistoryRoot.jsx calls this function
// instead of inlining the same gating logic, so these tests exercise the
// exact code path production uses -- without needing a DOM or
// @testing-library/react (explicitly not to be added, per the review).
import { describe, expect, it } from "vitest";
import { buildScreenModel, isRangeReady } from "./viewModel.js";
import { buildExpectedSeries, defaultPresetForMaxStar } from "./series.js";

const READY_PRICES_POINTS = [{ date: "2026-01-01T00:00:00Z", prices: Array.from({ length: 22 }, (_, i) => 1000 + i * 10) }];
const READY_LATEST_PRICES = Array.from({ length: 22 }, (_, i) => 1000 + i * 10);

describe("isRangeReady", () => {
  it("rejects the initial null state (useState(null), before the equipment fetch resolves)", () => {
    expect(isRangeReady(null)).toBe(false);
    expect(isRangeReady(undefined)).toBe(false);
  });

  it("rejects a truthy but wrong-shaped object -- the exact defect: a `{ from, to }` preset object mistaken for a `{ startStar, targetStar }` range", () => {
    // This is not hypothetical: defaultPresetForMaxStar actually returned
    // this exact shape before the fix in series.js. A naive `if (!range)`
    // guard does NOT catch this (the object is truthy) -- isRangeReady
    // must, since it is the thing production code actually branches on.
    expect(isRangeReady({ from: 0, to: 17 })).toBe(false);
  });

  it("rejects a partially-filled range", () => {
    expect(isRangeReady({ startStar: 0, targetStar: undefined })).toBe(false);
    expect(isRangeReady({ startStar: undefined, targetStar: 17 })).toBe(false);
  });

  it("accepts a well-formed integer range", () => {
    expect(isRangeReady({ startStar: 0, targetStar: 17 })).toBe(true);
    expect(isRangeReady({ startStar: 19, targetStar: 21 })).toBe(true);
  });
});

describe("buildScreenModel: must never throw, regardless of how unconfirmed/malformed the async state is", () => {
  it("initial mount: range=null, pricesState/latestState idle (exactly SfHistoryRoot's useState initial values) -- does not throw, everything is empty/null", () => {
    expect(() =>
      buildScreenModel({
        range: null,
        period: "150D",
        pricesState: { status: "idle", points: [] },
        latestState: { status: "idle", prices: null },
      }),
    ).not.toThrow();

    const model = buildScreenModel({
      range: null,
      period: "150D",
      pricesState: { status: "idle", points: [] },
      latestState: { status: "idle", prices: null },
    });
    expect(model.fullSeries).toEqual([]);
    expect(model.periodSeries).toEqual([]);
    expect(model.currentExpected).toBeNull();
    expect(model.percentile).toBeNull();
    expect(model.stats).toEqual({ average: null, high: null, low: null, count: 0 });
  });

  it("REPRODUCES THE REPORTED CRASH: `latest` resolves to \"ready\" before `range` is well-formed (a `{ from, to }` object, the pre-fix defaultPresetForMaxStar shape) -- must not throw, and currentExpected must stay null rather than being computed from garbage", () => {
    const malformedRange = { from: 0, to: 22 }; // what defaultPresetForMaxStar used to return
    expect(() =>
      buildScreenModel({
        range: malformedRange,
        period: "150D",
        pricesState: { status: "idle", points: [] }, // prices not resolved yet
        latestState: { status: "ready", prices: READY_LATEST_PRICES }, // latest resolved first (the actual race)
      }),
    ).not.toThrow();

    const model = buildScreenModel({
      range: malformedRange,
      period: "150D",
      pricesState: { status: "idle", points: [] },
      latestState: { status: "ready", prices: READY_LATEST_PRICES },
    });
    expect(model.currentExpected).toBeNull();
  });

  it("prices resolves to \"ready\" before range is well-formed -- must not throw", () => {
    const malformedRange = { from: 0, to: 17 };
    expect(() =>
      buildScreenModel({
        range: malformedRange,
        period: "150D",
        pricesState: { status: "ready", points: READY_PRICES_POINTS },
        latestState: { status: "idle", prices: null },
      }),
    ).not.toThrow();
  });

  it("`latest` failing (upstream unavailable, design §6) leaves currentExpected null rather than throwing or falling back to history", () => {
    const range = { startStar: 19, targetStar: 21 };
    const model = buildScreenModel({
      range,
      period: "150D",
      pricesState: { status: "ready", points: READY_PRICES_POINTS },
      latestState: { status: "error", prices: null },
    });
    expect(model.currentExpected).toBeNull();
  });

  it("`prices` failing (load error) leaves fullSeries/periodSeries empty rather than throwing", () => {
    const range = { startStar: 19, targetStar: 21 };
    const model = buildScreenModel({
      range,
      period: "150D",
      pricesState: { status: "error", points: [] },
      latestState: { status: "ready", prices: READY_LATEST_PRICES },
    });
    expect(model.fullSeries).toEqual([]);
    expect(model.periodSeries).toEqual([]);
  });

  it("switching equipment mid-flight: an in-flight range from the previous item plus a fresh idle pricesState for the new item -- does not throw", () => {
    // Simulates the moment right after `selectedItemId` changes: the price
    // effect has just reset pricesState to idle/loading for the new item,
    // but `range` (from the previous item) may momentarily be invalid for
    // the new item's maxStar before the re-clamp effect runs.
    const staleRangeFromPreviousItem = { startStar: 19, targetStar: 21 }; // may exceed the new item's maxStar
    expect(() =>
      buildScreenModel({
        range: staleRangeFromPreviousItem,
        period: "150D",
        pricesState: { status: "loading", points: [] },
        latestState: { status: "loading", prices: null },
      }),
    ).not.toThrow();
  });

  it("everything ready and well-formed: computes real values (positive case, proves the guards don't over-suppress valid data)", () => {
    const range = { startStar: 0, targetStar: 17 };
    const model = buildScreenModel({
      range,
      period: "150D",
      pricesState: { status: "ready", points: READY_PRICES_POINTS },
      latestState: { status: "ready", prices: READY_LATEST_PRICES },
    });
    expect(model.fullSeries).toHaveLength(1);
    expect(model.fullSeries[0].expected).not.toBeNull();
    expect(model.currentExpected).not.toBeNull();
    expect(model.percentile).not.toBeNull();
    expect(model.stats.count).toBe(1);
  });

  it("the real defaultPresetForMaxStar output is directly usable as `range` (integration check between the two fixed pieces)", () => {
    const range = defaultPresetForMaxStar(22);
    expect(isRangeReady(range)).toBe(true);
    expect(() =>
      buildScreenModel({
        range,
        period: "150D",
        pricesState: { status: "ready", points: READY_PRICES_POINTS },
        latestState: { status: "ready", prices: READY_LATEST_PRICES },
      }),
    ).not.toThrow();
  });
});

// IMPL_PLAN_SH37 §3/§7(a)(e)(f)(h): `buildScreenModel` now also fills a
// band's leading null run before computing `fullSeries`, and exposes
// `filledBands` (scoped to the CURRENTLY selected span).
describe("buildScreenModel: IMPL_PLAN_SH37 leading-gap fill + filledBands", () => {
  it("(a) fills a leading gap so a span that previously had a null Expected at the earliest point now computes one", () => {
    const missingLeadingStar = [
      { date: "d0", prices: [null, ...Array.from({ length: 21 }, (_, i) => 1000 + i * 10)] },
      { date: "d1", prices: Array.from({ length: 22 }, (_, i) => 1000 + i * 10) },
    ];
    const range = { startStar: 0, targetStar: 17 };
    const before = buildExpectedSeries(missingLeadingStar, 0, 17);
    expect(before[0].expected).toBeNull(); // proves the span WOULD be null without SH-37's fill

    const model = buildScreenModel({
      range,
      period: "150D",
      pricesState: { status: "ready", points: missingLeadingStar },
      latestState: { status: "idle", prices: null },
    });
    expect(model.fullSeries[0].expected).not.toBeNull();
  });

  it("(e) ★byte-for-byte unchanged for a fully-populated item (every band has history from the start)", () => {
    const range = { startStar: 0, targetStar: 17 };
    const withoutFill = buildExpectedSeries(READY_PRICES_POINTS, 0, 17);
    const model = buildScreenModel({
      range,
      period: "150D",
      pricesState: { status: "ready", points: READY_PRICES_POINTS },
      latestState: { status: "idle", prices: null },
    });
    expect(model.fullSeries).toEqual(withoutFill);
    expect(model.filledBands).toEqual([]);
  });

  it("(h) filledBands is [] when nothing was filled for the currently selected span", () => {
    const range = { startStar: 0, targetStar: 17 };
    const model = buildScreenModel({
      range,
      period: "150D",
      pricesState: { status: "ready", points: READY_PRICES_POINTS },
      latestState: { status: "idle", prices: null },
    });
    expect(model.filledBands).toEqual([]);
  });

  it("(h) filledBands only reports bands the CURRENTLY selected span actually requires -- a gap outside the span is not reported", () => {
    // Star index 18 (☆19) has a leading gap; a 0->17 span (needs stars
    // 0..16 only) never touches it, so it must not appear here even
    // though the SAME points array has an unrelated leading gap at ☆19.
    const points = [
      { date: "d0", prices: flatPricesWithGapAt(18) },
      { date: "d1", prices: flatPrices() },
    ];
    const modelNarrow = buildScreenModel({
      range: { startStar: 0, targetStar: 17 },
      period: "150D",
      pricesState: { status: "ready", points },
      latestState: { status: "idle", prices: null },
    });
    expect(modelNarrow.filledBands).toEqual([]);

    const modelWide = buildScreenModel({
      range: { startStar: 0, targetStar: 22 },
      period: "150D",
      pricesState: { status: "ready", points },
      latestState: { status: "idle", prices: null },
    });
    expect(modelWide.filledBands.map((b) => b.upgrade)).toEqual([18]);
  });

  it("(f) coexists with an already-filled band (simulating SH-36's server-side forming-price fill, which never leaves a null slot behind) -- SH-37's own fill is then simply a no-op for that band", () => {
    // Every slot already non-null (as SH-36's server-side fill would leave
    // a currently-forming band) -- SH-37 must not alter it, and must not
    // report it as filled.
    const points = [
      { date: "d0", prices: flatPrices() },
      { date: "d1", prices: flatPrices(1100) },
    ];
    const model = buildScreenModel({
      range: { startStar: 0, targetStar: 22 },
      period: "150D",
      pricesState: { status: "ready", points },
      latestState: { status: "idle", prices: null },
    });
    expect(model.filledBands).toEqual([]);
    expect(model.fullSeries).toEqual(buildExpectedSeries(points, 0, 22));
  });
});

function flatPrices(base = 1000) {
  return Array.from({ length: 22 }, (_, i) => base + i * 100);
}

function flatPricesWithGapAt(index) {
  const prices = flatPrices();
  prices[index] = null;
  return prices;
}
