import { describe, expect, it } from "vitest";
import { flattenDiscoveryCandidates, matchesDiscoveryQuery } from "./search.js";

const items = [
  {
    itemId: 1004808,
    itemName: "Arcane Umbra Knight Hat",
    aliases: [
      { itemId: 1004808, itemName: "Arcane Umbra Knight Hat" },
      { itemId: 1004809, itemName: "Arcane Umbra Mage Hat" },
    ],
  },
];

describe("flattenDiscoveryCandidates", () => {
  it("(g-1): every alias itemId is its own searchable row, all pointing at the representative", () => {
    const rows = flattenDiscoveryCandidates(items);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.representativeItemId === 1004808)).toBe(true);
    expect(rows.map((r) => r.itemId).sort()).toEqual([1004808, 1004809]);
  });

  it("falls back to a single self-named row when aliases is missing/empty", () => {
    const rows = flattenDiscoveryCandidates([{ itemId: 1, itemName: "X" }]);
    expect(rows).toEqual([{ key: "1-1", representativeItemId: 1, representativeItemName: "X", itemId: 1, itemName: "X" }]);
  });
});

describe("matchesDiscoveryQuery", () => {
  it("(g-1): matches an alias's own name, not just the representative's", () => {
    const rows = flattenDiscoveryCandidates(items);
    const mageHatRow = rows.find((r) => r.itemId === 1004809);
    expect(matchesDiscoveryQuery(mageHatRow, "Arcane Umbra Mage Hat")).toBe(true);
    expect(matchesDiscoveryQuery(mageHatRow, "mage")).toBe(true);
  });

  it("matches by itemId too", () => {
    const rows = flattenDiscoveryCandidates(items);
    expect(matchesDiscoveryQuery(rows[0], "1004809")).toBe(rows[0].itemId === 1004809);
  });

  it("empty query matches everything", () => {
    const rows = flattenDiscoveryCandidates(items);
    expect(rows.every((r) => matchesDiscoveryQuery(r, ""))).toBe(true);
  });
});
