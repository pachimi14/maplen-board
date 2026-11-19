import { describe, expect, it } from "vitest";
import { BOX_CATEGORY, RING_BOX_NAME_SUFFIX, isRingBoxDrop, reclassifyBoxDrops } from "./boxDrops.js";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sampleClear() {
  return {
    clearId: "combined-c1",
    boss: "WILL",
    complete: true,
    historyMemberIds: ["a", "b"],
    sourceClears: [{ clearId: "c1", boss: "WILL" }],
    excludedRewards: [],
    members: [
      {
        memberId: "a",
        bossNeso: "100",
        powerCrystalAmount: "0",
        ascendantNeso: "0",
        drops: [
          { dropId: "box1", category: "EQUIPMENT", name: "Rank 3 Special Skill Ring Box", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/2028394.png" },
          { dropId: "gear1", category: "EQUIPMENT", name: "Arcane Umbra Archer Gloves", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/1082699.png" },
          { dropId: "coin1", category: "COIN", name: "Arachno Coin", quantity: "10" },
        ],
      },
      {
        memberId: "b",
        bossNeso: "0",
        powerCrystalAmount: "0",
        ascendantNeso: "0",
        drops: [
          { dropId: "lower1", category: "EQUIPMENT", name: "Rank 3 Special Skill ring box", quantity: "1" },
          { dropId: "ft1", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" },
          { dropId: "box2", category: "EQUIPMENT", name: "  Rank 5 Special Skill Ring Box  ", quantity: "2" },
        ],
      },
    ],
  };
}

describe("isRingBoxDrop", () => {
  it("uses the server's case-sensitive \"Ring Box\" suffix on EQUIPMENT drops only", () => {
    expect(RING_BOX_NAME_SUFFIX).toBe("Ring Box");
    expect(isRingBoxDrop({ category: "EQUIPMENT", name: "Rank 3 Special Skill Ring Box" })).toBe(true);
    expect(isRingBoxDrop({ category: "EQUIPMENT", name: "Arcane Umbra Archer Gloves" })).toBe(false);
    expect(isRingBoxDrop({ category: "EQUIPMENT", name: "Rank 3 Special Skill ring box" })).toBe(false);
    expect(isRingBoxDrop({ category: "EQUIPMENT", name: "Ring Box Fragment" })).toBe(false);
    expect(isRingBoxDrop({ category: "FT_ITEM", name: "Rank 3 Special Skill Ring Box" })).toBe(false);
    expect(isRingBoxDrop({ category: "EQUIPMENT" })).toBe(false);
    expect(isRingBoxDrop(null)).toBe(false);
  });
});

describe("reclassifyBoxDrops", () => {
  it("re-tags only Ring Box EQUIPMENT drops as BOX and keeps every other field", () => {
    const result = reclassifyBoxDrops(sampleClear());
    const drops = Object.fromEntries(result.members.flatMap((member) => member.drops.map((drop) => [drop.dropId, drop])));
    expect(drops.box1).toEqual({ dropId: "box1", category: BOX_CATEGORY, name: "Rank 3 Special Skill Ring Box", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/2028394.png" });
    expect(drops.box2).toEqual({ dropId: "box2", category: "BOX", name: "  Rank 5 Special Skill Ring Box  ", quantity: "2" });
    expect(drops.gear1.category).toBe("EQUIPMENT");
    expect(drops.lower1.category).toBe("EQUIPMENT");
    expect(drops.coin1.category).toBe("COIN");
    expect(drops.ft1.category).toBe("FT_ITEM");
    const expected = sampleClear();
    expect({ ...result, members: undefined }).toEqual({ ...expected, members: undefined });
    expect(result.members.map(({ drops: _drops, ...rest }) => rest)).toEqual(expected.members.map(({ drops: _drops, ...rest }) => rest));
  });

  it("never mutates the input clear (deep-frozen input)", () => {
    const input = deepFreeze(sampleClear());
    const snapshot = JSON.stringify(input);
    const result = reclassifyBoxDrops(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result).not.toBe(input);
    expect(input.members[0].drops[0].category).toBe("EQUIPMENT");
    expect(result.members[0].drops[0].category).toBe("BOX");
  });

  it("returns null/empty input as-is", () => {
    expect(reclassifyBoxDrops(null)).toBeNull();
    expect(reclassifyBoxDrops(undefined)).toBeUndefined();
  });
});
