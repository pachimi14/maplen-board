import { describe, expect, it } from "vitest";
import { buildBandRows, buildCubeRows, groupRecentByItem, isObservationStale, starForUpgrade } from "./bands.js";

describe("starForUpgrade", () => {
  it("is 1-based (itemUpgrade 0 -> ☆1, itemUpgrade 24 -> ☆25)", () => {
    expect(starForUpgrade(0)).toBe(1);
    expect(starForUpgrade(24)).toBe(25);
  });
});

describe("buildBandRows", () => {
  it("returns exactly upgradeCount rows, ordered by itemUpgrade", () => {
    const rows = buildBandRows([{ itemUpgrade: 5, price: 1, step: "STEP_TYPE_CHANGE", priceAt: "x", isDiscovery: false }], 25);
    expect(rows).toHaveLength(25);
    expect(rows.map((r) => r.itemUpgrade)).toEqual([...Array(25).keys()]);
    expect(rows[5].price).toBe(1);
  });

  it("fills a missing band with nulls rather than shrinking the table", () => {
    const rows = buildBandRows([], 25);
    expect(rows).toHaveLength(25);
    expect(rows.every((r) => r.price === null && r.step === null && r.isDiscovery === false)).toBe(true);
    expect(rows.every((r) => r.windowStart === null && r.windowEnd === null)).toBe(true);
  });

  // IMPL_PLAN_SH33 follow-up (post-review): windowStart/windowEnd -- this
  // band's own observed DISCOVERY -> CHANGE flip window.
  it("carries windowStart/windowEnd through when the server reports an observed transition", () => {
    const rows = buildBandRows(
      [
        { itemUpgrade: 3, price: 1, step: "STEP_TYPE_CHANGE", priceAt: "x", isDiscovery: false, windowStart: "2026-08-14T10:00:00Z", windowEnd: "2026-08-14T10:05:00Z" },
        { itemUpgrade: 4, price: 1, step: "STEP_TYPE_DISCOVERY", priceAt: "x", isDiscovery: true, windowStart: null, windowEnd: null },
      ],
      25,
    );
    expect(rows[3].windowStart).toBe("2026-08-14T10:00:00Z");
    expect(rows[3].windowEnd).toBe("2026-08-14T10:05:00Z");
    expect(rows[4].windowStart).toBeNull();
    expect(rows[4].windowEnd).toBeNull();
  });

  it("(h)/(c)-style real data: Suit pattern -- only 11-14,16 (itemUpgrade 10-13,15) lack the badge", () => {
    const changeBands = new Set([10, 11, 12, 13, 15]);
    const bands = [...Array(25).keys()].map((itemUpgrade) => ({
      itemUpgrade,
      price: 1,
      step: changeBands.has(itemUpgrade) ? "STEP_TYPE_CHANGE" : "STEP_TYPE_DISCOVERY",
      priceAt: "2026-08-15T09:28:00Z",
      isDiscovery: !changeBands.has(itemUpgrade),
    }));
    const rows = buildBandRows(bands, 25);
    const noBadge = rows.filter((r) => !r.isDiscovery).map((r) => r.itemUpgrade);
    expect(new Set(noBadge)).toEqual(changeBands);
  });
});

describe("buildCubeRows", () => {
  it("returns [] for an empty/undefined input -- distinct from buildBandRows' fixed-length fill", () => {
    expect(buildCubeRows([])).toEqual([]);
    expect(buildCubeRows(undefined)).toEqual([]);
  });

  it("sorts by cubeItemId ascending regardless of input order (j: no invented ranking)", () => {
    const rows = buildCubeRows([
      { cubeItemId: 5062503, cubeName: "White Cube", price: 1, step: "STEP_TYPE_CHANGE", isDiscovery: false, windowStart: null, windowEnd: null },
      { cubeItemId: 2711000, cubeName: "Occult Cube", price: 1, step: "STEP_TYPE_DISCOVERY", isDiscovery: true, windowStart: null, windowEnd: null },
    ]);
    expect(rows.map((r) => r.cubeItemId)).toEqual([2711000, 5062503]);
  });

  // (d): an unrecognized cube itemId's name is whatever the server already
  // resolved it to (server-side fallback = the code itself) -- this layer
  // only re-applies the SAME defensive fallback if that field is ever
  // missing/blank, it never guesses a name of its own.
  it("falls back to the code itself when cubeName is missing/blank", () => {
    const rows = buildCubeRows([{ cubeItemId: 9999999, price: 1, step: "STEP_TYPE_DISCOVERY", isDiscovery: true, windowStart: null, windowEnd: null }]);
    expect(rows[0].cubeName).toBe("9999999");
  });

  it("carries windowStart/windowEnd through when the server reports an observed transition", () => {
    const rows = buildCubeRows([
      { cubeItemId: 5062010, cubeName: "Black Cube", price: 1, step: "STEP_TYPE_CHANGE", isDiscovery: false, windowStart: "2026-08-14T10:00:00Z", windowEnd: "2026-08-14T10:05:00Z" },
    ]);
    expect(rows[0].windowStart).toBe("2026-08-14T10:00:00Z");
    expect(rows[0].windowEnd).toBe("2026-08-14T10:05:00Z");
  });
});

describe("groupRecentByItem", () => {
  it("groups multiple bands of the same item together, sorted by itemUpgrade", () => {
    const groups = groupRecentByItem([
      { itemId: 1, itemName: "A", itemUpgrade: 9, windowStart: "2026-08-01T00:00:00Z", windowEnd: "2026-08-01T00:05:00Z" },
      { itemId: 1, itemName: "A", itemUpgrade: 3, windowStart: "2026-08-02T00:00:00Z", windowEnd: "2026-08-02T00:05:00Z" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].bands.map((b) => b.itemUpgrade)).toEqual([3, 9]);
  });

  it("sorts groups by most recent windowEnd, newest first", () => {
    const groups = groupRecentByItem([
      { itemId: 1, itemName: "Older", itemUpgrade: 0, windowStart: "2026-08-01T00:00:00Z", windowEnd: "2026-08-01T00:05:00Z" },
      { itemId: 2, itemName: "Newer", itemUpgrade: 0, windowStart: "2026-08-10T00:00:00Z", windowEnd: "2026-08-10T00:05:00Z" },
    ]);
    expect(groups.map((g) => g.itemName)).toEqual(["Newer", "Older"]);
  });

  it("returns [] for an empty/undefined input", () => {
    expect(groupRecentByItem([])).toEqual([]);
    expect(groupRecentByItem(undefined)).toEqual([]);
  });
});

describe("isObservationStale", () => {
  const now = new Date("2026-08-15T10:00:00Z");

  it("(j): false right after an on-time poll", () => {
    expect(isObservationStale("2026-08-15T09:58:00Z", { now })).toBe(false);
  });

  it("(j): true once the poller has clearly stopped", () => {
    expect(isObservationStale("2026-08-15T09:30:00Z", { now })).toBe(true);
  });

  it("never polled yet (null) is not itself 'stale'", () => {
    expect(isObservationStale(null, { now })).toBe(false);
  });

  it("an unparsable timestamp is not itself 'stale' (never invents a state)", () => {
    expect(isObservationStale("not-a-date", { now })).toBe(false);
  });
});
