import { describe, expect, it } from "vitest";
import { combineSelectedPartyClears, formatPartyClearTitle, groupPartyClearCandidates, isPartyClearCandidate, requiresDistributionConfirmation, selectPartyClearCandidates } from "./partyClears.js";
import { calculateSettlement } from "./settlement.js";

function clear(overrides = {}) {
  return {
    clearId: "clear-lucid-hard",
    boss: "LUCID",
    bossDifficulty: "HARD",
    ascendantTier: "Divine Ascendant",
    complete: true,
    partyCount: 2,
    historyMemberIds: ["member-1"],
    members: [{ memberId: "member-1" }, { memberId: "member-2" }],
    ...overrides,
  };
}

describe("formatPartyClearTitle", () => {
  it.each([
    ["LUCID", "EASY", "Dawning Ascendant 2", "Easy Lucid + Dawning Ascendant 2"],
    ["LUCID", "NORMAL", "Mystic Ascendant", "Normal Lucid + Mystic Ascendant"],
    ["LUCID", "HARD", "Divine Ascendant", "Hard Lucid + Divine Ascendant"],
    ["WILL", "EASY", "Luminous Ascendant", "Easy Will + Luminous Ascendant"],
    ["WILL", "NORMAL", "Glorious Ascendant", "Normal Will + Glorious Ascendant"],
    ["WILL", "HARD", "Eternal Ascendant", "Hard Will + Eternal Ascendant"],
  ])("combines %s %s with its Ascendant tier", (boss, bossDifficulty, ascendantTier, expected) => {
    expect(formatPartyClearTitle({ boss, bossDifficulty, ascendantTier })).toBe(expected);
  });
});

describe("Party Clear candidates", () => {
  it("keeps the full saved roster when only a subset has matching history", () => {
    const memberIds = ["member-1", "member-2"];
    expect(isPartyClearCandidate(clear(), memberIds)).toBe(true);
    expect(selectPartyClearCandidates([clear()], memberIds)).toHaveLength(1);
  });

  it.each([
    [6, 4, 6],
    [6, 5, 5],
    [4, 3, 5],
    [2, 1, 1],
    [1, 1, 2],
  ])("accepts independent clear=%i history=%i distribution=%i counts", (partyCount, historyCount, distributionCount) => {
    const memberIds = Array.from({ length: distributionCount }, (_, index) => `member-${index + 1}`);
    const candidate = clear({
      partyCount,
      historyMemberIds: memberIds.slice(0, historyCount),
      members: memberIds.map((memberId) => ({ memberId })),
    });
    expect(isPartyClearCandidate(candidate, memberIds)).toBe(true);
    expect(requiresDistributionConfirmation(candidate)).toBe(partyCount !== distributionCount || historyCount !== distributionCount);
  });

  it("rejects an invalid roster, count, history subset, and unsupported boss", () => {
    const memberIds = ["member-1", "member-2"];
    expect(isPartyClearCandidate(clear({ members: [{ memberId: "member-1" }] }), memberIds)).toBe(false);
    expect(isPartyClearCandidate(clear({ partyCount: 7 }), memberIds)).toBe(false);
    expect(isPartyClearCandidate(clear({ partyCount: 1, historyMemberIds: ["member-1", "member-2"] }), memberIds)).toBe(false);
    expect(isPartyClearCandidate(clear({ historyMemberIds: [] }), memberIds)).toBe(false);
    expect(isPartyClearCandidate(clear({ historyMemberIds: ["member-3"] }), memberIds)).toBe(false);
    expect(isPartyClearCandidate(clear({ boss: "LOTUS" }), memberIds)).toBe(false);
  });

  it("combines every selected difficulty before settlement", () => {
    const hard = clear({
      clearId: "clear-will-hard",
      boss: "WILL",
      bossDifficulty: "HARD",
      ascendantTier: "Eternal Ascendant",
      partyCount: 2,
      historyMemberIds: ["member-1"],
      members: [
        { memberId: "member-1", bossNeso: "100", powerCrystalAmount: "50", ascendantNeso: "20", drops: [{ dropId: "hard-coin", category: "COIN", name: "Arachno Coin", quantity: "1" }] },
        { memberId: "member-2", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      ],
    });
    const normal = clear({
      clearId: "clear-will-normal",
      boss: "WILL",
      bossDifficulty: "NORMAL",
      ascendantTier: "Glorious Ascendant",
      partyCount: 2,
      historyMemberIds: ["member-2"],
      members: [
        { memberId: "member-1", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
        { memberId: "member-2", bossNeso: "200", powerCrystalAmount: "60", ascendantNeso: "30", drops: [{ dropId: "normal-gear", category: "EQUIPMENT", name: "Gear", quantity: "1" }] },
      ],
    });

    const combined = combineSelectedPartyClears([hard, normal], ["member-1", "member-2"]);

    expect(combined.historyMemberIds).toEqual(["member-1", "member-2"]);
    const settlement = calculateSettlement({
      ...combined,
      partyOrder: ["member-1", "member-2"],
      include: { coin: false, equipment: false, bossNeso: true, powerCrystal: true, ascendantNeso: true },
      powerCrystalNesoRate: "1",
      saleNesoByDropId: {},
    });
    expect(settlement.ok).toBe(true);
    expect(settlement.total).toBe("460");
    expect(combined.members).toEqual([
      { memberId: "member-1", bossNeso: "100", powerCrystalAmount: "50", ascendantNeso: "20", drops: hard.members[0].drops },
      { memberId: "member-2", bossNeso: "200", powerCrystalAmount: "60", ascendantNeso: "30", drops: normal.members[1].drops },
    ]);
  });
  it("groups mixed difficulties under the same boss for explicit selection", () => {
    const hard = clear({ clearId: "clear-will-hard", boss: "WILL", bossDifficulty: "HARD", ascendantTier: "Eternal Ascendant" });
    const normal = clear({ clearId: "clear-will-normal", boss: "WILL", bossDifficulty: "NORMAL", ascendantTier: "Glorious Ascendant", historyMemberIds: ["member-2"] });
    expect(groupPartyClearCandidates([hard, normal])).toEqual([{ boss: "WILL", clears: [hard, normal] }]);
  });
});