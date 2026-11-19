import { describe, expect, it } from "vitest";
import { calculateSaleProceedsNeso, calculateSettlement, parseDecimalRate } from "./settlement.js";
import { sortPartyMembers } from "./partyOrder.js";

function clearInput(overrides = {}) {
  return {
    boss: "LUCID",
    complete: true,
    historyMemberIds: ["a"],
    partyOrder: ["a", "b"],
    include: { coin: true, equipment: true, bossNeso: true, powerCrystal: true, ascendantNeso: true },
    powerCrystalNesoRate: "1",
    saleNesoByDropId: { coin1: "100", equip1: "300" },
    members: [
      { memberId: "a", bossNeso: "600", powerCrystalAmount: "100", ascendantNeso: "50", drops: [{ dropId: "coin1", category: "COIN", name: "Coin", quantity: "10" }] },
      { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [{ dropId: "equip1", category: "EQUIPMENT", name: "Gear", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/1000001.png" }] },
    ],
    ...overrides,
  };
}

describe("parseDecimalRate", () => {
  it("parses exact finite decimal rates", () => {
    expect(parseDecimalRate("0.8")).toEqual({ ok: true, numerator: 8n, denominator: 10n });
    expect(parseDecimalRate("1.25")).toEqual({ ok: true, numerator: 125n, denominator: 100n });
  });
});

describe("calculateSaleProceedsNeso", () => {
  it("deducts the 5% sale fee using exact integer arithmetic", () => {
    expect(calculateSaleProceedsNeso("9500000")).toBe("9025000");
    expect(calculateSaleProceedsNeso("101")).toBe("95");
  });

  // G1 (LULU-119 follow-up, user ruling): a blank/whitespace-only sale price
  // preview computes as 0 proceeds (not "unknown/null") -- it matches what
  // calculateSettlement itself now does for an unfilled saleNesoByDropId
  // entry, so the on-screen preview never disagrees with the real calculation.
  it("treats a blank/whitespace-only value as 0 proceeds (matches calculateSettlement's unfilled-sale-price rule)", () => {
    expect(calculateSaleProceedsNeso("")).toBe("0");
    expect(calculateSaleProceedsNeso("   ")).toBe("0");
    expect(calculateSaleProceedsNeso(undefined)).toBe("0");
    expect(calculateSaleProceedsNeso(null)).toBe("0");
  });

  it("still rejects genuinely malformed (non-blank) values", () => {
    expect(calculateSaleProceedsNeso("abc")).toBeNull();
    expect(calculateSaleProceedsNeso("-5")).toBeNull();
    expect(calculateSaleProceedsNeso("1".repeat(31))).toBeNull();
  });
});

describe("calculateSettlement", () => {
  it("pools everyone's winnings, then gives taxed members tax-rate ÷ party-size and distributes the remainder", () => {
    const partyOrder = ["a", "b", "c", "d", "e", "f"];
    const members = partyOrder.map((memberId, index) => ({
      memberId,
      bossNeso: String((index + 1) * 100),
      powerCrystalAmount: "0",
      ascendantNeso: "0",
      drops: [],
    }));
    const result = calculateSettlement(clearInput({
      partyOrder,
      members,
      historyMemberIds: partyOrder,
      include: { bossNeso: true },
      saleNesoByDropId: {},
      taxPercentByMemberId: { a: "50" },
      sharePercentByMemberId: { b: "10" },
    }));
    expect(result.ok).toBe(true);
    expect(result.total).toBe("2100");
    expect(result.distributionPool).toBe("2100");
    expect(result.members.map((member) => member.assignedShare)).toEqual(["175", "211", "429", "429", "428", "428"]);
    expect(result.members.map((member) => [member.taxPercentText, member.sharePercentText])).toEqual([
      ["50%", "8.3333%"],
      [null, "10%"],
      [null, "20.4166%"],
      [null, "20.4166%"],
      [null, "20.4166%"],
      [null, "20.4166%"],
    ]);
    expect(result.members.reduce((sum, member) => sum + BigInt(member.assignedShare), 0n)).toBe(2100n);
  });

  it("adds only selected categories and creates transfers", () => {
    const result = calculateSettlement(clearInput());
    expect(result.ok).toBe(true);
    expect(result.total).toBe("1130");
    expect(result.members.map((row) => row.assignedShare)).toEqual(["565", "565"]);
    expect(result).toMatchObject({
      memberCount: 2,
      baseShare: "565",
      remainder: 0,
      categoryTotals: {
        bossNeso: "600",
        powerCrystalAmount: "100",
        powerCrystalNeso: "100",
        ascendantNeso: "50",
        coinSaleNeso: "95",
        equipmentSaleNeso: "285",
        coinQuantity: "10",
        equipmentQuantity: "1",
        transferableNeso: "1030",
      },
    });
    expect(result.members[0]).toMatchObject({
      memberId: "a",
      hasHistory: true,
      gross: "845",
      payment: "280",
      receipt: "0",
    });
    expect(result.members[1]).toMatchObject({
      memberId: "b",
      hasHistory: false,
      gross: "285",
      payment: "0",
      receipt: "280",
      equipmentQuantity: "1",
      equipmentDrops: [expect.objectContaining({ name: "Gear", quantity: "1", salePriceNeso: "300", saleNeso: "285" })],
    });
    expect(result.transfers).toEqual([{ fromMemberId: "a", toMemberId: "b", amount: "280" }]);
  });

  it("ignores unchecked categories without requiring sale values", () => {
    const input = clearInput({
      include: { coin: false, equipment: false, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      saleNesoByDropId: {},
    });
    const result = calculateSettlement(input);
    expect(result.ok).toBe(true);
    expect(result.total).toBe("600");
  });

  // G1 (LULU-119 follow-up, user ruling): the old "empty sale price blocks
  // the whole calculation" behavior is retired -- an unfilled sale price is
  // simply treated as a 0 NESO sale (no proceeds for that drop), not an error.
  it("treats an unfilled sale amount as 0 NESO instead of blocking the calculation", () => {
    const result = calculateSettlement(clearInput({ saleNesoByDropId: { coin1: "100" } }));
    expect(result.ok).toBe(true);
    // coin1 still contributes its normal proceeds; equip1 (left blank)
    // contributes 0 -- member b's equipment drop therefore has no proceeds.
    expect(result.categoryTotals.coinSaleNeso).toBe("95");
    expect(result.categoryTotals.equipmentSaleNeso).toBe("0");
    const memberB = result.members.find((member) => member.memberId === "b");
    expect(memberB.equipmentSaleNeso).toBe("0");
    expect(memberB.equipmentDrops).toEqual([expect.objectContaining({ name: "Gear", quantity: "1", salePriceNeso: "0", saleNeso: "0" })]);
  });

  it("also treats a whitespace-only or entirely missing saleNesoByDropId entry as 0 (not an error)", () => {
    const whitespaceOnly = calculateSettlement(clearInput({ saleNesoByDropId: { coin1: "100", equip1: "   " } }));
    expect(whitespaceOnly.ok).toBe(true);
    expect(whitespaceOnly.categoryTotals.equipmentSaleNeso).toBe("0");

    const entirelyMissing = calculateSettlement(clearInput({ saleNesoByDropId: {} }));
    expect(entirelyMissing.ok).toBe(true);
    expect(entirelyMissing.categoryTotals.coinSaleNeso).toBe("0");
    expect(entirelyMissing.categoryTotals.equipmentSaleNeso).toBe("0");
  });

  it("still rejects a genuinely malformed (non-blank) sale amount -- only a blank field gets the free pass", () => {
    for (const malformed of ["abc", "-5", "1.5", "1".repeat(31)]) {
      const result = calculateSettlement(clearInput({ saleNesoByDropId: { coin1: "100", equip1: malformed } }));
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({ dropId: "equip1" }));
    }
  });

  it("lets the distribution calculation run to completion with every sale price left blank", () => {
    const result = calculateSettlement(clearInput({ saleNesoByDropId: {} }));
    expect(result.ok).toBe(true);
    expect(result.categoryTotals.coinSaleNeso).toBe("0");
    expect(result.categoryTotals.equipmentSaleNeso).toBe("0");
  });

  it("converts Power Crystal via division (1 NESO = [rate] PC) and rounds half up instead of erroring on a remainder", () => {
    // 100 PC ÷ 0.8 = 125 NESO exactly.
    const exact = calculateSettlement(clearInput({ powerCrystalNesoRate: "0.8" }));
    expect(exact.ok).toBe(true);
    expect(exact.categoryTotals.powerCrystalNeso).toBe("125");
    expect(exact.total).toBe("1155");

    // 1 PC ÷ 0.8 = 1.25 -> rounds down to 1 (nearest integer, not a tie).
    const members = clearInput().members.map((member) => ({ ...member, powerCrystalAmount: member.memberId === "a" ? "1" : "0" }));
    const nonExact = calculateSettlement(clearInput({ members, powerCrystalNesoRate: "0.8" }));
    expect(nonExact.ok).toBe(true);
    expect(nonExact.members.find((member) => member.memberId === "a").powerCrystalNeso).toBe("1");

    // 1 PC ÷ 2 = 0.5 exactly -> round half up rounds the tie up to 1.
    const tieMembers = clearInput().members.map((member) => ({ ...member, powerCrystalAmount: member.memberId === "a" ? "1" : "0" }));
    const tie = calculateSettlement(clearInput({ members: tieMembers, powerCrystalNesoRate: "2" }));
    expect(tie.ok).toBe(true);
    expect(tie.members.find((member) => member.memberId === "a").powerCrystalNeso).toBe("1");
  });

  it("rejects rate 0, empty, negative, and non-numeric rate input as invalid_rate without calculating", () => {
    for (const rate of ["0", "0.0", "", "-1", "abc", "1.2.3"]) {
      const result = calculateSettlement(clearInput({ powerCrystalNesoRate: rate }));
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_rate", field: "powerCrystalNesoRate" }));
    }
  });

  it("rejects incomplete or mismatched parties", () => {
    expect(calculateSettlement(clearInput({ complete: false })).errors[0].code).toBe("incomplete_clear");
    expect(calculateSettlement(clearInput({ partyOrder: ["a", "c"] })).errors.map((entry) => entry.code)).toContain("party_mismatch");
  });

  it("calculates an explicitly confirmed two-member distribution from a six-person clear", () => {
    const partyOrder = ["a", "b"];
    const members = partyOrder.map((memberId, index) => ({
      memberId,
      bossNeso: index === 0 ? "500" : "0",
      powerCrystalAmount: "0",
      ascendantNeso: "0",
      drops: [],
    }));
    const result = calculateSettlement(clearInput({
      partyCount: 6,
      partyOrder,
      members,
      include: { bossNeso: true },
      saleNesoByDropId: {},
    }));
    expect(result.ok).toBe(true);
    expect(result.members.map((member) => member.assignedShare)).toEqual(["250", "250"]);
  });

  it("keeps values beyond Number.MAX_SAFE_INTEGER exact", () => {
    const members = clearInput().members.map((member) => ({ ...member, bossNeso: member.memberId === "a" ? "9007199254740993" : "9007199254740995", drops: [] }));
    const result = calculateSettlement(clearInput({ include: { bossNeso: true }, members, saleNesoByDropId: {} }));
    expect(result.ok).toBe(true);
    expect(result.total).toBe("18014398509481988");
  });
  it("carries Power Crystal-only liabilities because Power Crystal cannot be transferred", () => {
    const members = [
      { memberId: "a", bossNeso: "0", powerCrystalAmount: "100", ascendantNeso: "0", drops: [] },
      { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
    ];
    const result = calculateSettlement(clearInput({
      members,
      include: { powerCrystal: true },
      saleNesoByDropId: {},
      carryoverEnabled: true,
      previousCarryoverByMemberId: { a: "0", b: "0" },
    }));
    expect(result.ok).toBe(true);
    expect(result.transfers).toEqual([]);
    expect(result.members.map((member) => ({ id: member.memberId, payment: member.payment, receipt: member.receipt, next: member.nextCarryover }))).toEqual([
      { id: "a", payment: "0", receipt: "0", next: "-50" },
      { id: "b", payment: "0", receipt: "0", next: "50" },
    ]);
  });

  it("uses only this week's transferable NESO and carries the unpaid remainder", () => {
    const members = [
      { memberId: "a", bossNeso: "50", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
    ];
    const result = calculateSettlement(clearInput({
      members,
      include: { bossNeso: true },
      saleNesoByDropId: {},
      carryoverEnabled: true,
      previousCarryoverByMemberId: { a: "-50", b: "+50" },
    }));
    expect(result.ok).toBe(true);
    expect(result.transfers).toEqual([{ fromMemberId: "a", toMemberId: "b", amount: "50" }]);
    expect(result.members.map((member) => member.nextCarryover)).toEqual(["-25", "25"]);
  });

  // F2/LULU-119: Will FT Item (Sealed Mirror World Nodestone) is a third,
  // independently-toggled drop category alongside coin/equipment, settled the
  // same way (5% marketplace sale fee, per-drop sale price input).
  it("settles FT_ITEM drops with the same 5% sale deduction as coin/equipment when included", () => {
    const result = calculateSettlement(clearInput({
      boss: "WILL",
      include: { coin: true, equipment: true, ftItem: true, bossNeso: true, powerCrystal: true, ascendantNeso: true },
      saleNesoByDropId: { coin1: "100", equip1: "300", ft1: "1000" },
      members: [
        { memberId: "a", bossNeso: "600", powerCrystalAmount: "100", ascendantNeso: "50", drops: [{ dropId: "coin1", category: "COIN", name: "Coin", quantity: "10" }, { dropId: "ft1", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" }] },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [{ dropId: "equip1", category: "EQUIPMENT", name: "Gear", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/1000001.png" }] },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result.categoryTotals.ftItemQuantity).toBe("1");
    expect(result.categoryTotals.ftItemSaleNeso).toBe("950");
    expect(result.members[0]).toMatchObject({ ftItemQuantity: "1", ftItemSaleNeso: "950" });
    expect(result.members[1]).toMatchObject({ ftItemQuantity: "0", ftItemSaleNeso: "0" });
    // FT Item sale proceeds are transferable (same as coin/equipment).
    expect(BigInt(result.members[0].transferableNeso)).toBeGreaterThanOrEqual(950n);
  });

  it("excludes FT_ITEM drops from totals when unchecked, without requiring a sale value", () => {
    const result = calculateSettlement(clearInput({
      boss: "WILL",
      include: { coin: false, equipment: false, ftItem: false, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      saleNesoByDropId: {},
      members: [
        { memberId: "a", bossNeso: "600", powerCrystalAmount: "0", ascendantNeso: "0", drops: [{ dropId: "ft1", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" }] },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result.categoryTotals.ftItemQuantity).toBe("0");
    expect(result.categoryTotals.ftItemSaleNeso).toBe("0");
    expect(result.total).toBe("600");
  });

  it("requires previous carryovers to balance to zero", () => {
    const result = calculateSettlement(clearInput({
      carryoverEnabled: true,
      previousCarryoverByMemberId: { a: "10", b: "0" },
    }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain("carryover_not_balanced");
  });

  // docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md S5 acceptance criterion 6: a SLIME clear settles like
  // any other distribution-target boss -- no invalid_boss error.
  it("accepts SLIME as a valid distribution-target boss", () => {
    const result = calculateSettlement(clearInput({ boss: "SLIME" }));
    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });
});

// docs/IMPL_PLAN_RAFFLE_EXTRA_REWARD.md: extra reward is NESO already
// received outside the raffle (e.g. a carry's cut) that the party wants
// folded into this week's distribution. It skips the 5% sale fee (unlike
// coin/equipment/FT Item) and is added straight to the member's gross AND
// transferableNeso.
describe("calculateSettlement extra reward (docs/IMPL_PLAN_RAFFLE_EXTRA_REWARD.md)", () => {
  function sixMemberInput(overrides = {}) {
    const partyOrder = ["m1", "m2", "m3", "m4", "m5", "m6"];
    const members = partyOrder.map((memberId) => ({
      memberId,
      bossNeso: "60000000",
      powerCrystalAmount: "0",
      ascendantNeso: "0",
      drops: [],
    }));
    return {
      boss: "LUCID",
      complete: true,
      historyMemberIds: partyOrder,
      partyOrder,
      include: { coin: false, equipment: false, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      powerCrystalNesoRate: "1",
      saleNesoByDropId: {},
      members,
      ...overrides,
    };
  }

  // Acceptance criterion 1: 6 people each win 60,000,000, m3 additionally
  // receives a 60,000,000 extra reward (e.g. a carry's cut) -> m3 alone pays
  // 50,000,000 and the other 5 each receive 10,000,000 (5 transfers summing
  // to 50,000,000).
  it("acceptance 1: m3's 60,000,000 extra reward makes m3 pay 50,000,000 and the other 5 each receive 10,000,000", () => {
    const result = calculateSettlement(sixMemberInput({
      extraRewards: [{ rowId: "r1", memberId: "m3", amountNeso: "60000000" }],
    }));
    expect(result.ok).toBe(true);
    expect(result.total).toBe("420000000");
    expect(result.baseShare).toBe("70000000");
    const m3 = result.members.find((member) => member.memberId === "m3");
    expect(m3).toMatchObject({ gross: "120000000", payment: "50000000", receipt: "0" });
    const others = result.members.filter((member) => member.memberId !== "m3");
    expect(others.every((member) => member.payment === "0" && member.receipt === "10000000")).toBe(true);
    expect(result.transfers).toHaveLength(5);
    expect(result.transfers.every((transfer) => transfer.fromMemberId === "m3" && transfer.amount === "10000000")).toBe(true);
    const totalPaid = result.transfers.reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n);
    expect(totalPaid).toBe(50000000n);
  });

  // Acceptance criterion 2: the 5% sale fee never applies to extra reward --
  // 60,000,000 in contributes exactly 60,000,000 to gross, not 57,000,000.
  it("acceptance 2: does not deduct the 5% sale fee from extra reward", () => {
    const result = calculateSettlement(sixMemberInput({
      extraRewards: [{ rowId: "r1", memberId: "m3", amountNeso: "60000000" }],
    }));
    expect(result.ok).toBe(true);
    expect(result.categoryTotals.extraReward).toBe("60000000");
    const m3 = result.members.find((member) => member.memberId === "m3");
    expect(m3.extraReward).toBe("60000000");
    expect(BigInt(m3.gross)).toBe(60000000n + 60000000n);
  });

  // Acceptance criterion 3: two rows for the same member are summed.
  it("acceptance 3: sums multiple rows for the same member", () => {
    const result = calculateSettlement(sixMemberInput({
      extraRewards: [
        { rowId: "r1", memberId: "m3", amountNeso: "30000000" },
        { rowId: "r2", memberId: "m3", amountNeso: "30000000" },
      ],
    }));
    expect(result.ok).toBe(true);
    const m3 = result.members.find((member) => member.memberId === "m3");
    expect(m3.extraReward).toBe("60000000");
    expect(result.categoryTotals.extraReward).toBe("60000000");
  });

  // Acceptance criterion 4: a blank amount is treated as 0 (LULU-126-style
  // blank-is-zero), and the calculation still completes; a genuinely
  // malformed (non-blank) amount still errors.
  it("acceptance 4: treats a blank amount as 0 and still errors on a malformed (non-blank) amount", () => {
    const blank = calculateSettlement(sixMemberInput({
      extraRewards: [{ rowId: "r1", memberId: "m3", amountNeso: "" }],
    }));
    expect(blank.ok).toBe(true);
    expect(blank.categoryTotals.extraReward).toBe("0");

    const malformed = calculateSettlement(sixMemberInput({
      extraRewards: [{ rowId: "r1", memberId: "m3", amountNeso: "abc" }],
    }));
    expect(malformed.ok).toBe(false);
    expect(malformed.errors).toContainEqual(expect.objectContaining({ code: "invalid_integer", field: "extraRewardAmount", memberId: "m3" }));
  });

  it("rejects a row whose memberId is not part of the saved party", () => {
    const result = calculateSettlement(sixMemberInput({
      extraRewards: [{ rowId: "r1", memberId: "not-a-member", amountNeso: "1000" }],
    }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_extra_reward_member", memberId: "not-a-member" }));
  });

  // Acceptance criterion 5 (domain half): with no extraRewards at all, the
  // category total is 0 -- the UI hides the "extra reward" column/row
  // whenever this is "0" (see SettlementResult.jsx/shareImage.js), so the
  // existing look is unchanged when the feature is unused.
  it("acceptance 5: reports a 0 category total and per-member extraReward when no extraRewards are given", () => {
    const result = calculateSettlement(sixMemberInput());
    expect(result.ok).toBe(true);
    expect(result.categoryTotals.extraReward).toBe("0");
    expect(result.members.every((member) => member.extraReward === "0")).toBe(true);
    expect(result.total).toBe("360000000");
  });
});

// LULU-099: Power Crystal rate is now a divisor ("1 NESO = [rate] Power
// Crystal") instead of a multiplier. IMPL_PLAN_RAFFLE_PC_RATE_DIVIDE.md
// acceptance criteria 1-2: pin the documented 100,000,000 PC examples and
// confirm the single conversion propagates unchanged through total value,
// assigned share, payment/receipt, and next-carryover (no double conversion).
describe("Power Crystal rate divide conversion (LULU-099)", () => {
  function pcOnlyInput(rate, amount, overrides = {}) {
    return {
      boss: "LUCID",
      complete: true,
      historyMemberIds: ["a"],
      partyOrder: ["a", "b"],
      include: { coin: false, equipment: false, bossNeso: false, powerCrystal: true, ascendantNeso: false },
      powerCrystalNesoRate: rate,
      saleNesoByDropId: {},
      members: [
        { memberId: "a", bossNeso: "0", powerCrystalAmount: amount, ascendantNeso: "0", drops: [] },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      ],
      ...overrides,
    };
  }

  it("converts 100,000,000 PC using round-half-up division for the documented rate examples (acceptance criterion 1)", () => {
    expect(calculateSettlement(pcOnlyInput("1.1", "100000000")).members[0].powerCrystalNeso).toBe("90909091");
    expect(calculateSettlement(pcOnlyInput("1.2", "100000000")).members[0].powerCrystalNeso).toBe("83333333");
    expect(calculateSettlement(pcOnlyInput("1.3", "100000000")).members[0].powerCrystalNeso).toBe("76923077");
    expect(calculateSettlement(pcOnlyInput("1.0", "100000000")).members[0].powerCrystalNeso).toBe("100000000");
  });

  it("keeps total value, category totals, and gross consistent with a single conversion (no double conversion)", () => {
    const result = calculateSettlement(pcOnlyInput("1.1", "100000000"));
    expect(result.ok).toBe(true);
    expect(result.total).toBe("90909091");
    expect(result.categoryTotals.powerCrystalNeso).toBe("90909091");
    expect(result.members[0].powerCrystalNeso).toBe("90909091");
    expect(result.members[0].gross).toBe("90909091");
    expect(result.members[0].transferableNeso).toBe("0");
  });

  it("propagates the converted value through assigned share, payment/receipt, and next-carryover without recomputation (acceptance criterion 2)", () => {
    const result = calculateSettlement(pcOnlyInput("1.1", "100000000", {
      carryoverEnabled: true,
      previousCarryoverByMemberId: { a: "0", b: "0" },
    }));
    expect(result.ok).toBe(true);
    expect(result.members.map((member) => member.assignedShare)).toEqual(["45454546", "45454545"]);
    // Power Crystal value cannot itself be transferred, so no actual transfer occurs.
    expect(result.transfers).toEqual([]);
    expect(result.members.map((member) => ({
      id: member.memberId,
      payment: member.payment,
      receipt: member.receipt,
      next: member.nextCarryover,
    }))).toEqual([
      { id: "a", payment: "0", receipt: "0", next: "-45454545" },
      { id: "b", payment: "0", receipt: "0", next: "45454545" },
    ]);
  });

  it("rejects rate 0, empty, negative, and non-numeric rate input as invalid_rate without calculating (acceptance criterion 3)", () => {
    for (const rate of ["0", "0.0", "", "-1", "abc", "1.2.3"]) {
      const result = calculateSettlement(pcOnlyInput(rate, "100"));
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_rate" }));
    }
  });
});

// LULU-104: Party member order is normalized (sortPartyMembers) before
// memberId assignment, so the remainder allocation and transfer pairing no
// longer depend on the order the member was typed/added in. IMPL_PLAN
// acceptance criterion 1: same member set, different input order -> the
// remainder-assignment and transfer list are byte-for-byte identical.
describe("member order normalization feeds a stable settlement (LULU-104)", () => {
  const GROSS_BY_ASSET_KEY = { "asset-charlie": "100", "asset-bob": "0", "asset-alice": "0" };
  const RAW_MEMBERS = {
    alice: { assetKey: "asset-alice", displayName: "Alice" },
    bob: { assetKey: "asset-bob", displayName: "Bob" },
    charlie: { assetKey: "asset-charlie", displayName: "Charlie" },
  };

  function runSettlementForOrder(rawOrder) {
    const sorted = sortPartyMembers(rawOrder);
    const partyOrder = sorted.map((_, index) => "member-" + String(index + 1));
    const members = sorted.map((member, index) => ({
      memberId: partyOrder[index],
      bossNeso: GROSS_BY_ASSET_KEY[member.assetKey],
      powerCrystalAmount: "0",
      ascendantNeso: "0",
      drops: [],
    }));
    return calculateSettlement({
      boss: "LUCID",
      complete: true,
      historyMemberIds: partyOrder,
      partyOrder,
      include: { coin: false, equipment: false, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      powerCrystalNesoRate: "1",
      saleNesoByDropId: {},
      members,
    });
  }

  it("produces the same remainder allocation and transfer list regardless of input order", () => {
    const orderings = [
      [RAW_MEMBERS.alice, RAW_MEMBERS.bob, RAW_MEMBERS.charlie],
      [RAW_MEMBERS.charlie, RAW_MEMBERS.alice, RAW_MEMBERS.bob],
      [RAW_MEMBERS.bob, RAW_MEMBERS.charlie, RAW_MEMBERS.alice],
    ];
    const results = orderings.map((order) => runSettlementForOrder(order));
    for (const result of results) expect(result.ok).toBe(true);
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);

    // Canonical order (casefolded name, code point descending) is
    // Charlie, Bob, Alice -> memberId member-1/2/3 respectively. The 100
    // NESO total does not divide evenly by 3 (baseShare 33, remainder 1),
    // so Charlie (index 0 in canonical order) receives the +1.
    expect(results[0].remainder).toBe(1);
    expect(results[0].members.map((member) => member.assignedShare)).toEqual(["34", "33", "33"]);
    expect(results[0].transfers).toEqual([
      { fromMemberId: "member-1", toMemberId: "member-2", amount: "33" },
      { fromMemberId: "member-1", toMemberId: "member-3", amount: "33" },
    ]);
  });
});

// LULU-144 (docs/IMPL_PLAN_RAFFLE_BOX_CATEGORY.md): Ring Box drops re-tagged
// as "BOX" by domain/boxDrops.js are their own toggle (include.box), settled
// with the same 5% sale fee (LULU-090) and counted as transferable NESO.
describe("calculateSettlement BOX category", () => {
  function boxInput(overrides = {}) {
    return clearInput({
      boss: "WILL",
      historyMemberIds: ["a", "b"],
      include: { coin: true, equipment: true, ftItem: false, box: true, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      saleNesoByDropId: { box1: "10000000", equip1: "300" },
      members: [
        { memberId: "a", bossNeso: "600", powerCrystalAmount: "0", ascendantNeso: "0", drops: [{ dropId: "box1", category: "BOX", name: "Rank 3 Special Skill Ring Box", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/2028394.png" }] },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [{ dropId: "equip1", category: "EQUIPMENT", name: "Arcane Umbra Archer Gloves", quantity: "1" }] },
      ],
      ...overrides,
    });
  }

  it("deducts the 5% sale fee from a 10,000,000 NESO Box and adds it to transferable NESO", () => {
    const result = calculateSettlement(boxInput());
    expect(result.ok).toBe(true);
    expect(result.members[0]).toMatchObject({
      boxQuantity: "1",
      boxSaleNeso: "9500000",
      boxDrops: [{ dropId: "box1", name: "Rank 3 Special Skill Ring Box", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/2028394.png", salePriceNeso: "10000000", saleNeso: "9500000" }],
      equipmentQuantity: "0",
      equipmentSaleNeso: "0",
      equipmentDrops: [],
      transferableNeso: String(600 + 9500000),
      gross: String(600 + 9500000),
    });
    expect(result.members[1]).toMatchObject({ boxQuantity: "0", boxSaleNeso: "0", boxDrops: [], equipmentSaleNeso: "285" });
    expect(result.categoryTotals).toMatchObject({ boxQuantity: "1", boxSaleNeso: "9500000", equipmentSaleNeso: "285", transferableNeso: String(600 + 9500000 + 285) });
    expect(result.boxDrops).toEqual([{ dropId: "box1", name: "Rank 3 Special Skill Ring Box", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/2028394.png", salePriceNeso: "10000000", saleNeso: "9500000", memberId: "a" }]);
    expect(result.equipmentDrops.map((drop) => drop.dropId)).toEqual(["equip1"]);
    expect(result.total).toBe(String(600 + 9500000 + 285));
  });

  it("excludes Box when include.box is false (0 everywhere, no sale value required)", () => {
    const result = calculateSettlement(boxInput({
      include: { coin: true, equipment: true, ftItem: false, box: false, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      saleNesoByDropId: { equip1: "300" },
    }));
    expect(result.ok).toBe(true);
    expect(result.members[0]).toMatchObject({ boxQuantity: "0", boxSaleNeso: "0", boxDrops: [], transferableNeso: "600" });
    expect(result.categoryTotals).toMatchObject({ boxQuantity: "0", boxSaleNeso: "0", transferableNeso: "885" });
    expect(result.boxDrops).toEqual([]);
    expect(result.total).toBe("885");
  });

  it("treats an unfilled Box sale price as 0 (LULU-126)", () => {
    const result = calculateSettlement(boxInput({ saleNesoByDropId: { equip1: "300" } }));
    expect(result.ok).toBe(true);
    expect(result.members[0]).toMatchObject({ boxQuantity: "1", boxSaleNeso: "0" });
    expect(result.members[0].boxDrops[0]).toMatchObject({ salePriceNeso: "0", saleNeso: "0" });
  });

  it("does not let include.box pick up EQUIPMENT drops, or include.equipment pick up BOX drops", () => {
    const equipmentOnly = calculateSettlement(boxInput({
      include: { equipment: true, box: false, bossNeso: false },
    }));
    expect(equipmentOnly.ok).toBe(true);
    expect(equipmentOnly.total).toBe("285");
    const boxOnly = calculateSettlement(boxInput({
      include: { equipment: false, box: true, bossNeso: false },
    }));
    expect(boxOnly.ok).toBe(true);
    expect(boxOnly.total).toBe("9500000");
  });

  // Acceptance criterion 6: for input without BOX drops, every pre-existing
  // output field is byte-identical to the output captured from the code
  // before LULU-144 (golden below); only the new box* fields are added.
  it("keeps every pre-existing output field identical for input without BOX drops (golden captured before LULU-144)", () => {
    const input = {
      boss: "WILL",
      complete: true,
      historyMemberIds: ["a", "b"],
      partyOrder: ["a", "b", "c"],
      include: { coin: true, equipment: true, ftItem: true, bossNeso: true, powerCrystal: true, ascendantNeso: true },
      powerCrystalNesoRate: "1.1",
      carryoverEnabled: true,
      previousCarryoverByMemberId: { a: "-1000", b: "1000", c: "0" },
      saleNesoByDropId: { coin1: "1000000", equip1: "3000000", ft1: "5000000" },
      extraRewards: [{ rowId: "r1", memberId: "c", amountNeso: "700000" }],
      members: [
        { memberId: "a", bossNeso: "9000000", powerCrystalAmount: "100000000", ascendantNeso: "12000000", drops: [
          { dropId: "coin1", category: "COIN", name: "Arachno Coin", quantity: "10" },
          { dropId: "ft1", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" },
        ] },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [
          { dropId: "equip1", category: "EQUIPMENT", name: "Arcane Umbra Archer Gloves", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/1082699.png" },
        ] },
        { memberId: "c", bossNeso: "5", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      ],
    };
    const goldenBeforeBox = {
    "ok": true,
    "boss": "WILL",
    "total": "121159096",
    "memberCount": 3,
    "baseShare": "40386365",
    "remainder": 1,
    "carryoverEnabled": true,
    "customDistribution": false,
    "distributionPool": "121159096",
    "categoryTotals": {
      "bossNeso": "9000005",
      "powerCrystalAmount": "100000000",
      "powerCrystalNeso": "90909091",
      "ascendantNeso": "12000000",
      "coinQuantity": "10",
      "coinSaleNeso": "950000",
      "equipmentQuantity": "1",
      "equipmentSaleNeso": "2850000",
      "ftItemQuantity": "1",
      "ftItemSaleNeso": "4750000",
      "extraReward": "700000",
      "transferableNeso": "30250005"
    },
    "equipmentDrops": [
      {
        "dropId": "equip1",
        "name": "Arcane Umbra Archer Gloves",
        "quantity": "1",
        "imageUrl": "https://api-static.msu.io/itemimages/icon/1082699.png",
        "salePriceNeso": "3000000",
        "saleNeso": "2850000",
        "memberId": "b"
      }
    ],
    "members": [
      {
        "memberId": "a",
        "taxPercentText": null,
        "sharePercentText": null,
        "hasHistory": true,
        "bossNeso": "9000000",
        "powerCrystalAmount": "100000000",
        "powerCrystalNeso": "90909091",
        "ascendantNeso": "12000000",
        "coinQuantity": "10",
        "coinSaleNeso": "950000",
        "equipmentQuantity": "0",
        "equipmentSaleNeso": "0",
        "equipmentDrops": [],
        "ftItemQuantity": "1",
        "ftItemSaleNeso": "4750000",
        "extraReward": "0",
        "transferableNeso": "26700000",
        "previousCarryover": "-1000",
        "gross": "117609091",
        "assignedShare": "40386366",
        "balance": "77223725",
        "payment": "26700000",
        "receipt": "0",
        "nextCarryover": "-50523725"
      },
      {
        "memberId": "b",
        "taxPercentText": null,
        "sharePercentText": null,
        "hasHistory": true,
        "bossNeso": "0",
        "powerCrystalAmount": "0",
        "powerCrystalNeso": "0",
        "ascendantNeso": "0",
        "coinQuantity": "0",
        "coinSaleNeso": "0",
        "equipmentQuantity": "1",
        "equipmentSaleNeso": "2850000",
        "equipmentDrops": [
          {
            "dropId": "equip1",
            "name": "Arcane Umbra Archer Gloves",
            "quantity": "1",
            "imageUrl": "https://api-static.msu.io/itemimages/icon/1082699.png",
            "salePriceNeso": "3000000",
            "saleNeso": "2850000"
          }
        ],
        "ftItemQuantity": "0",
        "ftItemSaleNeso": "0",
        "extraReward": "0",
        "transferableNeso": "2850000",
        "previousCarryover": "1000",
        "gross": "2850000",
        "assignedShare": "40386365",
        "balance": "-37537365",
        "payment": "0",
        "receipt": "26700000",
        "nextCarryover": "10837365"
      },
      {
        "memberId": "c",
        "taxPercentText": null,
        "sharePercentText": null,
        "hasHistory": false,
        "bossNeso": "5",
        "powerCrystalAmount": "0",
        "powerCrystalNeso": "0",
        "ascendantNeso": "0",
        "coinQuantity": "0",
        "coinSaleNeso": "0",
        "equipmentQuantity": "0",
        "equipmentSaleNeso": "0",
        "equipmentDrops": [],
        "ftItemQuantity": "0",
        "ftItemSaleNeso": "0",
        "extraReward": "700000",
        "transferableNeso": "700005",
        "previousCarryover": "0",
        "gross": "700005",
        "assignedShare": "40386365",
        "balance": "-39686360",
        "payment": "0",
        "receipt": "0",
        "nextCarryover": "39686360"
      }
    ],
    "transfers": [
      {
        "fromMemberId": "a",
        "toMemberId": "b",
        "amount": "26700000"
      }
    ]
  };
    const withBoxOn = calculateSettlement({ ...input, include: { ...input.include, box: true } });
    const withBoxOff = calculateSettlement(input);
    for (const result of [withBoxOn, withBoxOff]) {
      const { boxDrops, categoryTotals: { boxQuantity, boxSaleNeso, ...categoryTotals }, members, ...rest } = result;
      expect(boxDrops).toEqual([]);
      expect([boxQuantity, boxSaleNeso]).toEqual(["0", "0"]);
      expect({
        ...rest,
        categoryTotals,
        members: members.map(({ boxQuantity: q, boxSaleNeso: s, boxDrops: d, ...member }) => {
          expect([q, s, d]).toEqual(["0", "0", []]);
          return member;
        }),
      }).toEqual(goldenBeforeBox);
    }
    expect(withBoxOn).toEqual(withBoxOff);
  });
});
