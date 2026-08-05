import { describe, expect, it, vi } from "vitest";
import {
  createSfHistorySource,
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
    expect(result.points).toEqual([{ date: "2026-03-08T00:00:00Z", prices: [1, 2, null, 4], provisional: false }]);
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
    });
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
      expect(result).toEqual({ ok: false, code: "upstreamUnavailable", prices: null, latestUpdatedAt: null });
    });
  });

  it("loadPrices maps a 404 to notFound", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const source = createSfHistorySource({ baseUrl: "https://api.example", fetchImpl });
    return source.loadPrices(123).then((result) => {
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
