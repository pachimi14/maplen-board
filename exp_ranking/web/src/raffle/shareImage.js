// Builds and draws the "copy settlement as image" PNG (IMPL_PLAN_RAFFLE_
// VALUE_CLARITY_SHARE.md C2, polished per post-launch user feedback --
// "character name and the transfer amount are far apart" / "please box the
// sections with a light background"). Split in three layers on purpose:
//  - buildSettlementShareModel(): pure data assembly (testable without a
//    canvas/DOM -- every number/string comes straight from `calculation`,
//    the same source SettlementResult.jsx renders, so the image and the
//    screen can never show different numbers).
//  - layoutSections(): pure arithmetic (no ctx) that turns the model into
//    absolute box/row/text positions plus the total canvas height. Both
//    measureSettlementShareImageHeight() and drawSettlementShareImage()
//    delegate to this single function so the measured height and the
//    drawn content can never drift apart from each other.
//  - drawSettlementShareImage(): takes a 2D rendering context and issues
//    only context methods (no document/canvas creation), so it can be
//    smoke-tested with a plain mock context under vitest's "node"
//    environment (no jsdom canvas polyfill available/wanted -- no new npm
//    dependency).
// renderSettlementShareImageBlob() is the browser-only glue (creates the
// actual <canvas>, calls toBlob) and is intentionally not unit-tested, the
// same way components/ShareImageButton.jsx's canvas/DOM glue isn't.

import { describeMemberSettlement, memberDisplayName, neso, pcPortionAmount, resolveMemberWallet, sumTransferAmounts } from "./uiText.js";

const SHARE_IMAGE_TITLE = "Raffle Settlement";
const SHARE_IMAGE_FOOTER = "lulumi-tools.com";
export const SHARE_IMAGE_WIDTH = 1200;

const PADDING = 40;
const BOX_PADDING = 20;
const BOX_RADIUS = 12;
const BOX_GAP = 20;
const MEMBER_ROW_HEIGHT = 56;
const TRANSFER_ROW_HEIGHT = 40;
const PILL_HEIGHT = 30;
const FONT_FAMILY = "sans-serif";

const COLOR = {
  background: "#ffffff",
  boxFill: "#f8fafc",
  boxBorder: "#e2e8f0",
  bandWhite: "#ffffff",
  bandAlt: "#f1f5f9",
  heading: "#0f172a",
  accent: "#047857",
  muted: "#64748b",
  transfer: "#0f172a",
};

const PILL_COLOR = {
  pays: { bg: "#fff1f2", text: "#be123c" },
  receives: { bg: "#ecfdf5", text: "#047857" },
  settled: { bg: "#f1f5f9", text: "#475569" },
};

/**
 * Assembles the plain-data drawing model for the settlement share image.
 * Every value is taken directly from `calculation` (the same object
 * SettlementResult.jsx renders) via the same shared uiText.js helpers the
 * on-screen UI uses, so the image can never drift from what's on screen.
 *
 * `context` carries display-only extras that aren't part of `calculation`
 * (the combined boss/difficulty label, the localized round timestamp, and
 * `memberWallets` for the transfer rows' receiver wallet -- LULU-103 C3:
 * including the wallet in the shared image is explicit user instruction,
 * replacing the earlier "never put wallet in the copy result" rule); all are
 * optional and default to "" / {}.
 */
export function buildSettlementShareModel(calculation, memberMap, include, powerCrystalNesoRate, t, context = {}) {
  const { bossLabel = "", roundLocalText = "", roundUtcText = "", memberWallets = {} } = context;
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
      grossLabel: t("raffle.grossWon"),
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
    wallet: resolveMemberWallet(memberWallets, transfer.toMemberId) || t("raffle.walletUnavailable"),
  }));

  return {
    title: SHARE_IMAGE_TITLE,
    bossLine: bossLabel,
    roundLine,
    summaryLines,
    baseShareLine: { label: t("raffle.baseShare"), value: neso(calculation.baseShare) },
    actualTransferTotal: { label: t("raffle.actualTransferTotal"), value: neso(sumTransferAmounts(calculation.transfers)) },
    memberSectionTitle: t("raffle.memberBreakdown"),
    memberRows,
    transferSectionTitle: t("raffle.actualTransfers"),
    transferRows,
    noTransfersText: t("raffle.noTransfers"),
    footer: SHARE_IMAGE_FOOTER,
  };
}

function pillColorFor(kind) {
  return PILL_COLOR[kind] || PILL_COLOR.settled;
}

/**
 * Pure arithmetic layout pass: turns `model` into absolute box/row/text
 * positions plus the total canvas height. No ctx is touched here, so
 * measureSettlementShareImageHeight() (called before the <canvas> exists,
 * to size it) and drawSettlementShareImage() both derive from this exact
 * same computation and can never disagree about heights.
 */
function layoutSections(model, width = SHARE_IMAGE_WIDTH) {
  const contentX = PADDING;
  const contentWidth = width - PADDING * 2;
  let y = PADDING + 8;

  const title = { text: model.title, y };
  y += 36;

  const boss = model.bossLine ? { text: model.bossLine, y } : null;
  if (boss) y += 30;

  const round = model.roundLine ? { text: model.roundLine, y } : null;
  if (round) y += 26;

  y += BOX_GAP;

  // Box 1: summary (total / members / PC rate / base share / actual transfer total).
  const summaryBoxY = y;
  const summaryLineYs = [];
  let summaryInnerY = summaryBoxY + BOX_PADDING;
  for (const _line of model.summaryLines) {
    summaryLineYs.push(summaryInnerY);
    summaryInnerY += 26;
  }
  const baseShareY = summaryInnerY + 6;
  summaryInnerY = baseShareY + 30;
  const actualTransferTotalY = summaryInnerY;
  const summaryBoxHeight = (actualTransferTotalY + 8 + BOX_PADDING) - summaryBoxY;
  y = summaryBoxY + summaryBoxHeight + BOX_GAP;

  // Box 2: member breakdown (heading + one fixed-height banded row per member).
  const memberBoxY = y;
  const memberHeadingY = memberBoxY + BOX_PADDING + 14;
  const memberRowsTop = memberHeadingY + 20;
  const memberRows = model.memberRows.map((member, index) => ({
    member,
    index,
    y: memberRowsTop + index * MEMBER_ROW_HEIGHT,
  }));
  const memberBoxHeight = (memberRowsTop - memberBoxY) + model.memberRows.length * MEMBER_ROW_HEIGHT + BOX_PADDING;
  y = memberBoxY + memberBoxHeight + BOX_GAP;

  // Box 3: actual transfers (heading + one fixed-height banded row per transfer,
  // or a single "no transfers" line when the list is empty).
  const transferBoxY = y;
  const transferHeadingY = transferBoxY + BOX_PADDING + 14;
  const transferRowsTop = transferHeadingY + 18;
  const transferRowCount = Math.max(model.transferRows.length, 1);
  const transferRows = model.transferRows.length
    ? model.transferRows.map((transfer, index) => ({
        transfer,
        index,
        y: transferRowsTop + index * TRANSFER_ROW_HEIGHT,
      }))
    : [];
  const emptyTransfersY = model.transferRows.length ? null : transferRowsTop;
  const transferBoxHeight = (transferRowsTop - transferBoxY) + transferRowCount * TRANSFER_ROW_HEIGHT + BOX_PADDING;
  y = transferBoxY + transferBoxHeight + BOX_GAP;

  const footer = { text: model.footer, y: y + 8 };
  const totalHeight = footer.y + 16;

  return {
    width,
    totalHeight,
    contentX,
    contentWidth,
    title,
    boss,
    round,
    summaryBox: { y: summaryBoxY, height: summaryBoxHeight, lineYs: summaryLineYs, baseShareY, actualTransferTotalY },
    memberBox: { y: memberBoxY, height: memberBoxHeight, headingY: memberHeadingY, rows: memberRows },
    transferBox: { y: transferBoxY, height: transferBoxHeight, headingY: transferHeadingY, rows: transferRows, emptyY: emptyTransfersY },
    footer,
  };
}

/** Computes the total canvas height needed to draw `model` (rows are bounded: <=6 members, <=n-1 transfers). */
export function measureSettlementShareImageHeight(model) {
  return layoutSections(model).totalHeight;
}

function drawText(ctx, { text, x, y, font, color, align = "left" }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.textAlign = "left";
}

/** Fills (and optionally strokes) a rounded rect, falling back to a plain rect when ctx.roundRect isn't available (older engines / test mocks). */
function drawRoundedRect(ctx, x, y, w, h, r, { fill, stroke } = {}) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    return;
  }
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }
}

function drawSectionBox(ctx, x, y, width, height) {
  drawRoundedRect(ctx, x, y, width, height, BOX_RADIUS, { fill: COLOR.boxFill, stroke: COLOR.boxBorder });
}

/** One member row: name (+ small PC-conversion note) on the left half, a color-coded pay/receive/settled pill spanning the right half. */
function drawMemberRow(ctx, contentX, contentWidth, row) {
  const { member, index, y } = row;
  const bandColor = index % 2 === 0 ? COLOR.bandWhite : COLOR.bandAlt;
  ctx.fillStyle = bandColor;
  ctx.fillRect(contentX, y, contentWidth, MEMBER_ROW_HEIGHT);

  const leftHalfWidth = contentWidth * 0.5;
  // Name always sits on the row's first text line (y+22), whether or not a
  // PC note follows on the second line -- keeps the name/gross-label row
  // grid-aligned across every member row, not just the ones with a note.
  drawText(ctx, { text: member.name, x: contentX + BOX_PADDING, y: y + 22, font: `bold 16px ${FONT_FAMILY}`, color: COLOR.heading });
  if (member.pcNote) {
    drawText(ctx, { text: member.pcNote, x: contentX + BOX_PADDING, y: y + 40, font: `12px ${FONT_FAMILY}`, color: COLOR.muted });
  }

  const grossRightX = contentX + leftHalfWidth - 10;
  drawText(ctx, { text: member.grossLabel, x: grossRightX, y: y + 22, font: `11px ${FONT_FAMILY}`, color: COLOR.muted, align: "right" });
  drawText(ctx, { text: member.gross, x: grossRightX, y: y + 40, font: `bold 15px ${FONT_FAMILY}`, color: COLOR.heading, align: "right" });

  const pillColor = pillColorFor(member.settlementKind);
  const pillX = contentX + leftHalfWidth + 8;
  const pillWidth = contentWidth - leftHalfWidth - 8 - BOX_PADDING;
  const pillY = y + (MEMBER_ROW_HEIGHT - PILL_HEIGHT) / 2;
  drawRoundedRect(ctx, pillX, pillY, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2, { fill: pillColor.bg });
  const pillText = member.settlementAmount ? member.settlementLabel + " " + member.settlementAmount : member.settlementLabel;
  drawText(ctx, {
    text: pillText,
    x: pillX + pillWidth / 2,
    y: pillY + PILL_HEIGHT / 2 + 5,
    font: `bold 14px ${FONT_FAMILY}`,
    color: pillColor.text,
    align: "center",
  });
}

/**
 * One transfer row (LULU-103 C3): "A → B AMOUNT" packed tightly on the left
 * (amount immediately after the names, bold), the receiver's full wallet
 * address right-aligned in small monospace text on the right, alternating
 * band. `ctx.measureText` positions the amount right after the name text;
 * when unavailable (e.g. a minimal test mock ctx) the amount simply starts
 * at the row's left edge instead of throwing.
 */
function drawTransferRow(ctx, contentX, contentWidth, row) {
  const { transfer, index, y } = row;
  const bandColor = index % 2 === 0 ? COLOR.bandWhite : COLOR.bandAlt;
  ctx.fillStyle = bandColor;
  ctx.fillRect(contentX, y, contentWidth, TRANSFER_ROW_HEIGHT);

  const textY = y + TRANSFER_ROW_HEIGHT / 2 + 5;
  const nameFont = `15px ${FONT_FAMILY}`;
  const nameText = transfer.from + " → " + transfer.to + " ";
  drawText(ctx, { text: nameText, x: contentX + BOX_PADDING, y: textY, font: nameFont, color: COLOR.transfer });
  ctx.font = nameFont;
  const nameWidth = typeof ctx.measureText === "function" ? ctx.measureText(nameText).width : 0;
  drawText(ctx, {
    text: transfer.amount,
    x: contentX + BOX_PADDING + nameWidth,
    y: textY,
    font: `bold 15px ${FONT_FAMILY}`,
    color: COLOR.heading,
  });
  drawText(ctx, {
    text: transfer.wallet,
    x: contentX + contentWidth - BOX_PADDING,
    y: textY,
    font: `12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
    color: COLOR.muted,
    align: "right",
  });
}

/**
 * Draws `model` onto `ctx` (a CanvasRenderingContext2D, real or a smoke-test
 * mock exposing the same method names). Returns the canvas size used.
 */
export function drawSettlementShareImage(ctx, model, { width = SHARE_IMAGE_WIDTH } = {}) {
  const layout = layoutSections(model, width);
  const { contentX, contentWidth } = layout;

  ctx.fillStyle = COLOR.background;
  ctx.fillRect(0, 0, width, layout.totalHeight);

  drawText(ctx, { text: layout.title.text, x: contentX, y: layout.title.y, font: `bold 32px ${FONT_FAMILY}`, color: COLOR.heading });
  if (layout.boss) drawText(ctx, { text: layout.boss.text, x: contentX, y: layout.boss.y, font: `bold 20px ${FONT_FAMILY}`, color: COLOR.accent });
  if (layout.round) drawText(ctx, { text: layout.round.text, x: contentX, y: layout.round.y, font: `15px ${FONT_FAMILY}`, color: COLOR.muted });

  // Box 1: summary.
  drawSectionBox(ctx, contentX, layout.summaryBox.y, contentWidth, layout.summaryBox.height);
  model.summaryLines.forEach((line, index) => {
    drawText(ctx, {
      text: line.label + ": " + line.value,
      x: contentX + BOX_PADDING,
      y: layout.summaryBox.lineYs[index],
      font: `bold 16px ${FONT_FAMILY}`,
      color: COLOR.heading,
    });
  });
  drawText(ctx, {
    text: model.baseShareLine.label + ": " + model.baseShareLine.value,
    x: contentX + BOX_PADDING,
    y: layout.summaryBox.baseShareY,
    font: `bold 20px ${FONT_FAMILY}`,
    color: COLOR.accent,
  });
  drawText(ctx, {
    text: model.actualTransferTotal.label + ": " + model.actualTransferTotal.value,
    x: contentX + BOX_PADDING,
    y: layout.summaryBox.actualTransferTotalY,
    font: `15px ${FONT_FAMILY}`,
    color: COLOR.heading,
  });

  // Box 2: member breakdown.
  drawSectionBox(ctx, contentX, layout.memberBox.y, contentWidth, layout.memberBox.height);
  drawText(ctx, {
    text: model.memberSectionTitle,
    x: contentX + BOX_PADDING,
    y: layout.memberBox.headingY,
    font: `bold 16px ${FONT_FAMILY}`,
    color: COLOR.heading,
  });
  for (const row of layout.memberBox.rows) {
    drawMemberRow(ctx, contentX, contentWidth, row);
  }

  // Box 3: actual transfers.
  drawSectionBox(ctx, contentX, layout.transferBox.y, contentWidth, layout.transferBox.height);
  drawText(ctx, {
    text: model.transferSectionTitle,
    x: contentX + BOX_PADDING,
    y: layout.transferBox.headingY,
    font: `bold 16px ${FONT_FAMILY}`,
    color: COLOR.heading,
  });
  if (layout.transferBox.rows.length) {
    for (const row of layout.transferBox.rows) {
      drawTransferRow(ctx, contentX, contentWidth, row);
    }
  } else {
    drawText(ctx, {
      text: model.noTransfersText,
      x: contentX + BOX_PADDING,
      y: layout.transferBox.emptyY + 6,
      font: `14px ${FONT_FAMILY}`,
      color: COLOR.muted,
    });
  }

  drawText(ctx, { text: layout.footer.text, x: contentX, y: layout.footer.y, font: `13px ${FONT_FAMILY}`, color: COLOR.muted });

  return { width, height: layout.totalHeight };
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
