import { describe, expect, it, vi } from "vitest";
import {
  createDiscoverySource,
  normalizeDiscoveryEquipmentPayload,
  normalizeDiscoveryPricesPayload,
  normalizeDiscoveryRecentPayload,
} from "./discoverySource.js";

const equipmentPayload = {
  items: [
    {
      itemId: 1004808,
      itemName: "Arcane Umbra Knight Hat",
      aliasItemIds: [1004808, 1004809],
      aliases: [
        { itemId: 1004808, itemName: "Arcane Umbra Knight Hat" },
        { itemId: 1004809, itemName: "Arcane Umbra Mage Hat" },
      ],
      stepsConsistent: true,
      lastScanAt: "2026-08-15T02:17:00Z",
      isActive: true,
    },
  ],
};

const pricesPayload = {
  itemId: 1053063,
  itemName: "Something Suit",
  upgradeCount: 25,
  observedAt: "2026-08-15T09:28:05Z",
  bands: [
    { itemUpgrade: 0, price: 1.0, step: "STEP_TYPE_DISCOVERY", priceAt: "2026-08-15T09:28:00Z", isDiscovery: true, windowStart: null, windowEnd: null },
    {
      itemUpgrade: 10,
      price: 2.0,
      step: "STEP_TYPE_CHANGE",
      priceAt: "2026-08-15T09:28:00Z",
      isDiscovery: false,
      windowStart: "2026-08-14T10:00:00Z",
      windowEnd: "2026-08-14T10:05:00Z",
    },
  ],
  cubes: [
    { cubeItemId: 2711000, cubeName: "Occult Cube", price: 0.000001, step: "STEP_TYPE_DISCOVERY", priceAt: "2026-08-16T15:18:00Z", isDiscovery: true, windowStart: null, windowEnd: null },
    { cubeItemId: 5062010, cubeName: "Black Cube", price: 570649.869736, step: "STEP_TYPE_CHANGE", priceAt: "2026-08-16T15:18:00Z", isDiscovery: false, windowStart: null, windowEnd: null },
  ],
};

const recentPayload = {
  days: 30,
  items: [
    { itemId: 1004808, itemName: "Arcane Umbra Knight Hat", itemUpgrade: 3, windowStart: "2026-08-01T00:00:00Z", windowEnd: "2026-08-01T00:05:00Z" },
  ],
};

// --- normalizeDiscoveryEquipmentPayload ---------------------------------------

describe("normalizeDiscoveryEquipmentPayload", () => {
  it("keeps every row with an integer itemId", () => {
    const result = normalizeDiscoveryEquipmentPayload(equipmentPayload);
    expect(result.ok).toBe(true);
    expect(result.items.map((i) => i.itemId)).toEqual([1004808]);
    expect(result.items[0].aliases).toHaveLength(2);
  });

  it("defaults aliases to a single self-named row when the field is missing/empty", () => {
    const result = normalizeDiscoveryEquipmentPayload({ items: [{ itemId: 42, itemName: "X" }] });
    expect(result.items[0].aliases).toEqual([{ itemId: 42, itemName: "X" }]);
    expect(result.items[0].aliasItemIds).toEqual([42]);
  });

  it("defaults stepsConsistent to true unless the server explicitly says false", () => {
    const result = normalizeDiscoveryEquipmentPayload({ items: [{ itemId: 1, itemName: "A" }] });
    expect(result.items[0].stepsConsistent).toBe(true);
    const inconsistent = normalizeDiscoveryEquipmentPayload({ items: [{ itemId: 1, itemName: "A", stepsConsistent: false }] });
    expect(inconsistent.items[0].stepsConsistent).toBe(false);
  });

  it("is invalidFormat for a non-object / missing items array", () => {
    expect(normalizeDiscoveryEquipmentPayload(null).ok).toBe(false);
    expect(normalizeDiscoveryEquipmentPayload({}).ok).toBe(false);
  });

  // IMPL_PLAN_SH33 follow-up (post-review, (m)): isActive -- a group kept
  // listed past deactivation for the 30-day retention window.
  it("keeps isActive: false when the server says so", () => {
    const result = normalizeDiscoveryEquipmentPayload({ items: [{ itemId: 1, itemName: "A", isActive: false }] });
    expect(result.items[0].isActive).toBe(false);
  });

  it("defaults isActive to true unless the server explicitly says false", () => {
    const result = normalizeDiscoveryEquipmentPayload({ items: [{ itemId: 1, itemName: "A" }] });
    expect(result.items[0].isActive).toBe(true);
  });
});

// --- normalizeDiscoveryPricesPayload ------------------------------------------

describe("normalizeDiscoveryPricesPayload", () => {
  it("keeps every band and the isDiscovery badge", () => {
    const result = normalizeDiscoveryPricesPayload(pricesPayload, 1053063);
    expect(result.ok).toBe(true);
    expect(result.bands).toHaveLength(2);
    expect(result.bands[0].isDiscovery).toBe(true);
    expect(result.bands[1].isDiscovery).toBe(false);
    expect(result.observedAt).toBe("2026-08-15T09:28:05Z");
  });

  it("is invalidFormat when itemId does not match the request", () => {
    const result = normalizeDiscoveryPricesPayload(pricesPayload, 999);
    expect(result.ok).toBe(false);
  });

  it("observedAt/price/step/priceAt are null, never invented, when a band was never polled", () => {
    const result = normalizeDiscoveryPricesPayload(
      { itemId: 1, itemName: "X", upgradeCount: 1, observedAt: null, bands: [{ itemUpgrade: 0, price: null, step: null, priceAt: null, isDiscovery: false, windowStart: null, windowEnd: null }] },
      1,
    );
    expect(result.observedAt).toBeNull();
    expect(result.bands[0].price).toBeNull();
    expect(result.bands[0].step).toBeNull();
    expect(result.bands[0].windowStart).toBeNull();
    expect(result.bands[0].windowEnd).toBeNull();
  });

  // IMPL_PLAN_SH33 follow-up (post-review): windowStart/windowEnd -- this
  // band's own observed DISCOVERY -> CHANGE flip.
  it("keeps windowStart/windowEnd when the server reports an observed transition", () => {
    const result = normalizeDiscoveryPricesPayload(pricesPayload, 1053063);
    expect(result.bands[0].windowStart).toBeNull(); // still DISCOVERY -- never observed
    expect(result.bands[1].windowStart).toBe("2026-08-14T10:00:00Z");
    expect(result.bands[1].windowEnd).toBe("2026-08-14T10:05:00Z");
  });

  // IMPL_PLAN_SH34 §3/§4: cubes -- a separate list, not a fixed-length one.
  it("keeps every cube with its resolved name and isDiscovery badge", () => {
    const result = normalizeDiscoveryPricesPayload(pricesPayload, 1053063);
    expect(result.cubes).toHaveLength(2);
    expect(result.cubes[0]).toEqual({
      cubeItemId: 2711000,
      cubeName: "Occult Cube",
      price: 0.000001,
      step: "STEP_TYPE_DISCOVERY",
      priceAt: "2026-08-16T15:18:00Z",
      isDiscovery: true,
      windowStart: null,
      windowEnd: null,
    });
    expect(result.cubes[1].isDiscovery).toBe(false);
  });

  it("normalizes to an empty cubes array when the server omits it or the item has none recorded", () => {
    const result = normalizeDiscoveryPricesPayload({ ...pricesPayload, cubes: [] }, 1053063);
    expect(result.cubes).toEqual([]);
    const withoutField = normalizeDiscoveryPricesPayload(
      { itemId: 1053063, itemName: "X", upgradeCount: 0, observedAt: null, bands: [] },
      1053063,
    );
    expect(withoutField.cubes).toEqual([]);
  });

  it("(d): an unresolved cube name falls back to the code itself as a string", () => {
    const result = normalizeDiscoveryPricesPayload(
      {
        itemId: 1053063,
        itemName: "X",
        upgradeCount: 0,
        observedAt: null,
        bands: [],
        cubes: [{ cubeItemId: 9999999, cubeName: "9999999", price: 1.0, step: "STEP_TYPE_DISCOVERY", priceAt: "x", isDiscovery: true, windowStart: null, windowEnd: null }],
      },
      1053063,
    );
    expect(result.cubes[0].cubeName).toBe("9999999");
  });
});

// --- normalizeDiscoveryRecentPayload ------------------------------------------

describe("normalizeDiscoveryRecentPayload", () => {
  it("keeps every transition row with itemName/windowStart/windowEnd", () => {
    const result = normalizeDiscoveryRecentPayload(recentPayload);
    expect(result.ok).toBe(true);
    expect(result.days).toBe(30);
    expect(result.items[0]).toEqual(recentPayload.items[0]);
  });

  it("is invalidFormat for a missing items array", () => {
    expect(normalizeDiscoveryRecentPayload({}).ok).toBe(false);
  });
});

// --- createDiscoverySource: URL shape / error mapping -------------------------

describe("createDiscoverySource", () => {
  it("loadEquipment hits /sf-history/discovery/equipment", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => equipmentPayload });
    const source = createDiscoverySource({ baseUrl: "https://x", fetchImpl });
    const result = await source.loadEquipment();
    expect(fetchImpl).toHaveBeenCalledWith("https://x/sf-history/discovery/equipment", { signal: undefined });
    expect(result.ok).toBe(true);
  });

  it("loadPrices hits /sf-history/discovery/prices?itemId= and maps 404 -> notFound", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const source = createDiscoverySource({ baseUrl: "https://x", fetchImpl });
    const result = await source.loadPrices(1053063);
    expect(fetchImpl).toHaveBeenCalledWith("https://x/sf-history/discovery/prices?itemId=1053063", { signal: undefined });
    expect(result).toEqual({ ok: false, code: "notFound", itemName: null, upgradeCount: 0, observedAt: null, bands: [], cubes: [] });
  });

  it("loadRecent omits ?days= when not an integer, includes it otherwise", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => recentPayload });
    const source = createDiscoverySource({ baseUrl: "https://x", fetchImpl });
    await source.loadRecent({});
    expect(fetchImpl).toHaveBeenCalledWith("https://x/sf-history/discovery/recent", { signal: undefined });
    await source.loadRecent({ days: 7 });
    expect(fetchImpl).toHaveBeenCalledWith("https://x/sf-history/discovery/recent?days=7", { signal: undefined });
  });

  it("maps a network throw to networkError (and AbortError to aborted)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const source = createDiscoverySource({ baseUrl: "https://x", fetchImpl });
    expect((await source.loadEquipment()).code).toBe("networkError");

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchImplAbort = vi.fn().mockRejectedValue(abortError);
    const abortSource = createDiscoverySource({ baseUrl: "https://x", fetchImpl: fetchImplAbort });
    expect((await abortSource.loadPrices(1)).code).toBe("aborted");
  });
});
