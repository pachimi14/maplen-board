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
    expect(calculateSaleProceedsNeso("")).toBeNull();
  });
});

describe("calculateSettlement", () => {
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

  it("requires one sale amount for every selected drop", () => {
    const result = calculateSettlement(clearInput({ saleNesoByDropId: { coin1: "100" } }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_integer", dropId: "equip1" }));
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

  it("requires previous carryovers to balance to zero", () => {
    const result = calculateSettlement(clearInput({
      carryoverEnabled: true,
      previousCarryoverByMemberId: { a: "10", b: "0" },
    }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain("carryover_not_balanced");
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