// Builds and draws the "copy settlement as image" PNG (IMPL_PLAN_RAFFLE_
// VALUE_CLARITY_SHARE.md, C2). Split in two layers on purpose:
//  - buildSettlementShareModel(): pure data assembly (testable without a
//    canvas/DOM -- every number/string comes straight from `calculation`,
//    the same source SettlementResult.jsx renders, so the image and the
//    screen can never show different numbers).
//  - drawSettlementShareImage(): takes a 2D rendering context and draws the
//    model onto it. It only calls context methods (no document/canvas
//    creation), so it can be smoke-tested with a plain mock context under
//    vitest's "node" environment (no jsdom canvas polyfill available/
//    wanted -- no new npm dependency).
// renderSettlementShareImageBlob() is the browser-only glue (creates the
// actual <canvas>, calls toBlob) and is intentionally not unit-tested, the
// same way components/ShareImageButton.jsx's canvas/DOM glue isn't.

import { describeMemberSettlement, memberDisplayName, neso, pcPortionAmount, sumTransferAmounts } from "./uiText.js";

const SHARE_IMAGE_TITLE = "Raffle Settlement";
const SHARE_IMAGE_FOOTER = "lulumi-tools.com";
export const SHARE_IMAGE_WIDTH = 1200;

const PADDING = 40;
const FONT_FAMILY = "sans-serif";
const COLOR = {
  background: "#ffffff",
  heading: "#0f172a",
  accent: "#047857",
  muted: "#64748b",
  pay: "#b91c1c",
  receive: "#047857",
  transfer: "#0f172a",
};

/**
 * Assembles the plain-data drawing model for the settlement share image.
 * Every value is taken directly from `calculation` (the same object
 * SettlementResult.jsx renders) via the same shared uiText.js helpers the
 * on-screen UI uses, so the image can never drift from what's on screen.
 *
 * `context` carries display-only extras that aren't part of `calculation`
 * (the combined boss/difficulty label and the localized round timestamp);
 * all are optional and default to "".
 */
export function buildSettlementShareModel(calculation, memberMap, include, powerCrystalNesoRate, t, context = {}) {
  const { bossLabel = "", roundLocalText = "", roundUtcText = "" } = context;
  const roundLine = roundLocalText && roundUtcText
    ? t("raffle.targetRoundValue", { local: roundLocalText, utc: roundUtcText })
    : "";

  const summaryLines = [
    { label: t("raffle.total"), value: neso(calculation.total) },
    { label: t("raffle.distributionMembers"), value: String(calculation.memberCount) },
  ];
  if (include?.powerCrystal) {
    summaryLines.push({
      label: t("raffle.powerCrystalRate"),
      value: t("raffle.powerCrystalRatePrefix") + " " + powerCrystalNesoRate + " " + t("raffle.powerCrystalRateSuffix"),
    });
  }

  const memberRows = calculation.members.map((member) => {
    const settlement = describeMemberSettlement(member, { t, carryoverEnabled: calculation.carryoverEnabled });
    const pcAmount = pcPortionAmount(member);
    return {
      memberId: member.memberId,
      name: memberDisplayName(memberMap, member.memberId),
      gross: neso(member.gross),
      pcNote: pcAmount != null ? t("raffle.pcPortionNote", { amount: neso(pcAmount) }) : null,
      settlementKind: settlement.kind,
      settlementLabel: settlement.label,
      settlementAmount: settlement.amount != null ? neso(settlement.amount) : null,
    };
  });

  const transferRows = calculation.transfers.map((transfer) => ({
    from: memberDisplayName(memberMap, transfer.fromMemberId),
    to: memberDisplayName(memberMap, transfer.toMemberId),
    amount: neso(transfer.amount),
  }));

  return {
    title: SHARE_IMAGE_TITLE,
    bossLine: bossLabel,
    roundLine,
    summaryLines,
    baseShareLine: { label: t("raffle.baseShare"), value: neso(calculation.baseShare) },
    baseShareNote: t("raffle.baseShareNote"),
    actualTransferTotal: { label: t("raffle.actualTransferTotal"), value: neso(sumTransferAmounts(calculation.transfers)) },
    memberRows,
    transferRows,
    footer: SHARE_IMAGE_FOOTER,
  };
}

/** Computes the total canvas height needed to draw `model` (rows are bounded: <=6 members, <=n-1 transfers). */
export function measureSettlementShareImageHeight(model) {
  let height = PADDING;
  height += 44; // title
  if (model.bossLine) height += 30;
  if (model.roundLine) height += 26;
  height += 16;
  height += model.summaryLines.length * 30;
  height += 8;
  height += 32; // baseShare value line
  height += 22; // baseShare note line
  height += 30; // actual transfer total line
  height += 16;
  height += 30; // "members" section heading
  height += model.memberRows.reduce((sum, row) => sum + 26 + (row.pcNote ? 18 : 0), 0);
  height += 16;
  height += 30; // transfers section heading
  height += Math.max(model.transferRows.length, 1) * 26;
  height += 40; // footer
  return height;
}

function drawRow(ctx, { text, x, y, font, color, align = "left" }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.textAlign = "left";
}

/**
 * Draws `model` onto `ctx` (a CanvasRenderingContext2D, real or a smoke-test
 * mock exposing the same method names). Returns the canvas size used.
 */
export function drawSettlementShareImage(ctx, model, { width = SHARE_IMAGE_WIDTH } = {}) {
  const height = measureSettlementShareImageHeight(model);

  ctx.fillStyle = COLOR.background;
  ctx.fillRect(0, 0, width, height);

  let y = PADDING + 8;
  drawRow(ctx, { text: model.title, x: PADDING, y, font: `bold 32px ${FONT_FAMILY}`, color: COLOR.heading });
  y += 36;

  if (model.bossLine) {
    drawRow(ctx, { text: model.bossLine, x: PADDING, y, font: `bold 20px ${FONT_FAMILY}`, color: COLOR.accent });
    y += 30;
  }
  if (model.roundLine) {
    drawRow(ctx, { text: model.roundLine, x: PADDING, y, font: `15px ${FONT_FAMILY}`, color: COLOR.muted });
    y += 26;
  }

  y += 16;
  for (const line of model.summaryLines) {
    drawRow(ctx, { text: line.label + ": " + line.value, x: PADDING, y, font: `bold 18px ${FONT_FAMILY}`, color: COLOR.heading });
    y += 30;
  }

  y += 8;
  drawRow(ctx, { text: model.baseShareLine.label + ": " + model.baseShareLine.value, x: PADDING, y, font: `bold 22px ${FONT_FAMILY}`, color: COLOR.accent });
  y += 32;
  drawRow(ctx, { text: model.baseShareNote, x: PADDING, y, font: `13px ${FONT_FAMILY}`, color: COLOR.muted });
  y += 22;
  drawRow(ctx, {
    text: model.actualTransferTotal.label + ": " + model.actualTransferTotal.value,
    x: PADDING,
    y,
    font: `16px ${FONT_FAMILY}`,
    color: COLOR.heading,
  });
  y += 30;

  y += 16;
  drawRow(ctx, { text: "—", x: PADDING, y, font: `bold 18px ${FONT_FAMILY}`, color: COLOR.heading });
  y += 30;
  for (const row of model.memberRows) {
    drawRow(ctx, { text: row.name + " — " + row.gross, x: PADDING, y, font: `16px ${FONT_FAMILY}`, color: COLOR.heading });
    const settlementColor = row.settlementKind === "pays" ? COLOR.pay : row.settlementKind === "receives" ? COLOR.receive : COLOR.muted;
    const settlementText = row.settlementAmount ? row.settlementLabel + " " + row.settlementAmount : row.settlementLabel;
    drawRow(ctx, { text: settlementText, x: width - PADDING, y, font: `bold 16px ${FONT_FAMILY}`, color: settlementColor, align: "right" });
    y += 26;
    if (row.pcNote) {
      drawRow(ctx, { text: row.pcNote, x: PADDING, y, font: `13px ${FONT_FAMILY}`, color: COLOR.muted });
      y += 18;
    }
  }

  y += 16;
  drawRow(ctx, { text: "—", x: PADDING, y, font: `bold 18px ${FONT_FAMILY}`, color: COLOR.heading });
  y += 30;
  if (model.transferRows.length) {
    for (const transfer of model.transferRows) {
      drawRow(ctx, {
        text: transfer.from + " → " + transfer.to + "  " + transfer.amount,
        x: PADDING,
        y,
        font: `15px ${FONT_FAMILY}`,
        color: COLOR.transfer,
      });
      y += 26;
    }
  } else {
    y += 26;
  }

  drawRow(ctx, { text: model.footer, x: PADDING, y: height - 16, font: `13px ${FONT_FAMILY}`, color: COLOR.muted });

  return { width, height };
}

/** Deterministic PNG file name for a downloaded/fallback settlement share image. */
export function settlementShareFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `lulumi-tools_raffle-settlement_${year}-${month}-${day}.png`;
}

/**
 * Browser-only glue: creates a real <canvas>, draws `model` onto it, and
 * resolves with the resulting PNG Blob. Not unit-tested (requires a real
 * canvas 2D context, unavailable under vitest's jsdom-less "node"
 * environment without adding a new npm dependency); drawSettlementShareImage
 * above carries the tested drawing logic.
 */
export function renderSettlementShareImageBlob(model, options = {}) {
  const width = options.width || SHARE_IMAGE_WIDTH;
  const height = measureSettlementShareImageHeight(model);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("2d canvas context is not available"));
  }
  drawSettlementShareImage(ctx, model, { width });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}
