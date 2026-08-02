import { describe, expect, it } from "vitest";
import { calculateSettlement, parseDecimalRate } from "./settlement.js";

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

describe("calculateSettlement", () => {
  it("adds only selected categories and creates transfers", () => {
    const result = calculateSettlement(clearInput());
    expect(result.ok).toBe(true);
    expect(result.total).toBe("1150");
    expect(result.members.map((row) => row.assignedShare)).toEqual(["575", "575"]);
    expect(result).toMatchObject({
      memberCount: 2,
      baseShare: "575",
      remainder: 0,
      categoryTotals: {
        bossNeso: "600",
        powerCrystalAmount: "100",
        powerCrystalNeso: "100",
        ascendantNeso: "50",
        coinSaleNeso: "100",
        equipmentSaleNeso: "300",
        coinQuantity: "10",
        equipmentQuantity: "1",
        transferableNeso: "1050",
      },
    });
    expect(result.members[0]).toMatchObject({
      memberId: "a",
      hasHistory: true,
      gross: "850",
      payment: "275",
      receipt: "0",
    });
    expect(result.members[1]).toMatchObject({
      memberId: "b",
      hasHistory: false,
      gross: "300",
      payment: "0",
      receipt: "275",
      equipmentQuantity: "1",
      equipmentDrops: [expect.objectContaining({ name: "Gear", quantity: "1" })],
    });
    expect(result.transfers).toEqual([{ fromMemberId: "a", toMemberId: "b", amount: "275" }]);
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

  it("uses exact Power Crystal conversion and rejects sub-NESO fractions", () => {
    const exact = calculateSettlement(clearInput({ powerCrystalNesoRate: "0.8" }));
    expect(exact.ok).toBe(true);
    expect(exact.total).toBe("1130");
    const members = clearInput().members.map((member) => ({ ...member, powerCrystalAmount: member.memberId === "a" ? "1" : "0" }));
    const fractional = calculateSettlement(clearInput({ members, powerCrystalNesoRate: "0.8" }));
    expect(fractional.errors.map((entry) => entry.code)).toContain("fractional_neso");
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