// IMPL_PLAN_SH37 §3/§7: fillLeadingPriceGaps' core contract -- fills only a
// band's LEADING null run (before its own first real value anywhere in
// `points`), never a mid-series gap, never a band with no real value at
// all. §7(a)/(c) are reproduced against real production data (frozen
// fixtures, see the two dedicated `describe` blocks below).
import { describe, expect, it } from "vitest";
import { fillLeadingPriceGaps, LOWER_BOUND_PRICE } from "./priceGapFill.js";
import { buildExpectedSeries } from "./series.js";
import { requiredPriceStars } from "../starforce.js";
import hatFixture from "../__fixtures__/sh37_hat_points.json";

function flatPrices(base = 1000, length = 22) {
  return Array.from({ length }, (_, i) => base + i * 100);
}

describe("fillLeadingPriceGaps: leading gap only (plan §3/§7(d))", () => {
  it("fills a band's leading nulls up to (not including) its own first real point", () => {
    const points = [
      { date: "d0", prices: [null, 100] },
      { date: "d1", prices: [null, 100] },
      { date: "d2", prices: [50, 100] }, // star 0's first real value
      { date: "d3", prices: [60, 100] },
    ];
    const { points: filled } = fillLeadingPriceGaps(points);
    expect(filled[0].prices[0]).toBe(LOWER_BOUND_PRICE);
    expect(filled[1].prices[0]).toBe(LOWER_BOUND_PRICE);
    expect(filled[2].prices[0]).toBe(50); // real value untouched
    expect(filled[3].prices[0]).toBe(60);
  });

  it("(d) ★does NOT fill a mid-series null (a gap AFTER the band's first real point) -- stays null", () => {
    const points = [
      { date: "d0", prices: [null] }, // leading gap -> filled
      { date: "d1", prices: [10] }, // first real value (the anchor)
      { date: "d2", prices: [null] }, // mid-series gap -- must stay null
      { date: "d3", prices: [20] },
    ];
    const { points: filled } = fillLeadingPriceGaps(points);
    expect(filled[0].prices[0]).toBe(LOWER_BOUND_PRICE);
    expect(filled[1].prices[0]).toBe(10);
    expect(filled[2].prices[0]).toBeNull(); // NOT filled -- this is the (d) guarantee
    expect(filled[3].prices[0]).toBe(20);
  });

  it("leaves a band with no real value ANYWHERE in `points` entirely untouched (no anchor to fill toward)", () => {
    const points = [
      { date: "d0", prices: [null] },
      { date: "d1", prices: [null] },
    ];
    const { points: filled, filledBands } = fillLeadingPriceGaps(points);
    expect(filled[0].prices[0]).toBeNull();
    expect(filled[1].prices[0]).toBeNull();
    expect(filledBands).toEqual([]);
  });

  it("each band's leading run is independent -- different first-real indices per star", () => {
    const points = [
      { date: "d0", prices: [null, null] },
      { date: "d1", prices: [null, 5] }, // star 1's first real value
      { date: "d2", prices: [7, 6] }, // star 0's first real value
      { date: "d3", prices: [8, 9] },
    ];
    const { points: filled } = fillLeadingPriceGaps(points);
    expect(filled.map((p) => p.prices[0])).toEqual([LOWER_BOUND_PRICE, LOWER_BOUND_PRICE, 7, 8]);
    expect(filled.map((p) => p.prices[1])).toEqual([LOWER_BOUND_PRICE, 5, 6, 9]);
  });
});

describe("fillLeadingPriceGaps: filledBands metadata (plan §3/§7(g))", () => {
  it("reports one entry per filled band, with the date of its own first real point", () => {
    const points = [
      { date: "d0", prices: [null, null] },
      { date: "d1", prices: [1, null] },
      { date: "d2", prices: [1, 2] },
    ];
    const { filledBands } = fillLeadingPriceGaps(points);
    expect(filledBands).toEqual([
      { upgrade: 0, untilDate: "d1" },
      { upgrade: 1, untilDate: "d2" },
    ]);
  });

  it("is [] when nothing needed filling", () => {
    const points = [{ date: "d0", prices: [1, 2] }];
    expect(fillLeadingPriceGaps(points).filledBands).toEqual([]);
  });

  it("annotates each touched point with its own `filledUpgrades` list (plan §3: 点ごとに識別できる)", () => {
    const points = [
      { date: "d0", prices: [null, null] },
      { date: "d1", prices: [1, 2] },
    ];
    const { points: filled } = fillLeadingPriceGaps(points);
    expect(filled[0].filledUpgrades).toEqual([0, 1]);
    expect(filled[1].filledUpgrades).toBeUndefined();
  });
});

describe("fillLeadingPriceGaps: (e) ★byte-for-byte no-op when every band has history from the start", () => {
  it("returns the exact same points reference when nothing was filled", () => {
    const points = [{ date: "d0", prices: flatPrices() }, { date: "d1", prices: flatPrices(1100) }];
    const { points: filled, filledBands } = fillLeadingPriceGaps(points);
    expect(filled).toBe(points); // same array reference -- proves "no clone when no-op"
    expect(filledBands).toEqual([]);
  });

  it("Expected values computed from the (unmodified) filled points are bit-identical to computing directly on the original points", () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, prices: flatPrices(1000 + i * 5) }));
    const { points: filled } = fillLeadingPriceGaps(points);
    const before = buildExpectedSeries(points, 0, 17);
    const after = buildExpectedSeries(filled, 0, 17);
    expect(after).toEqual(before);
  });
});

describe("fillLeadingPriceGaps: edge cases", () => {
  it("handles an empty/absent points array without throwing", () => {
    expect(fillLeadingPriceGaps([])).toEqual({ points: [], filledBands: [] });
    expect(fillLeadingPriceGaps(null)).toEqual({ points: [], filledBands: [] });
    expect(fillLeadingPriceGaps(undefined)).toEqual({ points: [], filledBands: [] });
  });

  it("tolerates a point with a missing/malformed `prices` array (passes it through unchanged)", () => {
    const points = [{ date: "d0", prices: [1, 2] }, { date: "d1" }];
    const { points: filled } = fillLeadingPriceGaps(points);
    expect(filled[1]).toEqual({ date: "d1" });
  });

  it("never touches an already non-null value, including one at the exact lower-bound price itself (idempotent)", () => {
    const points = [
      { date: "d0", prices: [LOWER_BOUND_PRICE] },
      { date: "d1", prices: [5] },
    ];
    const { points: filled, filledBands } = fillLeadingPriceGaps(points);
    expect(filled).toBe(points);
    expect(filledBands).toEqual([]);
  });
});

// IMPL_PLAN_SH37 §7(a) ★: reproduces the 統括's own production-data
// worked table verbatim, against a frozen `/sf-history/prices?itemId=
// 1004811` snapshot (Arcane Umbra Thief Hat) -- not a live call (see the
// fixture's own `sourceNote`). This is the exact `0->22` acceptance
// scenario the plan calls out: ☆19 (prices[18]) does not finish forming
// until 2026-08-20T00:00Z; every earlier point in this window is missing
// it (and, at the very start of the window, several other bands too).
describe("IMPL_PLAN_SH37 §7(a) ★: Hat 0->22 across the fixture's real leading-gap window", () => {
  const { points: filled } = fillLeadingPriceGaps(hatFixture.points);
  const required = requiredPriceStars(0, 22);

  function expectedAt(date) {
    const point = filled.find((p) => p.date === date);
    return buildExpectedSeriesSingle(point.prices);
  }

  function buildExpectedSeriesSingle(prices) {
    return buildExpectedSeries([{ date: "x", prices }], 0, 22)[0].expected;
  }

  it("required stars for 0->22 include ☆19 (index 18, the plan's own bottleneck)", () => {
    expect(required).toContain(18);
  });

  it("every point in the window is now computable (no null Expected) once leading gaps are filled", () => {
    for (const point of filled) {
      const series = buildExpectedSeries([point], 0, 22);
      expect(series[0].expected).not.toBeNull();
    }
  });

  it("08-17T12:00 ~= 0.208B (plan's own worked value)", () => {
    expect(expectedAt("2026-08-17T12:00:00Z") / 1e9).toBeCloseTo(0.208, 2);
  });

  it("08-18T04:00 ~= 1.489B", () => {
    expect(expectedAt("2026-08-18T04:00:00Z") / 1e9).toBeCloseTo(1.489, 2);
  });

  it("08-19T20:00 ~= 1.065B", () => {
    expect(expectedAt("2026-08-19T20:00:00Z") / 1e9).toBeCloseTo(1.065, 2);
  });

  it("08-20T00:00 ~= 1.650B (the step where ☆19 finishes forming -- no gap left to fill from here on)", () => {
    expect(expectedAt("2026-08-20T00:00:00Z") / 1e9).toBeCloseTo(1.65, 2);
  });

  it("☆19 (index 18) is reported as a filled band, ending exactly at 08-20T00:00Z", () => {
    const { filledBands } = fillLeadingPriceGaps(hatFixture.points);
    const star19 = filledBands.find((band) => band.upgrade === 18);
    expect(star19).toEqual({ upgrade: 18, untilDate: "2026-08-20T00:00:00Z" });
  });
});
