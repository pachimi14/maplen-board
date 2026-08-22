import { describe, expect, it, vi } from "vitest";
import {
  createSfHistorySource,
  normalizeCubePricesPayload,
  normalizeEquipmentPayload,
  normalizeLatestPayload,
  normalizePricesPayload,
} from "./sfHistorySource.js";

const equipmentPayload = {
  generatedAt: "2026-08-04T18:30:54Z",
  excluded: [],
  items: [
    { itemId: 1003720, itemName: "Chaos Von Bon Helmet", aliasItemIds: [1003719, 1003720], maxStar: 22 },
    { itemId: 1022232, itemName: "Black Bean Mark", aliasItemIds: [1022232], maxStar: 20 },
    { itemId: 9999999, itemName: "No maxStar yet", aliasItemIds: [9999999], maxStar: null },
  ],
};

const pricesPayload = {
  itemId: 1003720,
  interval: "4h",
  labelIs: "bucketStart",
  startDate: "2026-03-08T00:00:00Z",
  endDate: "2026-08-04T16:00:00Z",
  priceVersion: "2026-08-05T20:00:00Z",
  upgradeCount: 22,
  points: [{ date: "2026-03-08T00:00:00Z", prices: [1, 2, null, 4] }],
};

const latestPayload = {
  itemId: 1003720,
  latestUpdatedAt: "2026-08-04T18:20:00Z",
  prices: [1, 2, null, 4],
  cubes: [636809.13, 778760.18, 1048901.68, 1202408.98],
  cubeOrder: ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"],
};

const cubePricesPayload = {
  itemId: 1003720,
  interval: "4h",
  labelIs: "bucketStart",
  startDate: "2026-03-25T00:00:00Z",
  endDate: "2026-08-21T20:00:00Z",
  priceVersion: "2026-08-22T00:00:00Z",
  cubeOrder: ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"],
  points: [{ date: "2026-03-25T00:00:00Z", cubes: [894882.28, 1638568.1, 2185268.35, null] }],
};

describe("normalizeEquipmentPayload", () => {
  it("keeps items with an integer itemId and a positive integer maxStar", () => {
    const result = normalizeEquipmentPayload(equipmentPayload);
    expect(result.ok).toBe(true);
    expect(result.items.map((i) => i.itemId)).toEqual([1003720, 1022232]);
  });

  it("drops an item with a missing maxStar rather than guessing (design §7.1)", () => {
    const result = normalizeEquipmentPayload(equipmentPayload);
    expect(result.items.find((i) => i.itemId === 9999999)).toBeUndefined();
  });

  it("defaults aliasItemIds to [itemId] when the field is missing/empty", () => {
    const result = normalizeEquipmentPayload({
      items: [{ itemId: 42, itemName: "X", maxStar: 22 }],
    });
    expect(result.items[0].aliasItemIds).toEqual([42]);
  });

  it("is invalidFormat for a non-object / missing items array", () => {
    expect(normalizeEquipmentPayload(null).ok).toBe(false);
    expect(normalizeEquipmentPayload({}).ok).toBe(false);
  });

  it("IMPL_PLAN_SH9 §3-2: passes through per-alias itemId+itemName", () => {
    const result = normalizeEquipmentPayload({
      items: [
        {
          itemId: 1102940,
          itemName: "Arcane Umbra Knight Cape",
          aliasItemIds: [1102940, 1102942, 1102943],
          maxStar: 22,
          aliases: [
            { itemId: 1102940, itemName: "Arcane Umbra Knight Cape" },
            { itemId: 1102942, itemName: "Arcane Umbra Mage Cape" },
            { itemId: 1102943, itemName: "Arcane Umbra Archer Cape" },
          ],
        },
      ],
    });
    expect(result.items[0].aliases).toEqual([
      { itemId: 1102940, itemName: "Arcane Umbra Knight Cape" },
      { itemId: 1102942, itemName: "Arcane Umbra Mage Cape" },
      { itemId: 1102943, itemName: "Arcane Umbra Archer Cape" },
    ]);
  });

  it("falls back to a single self-named alias when the server sent no `aliases` (pre-SH9 snapshot)", () => {
    const result = normalizeEquipmentPayload({
      items: [{ itemId: 1022232, itemName: "Black Bean Mark", aliasItemIds: [1022232], maxStar: 20 }],
    });
    expect(result.items[0].aliases).toEqual([{ itemId: 1022232, itemName: "Black Bean Mark" }]);
  });
});

describe("normalizePricesPayload", () => {
  it("passes through points, converting non-finite prices entries to null", () => {
    const result = normalizePricesPayload(pricesPayload, 1003720);
    expect(result.ok).toBe(true);
    expect(result.points).toEqual([
      { date: "2026-03-08T00:00:00Z", prices: [1, 2, null, 4], provisional: false, closed: true },
    ]);
    expect(result.priceVersion).toBe("2026-08-05T20:00:00Z");
    expect(result.endDate).toBe("2026-08-04T16:00:00Z");
    expect(result.provisionalDate).toBeNull();
  });

  it("is invalidFormat if the response itemId does not match the request", () => {
    const result = normalizePricesPayload(pricesPayload, 1234);
    expect(result.ok).toBe(false);
  });

  it("IMPL_PLAN_SH7 §3-2: passes through a trailing provisional point and provisionalDate", () => {
    const payloadWithProvisional = {
      ...pricesPayload,
      provisionalDate: "2026-08-05T00:00:00Z",
      points: [
        ...pricesPayload.points,
        { date: "2026-08-05T00:00:00Z", prices: [9, 8, 7, 6], provisional: true },
      ],
    };
    const result = normalizePricesPayload(payloadWithProvisional, 1003720);
    expect(result.ok).toBe(true);
    expect(result.provisionalDate).toBe("2026-08-05T00:00:00Z");
    expect(result.points[0].provisional).toBe(false);
    expect(result.points[1]).toEqual({
      date: "2026-08-05T00:00:00Z",
      prices: [9, 8, 7, 6],
      provisional: true,
      closed: true,
    });
  });

  it("IMPL_PLAN_SH19 §1/§4 (P0 regression): passes through `closed: false` for the still-open bucket -- this is the exact field the previous version of this function silently dropped, which made every point look closed and emptied the chart's dashed/bridge series", () => {
    const payloadWithOpenBucket = {
      ...pricesPayload,
      points: [
        ...pricesPayload.points,
        { date: "2026-08-05T00:00:00Z", prices: [9, 8, 7, 6], provisional: true, closed: false, asOf: "2026-08-05T01:40:00Z" },
      ],
    };
    const result = normalizePricesPayload(payloadWithOpenBucket, 1003720);
    expect(result.points[0].closed).toBe(true); // confirmed point defaults to closed (server omits the field)
    expect(result.points[1].closed).toBe(false); // the still-open bucket, explicitly false
  });

  it("IMPL_PLAN_SH19 §1/§4: an elapsed-but-unaggregated point (`provisional: true`, `closed: true`) keeps `closed: true` -- distinct from the still-open bucket even though both are `provisional`", () => {
    const payloadWithElapsedUnsaved = {
      ...pricesPayload,
      points: [
        ...pricesPayload.points,
        { date: "2026-08-05T00:00:00Z", prices: [9, 8, 7, 6], provisional: true, closed: true },
      ],
    };
    const result = normalizePricesPayload(payloadWithElapsedUnsaved, 1003720);
    expect(result.points[1].provisional).toBe(true);
    expect(result.points[1].closed).toBe(true);
  });

  it("IMPL_PLAN_SH8 §2-2: passes through a provisional point's `asOf`, omitting the key when absent", () => {
    const payloadWithAsOf = {
      ...pricesPayload,
      points: [
        ...pricesPayload.points,
        { date: "2026-08-05T00:00:00Z", prices: [9, 8, 7, 6], provisional: true, asOf: "2026-08-05T01:40:00Z" },
      ],
    };
    const result = normalizePricesPayload(payloadWithAsOf, 1003720);
    expect(result.points[1].asOf).toBe("2026-08-05T01:40:00Z");
    expect(result.points[0]).not.toHaveProperty("asOf"); // confirmed point never had one to begin with
  });

  it("IMPL_PLAN_SH36 §3/§4: defaults formingBands to [] when the server omits it", () => {
    const result = normalizePricesPayload(pricesPayload, 1003720);
    expect(result.formingBands).toEqual([]);
  });

  it("IMPL_PLAN_SH36 §4: passes through well-formed formingBands entries", () => {
    const payloadWithFormingBands = {
      ...pricesPayload,
      formingBands: [
        { startStar: 1, endStar: 10 },
        { startStar: 20, endStar: 22 },
      ],
    };
    const result = normalizePricesPayload(payloadWithFormingBands, 1003720);
    expect(result.formingBands).toEqual([
      { startStar: 1, endStar: 10 },
      { startStar: 20, endStar: 22 },
    ]);
  });

  it("IMPL_PLAN_SH36 §4: drops a malformed formingBands entry rather than guessing", () => {
    const payloadWithMalformedFormingBands = {
      ...pricesPayload,
      formingBands: [{ startStar: 1, endStar: 10 }, { startStar: "x", endStar: 5 }, null],
    };
    const result = normalizePricesPayload(payloadWithMalformedFormingBands, 1003720);
    expect(result.formingBands).toEqual([{ startStar: 1, endStar: 10 }]);
  });
});

describe("normalizeLatestPayload", () => {
  it("passes through prices as-is (design §6.1: same units as the historical series)", () => {
    const result = normalizeLatestPayload(latestPayload, 1003720);
    expect(result.ok).toBe(true);
    expect(result.prices).toEqual([1, 2, null, 4]);
    expect(result.latestUpdatedAt).toBe("2026-08-04T18:20:00Z");
  });

  it("is invalidFormat for a mismatched itemId", () => {
    expect(normalizeLatestPayload(latestPayload, 1).ok).toBe(false);
  });

  // IMPL_PLAN_SH41 §1: `cubes`/`cubeOrder` are no longer intentionally
  // dropped (see contract.test.js) -- this pins the actual pass-through.
  it("IMPL_PLAN_SH41 §1: passes through cubes/cubeOrder", () => {
    const result = normalizeLatestPayload(latestPayload, 1003720);
    expect(result.cubes).toEqual([636809.13, 778760.18, 1048901.68, 1202408.98]);
    expect(result.cubeOrder).toEqual(["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"]);
  });

  it("IMPL_PLAN_SH41 §1: defaults cubes/cubeOrder to null when the server omits them", () => {
    const result = normalizeLatestPayload({ itemId: 1003720, prices: [1] }, 1003720);
    expect(result.cubes).toBeNull();
    expect(result.cubeOrder).toBeNull();
  });
});

describe("normalizeCubePricesPayload", () => {
  it("K1/K2: passes through raw cube prices as-is, converting non-finite entries to null (never a computed value)", () => {
    const result = normalizeCubePricesPayload(cubePricesPayload, 1003720);
    expect(result.ok).toBe(true);
    expect(result.points).toEqual([
      { date: "2026-03-25T00:00:00Z", cubes: [894882.28, 1638568.1, 2185268.35, null], provisional: false, closed: true },
    ]);
    expect(result.cubeOrder).toEqual(["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"]);
    expect(result.priceVersion).toBe("2026-08-22T00:00:00Z");
    expect(result.endDate).toBe("2026-08-21T20:00:00Z");
  });

  it("K2: a cube sub-type with no data at a point (e.g. White Bonus Cube before 2026-06-11) stays null, never 0/backfilled", () => {
    const result = normalizeCubePricesPayload(cubePricesPayload, 1003720);
    expect(result.points[0].cubes[3]).toBeNull();
  });

  it("is invalidFormat if the response itemId does not match the request", () => {
    expect(normalizeCubePricesPayload(cubePricesPayload, 1234).ok).toBe(false);
  });

  it("passes through a trailing provisional/open point the same way normalizePricesPayload does", () => {
    const payloadWithOpenBucket = {
      ...cubePricesPayload,
      points: [
        ...cubePricesPayload.points,
        {
          date: "2026-08-22T00:00:00Z",
          cubes: [636809.13, 778760.18, 1048901.68, 1202408.98],
          provisional: true,
          closed: false,
          asOf: "2026-08-22T00:05:00Z",
        },
      ],
    };
    const result = normalizeCubePricesPayload(payloadWithOpenBucket, 1003720);
    expect(result.points[1]).toEqual({
      date: "2026-08-22T00:00:00Z",
      cubes: [636809.13, 778760.18, 1048901.68, 1202408.98],
      provisional: true,
      closed: false,
      asOf: "2026-08-22T00:05:00Z",
    });
  });
});

describe("createSfHistorySource (design §10.2: simple requests only, no custom headers)", () => {
  it("loadEquipment calls the equipment endpoint with no extra headers/options beyond signal", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => equipmentPayload });
    const source = createSfHistorySource({ baseUrl: "https://api.example", fetchImpl });
    return source.loadEquipment().then((result) => {
      expect(result.ok).toBe(true);
      expect(fetchImpl.mock.calls[0][0]).toBe("https://api.example/sf-history/equipment");
      expect(Object.keys(fetchImpl.mock.calls[0][1] || {})).not.toContain("headers");
    });
  });

  it("loadPrices builds the itemId query string", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => pricesPayload });
    const source = createSfHistorySource({ baseUrl: "https://api.example", fetchImpl });
    return source.loadPrices(1003720).then((result) => {
      expect(result.ok).toBe(true);
      expect(fetchImpl.mock.calls[0][0]).toBe("https://api.example/sf-history/prices?itemId=1003720");
    });
  });

  it("loadLatest maps a 503 to upstreamUnavailable, never falling back to historical data (design §6)", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const source = createSfHistorySource({ baseUrl: "https://api.example", fetchImpl });
    return source.loadLatest(1003720).then((result) => {
      expect(result).toEqual({
        ok: false,
        code: "upstreamUnavailable",
        prices: null,
        latestUpdatedAt: null,
        cubes: null,
        cubeOrder: null,
      });
    });
  });

  it("loadPrices maps a 404 to notFound", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const source = createSfHistorySource({ baseUrl: "https://api.example", fetchImpl });
    return source.loadPrices(123).then((result) => {
      expect(result.code).toBe("notFound");
    });
  });

  it("loadCubePrices builds the itemId query string against the cube-prices route", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => cubePricesPayload });
    const source = createSfHistorySource({ baseUrl: "https://api.example", fetchImpl });
    return source.loadCubePrices(1003720).then((result) => {
      expect(result.ok).toBe(true);
      expect(fetchImpl.mock.calls[0][0]).toBe("https://api.example/sf-history/cube-prices?itemId=1003720");
      expect(Object.keys(fetchImpl.mock.calls[0][1] || {})).not.toContain("headers");
    });
  });

  it("loadCubePrices maps a 404 to notFound", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const source = createSfHistorySource({ baseUrl: "https://api.example", fetchImpl });
    return source.loadCubePrices(123).then((result) => {
      expect(result.code).toBe("notFound");
    });
  });

  it("a network error is soft-failed as networkError, not thrown", () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const source = createSfHistorySource({ baseUrl: "https://api.example", fetchImpl });
    return source.loadEquipment().then((result) => {
      expect(result).toEqual({ ok: false, code: "networkError", items: [] });
    });
  });
});
