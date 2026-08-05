import { describe, expect, it } from "vitest";
import { flattenCandidates, matchesEquipmentQuery } from "./equipmentSearch.js";

// IMPL_PLAN_SH9 §3-3/(c): the exact shape /sf-history/equipment sends after
// gen_item_list.py resolves alias names -- one representative group
// (AbsoLab Mage Gloves) whose non-representative members include AbsoLab
// Knight Gloves, the real "search by a non-representative name" example
// used in this slice's completion report (there is no "AbsoLab Warrior
// Gloves" in the actual catalog -- this game's AbsoLab job-line naming is
// Knight/Mage/Archer/Bandit/Pirate, not "Warrior").
const ITEMS = [
  {
    itemId: 1082637,
    itemName: "AbsoLab Mage Gloves",
    aliasItemIds: [1082636, 1082637, 1082638, 1082639, 1082640],
    maxStar: 22,
    aliases: [
      { itemId: 1082636, itemName: "AbsoLab Knight Gloves" },
      { itemId: 1082637, itemName: "AbsoLab Mage Gloves" },
      { itemId: 1082638, itemName: "AbsoLab Archer Gloves" },
      { itemId: 1082639, itemName: "AbsoLab Bandit Gloves" },
      { itemId: 1082640, itemName: "AbsoLab Pirate Gloves" },
    ],
  },
  {
    itemId: 1022232,
    itemName: "Black Bean Mark",
    aliasItemIds: [1022232],
    maxStar: 20,
    // no `aliases` at all -- exercises the pre-SH9-shape fallback path.
    aliases: [],
  },
];

describe("flattenCandidates (IMPL_PLAN_SH9 §3-3)", () => {
  it("produces one row per alias, each tagged with its group's representative", () => {
    const rows = flattenCandidates(ITEMS);
    expect(rows).toHaveLength(6); // 5 AbsoLab Gloves aliases + 1 Black Bean Mark self-row
    const knightGloves = rows.find((r) => r.itemName === "AbsoLab Knight Gloves");
    expect(knightGloves).toEqual({
      key: "1082637-1082636",
      representativeItemId: 1082637,
      representativeItemName: "AbsoLab Mage Gloves",
      itemId: 1082636,
      itemName: "AbsoLab Knight Gloves",
      maxStar: 22,
    });
  });

  it("falls back to a single self-named row when `aliases` is empty", () => {
    const rows = flattenCandidates(ITEMS);
    const blackBean = rows.filter((r) => r.representativeItemId === 1022232);
    expect(blackBean).toEqual([
      {
        key: "1022232-1022232",
        representativeItemId: 1022232,
        representativeItemName: "Black Bean Mark",
        itemId: 1022232,
        itemName: "Black Bean Mark",
        maxStar: 20,
      },
    ]);
  });
});

describe("matchesEquipmentQuery + flattenCandidates together (design §7: search all, resolve to representative)", () => {
  it("finds a non-representative item by its own name (the plan's (c) example)", () => {
    const rows = flattenCandidates(ITEMS).filter((row) => matchesEquipmentQuery(row, "AbsoLab Knight Gloves"));
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe(1082636);
    // The representative that `prices`/`latest` must be called with -- never
    // the searched item's own id (design §7: "取得・表示は代表").
    expect(rows[0].representativeItemId).toBe(1082637);
    expect(rows[0].representativeItemName).toBe("AbsoLab Mage Gloves");
  });

  it("also finds it by its own itemId", () => {
    const rows = flattenCandidates(ITEMS).filter((row) => matchesEquipmentQuery(row, "1082636"));
    expect(rows.map((r) => r.itemId)).toEqual([1082636]);
  });

  it("is case-insensitive and matches on a partial name", () => {
    const rows = flattenCandidates(ITEMS).filter((row) => matchesEquipmentQuery(row, "knight glo"));
    expect(rows.map((r) => r.itemId)).toEqual([1082636]);
  });

  it("an empty query matches everything", () => {
    const all = flattenCandidates(ITEMS);
    expect(all.filter((row) => matchesEquipmentQuery(row, ""))).toHaveLength(all.length);
  });
});
