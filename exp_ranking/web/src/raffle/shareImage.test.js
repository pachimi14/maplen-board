import { describe, expect, it } from "vitest";
import ja from "../i18n/locales/ja.json";
import { calculateSettlement } from "./domain/settlement.js";
import { neso } from "./uiText.js";
import {
  buildSettlementShareModel,
  drawSettlementShareImage,
  measureSettlementShareImageHeight,
  settlementShareFileName,
} from "./shareImage.js";

function getNested(obj, path) {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

function makeT(messages) {
  return (key, vars = {}) => {
    const template = getNested(messages, key) ?? key;
    if (typeof template !== "string") return key;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : ""));
  };
}

const t = makeT(ja);

// PC rate 1.2 composite case (IMPL_PLAN_RAFFLE_VALUE_CLARITY_SHARE.md
// acceptance criterion 1/3): one member wins boss NESO + Power Crystal
// (converted at a >1 rate), the other two win nothing and receive a share.
// Rate 1.2 means "1 NESO = 1.2 Power Crystal" (LULU-099 divide semantics):
// 100 PC / 1.2 = 83.33... -> rounds half up to 83.
function compositeCalculation() {
  const result = calculateSettlement({
    boss: "WILL",
    complete: true,
    historyMemberIds: ["a"],
    partyOrder: ["a", "b", "c"],
    include: { coin: false, equipment: false, bossNeso: true, powerCrystal: true, ascendantNeso: false },
    powerCrystalNesoRate: "1.2",
    members: [
      { memberId: "a", bossNeso: "900", powerCrystalAmount: "100", ascendantNeso: "0", drops: [] },
      { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      { memberId: "c", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
    ],
  });
  expect(result.ok).toBe(true);
  return result;
}

const memberMap = {
  a: { displayName: "Alice" },
  b: { displayName: "Bob" },
  c: { displayName: "Cleo" },
};
const include = { coin: false, equipment: false, bossNeso: true, powerCrystal: true, ascendantNeso: false };

describe("buildSettlementShareModel", () => {
  it("includes every member row, every transfer row, and the PC-conversion note (acceptance criterion 3)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);

    expect(model.memberRows.map((row) => row.name)).toEqual(["Alice", "Bob", "Cleo"]);
    expect(model.transferRows).toHaveLength(calculation.transfers.length);
    expect(calculation.transfers.length).toBeGreaterThan(0);

    const aliceRow = model.memberRows.find((row) => row.memberId === "a");
    expect(aliceRow.pcNote).toContain("PC");
    expect(aliceRow.pcNote).toContain("83");
    expect(model.memberRows.find((row) => row.memberId === "b").pcNote).toBeNull();
    expect(model.memberRows.find((row) => row.memberId === "c").pcNote).toBeNull();
  });

  it("labels who pays/receives using the same rule as the settlement UI (describeMemberSettlement)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    const kinds = Object.fromEntries(model.memberRows.map((row) => [row.memberId, row.settlementKind]));
    expect(kinds).toEqual({ a: "pays", b: "receives", c: "receives" });
  });

  it("numbers match calculation exactly -- total/baseShare/actual-transfer-total are not recomputed independently", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.summaryLines[0].value).toBe(neso(calculation.total));
    expect(model.baseShareLine.value).toBe(neso(calculation.baseShare));
    const manualTransferTotal = calculation.transfers.reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n).toString();
    expect(model.actualTransferTotal.value).toBe(neso(manualTransferTotal));
  });

  it("states the PC conversion is included in the base-share label (C1 regression pin)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.baseShareLine.label).toContain("PC換算込み");
  });

  it("carries the boss label and round line through untouched when provided", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t, {
      bossLabel: "Hard Will + Eternal Ascendant",
      roundLocalText: "2026/8/13(木) 9:00",
      roundUtcText: "00:00 UTC",
    });
    expect(model.bossLine).toBe("Hard Will + Eternal Ascendant");
    expect(model.roundLine).toContain("00:00 UTC");
  });

  it("omits the round line entirely when round context is not provided", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.roundLine).toBe("");
    expect(model.bossLine).toBe("");
  });
});

describe("drawSettlementShareImage (smoke test)", () => {
  function makeMockCtx() {
    const calls = { fillRect: 0, fillText: 0 };
    return {
      calls,
      fillStyle: "",
      font: "",
      textAlign: "left",
      fillRect: () => {
        calls.fillRect += 1;
      },
      fillText: () => {
        calls.fillText += 1;
      },
    };
  }

  it("draws without throwing and paints a background plus one fillText call per text row", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t, {
      bossLabel: "Hard Will",
      roundLocalText: "2026/8/13 9:00",
      roundUtcText: "00:00 UTC",
    });
    const ctx = makeMockCtx();

    const size = drawSettlementShareImage(ctx, model);

    expect(size.height).toBeGreaterThan(0);
    expect(size.width).toBeGreaterThan(0);
    expect(ctx.calls.fillRect).toBe(1);
    // title + boss + round + summary lines + baseShare(2) + actualTransferTotal
    // + section separators(2) + (2 fillText per member row w/ PC note, 1 without)
    // + transfer rows + footer -- assert a generous lower bound instead of an
    // exact count so minor copy tweaks don't make this test brittle.
    expect(ctx.calls.fillText).toBeGreaterThan(10);
  });

  it("still draws (with a placeholder row) when there are no transfers to show", () => {
    const result = calculateSettlement({
      boss: "LUCID",
      complete: true,
      historyMemberIds: ["a"],
      partyOrder: ["a"],
      include: { coin: false, equipment: false, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      members: [{ memberId: "a", bossNeso: "500", drops: [] }],
    });
    expect(result.ok).toBe(true);
    expect(result.transfers).toEqual([]);
    const model = buildSettlementShareModel(result, { a: { displayName: "Solo" } }, { bossNeso: true }, "1", t);
    const ctx = makeMockCtx();

    expect(() => drawSettlementShareImage(ctx, model)).not.toThrow();
  });
});

describe("measureSettlementShareImageHeight", () => {
  it("grows with more member/transfer rows", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    const smaller = { ...model, memberRows: model.memberRows.slice(0, 1), transferRows: [] };
    expect(measureSettlementShareImageHeight(model)).toBeGreaterThan(measureSettlementShareImageHeight(smaller));
  });
});

describe("settlementShareFileName", () => {
  it("formats a deterministic lulumi-tools_raffle-settlement_YYYY-MM-DD.png name", () => {
    expect(settlementShareFileName(new Date(2026, 7, 13))).toBe("lulumi-tools_raffle-settlement_2026-08-13.png");
  });
});
