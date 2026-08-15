import { describe, expect, it } from "vitest";
import { deriveAliasLabel, flattenDiscoveryCandidates, groupDiscoveryCandidates, matchesDiscoveryQuery } from "./search.js";

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

// IMPL_PLAN_SH33 §4 (B): the real 3-group / 15-alias shape the local API
// returns (docs/IMPL_PLAN_SH33.md's own §4 example names -- "Knight / Mage /
// Archer / Thief / Pirate"), used by the groupDiscoveryCandidates suite
// below to exercise (i)/(j)/(k) against something matching production data,
// not just a 1-group fixture.
const threeGroups = [
  {
    itemId: 1004811,
    itemName: "Arcane Umbra Thief Hat",
    aliases: [
      { itemId: 1004808, itemName: "Arcane Umbra Knight Hat" },
      { itemId: 1004809, itemName: "Arcane Umbra Mage Hat" },
      { itemId: 1004810, itemName: "Arcane Umbra Archer Hat" },
      { itemId: 1004811, itemName: "Arcane Umbra Thief Hat" },
      { itemId: 1004812, itemName: "Arcane Umbra Pirate Hat" },
    ],
  },
  {
    itemId: 1053064,
    itemName: "Arcane Umbra Mage Suit",
    aliases: [
      { itemId: 1053063, itemName: "Arcane Umbra Knight Suit" },
      { itemId: 1053064, itemName: "Arcane Umbra Mage Suit" },
      { itemId: 1053065, itemName: "Arcane Umbra Archer Suit" },
      { itemId: 1053066, itemName: "Arcane Umbra Thief Suit" },
      { itemId: 1053067, itemName: "Arcane Umbra Pirate Suit" },
    ],
  },
  {
    itemId: 1152199,
    itemName: "Arcane Umbra Thief Shoulder",
    aliases: [
      { itemId: 1152196, itemName: "Arcane Umbra Knight Shoulder" },
      { itemId: 1152197, itemName: "Arcane Umbra Mage Shoulder" },
      { itemId: 1152198, itemName: "Arcane Umbra Archer Shoulder" },
      { itemId: 1152199, itemName: "Arcane Umbra Thief Shoulder" },
      { itemId: 1152200, itemName: "Arcane Umbra Pirate Shoulder" },
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

describe("deriveAliasLabel", () => {
  it("plan §4 example: strips the shared 'Arcane Umbra ... Hat' prefix/suffix down to the job word", () => {
    const names = [
      "Arcane Umbra Knight Hat",
      "Arcane Umbra Mage Hat",
      "Arcane Umbra Archer Hat",
      "Arcane Umbra Thief Hat",
      "Arcane Umbra Pirate Hat",
    ];
    expect(deriveAliasLabel("Arcane Umbra Knight Hat", names)).toBe("Knight");
    expect(deriveAliasLabel("Arcane Umbra Mage Hat", names)).toBe("Mage");
    expect(deriveAliasLabel("Arcane Umbra Archer Hat", names)).toBe("Archer");
    expect(deriveAliasLabel("Arcane Umbra Thief Hat", names)).toBe("Thief");
    expect(deriveAliasLabel("Arcane Umbra Pirate Hat", names)).toBe("Pirate");
  });

  it("falls back to the full name for a lone item (no siblings to diff against)", () => {
    expect(deriveAliasLabel("Solo Item", ["Solo Item"])).toBe("Solo Item");
  });

  it("falls back to the full name when there is no common prefix+suffix structure", () => {
    expect(deriveAliasLabel("Totally Different Name", ["Totally Different Name", "Nothing Alike Here"])).toBe(
      "Totally Different Name",
    );
  });
});

describe("groupDiscoveryCandidates", () => {
  it("(i): an empty query returns exactly one row per monitored group (3), not one per alias (15)", () => {
    const groups = groupDiscoveryCandidates(threeGroups, "");
    expect(groups).toHaveLength(3);
    expect(groups.flatMap((g) => g.aliases)).toHaveLength(15);
  });

  it("(j): searching a non-representative alias's full name still surfaces exactly ONE group (its own)", () => {
    const groups = groupDiscoveryCandidates(threeGroups, "Arcane Umbra Mage Hat");
    expect(groups).toHaveLength(1);
    expect(groups[0].representativeItemId).toBe(1004811); // the Hat group's representative (Thief Hat)
    const matched = groups[0].aliases.filter((a) => a.matched);
    expect(matched.map((a) => a.itemName)).toEqual(["Arcane Umbra Mage Hat"]);
  });

  it("(j): a bare job-word query ('mage') still surfaces every group that has a Mage alias", () => {
    const groups = groupDiscoveryCandidates(threeGroups, "mage");
    expect(groups).toHaveLength(3); // all 3 monitored groups have a Mage alias
  });

  it("(k): itemId search resolves to the owning group, for every one of the 15 alias itemIds", () => {
    const allAliasIds = threeGroups.flatMap((item) => item.aliases.map((a) => a.itemId));
    expect(allAliasIds).toHaveLength(15);
    for (const itemId of allAliasIds) {
      const groups = groupDiscoveryCandidates(threeGroups, String(itemId));
      expect(groups).toHaveLength(1);
      expect(groups[0].aliases.some((a) => a.itemId === itemId && a.matched)).toBe(true);
    }
  });

  it("every group still carries all 5 job-variant aliases, even when only one matched", () => {
    const groups = groupDiscoveryCandidates(threeGroups, "Thief Hat");
    expect(groups).toHaveLength(1);
    expect(groups[0].aliases).toHaveLength(5);
    expect(groups[0].aliases.map((a) => a.label)).toEqual(["Knight", "Mage", "Archer", "Thief", "Pirate"]);
  });

  it("a query matching nothing returns no groups", () => {
    expect(groupDiscoveryCandidates(threeGroups, "nonexistent-item-xyz")).toEqual([]);
  });

  it("groups are sorted by representative name", () => {
    const groups = groupDiscoveryCandidates(threeGroups, "");
    expect(groups.map((g) => g.representativeItemName)).toEqual([
      "Arcane Umbra Mage Suit",
      "Arcane Umbra Thief Hat",
      "Arcane Umbra Thief Shoulder",
    ]);
  });
});
