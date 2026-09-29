import { describe, expect, it } from "vitest";
import { loadRaffleSalePrices, saveRaffleSalePrice } from "./salePriceCache.js";

function backend() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

describe("sale price cache", () => {
  it("restores prices for the same round and party until the next Thursday reset", () => {
    const storage = backend();
    const round = "2026-09-24T00:00:00Z";
    saveRaffleSalePrice(round, ["CHARb", "CHARa"], "drop-1", "123456", { backend: storage, now: Date.parse(round) + 1000 });
    expect(loadRaffleSalePrices(round, ["CHARa", "CHARb"], { backend: storage, now: Date.parse("2026-10-01T00:00:00Z") - 1 })).toEqual({ "drop-1": "123456" });
  });

  it("expires at the reset and removes a price when the input is cleared", () => {
    const storage = backend();
    const round = "2026-09-24T00:00:00Z";
    const savedAt = Date.parse(round) + 1000;
    saveRaffleSalePrice(round, ["CHARa"], "drop-1", "10", { backend: storage, now: savedAt });
    saveRaffleSalePrice(round, ["CHARa"], "drop-1", "", { backend: storage, now: savedAt + 1 });
    expect(loadRaffleSalePrices(round, ["CHARa"], { backend: storage, now: savedAt + 2 })).toEqual({});
    saveRaffleSalePrice(round, ["CHARa"], "drop-1", "10", { backend: storage, now: savedAt + 3 });
    expect(loadRaffleSalePrices(round, ["CHARa"], { backend: storage, now: Date.parse("2026-10-01T00:00:00Z") })).toEqual({});
  });
});
