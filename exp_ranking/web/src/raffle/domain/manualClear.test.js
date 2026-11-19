import { describe, expect, it } from "vitest";
import { MANUAL_ITEM_KEYS_BY_BOSS, buildManualClear, partySessionFromMembers } from "./manualClear.js";
import { combineSelectedPartyClears, formatPartyClearTitle, requiresDistributionConfirmation } from "./partyClears.js";
import { reclassifyBoxDrops } from "./boxDrops.js";
import { calculateSettlement } from "./settlement.js";

// Same default include as RaffleCalculatorRoot.jsx initialBossSetting() (LULU-144).
const DEFAULT_INCLUDE = { coin: true, equipment: true, ftItem: false, box: true, bossNeso: true, powerCrystal: true, ascendantNeso: true };
const PARTY = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];

// Settlement output with every dropId removed (the only field the two paths
// are allowed to differ on, together with clearId which the output has none of).
function withoutDropIds(result) {
  const strip = (drops) => (drops || []).map(({ dropId, ...rest }) => rest);
  return {
    ...result,
    equipmentDrops: strip(result.equipmentDrops),
    boxDrops: strip(result.boxDrops),
    members: result.members.map((member) => ({ ...member, equipmentDrops: strip(member.equipmentDrops), boxDrops: strip(member.boxDrops) })),
  };
}

function settle(clear, extra) {
  return calculateSettlement({ ...clear, ...extra });
}

// Runs the same values through (a) the API path: contract-shaped clear ->
// combineSelectedPartyClears -> reclassifyBoxDrops (Ring Box arrives as
// EQUIPMENT) and (b) the manual path: buildManualClear. Returns both results.
function bothPaths({ apiClear, apiSaleNesoByDropId, apiInclude, manual, extra }) {
  const partyOrder = manual.partyOrder;
  const apiActive = reclassifyBoxDrops(combineSelectedPartyClears([apiClear], partyOrder));
  const api = settle(apiActive, { partyOrder, include: apiInclude, saleNesoByDropId: apiSaleNesoByDropId, ...extra });
  const built = buildManualClear(manual);
  const viaManual = settle(built.clear, { partyOrder, include: built.include, saleNesoByDropId: built.saleNesoByDropId, ...extra });
  return { api, viaManual, built, apiActive };
}

function apiMember(memberId, overrides = {}) {
  return { memberId, bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [], ...overrides };
}

describe("buildManualClear -- shape", () => {
  it("returns a clear shaped like combineSelectedPartyClears() (no confirmation dialog, Hard Will tier)", () => {
    const { clear, saleNesoByDropId, include } = buildManualClear({
      boss: "WILL",
      difficulty: "HARD",
      partyOrder: ["member-1", "member-2"],
      include: DEFAULT_INCLUDE,
      entriesByMemberId: { "member-1": { bossNeso: "1,000", coinQuantity: "2", coinSaleNeso: "", equipment: [{ rowId: "r1", name: "", saleNeso: "5" }] } },
      labels: { equipment: "Equipment drop" },
    });
    expect(clear.clearId).toBe("manual-will-hard");
    expect(clear).toMatchObject({ boss: "WILL", bossDifficulty: "HARD", ascendantTier: "Eternal Ascendant Hard Will", partyCount: 2, complete: true, excludedRewards: [] });
    expect(clear.historyMemberIds).toEqual(["member-1", "member-2"]);
    expect(clear.sourceClears).toHaveLength(1);
    expect(clear.sourceClears[0].clearId).toBe(clear.clearId);
    expect(requiresDistributionConfirmation(clear.sourceClears[0])).toBe(false);
    expect(formatPartyClearTitle(clear.sourceClears[0])).toBe("Hard Will + Eternal Ascendant Hard Will");
    expect(Object.keys(clear).sort()).toEqual(expect.arrayContaining(Object.keys(combineSelectedPartyClears([{ ...clear.sourceClears[0] }], ["member-1", "member-2"])).sort()));
    expect(clear.members[0]).toEqual({
      memberId: "member-1",
      bossNeso: "1000",
      powerCrystalAmount: "0",
      ascendantNeso: "0",
      drops: [
        { dropId: "manual-will-member-1-coin", category: "COIN", name: "Arachno Coin", quantity: "2" },
        { dropId: "manual-will-member-1-equipment-r1", category: "EQUIPMENT", name: "Equipment drop", quantity: "1" },
      ],
    });
    expect(clear.members[1]).toEqual({ memberId: "member-2", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] });
    expect(saleNesoByDropId).toEqual({ "manual-will-member-1-coin": "", "manual-will-member-1-equipment-r1": "5" });
    expect(include).toEqual(DEFAULT_INCLUDE);
  });

  it("keeps dropIds unique within the clear even with duplicate row ids", () => {
    const { clear } = buildManualClear({
      boss: "LUCID", difficulty: "HARD", partyOrder: ["member-1", "member-2"], include: DEFAULT_INCLUDE,
      entriesByMemberId: {
        "member-1": { box: [{ rowId: "x", saleNeso: "1" }, { rowId: "x", saleNeso: "2" }], equipment: [{ rowId: "x" }] },
        "member-2": { box: [{ rowId: "x" }] },
      },
    });
    const dropIds = clear.members.flatMap((member) => member.drops.map((drop) => drop.dropId));
    expect(new Set(dropIds).size).toBe(dropIds.length);
    expect(dropIds).toHaveLength(4);
  });

  it("masks include/fields to what each boss can award (Slime: no coin / PC / equipment / FT; Lucid: no FT)", () => {
    const everything = { bossNeso: "1", ascendantNeso: "2", powerCrystalAmount: "3", coinQuantity: "1", ftItemQuantity: "1", equipment: [{ rowId: "e" }], box: [{ rowId: "b" }] };
    const slime = buildManualClear({ boss: "SLIME", difficulty: "HARD", partyOrder: ["member-1"], include: DEFAULT_INCLUDE, entriesByMemberId: { "member-1": everything } });
    expect(slime.clear.bossDifficulty).toBe("CHAOS");
    expect(slime.clear.ascendantTier).toBe("Eternal Ascendant Chaos Guardian");
    expect(slime.include).toEqual({ coin: false, equipment: false, ftItem: false, box: true, bossNeso: true, powerCrystal: false, ascendantNeso: true });
    expect(slime.clear.members[0].powerCrystalAmount).toBe("0");
    expect(slime.clear.members[0].drops.map((drop) => drop.category)).toEqual(["BOX"]);
    const lucid = buildManualClear({ boss: "LUCID", difficulty: "NORMAL", partyOrder: ["member-1"], include: { ...DEFAULT_INCLUDE, ftItem: true }, entriesByMemberId: { "member-1": everything } });
    expect(lucid.include.ftItem).toBe(false);
    expect(lucid.clear.members[0].drops.map((drop) => drop.category)).toEqual(["COIN", "EQUIPMENT", "BOX"]);
    expect(lucid.clear.ascendantTier).toBe("Mystic Ascendant");
    expect(MANUAL_ITEM_KEYS_BY_BOSS.WILL).toContain("ftItem");
  });

  it("is unchanged by reclassifyBoxDrops (Box is already BOX)", () => {
    const { clear } = buildManualClear({ boss: "WILL", difficulty: "HARD", partyOrder: ["member-1"], include: DEFAULT_INCLUDE, entriesByMemberId: { "member-1": { box: [{ rowId: "1", name: "Gold Ring Box" }, { rowId: "2" }], equipment: [{ rowId: "3", name: "Arcane Hat" }] } } });
    expect(reclassifyBoxDrops(clear)).toEqual(clear);
  });

  it("passes malformed values through so calculateSettlement fails visibly", () => {
    const { clear, include, saleNesoByDropId } = buildManualClear({ boss: "LUCID", difficulty: "HARD", partyOrder: ["member-1"], include: DEFAULT_INCLUDE, entriesByMemberId: { "member-1": { bossNeso: "12a", equipment: [{ rowId: "1", saleNeso: "-5" }] } } });
    const result = calculateSettlement({ ...clear, partyOrder: ["member-1"], include, saleNesoByDropId, powerCrystalNesoRate: "1.1" });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => [error.code, error.field])).toEqual([["invalid_integer", "bossNeso"], ["invalid_integer", "saleNeso"]]);
  });

  it("maps a sorted roster to the API job's position-based memberIds", () => {
    const { partyOrder, memberMap } = partySessionFromMembers([{ assetKey: "CHARa" }, { assetKey: "CHARb" }]);
    expect(partyOrder).toEqual(["member-1", "member-2"]);
    expect(memberMap["member-2"].assetKey).toBe("CHARb");
  });
});

describe("buildManualClear -- item checks (#6)", () => {
  it("an unchecked item contributes 0, and re-checking brings the same typed value back", () => {
    const entriesByMemberId = { "member-1": { bossNeso: "100", coinQuantity: "3", coinSaleNeso: "1000" } };
    const run = (include) => {
      const built = buildManualClear({ boss: "LUCID", difficulty: "HARD", partyOrder: ["member-1", "member-2"], include, entriesByMemberId });
      return calculateSettlement({ ...built.clear, partyOrder: ["member-1", "member-2"], include: built.include, saleNesoByDropId: built.saleNesoByDropId, powerCrystalNesoRate: "1.1" });
    };
    const off = run({ ...DEFAULT_INCLUDE, coin: false });
    expect(off.categoryTotals.coinSaleNeso).toBe("0");
    expect(off.total).toBe("100");
    const on = run(DEFAULT_INCLUDE);
    expect(on.categoryTotals.coinSaleNeso).toBe("950");
    expect(on.categoryTotals.coinQuantity).toBe("3");
    expect(on.total).toBe("1050");
    expect(entriesByMemberId["member-1"].coinSaleNeso).toBe("1000");
  });
});

describe("buildManualClear -- equivalence with the API path (#4)", () => {
  it("LUCID: multiple equipment and Box rows, Power Crystal, carryover enabled", () => {
    const partyOrder = PARTY.slice(0, 4);
    const apiClear = {
      clearId: "api-lucid-hard-4",
      boss: "LUCID",
      bossDifficulty: "HARD",
      ascendantTier: "Divine Ascendant",
      partyCount: 4,
      historyMemberIds: partyOrder,
      complete: true,
      excludedRewards: [],
      members: [
        apiMember("member-1", { bossNeso: "12000000", powerCrystalAmount: "275", ascendantNeso: "40000000", drops: [
          { dropId: "d-coin-1", category: "COIN", name: "Phantasma Coin", quantity: "7" },
          { dropId: "d-eq-1", category: "EQUIPMENT", name: "Arcane Umbra Hat", quantity: "1" },
          { dropId: "d-eq-2", category: "EQUIPMENT", name: "Arcane Umbra Cape", quantity: "1" },
          { dropId: "d-box-1", category: "EQUIPMENT", name: "Gold Ring Box", quantity: "1" },
        ] }),
        apiMember("member-2", { bossNeso: "3000000", drops: [
          { dropId: "d-box-2", category: "EQUIPMENT", name: "Silver Ring Box", quantity: "1" },
          { dropId: "d-box-3", category: "EQUIPMENT", name: "Gold Ring Box", quantity: "1" },
        ] }),
        apiMember("member-3", { powerCrystalAmount: "33" }),
        apiMember("member-4"),
      ],
    };
    const apiSaleNesoByDropId = { "d-coin-1": "7,000,000".replace(/,/g, ""), "d-eq-1": "25000000", "d-eq-2": "", "d-box-1": "8000001", "d-box-2": "1234567", "d-box-3": "" };
    const manual = {
      boss: "LUCID",
      difficulty: "HARD",
      partyOrder,
      include: DEFAULT_INCLUDE,
      entriesByMemberId: {
        "member-1": {
          bossNeso: "12,000,000", powerCrystalAmount: "275", ascendantNeso: "40,000,000", coinQuantity: "7", coinSaleNeso: "7,000,000",
          equipment: [{ rowId: "a", name: "Arcane Umbra Hat", saleNeso: "25,000,000" }, { rowId: "b", name: "Arcane Umbra Cape", saleNeso: "" }],
          box: [{ rowId: "c", name: "Gold Ring Box", saleNeso: "8000001" }],
        },
        "member-2": { bossNeso: "3000000", box: [{ rowId: "d", name: "Silver Ring Box", saleNeso: "1,234,567" }, { rowId: "e", name: "Gold Ring Box", saleNeso: "" }] },
        "member-3": { powerCrystalAmount: "33" },
      },
    };
    const extra = {
      powerCrystalNesoRate: "1.1",
      carryoverEnabled: true,
      previousCarryoverByMemberId: { "member-1": "-500000", "member-2": "300000", "member-3": "200000", "member-4": "0" },
      extraRewards: [{ rowId: "x", memberId: "member-4", amountNeso: "999" }],
    };
    const { api, viaManual } = bothPaths({ apiClear, apiSaleNesoByDropId, apiInclude: DEFAULT_INCLUDE, manual, extra });
    expect(api.ok).toBe(true);
    expect(api.boxDrops).toHaveLength(3);
    expect(api.equipmentDrops).toHaveLength(2);
    expect(api.categoryTotals.powerCrystalAmount).toBe("308");
    expect(withoutDropIds(viaManual)).toEqual(withoutDropIds(api));
  });

  it("WILL: coin + FT Item (checked) + equipment, custom tax/share rules", () => {
    const partyOrder = PARTY;
    const apiClear = {
      clearId: "api-will-normal-6", boss: "WILL", bossDifficulty: "NORMAL", ascendantTier: "Glorious Ascendant", partyCount: 6,
      historyMemberIds: partyOrder, complete: true, excludedRewards: [],
      members: [
        apiMember("member-1", { bossNeso: "5000000", drops: [{ dropId: "w-coin", category: "COIN", name: "Arachno Coin", quantity: "4" }] }),
        apiMember("member-2", { ascendantNeso: "60000000", drops: [{ dropId: "w-ft", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" }] }),
        apiMember("member-3", { drops: [{ dropId: "w-eq", category: "EQUIPMENT", name: "Arcane Umbra Shoes", quantity: "1" }] }),
        apiMember("member-4"), apiMember("member-5"), apiMember("member-6", { powerCrystalAmount: "11" }),
      ],
    };
    const apiSaleNesoByDropId = { "w-coin": "20000000", "w-ft": "3000000", "w-eq": "17" };
    const manual = {
      boss: "WILL", difficulty: "NORMAL", partyOrder, include: { ...DEFAULT_INCLUDE, ftItem: true },
      entriesByMemberId: {
        "member-1": { bossNeso: "5000000", coinQuantity: "4", coinSaleNeso: "20000000" },
        "member-2": { ascendantNeso: "60000000", ftItemQuantity: "1", ftItemSaleNeso: "3000000" },
        "member-3": { equipment: [{ rowId: "1", name: "Arcane Umbra Shoes", saleNeso: "17" }] },
        "member-6": { powerCrystalAmount: "11" },
      },
    };
    const extra = { powerCrystalNesoRate: "1.1", taxPercentByMemberId: { "member-1": "50" }, sharePercentByMemberId: { "member-2": "25" } };
    const { api, viaManual } = bothPaths({ apiClear, apiSaleNesoByDropId, apiInclude: { ...DEFAULT_INCLUDE, ftItem: true }, manual, extra });
    expect(api.ok).toBe(true);
    expect(api.categoryTotals.ftItemSaleNeso).toBe("2850000");
    expect(withoutDropIds(viaManual)).toEqual(withoutDropIds(api));
  });

  it("SLIME: boss NESO + Ascendant + Box rows (API default include vs manual masked include)", () => {
    const partyOrder = PARTY.slice(0, 3);
    const apiClear = {
      clearId: "api-slime-chaos-3", boss: "SLIME", bossDifficulty: "CHAOS", ascendantTier: "Eternal Ascendant Chaos Guardian", partyCount: 3,
      historyMemberIds: partyOrder, complete: true, excludedRewards: [],
      members: [
        apiMember("member-1", { bossNeso: "9000000", drops: [{ dropId: "s-box-1", category: "EQUIPMENT", name: "Chaos Ring Box", quantity: "1" }, { dropId: "s-box-2", category: "EQUIPMENT", name: "Chaos Ring Box", quantity: "1" }] }),
        apiMember("member-2", { ascendantNeso: "70000001" }),
        apiMember("member-3"),
      ],
    };
    const manual = {
      boss: "SLIME", difficulty: "CHAOS", partyOrder, include: DEFAULT_INCLUDE,
      entriesByMemberId: {
        "member-1": { bossNeso: "9000000", box: [{ rowId: "1", name: "Chaos Ring Box", saleNeso: "4000000" }, { rowId: "2", name: "Chaos Ring Box", saleNeso: "" }] },
        "member-2": { ascendantNeso: "70000001" },
      },
    };
    const { api, viaManual } = bothPaths({ apiClear, apiSaleNesoByDropId: { "s-box-1": "4000000" }, apiInclude: DEFAULT_INCLUDE, manual, extra: { powerCrystalNesoRate: "1.1" } });
    expect(api.ok).toBe(true);
    expect(api.categoryTotals.boxSaleNeso).toBe("3800000");
    expect(withoutDropIds(viaManual)).toEqual(withoutDropIds(api));
  });
});

describe("buildManualClear -- numeric golden (#5)", () => {
  it("Hard Will, 6 members, only A entered", () => {
    const built = buildManualClear({
      boss: "WILL",
      difficulty: "HARD",
      partyOrder: PARTY,
      include: DEFAULT_INCLUDE,
      entriesByMemberId: { "member-1": { bossNeso: "30,000,000", ascendantNeso: "50,000,000", powerCrystalAmount: "110", coinQuantity: "2", coinSaleNeso: "10,000,000" } },
    });
    const result = calculateSettlement({ ...built.clear, partyOrder: PARTY, include: built.include, saleNesoByDropId: built.saleNesoByDropId, powerCrystalNesoRate: "1.1" });
    expect(result.ok).toBe(true);
    expect(result.total).toBe("89500100");
    expect(result.baseShare).toBe("14916683");
    expect(result.remainder).toBe(2);
    expect(result.transfers).toHaveLength(5);
    const transferSum = result.transfers.reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n);
    expect(transferSum.toString()).toBe(result.members[0].payment);
    expect(result.members[0].payment).toBe("74583416");
    expect(result.transfers.map((transfer) => transfer.amount)).toEqual(["14916684", "14916683", "14916683", "14916683", "14916683"]);
    expect(result.transfers.every((transfer) => transfer.fromMemberId === "member-1")).toBe(true);
  });
});
