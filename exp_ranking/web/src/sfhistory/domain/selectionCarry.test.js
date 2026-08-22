import { describe, expect, it } from "vitest";
import { guessPrefetchItemId, resolveCarriedSelection } from "./selectionCarry.js";

const ITEMS = [
  { itemId: 1382265, itemName: "Arcane Umbra Staff", maxStar: 22 },
  { itemId: 555, itemName: "Some Gloves", maxStar: 17 },
];

describe("resolveCarriedSelection (IMPL_PLAN_SH42 §2 B)", () => {
  it("returns null when nothing was carried (fresh page load, e.g. #/starforce opened directly -- plan (f))", () => {
    expect(resolveCarriedSelection(ITEMS, null)).toBeNull();
  });

  it("returns null for a malformed carried value (no itemId)", () => {
    expect(resolveCarriedSelection(ITEMS, {})).toBeNull();
    expect(resolveCarriedSelection(ITEMS, { itemId: "not-a-number" })).toBeNull();
  });

  it("returns null when the carried item is not present in this page's own items (plan (e): New Equipment's 3-item fallback)", () => {
    expect(resolveCarriedSelection(ITEMS, { itemId: 999999, alias: { itemId: 999999, itemName: "Ghost" } })).toBeNull();
  });

  it("resolves to the matching item + its carried alias when present", () => {
    const carried = { itemId: 555, alias: { itemId: 555, itemName: "Some Gloves (alias)" } };
    expect(resolveCarriedSelection(ITEMS, carried)).toEqual({
      itemId: 555,
      alias: { itemId: 555, itemName: "Some Gloves (alias)" },
    });
  });

  it("falls back to the matched item's own id/name as the alias when carried.alias is malformed", () => {
    const carried = { itemId: 1382265, alias: null };
    expect(resolveCarriedSelection(ITEMS, carried)).toEqual({
      itemId: 1382265,
      alias: { itemId: 1382265, itemName: "Arcane Umbra Staff" },
    });
  });
});

describe("guessPrefetchItemId (IMPL_PLAN_SH46 §3 B)", () => {
  it("guesses the carried itemId when present (no items list needed/available yet)", () => {
    expect(guessPrefetchItemId({ itemId: 555, alias: { itemId: 555, itemName: "Some Gloves" } }, 1382265)).toBe(555);
  });

  it("falls back to defaultItemId when nothing was carried (fresh page load)", () => {
    expect(guessPrefetchItemId(null, 1382265)).toBe(1382265);
  });

  it("falls back to defaultItemId for a malformed carried value (no itemId)", () => {
    expect(guessPrefetchItemId({}, 1382265)).toBe(1382265);
    expect(guessPrefetchItemId({ itemId: "not-a-number" }, 1382265)).toBe(1382265);
  });
});
