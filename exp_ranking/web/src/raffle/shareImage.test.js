import { describe, expect, it } from "vitest";
import ja from "../i18n/locales/ja.json";
import { calculateSettlement } from "./domain/settlement.js";
import { neso, settlementCategoryColumns, settlementMemberCategoryCell, signedNeso } from "./uiText.js";
import {
  SHARE_IMAGE_MAX_WIDTH,
  SHARE_IMAGE_WIDTH,
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

// R2/LULU-119: a mock ctx with a real (if approximate) measureText, so the
// layout math is exercised the same way it is against a real 2D context --
// column widths actually reflect relative text lengths, which is what lets
// the overlap check below be meaningful instead of trivially passing.
function makeMeasuringMockCtx() {
  const fillTextCalls = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "left",
    fillRect: () => {},
    strokeRect: () => {},
    measureText: (text) => ({ width: String(text).length * 7 }),
    fillText: (text, x, y) => {
      fillTextCalls.push({ text, x, y, align: ctx.textAlign, width: ctx.measureText(text).width });
    },
  };
  return { ctx, fillTextCalls };
}

/** [start, end] pixel interval actually covered by one drawn text call, accounting for textAlign (drawText always sets ctx.textAlign right before fillText -- see shareImage.js). */
function drawnTextInterval(call) {
  if (call.align === "right") return [call.x - call.width, call.x];
  if (call.align === "center") return [call.x - call.width / 2, call.x + call.width / 2];
  return [call.x, call.x + call.width];
}

/**
 * R2/LULU-119 regression test utility: machine-checks that every pair of
 * texts drawn at the exact same y (i.e. the same visual line/row) has
 * non-overlapping [xStart, xStart+measureTextWidth] intervals. This is the
 * literal defect report -- headers/values from adjacent columns overlapping
 * and becoming unreadable -- expressed as an assertion instead of a human
 * eyeballing a rendered PNG.
 */
function assertNoOverlapWithinAnyRow(fillTextCalls) {
  const byY = new Map();
  for (const call of fillTextCalls) {
    if (!call.text) continue;
    const list = byY.get(call.y) || [];
    list.push(call);
    byY.set(call.y, list);
  }
  for (const [y, calls] of byY) {
    const intervals = calls
      .map((call) => {
        const [start, end] = drawnTextInterval(call);
        return { start, end, text: call.text };
      })
      .sort((a, b) => a.start - b.start);
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      expect(
        current.start,
        `overlap at y=${y}: "${previous.text}" [${previous.start.toFixed(1)},${previous.end.toFixed(1)}] vs "${current.text}" [${current.start.toFixed(1)},${current.end.toFixed(1)}]`,
      ).toBeGreaterThanOrEqual(previous.end - 0.01);
    }
  }
}

describe("buildSettlementShareModel", () => {
  it("includes every member row and every transfer row", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);

    expect(model.memberRows.map((row) => row.name)).toEqual(["Alice", "Bob", "Cleo"]);
    expect(model.transferRows).toHaveLength(calculation.transfers.length);
    expect(calculation.transfers.length).toBeGreaterThan(0);
  });

  it("labels who pays/receives using the same rule as the settlement UI (describeMemberSettlement)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    const kinds = Object.fromEntries(model.memberRows.map((row) => [row.memberId, row.settlementKind]));
    expect(kinds).toEqual({ a: "pays", b: "receives", c: "receives" });
  });

  it("numbers match calculation exactly -- total/baseShare are not recomputed independently", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.summaryLines[0].value).toBe(neso(calculation.total));
    expect(model.baseShareLine.value).toBe(neso(calculation.baseShare));
  });

  it("states the PC conversion is included in the base-share label (C1 regression pin)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.baseShareLine.label).toContain("PC換算込み");
  });

  it("reuses the existing member/transfer breakdown section headings (no new locale keys for box headings)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.memberSectionTitle).toBe(t("raffle.memberBreakdown"));
    expect(model.transferSectionTitle).toBe(t("raffle.actualTransfers"));
  });

  it("no longer carries a baseShareNote field (retired per post-launch feedback round 2) or an actualTransferTotal field (retired per user instruction)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.baseShareNote).toBeUndefined();
    expect(model.actualTransferTotal).toBeUndefined();
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

// C4: the member section is a real table mirroring SettlementResult.jsx's
// member breakdown table (member / active category columns / gross /
// settlement), built from the same shared uiText.js helpers so the two
// tables can never disagree about columns or a member's cell value. Raffle
// history and assigned-share are intentionally excluded (user instruction).
describe("buildSettlementShareModel member table (C4)", () => {
  it("mirrors the on-screen member table's active category columns", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.memberCategoryColumns.map((column) => column.key)).toEqual(settlementCategoryColumns(include, t).map((column) => column.key));
  });

  it("excludes raffle-history and assigned-share from every member row", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    for (const row of model.memberRows) {
      expect(row).not.toHaveProperty("hasHistory");
      expect(row).not.toHaveProperty("assignedShare");
    }
  });

  it("attaches the non-transferable note only to the Power Crystal column header", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    const pcColumn = model.memberCategoryColumns.find((column) => column.key === "powerCrystal");
    expect(pcColumn.note).toBe(t("raffle.powerCrystalNonTransferable"));
    for (const column of model.memberCategoryColumns) {
      if (column.key !== "powerCrystal") expect(column.note).toBeNull();
    }
  });

  it("gives each member row one categoryCells entry per active column, matching settlementMemberCategoryCell exactly (no new computation)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    const aliceRow = model.memberRows.find((row) => row.memberId === "a");
    const aliceMember = calculation.members.find((member) => member.memberId === "a");
    const pcCell = aliceRow.categoryCells.find((cell) => cell.key === "powerCrystal");
    expect(pcCell).toEqual({ key: "powerCrystal", ...settlementMemberCategoryCell(aliceMember, "powerCrystal", { powerCrystalNesoRate: "1.2" }) });
    expect(pcCell.primary).toContain("100 PC");
    expect(pcCell.secondary).toContain("83");

    const bobRow = model.memberRows.find((row) => row.memberId === "b");
    const bossCell = bobRow.categoryCells.find((cell) => cell.key === "bossNeso");
    expect(bossCell).toEqual({ key: "bossNeso", primary: "0", secondary: null, zero: true });
  });
});

// LULU-103 C3: the receiver's wallet is now part of the share image itself
// (explicit user instruction, replacing the earlier "never put wallet in the
// copy result" rule) so the same notification-worthy detail is visible on
// both the screen and the shared image.
describe("buildSettlementShareModel transfer wallets (LULU-103 C3)", () => {
  it("attaches the receiver's own wallet to each transfer row", () => {
    const calculation = compositeCalculation();
    const wallet = "0xEE158FbBF3507A4a7e42C112e49725db4875a5b9";
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t, { memberWallets: { b: wallet, c: wallet } });
    expect(model.transferRows.length).toBeGreaterThan(0);
    for (const row of model.transferRows) expect(row.wallet).toBe(wallet);
  });

  it("falls back to the localized placeholder for a transfer row when the receiver's wallet is unknown", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.transferRows.length).toBeGreaterThan(0);
    for (const row of model.transferRows) expect(row.wallet).toBe(t("raffle.walletUnavailable"));
  });
});

describe("drawSettlementShareImage (smoke test)", () => {
  // No ctx.roundRect on this mock (mirrors real engines that predate it), so
  // drawRoundedRect() falls back to fillRect/strokeRect -- exercising both
  // the box-fill and box-border code paths without needing a real canvas.
  function makeMockCtx() {
    const calls = { fillRect: 0, strokeRect: 0, fillText: 0 };
    return {
      calls,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "left",
      fillRect: () => {
        calls.fillRect += 1;
      },
      strokeRect: () => {
        calls.strokeRect += 1;
      },
      fillText: () => {
        calls.fillText += 1;
      },
    };
  }

  // Like makeMockCtx, but also records every fillText call's (text, x) so
  // column-alignment assertions (C4/C5: "does every row draw its amount at
  // the same x") can inspect what was actually drawn.
  function makeTrackingMockCtx() {
    const fillTextCalls = [];
    return {
      fillTextCalls,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "left",
      fillRect: () => {},
      strokeRect: () => {},
      fillText: (text, x, y) => {
        fillTextCalls.push({ text, x, y });
      },
    };
  }

  it("draws without throwing, paints the canvas background, boxes every section, and bands every row", () => {
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
    // canvas background(1) + 3 section boxes(3) + 2 table header bands(2) +
    // 1 band per member row(3) + 1 pill per member row(3) + 1 band per
    // transfer row(>=1) -- a generous lower bound instead of an exact count
    // so minor layout tweaks don't make this test brittle.
    expect(ctx.calls.fillRect).toBeGreaterThanOrEqual(1 + 3 + 2 + model.memberRows.length * 2 + model.transferRows.length);
    // 3 section box borders (fallback strokeRect, no ctx.roundRect on this mock).
    expect(ctx.calls.strokeRect).toBeGreaterThanOrEqual(3);
    // title + boss + round + summary lines + baseShare + 2 section headings +
    // 2 table headers (member columns + transfer columns) + member-row cells
    // + transfer-row cells + footer.
    expect(ctx.calls.fillText).toBeGreaterThan(15);
  });

  it("draws without throwing when the mock ctx implements measureText (name truncation / amount positioning)", () => {
    const calculation = compositeCalculation();
    const wallet = "0xEE158FbBF3507A4a7e42C112e49725db4875a5b9";
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t, { memberWallets: { b: wallet, c: wallet } });
    const ctx = makeMockCtx();
    ctx.measureText = (text) => ({ width: text.length * 7 });

    expect(() => drawSettlementShareImage(ctx, model)).not.toThrow();
    expect(model.transferRows.some((row) => row.wallet === wallet)).toBe(true);
  });

  it("aligns every transfer row's amount at the same fixed x (C5: fixes amounts drifting out of column under the old packed-text layout)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.transferRows.length).toBeGreaterThan(1);
    const ctx = makeTrackingMockCtx();

    drawSettlementShareImage(ctx, model);

    const amountXs = new Set(
      ctx.fillTextCalls.filter((call) => model.transferRows.some((row) => row.amount === call.text)).map((call) => call.x),
    );
    expect(amountXs.size).toBe(1);
  });

  it("aligns every member row's gross value at the same fixed x regardless of name length (C4 table columns)", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.memberRows.length).toBeGreaterThan(1);
    const ctx = makeTrackingMockCtx();

    drawSettlementShareImage(ctx, model);

    const grossXs = new Set(
      ctx.fillTextCalls.filter((call) => model.memberRows.some((row) => row.gross === call.text)).map((call) => call.x),
    );
    expect(grossXs.size).toBe(1);
  });

  it("still draws (with a placeholder 'no transfers' line) when there are no transfers to show", () => {
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
    expect(model.noTransfersText).toBe(t("raffle.noTransfers"));
    const ctx = makeMockCtx();

    expect(() => drawSettlementShareImage(ctx, model)).not.toThrow();
  });
});

// LULU-119 follow-up round 2 (user adjustment B): the transfer table's 3
// columns are packed left-to-right at their own real measured content width
// instead of stretching to fill the box (which used to leave the amount
// column pushed toward the middle and the wallet column pinned at the box's
// far right edge regardless of how short the actual content was). The
// amount column keeps right-aligning its own text within its own (now
// content-tight) column, so digits still line up vertically across rows.
describe("transfer table column packing (LULU-119 follow-up round 2, user adjustment B)", () => {
  it("packs the 3 transfer columns at their real content width, leaving whitespace on the right instead of stretching to the box's right edge", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t, { memberWallets: { b: "0x1111111111111111111111111111111111aaaa", c: "0x1111111111111111111111111111111111aaaa" } });
    expect(model.transferRows.length).toBeGreaterThan(0);
    const { ctx, fillTextCalls } = makeMeasuringMockCtx();

    const size = drawSettlementShareImage(ctx, model);

    const walletCalls = fillTextCalls.filter((call) => model.transferRows.some((row) => row.wallet === call.text));
    expect(walletCalls.length).toBeGreaterThan(0);
    // align="right" -> call.x IS the drawn text's right edge.
    const rightmostWalletEdge = Math.max(...walletCalls.map((call) => call.x));
    // With short synthetic content (short display names, a fixed-length hex
    // wallet), the packed table ends well before the canvas's right edge --
    // under the old stretch-to-fill layout the wallet column's right edge
    // sat right at the box's right edge regardless of content length.
    expect(size.width - rightmostWalletEdge).toBeGreaterThan(300);
  });

  it("still right-aligns the amount column at a single fixed x across every row (digits stay vertically aligned) after packing", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.transferRows.length).toBeGreaterThan(1);
    const { ctx, fillTextCalls } = makeMeasuringMockCtx();

    drawSettlementShareImage(ctx, model);

    const amountXs = new Set(
      fillTextCalls.filter((call) => model.transferRows.some((row) => row.amount === call.text)).map((call) => call.x),
    );
    expect(amountXs.size).toBe(1);
  });

  it("keeps a modest, non-overlapping, non-zero gap between the amount and wallet columns", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t, {
      memberWallets: { b: "0x1111111111111111111111111111111111aaaa", c: "0x1111111111111111111111111111111111aaaa" },
    });
    expect(model.transferRows.length).toBeGreaterThan(0);
    const { ctx, fillTextCalls } = makeMeasuringMockCtx();

    drawSettlementShareImage(ctx, model);

    for (const row of model.transferRows) {
      const amountCall = fillTextCalls.find((call) => call.text === row.amount);
      const walletCall = fillTextCalls.find((call) => call.text === row.wallet);
      expect(amountCall).toBeTruthy();
      expect(walletCall).toBeTruthy();
      const amountRightEdge = amountCall.x; // align="right" -> x is the right edge.
      const walletLeftEdge = walletCall.x - walletCall.width; // align="right" -> x-width is the left edge.
      // Positive, modest gap (spec: "24-32px" example) -- not touching/
      // overlapping (already covered by assertNoOverlapWithinAnyRow
      // elsewhere), and not an unreasonably large empty stretch either.
      expect(walletLeftEdge - amountRightEdge).toBeGreaterThanOrEqual(15);
      expect(walletLeftEdge - amountRightEdge).toBeLessThanOrEqual(120);
    }
  });

  it("draws the column headers (payer/receiver, amount, wallet) at the same x positions as their row data", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    const { ctx, fillTextCalls } = makeMeasuringMockCtx();

    drawSettlementShareImage(ctx, model);

    const amountHeaderCall = fillTextCalls.find((call) => call.text === model.transferAmountLabel);
    const walletHeaderCall = fillTextCalls.find((call) => call.text === model.transferWalletLabel);
    expect(amountHeaderCall).toBeTruthy();
    expect(walletHeaderCall).toBeTruthy();
    const amountDataXs = new Set(fillTextCalls.filter((call) => model.transferRows.some((row) => row.amount === call.text)).map((call) => call.x));
    const walletDataXs = new Set(fillTextCalls.filter((call) => model.transferRows.some((row) => row.wallet === call.text)).map((call) => call.x));
    expect(amountDataXs.has(amountHeaderCall.x)).toBe(true);
    expect(walletDataXs.has(walletHeaderCall.x)).toBe(true);
  });
});

// LULU-119 follow-up (user report: 10 member-table columns made the shared
// image 1529px wide and hard to read). "Equipment drop" and "Will FT Item"
// are collapsed into one share-image-only "Other Sales" column (sale
// proceeds total only -- no quantity/icon/two-line breakdown). This is
// purely a shareImage.js assembly step: settlementCategoryColumns() /
// settlementMemberCategoryCell() in uiText.js are untouched (still return
// separate "equipment"/"ftItem"), so SettlementResult.jsx -- which builds
// its own category list independently and never calls
// settlementCategoryColumns() -- renders exactly as before (verified below
// and by the fact SettlementResult.jsx has zero diff in this change).
describe("buildSettlementShareModel Other Sales column (LULU-119 follow-up)", () => {
  function otherSalesCalculation(include) {
    const result = calculateSettlement({
      boss: "WILL",
      complete: true,
      historyMemberIds: ["a"],
      partyOrder: ["a", "b"],
      include,
      powerCrystalNesoRate: "1",
      saleNesoByDropId: { equip1: "1000", ft1: "2000" },
      members: [
        {
          memberId: "a",
          bossNeso: "0",
          powerCrystalAmount: "0",
          ascendantNeso: "0",
          drops: [
            { dropId: "equip1", category: "EQUIPMENT", name: "Gear", quantity: "1" },
            { dropId: "ft1", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" },
          ],
        },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      ],
    });
    expect(result.ok).toBe(true);
    return result;
  }

  it("does not change uiText.js's shared settlementCategoryColumns/settlementMemberCategoryCell -- they still return separate equipment/ftItem keys", () => {
    const include = { coin: false, equipment: true, ftItem: true, bossNeso: false, powerCrystal: false, ascendantNeso: false };
    expect(settlementCategoryColumns(include, t).map((column) => column.key)).toEqual(["equipment", "ftItem"]);
  });

  it("collapses equipment+ftItem into one otherSales column (BigInt sum, no new rounding) when both are included", () => {
    const include = { coin: false, equipment: true, ftItem: true, bossNeso: false, powerCrystal: false, ascendantNeso: false };
    const calculation = otherSalesCalculation(include);
    const model = buildSettlementShareModel(calculation, memberMap, include, "1", t);

    expect(model.memberCategoryColumns.map((column) => column.key)).toEqual(["otherSales"]);
    expect(model.memberCategoryColumns[0].label).toBe(t("raffle.otherSales"));
    const aliceMember = calculation.members.find((member) => member.memberId === "a");
    const expectedTotal = BigInt(aliceMember.equipmentSaleNeso) + BigInt(aliceMember.ftItemSaleNeso);
    const aliceRow = model.memberRows.find((row) => row.memberId === "a");
    const cell = aliceRow.categoryCells.find((entry) => entry.key === "otherSales");
    expect(cell).toEqual({ key: "otherSales", primary: neso(expectedTotal.toString()), secondary: null, zero: false });
  });

  it("shows the otherSales column when only one of equipment/ftItem is included", () => {
    const equipmentOnly = { coin: false, equipment: true, ftItem: false, bossNeso: false, powerCrystal: false, ascendantNeso: false };
    const equipmentModel = buildSettlementShareModel(otherSalesCalculation(equipmentOnly), memberMap, equipmentOnly, "1", t);
    expect(equipmentModel.memberCategoryColumns.map((column) => column.key)).toEqual(["otherSales"]);

    const ftItemOnly = { coin: false, equipment: false, ftItem: true, bossNeso: false, powerCrystal: false, ascendantNeso: false };
    const ftItemModel = buildSettlementShareModel(otherSalesCalculation(ftItemOnly), memberMap, ftItemOnly, "1", t);
    expect(ftItemModel.memberCategoryColumns.map((column) => column.key)).toEqual(["otherSales"]);
  });

  it("omits the otherSales column entirely when neither equipment nor ftItem is included", () => {
    const include = { coin: true, equipment: false, ftItem: false, bossNeso: false, powerCrystal: false, ascendantNeso: false };
    const model = buildSettlementShareModel(otherSalesCalculation(include), memberMap, include, "1", t);
    expect(model.memberCategoryColumns.map((column) => column.key)).toEqual(["coin"]);
  });

  it("shows a dimmed 0 (not the coin/equipment quantity style) for a member with no other-sales drops", () => {
    const include = { coin: false, equipment: true, ftItem: true, bossNeso: false, powerCrystal: false, ascendantNeso: false };
    const model = buildSettlementShareModel(otherSalesCalculation(include), memberMap, include, "1", t);
    const bobRow = model.memberRows.find((row) => row.memberId === "b");
    const cell = bobRow.categoryCells.find((entry) => entry.key === "otherSales");
    expect(cell).toEqual({ key: "otherSales", primary: "0", secondary: null, zero: true });
  });
});

// LULU-119 follow-up round 2 (user adjustment A): the standalone
// next-carryover block is retired again -- next carryover is back as the
// member table's rightmost column, shown for every member (including "0"
// for members with nothing carried, since it's a table row now, not a
// filtered list). Previous carryover stays hidden (not restored). Same
// value/sign as the on-screen carryover badge (SettlementResult.jsx) via the
// shared signedNeso helper -- never recomputed independently, so the two can
// never disagree.
describe("buildSettlementShareModel next-carryover column (LULU-119 follow-up round 2)", () => {
  function carryoverCalculation(previousCarryoverByMemberId) {
    const result = calculateSettlement({
      boss: "LUCID",
      complete: true,
      historyMemberIds: ["a"],
      partyOrder: ["a", "b"],
      include: { coin: false, equipment: false, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      powerCrystalNesoRate: "1",
      saleNesoByDropId: {},
      carryoverEnabled: true,
      previousCarryoverByMemberId,
      members: [
        { memberId: "a", bossNeso: "50", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      ],
    });
    expect(result.ok).toBe(true);
    return result;
  }

  it("does not add a previousCarryover column/field anywhere (stays hidden)", () => {
    const calculation = carryoverCalculation({ a: "-50", b: "50" });
    const model = buildSettlementShareModel(calculation, memberMap, { bossNeso: true }, "1", t);
    expect(model.memberCategoryColumns.map((column) => column.key)).not.toContain("previousCarryover");
    for (const row of model.memberRows) {
      expect(row).not.toHaveProperty("previousCarryover");
    }
  });

  it("marks carryoverEnabled and gives every member row a nextCarryover value, with the same value/sign as the shared signedNeso helper", () => {
    const calculation = carryoverCalculation({ a: "-50", b: "50" });
    const model = buildSettlementShareModel(calculation, memberMap, { bossNeso: true }, "1", t);
    expect(model.carryoverEnabled).toBe(true);
    expect(model.nextCarryoverColumnLabel).toBe(t("raffle.nextCarryover"));
    expect(model.memberRows).toHaveLength(calculation.members.length);
    for (const member of calculation.members) {
      const row = model.memberRows.find((entry) => entry.memberId === member.memberId);
      expect(row.nextCarryover).toBe(signedNeso(member.nextCarryover));
    }
  });

  it("shows a member row with nextCarryover \"0 NESO\" (not omitted) when their next carryover settled to exactly 0", () => {
    // Balanced two-member party with equal previous carryovers cancels out
    // to next carryover 0 for both -- both must still appear as table rows.
    const calculation = carryoverCalculation({ a: "0", b: "0" });
    const model = buildSettlementShareModel(calculation, memberMap, { bossNeso: true }, "1", t);
    for (const member of calculation.members) expect(member.nextCarryover).toBe("0");
    expect(model.memberRows).toHaveLength(2);
    for (const row of model.memberRows) expect(row.nextCarryover).toBe(signedNeso("0"));
  });

  it("has carryoverEnabled false and null nextCarryover on every row when carryover is not enabled", () => {
    const calculation = compositeCalculation();
    const model = buildSettlementShareModel(calculation, memberMap, include, "1.2", t);
    expect(model.carryoverEnabled).toBe(false);
    for (const row of model.memberRows) expect(row.nextCarryover).toBeNull();
  });

  it("draws a nextCarryover column (header + every member's value, including 0) only when carryoverEnabled, at a single fixed x per row set", () => {
    const withCarryover = carryoverCalculation({ a: "-50", b: "50" });
    const modelWithCarryover = buildSettlementShareModel(withCarryover, memberMap, { bossNeso: true }, "1", t);
    const fillTextCalls = [];
    const ctx = { fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "left", fillRect: () => {}, strokeRect: () => {}, fillText: (text, x, y) => fillTextCalls.push({ text, x, y }) };

    expect(() => drawSettlementShareImage(ctx, modelWithCarryover)).not.toThrow();
    expect(fillTextCalls.some((call) => call.text === modelWithCarryover.nextCarryoverColumnLabel)).toBe(true);
    const carryoverXs = new Set(
      fillTextCalls.filter((call) => modelWithCarryover.memberRows.some((row) => row.nextCarryover === call.text)).map((call) => call.x),
    );
    expect(carryoverXs.size).toBe(1);

    const withoutCarryover = compositeCalculation();
    const modelWithoutCarryover = buildSettlementShareModel(withoutCarryover, memberMap, include, "1.2", t);
    const noCarryoverFillTextCalls = [];
    const noCarryoverCtx = { fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "left", fillRect: () => {}, strokeRect: () => {}, fillText: (text, x, y) => noCarryoverFillTextCalls.push({ text, x, y }) };
    drawSettlementShareImage(noCarryoverCtx, modelWithoutCarryover);
    expect(noCarryoverFillTextCalls.some((call) => call.text === modelWithoutCarryover.nextCarryoverColumnLabel)).toBe(false);
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

// R2/LULU-119 code review, then LULU-119 follow-up (equipment+ftItem
// collapsed into "Other Sales", carryover moved out of the member table
// entirely): the member table now tops out at 8 columns for even the
// maximal configuration (member / bossNeso / powerCrystal / ascendantNeso /
// coin / otherSales / gross / settlement), which fits the default 1200px
// canvas without needing to grow -- unlike the pre-follow-up 10-column
// layout that reached 1529px. This suite pins non-overlap (still using real,
// measured text metrics) for the minimal, standard-8-column, and maximal
// (all categories + carryover enabled + FT Item + 6 members) configurations.
describe("member table column widths never overlap (R2/LULU-119, updated for the column-reduction follow-up)", () => {
  const minimalMemberMap = { a: { displayName: "Alice" } };

  function minimalCalculation() {
    const result = calculateSettlement({
      boss: "LUCID",
      complete: true,
      historyMemberIds: ["a"],
      partyOrder: ["a"],
      include: { bossNeso: true, powerCrystal: false, ascendantNeso: false, coin: false, equipment: false, ftItem: false },
      members: [{ memberId: "a", bossNeso: "1234567890123", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] }],
    });
    expect(result.ok).toBe(true);
    return result;
  }

  // Representative "typical week" numbers/names (matching the sizes already
  // used elsewhere in this test suite / settlement.test.js), not a stress
  // case -- this pins that the common configuration keeps looking the same
  // as before F2/F3 (no visual regression), unlike the ③ max/stress case
  // below which intentionally uses long names and large amounts.
  const standardMemberMap = {
    a: { displayName: "Alice" },
    b: { displayName: "Bob" },
    c: { displayName: "Cleo" },
  };

  function standardCalculation() {
    const result = calculateSettlement({
      boss: "WILL",
      complete: true,
      historyMemberIds: ["a"],
      partyOrder: ["a", "b", "c"],
      include: { bossNeso: true, powerCrystal: true, ascendantNeso: true, coin: true, equipment: true, ftItem: false },
      powerCrystalNesoRate: "1.1",
      saleNesoByDropId: { coin1: "100000", equip1: "300000" },
      members: [
        {
          memberId: "a",
          bossNeso: "9000000",
          powerCrystalAmount: "100000000",
          ascendantNeso: "12000000",
          drops: [
            { dropId: "coin1", category: "COIN", name: "Arachno Coin", quantity: "10" },
            { dropId: "equip1", category: "EQUIPMENT", name: "AbsoLab Knight Suit", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/1003172.png" },
          ],
        },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
        { memberId: "c", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      ],
    });
    expect(result.ok).toBe(true);
    return result;
  }

  // Realistic max configuration (acceptance criterion): every category
  // (incl. FT Item) + carryover enabled + 6 members, with a "typical week"
  // magnitude of names/numbers (the same style as ② standard, not an
  // artificial digit-count stress case -- see stressCalculation() below for
  // that). Member "b" earns only Power Crystal (non-transferable), the same
  // proven pattern as settlement.test.js's "carries Power Crystal-only
  // liabilities" case, which deterministically leaves a non-zero next
  // carryover without needing an artificially large previousCarryover input.
  const maxMemberMap = {
    a: { displayName: "Alice" },
    b: { displayName: "Bob" },
    c: { displayName: "Cleo" },
    d: { displayName: "Dana" },
    e: { displayName: "Eve" },
    f: { displayName: "Finn" },
  };

  function maxCalculation() {
    const memberIds = ["a", "b", "c", "d", "e", "f"];
    const result = calculateSettlement({
      boss: "WILL",
      complete: true,
      historyMemberIds: memberIds,
      partyOrder: memberIds,
      include: { bossNeso: true, powerCrystal: true, ascendantNeso: true, coin: true, equipment: true, ftItem: true },
      powerCrystalNesoRate: "1.1",
      carryoverEnabled: true,
      previousCarryoverByMemberId: Object.fromEntries(memberIds.map((memberId) => [memberId, "0"])),
      saleNesoByDropId: { coin1: "100000", equip1: "300000", ft1: "500000" },
      members: memberIds.map((memberId) => {
        if (memberId === "a") {
          return {
            memberId,
            bossNeso: "9000000",
            powerCrystalAmount: "0",
            ascendantNeso: "12000000",
            drops: [
              { dropId: "coin1", category: "COIN", name: "Arachno Coin", quantity: "10" },
              { dropId: "equip1", category: "EQUIPMENT", name: "AbsoLab Knight Suit", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/1003172.png" },
              { dropId: "ft1", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" },
            ],
          };
        }
        if (memberId === "b") {
          return { memberId, bossNeso: "0", powerCrystalAmount: "100000000", ascendantNeso: "0", drops: [] };
        }
        return { memberId, bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] };
      }),
    });
    expect(result.ok).toBe(true);
    return result;
  }

  const stressMemberMap = {
    a: { displayName: "Alexandrina Moonwhisper" },
    b: { displayName: "Bartholomew" },
    c: { displayName: "Cleopatra Nightblade" },
    d: { displayName: "Dmitri" },
    e: { displayName: "Evangelina Frostheart" },
    f: { displayName: "Fitzgerald" },
  };

  // Deliberately extreme names/numbers (not a realistic week): this is only
  // to pin that overlap-safety and full-digit-integrity hold even under
  // adversarial input -- the growth-past-1200px math it exercises is
  // unchanged by this follow-up (still real ctx.measureText, still no
  // truncation/rounding of primary figures), so no exact-width assertion
  // here (unlike ③ below, which is the literal acceptance criterion for a
  // realistic maximal configuration).
  function stressCalculation() {
    const memberIds = ["a", "b", "c", "d", "e", "f"];
    const result = calculateSettlement({
      boss: "WILL",
      complete: true,
      historyMemberIds: memberIds,
      partyOrder: memberIds,
      include: { bossNeso: true, powerCrystal: true, ascendantNeso: true, coin: true, equipment: true, ftItem: true },
      powerCrystalNesoRate: "1.1",
      carryoverEnabled: true,
      previousCarryoverByMemberId: { a: "-123456789", b: "123456789", c: "0", d: "0", e: "0", f: "0" },
      saleNesoByDropId: { coin1: "250000000", equip1: "9000000000", ft1: "1000000000" },
      members: memberIds.map((memberId) => memberId === "a"
        ? {
            memberId,
            bossNeso: "123456789",
            powerCrystalAmount: "999999999",
            ascendantNeso: "87654321",
            drops: [
              { dropId: "coin1", category: "COIN", name: "Arachno Coin", quantity: "123456" },
              { dropId: "equip1", category: "EQUIPMENT", name: "AbsoLab Knight Suit", quantity: "1", imageUrl: "https://api-static.msu.io/itemimages/icon/1003172.png" },
              { dropId: "ft1", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" },
            ],
          }
        : { memberId, bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] }),
    });
    expect(result.ok).toBe(true);
    return result;
  }

  it("① minimal configuration (1 category column, no carryover) draws with no overlapping cells", () => {
    const calculation = minimalCalculation();
    const model = buildSettlementShareModel(calculation, minimalMemberMap, { bossNeso: true }, "1", t);
    const { ctx, fillTextCalls } = makeMeasuringMockCtx();

    const size = drawSettlementShareImage(ctx, model);

    assertNoOverlapWithinAnyRow(fillTextCalls);
    // No column growth needed for the minimal configuration -- default width.
    expect(size.width).toBe(SHARE_IMAGE_WIDTH);
  });

  // LULU-119 follow-up acceptance criterion: member / bossNeso / powerCrystal
  // / ascendantNeso / coin / otherSales / gross / settlement = 8 columns
  // fits the default 1200px canvas.
  it("② standard 8-column configuration (member/bossNeso/powerCrystal/ascendantNeso/coin/otherSales/gross/settlement, no carryover) draws with no overlapping cells and keeps the default 1200px canvas (no visual regression for the common case)", () => {
    const calculation = standardCalculation();
    const include5 = { bossNeso: true, powerCrystal: true, ascendantNeso: true, coin: true, equipment: true };
    const model = buildSettlementShareModel(calculation, standardMemberMap, include5, "1.1", t);
    expect(model.memberCategoryColumns.map((column) => column.key)).toEqual(["bossNeso", "powerCrystal", "ascendantNeso", "coin", "otherSales"]);
    // member + 5 category columns + gross + settlement = 8 total columns.
    expect(model.memberCategoryColumns).toHaveLength(5);
    const { ctx, fillTextCalls } = makeMeasuringMockCtx();

    const size = drawSettlementShareImage(ctx, model);

    assertNoOverlapWithinAnyRow(fillTextCalls);
    expect(size.width).toBe(SHARE_IMAGE_WIDTH);
  });

  it("\u2462 maximal configuration (all categories incl. FT Item + carryover enabled -> 9 member-table columns, 6 members) draws with no overlapping cells", () => {
    const calculation = maxCalculation();
    const include6 = { bossNeso: true, powerCrystal: true, ascendantNeso: true, coin: true, equipment: true, ftItem: true };
    const model = buildSettlementShareModel(calculation, maxMemberMap, include6, "1.1", t);
    // otherSales collapses equipment+ftItem: 5 category columns, not 6.
    expect(model.memberCategoryColumns.map((column) => column.key)).toEqual(["bossNeso", "powerCrystal", "ascendantNeso", "coin", "otherSales"]);
    // LULU-119 follow-up round 2: next carryover is back as the member
    // table's rightmost (9th) column -- member "b" (Power-Crystal-only) has
    // a non-zero next carryover in this fixture, covering its overlap-safety.
    expect(model.carryoverEnabled).toBe(true);
    expect(model.memberRows.some((row) => row.nextCarryover !== signedNeso("0"))).toBe(true);
    const { ctx, fillTextCalls } = makeMeasuringMockCtx();

    const size = drawSettlementShareImage(ctx, model);

    assertNoOverlapWithinAnyRow(fillTextCalls);
    // With carryover restored as a 9th member-table column, this realistic
    // maximal configuration grows past the default 1200px (the user
    // explicitly accepted automatic growth for this case) -- see the
    // "reports the actual canvas width" test below for the pinned number.
    expect(size.width).toBeGreaterThanOrEqual(SHARE_IMAGE_WIDTH);
    // Every primary settlement figure is still drawn in full (no
    // truncation/rounding of money).
    for (const row of model.memberRows) {
      const primaryTexts = row.categoryCells.map((cell) => cell.primary).filter(Boolean);
      for (const text of primaryTexts) {
        expect(fillTextCalls.some((call) => call.text === text)).toBe(true);
      }
    }
  });

  it("reports the actual canvas width used for the maximal configuration (for code-review verification)", () => {
    const calculation = maxCalculation();
    const include6 = { bossNeso: true, powerCrystal: true, ascendantNeso: true, coin: true, equipment: true, ftItem: true };
    const model = buildSettlementShareModel(calculation, maxMemberMap, include6, "1.1", t);
    const { ctx } = makeMeasuringMockCtx();

    const size = drawSettlementShareImage(ctx, model);

    // Pinned measured value (LULU-119 follow-up round 2): 9 member-table
    // columns (member/bossNeso/powerCrystal/ascendantNeso/coin/otherSales/
    // gross/settlement/nextCarryover) need more than the default 1200px;
    // still comfortably within the SHARE_IMAGE_MAX_WIDTH guideline.
    expect(size.width).toBe(1288);
    expect(size.width).toBeGreaterThan(SHARE_IMAGE_WIDTH);
    expect(size.width).toBeLessThanOrEqual(SHARE_IMAGE_MAX_WIDTH);
  });

  // Retained from the original R2 fix: even deliberately extreme names/
  // numbers (not a realistic week) must never overlap, and every primary
  // figure must still be shown in full -- growing the canvas past 1200px
  // (up to the SHARE_IMAGE_MAX_WIDTH guideline, and beyond only if truly
  // unavoidable) instead of ever truncating/rounding a settlement amount.
  it("extreme/stress configuration (long names, very large amounts) still draws with no overlapping cells and no truncated primary figures", () => {
    const calculation = stressCalculation();
    const include6 = { bossNeso: true, powerCrystal: true, ascendantNeso: true, coin: true, equipment: true, ftItem: true };
    const model = buildSettlementShareModel(calculation, stressMemberMap, include6, "1.1", t);
    const { ctx, fillTextCalls } = makeMeasuringMockCtx();

    const size = drawSettlementShareImage(ctx, model);

    assertNoOverlapWithinAnyRow(fillTextCalls);
    for (const row of model.memberRows) {
      const primaryTexts = row.categoryCells.map((cell) => cell.primary).filter(Boolean);
      for (const text of primaryTexts) {
        expect(fillTextCalls.some((call) => call.text === text)).toBe(true);
      }
    }
    expect(size.width).toBeGreaterThanOrEqual(SHARE_IMAGE_WIDTH);
  });
});
