// Builds and draws the "copy settlement as image" PNG. Split in three layers
// on purpose:
//  - buildSettlementShareModel(): pure data assembly (testable without a
//    canvas/DOM -- every number/string comes straight from `calculation`,
//    the same source SettlementResult.jsx renders, so the image and the
//    screen can never show different numbers).
//  - layoutSections(): pure arithmetic (no ctx) that turns the model into
//    absolute box/row/text/column positions plus the total canvas height.
//    Both measureSettlementShareImageHeight() and drawSettlementShareImage()
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
//
// C4: the member section is a real table (member / active category columns
// / gross / settlement -- no raffle-history or assigned-share columns),
// mirroring SettlementResult.jsx's member breakdown table via the shared
// settlementCategoryColumns/settlementMemberCategoryCell helpers so the two
// tables can never disagree about which columns are shown or a member's
// cell value.
// C5: the transfer section is also a column-aligned table -- the amount
// column's right edge sits at the same fixed x on every row (independent of
// name length), so amounts read as a straight vertical column instead of
// drifting per row; the wallet column stays at the box's right edge.

import {
  describeMemberSettlement,
  memberDisplayName,
  neso,
  resolveMemberWallet,
  settlementCategoryColumns,
  settlementMemberCategoryCell,
  signedNeso,
} from "./uiText.js";

const SHARE_IMAGE_TITLE = "Raffle Settlement";
const SHARE_IMAGE_FOOTER = "lulumi-tools.com";
export const SHARE_IMAGE_WIDTH = 1200;

const PADDING = 40;
const BOX_PADDING = 20;
const BOX_RADIUS = 12;
const BOX_GAP = 20;
const CELL_PADDING = 10;
const MEMBER_ROW_HEIGHT = 56;
const MEMBER_HEADER_HEIGHT = 40;
const TRANSFER_ROW_HEIGHT = 40;
const TRANSFER_HEADER_HEIGHT = 28;
const PILL_HEIGHT = 30;
const FONT_FAMILY = "sans-serif";
const MONOSPACE_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Member table fixed column widths (C4): member name / gross / settlement
// pill columns are fixed; the remaining width is split evenly across
// whichever category columns are currently included (1-5 of them).
const MEMBER_NAME_COL_WIDTH = 170;
const MEMBER_GROSS_COL_WIDTH = 120;
const MEMBER_SETTLE_COL_WIDTH = 190;
// F3/LULU-119: previous/next carryover columns (only added when
// carryoverEnabled) sit right after member name / right after settlement,
// matching the on-screen member table's column order.
const MEMBER_CARRYOVER_COL_WIDTH = 110;

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
  tableHeaderBg: "#e8edf3",
  tableHeaderText: "#334155",
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

  // C4: same active-category-column set as the on-screen member table
  // (settlementCategoryColumns), with the Power Crystal "non-transferable"
  // sub-note carried alongside its column header.
  const memberCategoryColumns = settlementCategoryColumns(include, t).map((column) => ({
    ...column,
    note: column.key === "powerCrystal" ? t("raffle.powerCrystalNonTransferable") : null,
  }));

  const memberRows = calculation.members.map((member) => {
    const settlement = describeMemberSettlement(member, { t, carryoverEnabled: calculation.carryoverEnabled });
    return {
      memberId: member.memberId,
      name: memberDisplayName(memberMap, member.memberId),
      categoryCells: memberCategoryColumns.map((column) => ({
        key: column.key,
        ...settlementMemberCategoryCell(member, column.key, { powerCrystalNesoRate }),
      })),
      gross: neso(member.gross),
      settlementKind: settlement.kind,
      settlementLabel: settlement.label,
      settlementAmount: settlement.amount != null ? neso(settlement.amount) : null,
      // F3/LULU-119: same value/sign as the on-screen member table's carryover
      // badges (both call the shared signedNeso helper on the same
      // calculation row field -- never recomputed independently).
      previousCarryover: calculation.carryoverEnabled ? signedNeso(member.previousCarryover) : null,
      nextCarryover: calculation.carryoverEnabled ? signedNeso(member.nextCarryover) : null,
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
    memberSectionTitle: t("raffle.memberBreakdown"),
    memberColumnLabel: t("raffle.member"),
    grossColumnLabel: t("raffle.grossWon"),
    settlementColumnLabel: t("raffle.settlement"),
    // F3/LULU-119: carryover columns are only added to the table layout when
    // the party has carryover enabled, matching the on-screen member table.
    carryoverEnabled: calculation.carryoverEnabled === true,
    previousCarryoverColumnLabel: t("raffle.previousCarryover"),
    nextCarryoverColumnLabel: t("raffle.nextCarryover"),
    memberCategoryColumns,
    memberRows,
    transferSectionTitle: t("raffle.actualTransfers"),
    transferNamesLabel: t("raffle.payer") + " → " + t("raffle.receiver"),
    transferAmountLabel: t("raffle.amount"),
    transferWalletLabel: t("raffle.receiverWallet"),
    transferRows,
    noTransfersText: t("raffle.noTransfers"),
    footer: SHARE_IMAGE_FOOTER,
  };
}

function pillColorFor(kind) {
  return PILL_COLOR[kind] || PILL_COLOR.settled;
}

/** F3/LULU-119: colors a carryover cell like the on-screen carryover badge -- receive (starts with "+") green, pay (starts with "-") rose, zero muted. */
function carryoverColor(text) {
  if (typeof text !== "string") return COLOR.muted;
  if (text.startsWith("+")) return PILL_COLOR.receives.text;
  if (text.startsWith("-")) return PILL_COLOR.pays.text;
  return COLOR.muted;
}

/**
 * Left-to-right column layout for the member table (C4): member name (fixed)
 * / previous carryover (fixed, F3, only when carryoverEnabled) / one column
 * per active category (evenly split) / gross (fixed) / settlement (fixed) /
 * next carryover (fixed, F3, only when carryoverEnabled). Order matches the
 * on-screen member table (SettlementResult.jsx).
 *
 * The category width always divides the remaining space evenly (F3:
 * carryover's 2 extra fixed columns can otherwise push the table past the
 * fixed 1200px canvas width) -- the columns always sum to exactly
 * contentWidth so numbers never get clipped or overlap the next box.
 */
function computeMemberTableColumns(model, contentX, contentWidth) {
  const categoryCount = model.memberCategoryColumns.length;
  const carryoverWidth = model.carryoverEnabled ? MEMBER_CARRYOVER_COL_WIDTH * 2 : 0;
  const fixedWidth = MEMBER_NAME_COL_WIDTH + MEMBER_GROSS_COL_WIDTH + MEMBER_SETTLE_COL_WIDTH + carryoverWidth;
  // Simply split the remaining width evenly across category columns
  // (never floored at MEMBER_MIN_CATEGORY_COL_WIDTH): flooring would push the
  // table past contentWidth whenever fixedWidth + carryover + many category
  // columns don't leave enough room, causing numbers to overflow past the
  // 1200px canvas. Dividing evenly always sums back to exactly contentWidth.
  const categoryWidth = categoryCount ? Math.max(0, (contentWidth - fixedWidth) / categoryCount) : 0;

  const columns = [];
  let x = contentX;
  columns.push({ key: "member", label: model.memberColumnLabel, note: null, x, width: MEMBER_NAME_COL_WIDTH, align: "left" });
  x += MEMBER_NAME_COL_WIDTH;
  if (model.carryoverEnabled) {
    columns.push({ key: "previousCarryover", label: model.previousCarryoverColumnLabel, note: null, x, width: MEMBER_CARRYOVER_COL_WIDTH, align: "right" });
    x += MEMBER_CARRYOVER_COL_WIDTH;
  }
  for (const column of model.memberCategoryColumns) {
    columns.push({ key: column.key, label: column.label, note: column.note, x, width: categoryWidth, align: "right" });
    x += categoryWidth;
  }
  columns.push({ key: "gross", label: model.grossColumnLabel, note: null, x, width: MEMBER_GROSS_COL_WIDTH, align: "right" });
  x += MEMBER_GROSS_COL_WIDTH;
  columns.push({ key: "settlement", label: model.settlementColumnLabel, note: null, x, width: MEMBER_SETTLE_COL_WIDTH, align: "right" });
  x += MEMBER_SETTLE_COL_WIDTH;
  if (model.carryoverEnabled) {
    columns.push({ key: "nextCarryover", label: model.nextCarryoverColumnLabel, note: null, x, width: MEMBER_CARRYOVER_COL_WIDTH, align: "right" });
  }
  return columns;
}

/**
 * Left-to-right column layout for the transfer table (C5): names / amount /
 * wallet, each a fixed fraction of contentWidth. Because every row shares
 * this exact same column layout, the amount column's right edge sits at the
 * same x on every row regardless of how long a row's names are -- the fix
 * for amounts drifting out of vertical alignment under the old packed-text
 * layout.
 */
function computeTransferTableColumns(model, contentX, contentWidth) {
  const namesWidth = Math.round(contentWidth * 0.46);
  const amountWidth = Math.round(contentWidth * 0.22);
  const walletWidth = contentWidth - namesWidth - amountWidth;
  let x = contentX;
  const names = { key: "names", label: model.transferNamesLabel, x, width: namesWidth, align: "left" };
  x += namesWidth;
  const amount = { key: "amount", label: model.transferAmountLabel, x, width: amountWidth, align: "right" };
  x += amountWidth;
  const wallet = { key: "wallet", label: model.transferWalletLabel, x, width: walletWidth, align: "right" };
  return { names, amount, wallet };
}

/**
 * Pure arithmetic layout pass: turns `model` into absolute box/row/column/
 * text positions plus the total canvas height. No ctx is touched here (aside
 * from column widths, which are fixed allocations, not text-measured), so
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

  // Box 1: summary (total / members / PC rate / base share).
  const summaryBoxY = y;
  const summaryLineYs = [];
  let summaryInnerY = summaryBoxY + BOX_PADDING;
  for (const _line of model.summaryLines) {
    summaryLineYs.push(summaryInnerY);
    summaryInnerY += 26;
  }
  const baseShareY = summaryInnerY + 6;
  const summaryBoxHeight = (baseShareY + 8 + BOX_PADDING) - summaryBoxY;
  y = summaryBoxY + summaryBoxHeight + BOX_GAP;

  // Box 2: member table (heading + header row + one fixed-height banded row per member).
  const memberBoxY = y;
  const memberHeadingY = memberBoxY + BOX_PADDING + 14;
  const memberTableTop = memberHeadingY + 18;
  const memberRowsTop = memberTableTop + MEMBER_HEADER_HEIGHT;
  const memberColumns = computeMemberTableColumns(model, contentX, contentWidth);
  const memberRows = model.memberRows.map((member, index) => ({
    member,
    index,
    y: memberRowsTop + index * MEMBER_ROW_HEIGHT,
  }));
  const memberBoxHeight = (memberRowsTop - memberBoxY) + model.memberRows.length * MEMBER_ROW_HEIGHT + BOX_PADDING;
  y = memberBoxY + memberBoxHeight + BOX_GAP;

  // Box 3: transfer table (heading + header row + one fixed-height banded row
  // per transfer, or a single "no transfers" line when the list is empty).
  const transferBoxY = y;
  const transferHeadingY = transferBoxY + BOX_PADDING + 14;
  const transferTableTop = transferHeadingY + 18;
  const transferRowsTop = transferTableTop + TRANSFER_HEADER_HEIGHT;
  const transferColumns = computeTransferTableColumns(model, contentX, contentWidth);
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
    summaryBox: { y: summaryBoxY, height: summaryBoxHeight, lineYs: summaryLineYs, baseShareY },
    memberBox: {
      y: memberBoxY,
      height: memberBoxHeight,
      headingY: memberHeadingY,
      headerY: memberTableTop,
      columns: memberColumns,
      rows: memberRows,
    },
    transferBox: {
      y: transferBoxY,
      height: transferBoxHeight,
      headingY: transferHeadingY,
      headerY: transferTableTop,
      columns: transferColumns,
      rows: transferRows,
      emptyY: emptyTransfersY,
    },
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

/**
 * Truncates `text` to fit within `maxWidth` at `font`, appending an ellipsis
 * ("…") when it doesn't fit (binary search over the longest fitting prefix).
 * Falls back to the untruncated text when `ctx.measureText` isn't available
 * (e.g. a minimal test mock ctx) instead of throwing.
 */
function truncateToWidth(ctx, text, font, maxWidth) {
  if (typeof ctx.measureText !== "function" || !Number.isFinite(maxWidth)) return text;
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? text.slice(0, low) + ellipsis : ellipsis;
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

function columnTextX(column) {
  return column.align === "left" ? column.x + CELL_PADDING : column.x + column.width - CELL_PADDING;
}

/** Draws a table header band spanning `columns`, with each column's label (and optional sub-note, e.g. Power Crystal's "non-transferable") right/left-aligned per column. */
function drawTableHeader(ctx, columns, y, height) {
  const first = columns[0];
  const last = columns[columns.length - 1];
  ctx.fillStyle = COLOR.tableHeaderBg;
  ctx.fillRect(first.x, y, (last.x + last.width) - first.x, height);
  for (const column of columns) {
    const textX = columnTextX(column);
    drawText(ctx, { text: column.label, x: textX, y: y + 17, font: `bold 12px ${FONT_FAMILY}`, color: COLOR.tableHeaderText, align: column.align });
    if (column.note) {
      drawText(ctx, { text: column.note, x: textX, y: y + 31, font: `10px ${FONT_FAMILY}`, color: COLOR.tableHeaderText, align: column.align });
    }
  }
}

/**
 * One member-table row (C4): member name / active category cells / gross /
 * settlement pill, each drawn within its fixed column so every row reads as
 * a proper table (not a two-block card). Category cells reuse
 * settlementMemberCategoryCell's `{ primary, secondary, zero }` shape --
 * `zero` values render dimmed, matching the on-screen table's zero-value
 * dimming rule.
 */
function drawMemberTableRow(ctx, columns, row) {
  const { member, index, y } = row;
  const first = columns[0];
  const last = columns[columns.length - 1];
  const bandColor = index % 2 === 0 ? COLOR.bandWhite : COLOR.bandAlt;
  ctx.fillStyle = bandColor;
  ctx.fillRect(first.x, y, (last.x + last.width) - first.x, MEMBER_ROW_HEIGHT);

  const primaryY = y + 24;
  const secondaryY = y + 42;

  for (const column of columns) {
    const textX = columnTextX(column);
    if (column.key === "member") {
      const nameFont = `bold 14px ${FONT_FAMILY}`;
      const name = truncateToWidth(ctx, member.name, nameFont, column.width - CELL_PADDING * 2);
      drawText(ctx, { text: name, x: textX, y: primaryY, font: nameFont, color: COLOR.heading, align: column.align });
      continue;
    }
    if (column.key === "gross") {
      drawText(ctx, { text: member.gross, x: textX, y: primaryY, font: `bold 13px ${FONT_FAMILY}`, color: COLOR.heading, align: column.align });
      continue;
    }
    if (column.key === "previousCarryover" || column.key === "nextCarryover") {
      const text = member[column.key];
      drawText(ctx, { text, x: textX, y: primaryY, font: `bold 12px ${FONT_FAMILY}`, color: carryoverColor(text), align: column.align });
      continue;
    }
    if (column.key === "settlement") {
      const pillWidth = column.width - CELL_PADDING * 2;
      const pillX = column.x + CELL_PADDING;
      const pillY = y + (MEMBER_ROW_HEIGHT - PILL_HEIGHT) / 2;
      const pillColor = pillColorFor(member.settlementKind);
      drawRoundedRect(ctx, pillX, pillY, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2, { fill: pillColor.bg });
      const pillText = member.settlementAmount ? member.settlementLabel + " " + member.settlementAmount : member.settlementLabel;
      drawText(ctx, {
        text: pillText,
        x: pillX + pillWidth / 2,
        y: pillY + PILL_HEIGHT / 2 + 5,
        font: `bold 12px ${FONT_FAMILY}`,
        color: pillColor.text,
        align: "center",
      });
      continue;
    }
    const cell = member.categoryCells.find((entry) => entry.key === column.key);
    if (!cell) continue;
    drawText(ctx, {
      text: cell.primary,
      x: textX,
      y: primaryY,
      font: cell.zero ? `12px ${FONT_FAMILY}` : `bold 12px ${FONT_FAMILY}`,
      color: cell.zero ? COLOR.muted : COLOR.heading,
      align: column.align,
    });
    if (cell.secondary) {
      drawText(ctx, { text: cell.secondary, x: textX, y: secondaryY, font: `10px ${FONT_FAMILY}`, color: COLOR.muted, align: column.align });
    }
  }
}

/**
 * One transfer-table row (C5): "SENDER → RECEIVER" left-aligned (truncated
 * to fit, longest-name-safe), the amount right-aligned at the transfer
 * table's fixed amount-column edge (identical x on every row -- this is the
 * fix for amounts drifting out of vertical alignment under the old
 * packed-text layout), and the receiver's wallet right-aligned at the box's
 * right edge in small monospace text.
 */
function drawTransferTableRow(ctx, columns, row) {
  const { transfer, index, y } = row;
  const bandColor = index % 2 === 0 ? COLOR.bandWhite : COLOR.bandAlt;
  ctx.fillStyle = bandColor;
  ctx.fillRect(columns.names.x, y, (columns.wallet.x + columns.wallet.width) - columns.names.x, TRANSFER_ROW_HEIGHT);

  const textY = y + TRANSFER_ROW_HEIGHT / 2 + 5;
  const nameFont = `14px ${FONT_FAMILY}`;
  const nameText = truncateToWidth(ctx, transfer.from + " → " + transfer.to, nameFont, columns.names.width - CELL_PADDING * 2);
  drawText(ctx, { text: nameText, x: columns.names.x + CELL_PADDING, y: textY, font: nameFont, color: COLOR.transfer });

  drawText(ctx, {
    text: transfer.amount,
    x: columns.amount.x + columns.amount.width - CELL_PADDING,
    y: textY,
    font: `bold 14px ${FONT_FAMILY}`,
    color: COLOR.heading,
    align: "right",
  });

  drawText(ctx, {
    text: transfer.wallet,
    x: columns.wallet.x + columns.wallet.width - CELL_PADDING,
    y: textY,
    font: `12px ${MONOSPACE_FONT_FAMILY}`,
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

  // Box 2: member table (C4).
  drawSectionBox(ctx, contentX, layout.memberBox.y, contentWidth, layout.memberBox.height);
  drawText(ctx, {
    text: model.memberSectionTitle,
    x: contentX + BOX_PADDING,
    y: layout.memberBox.headingY,
    font: `bold 16px ${FONT_FAMILY}`,
    color: COLOR.heading,
  });
  drawTableHeader(ctx, layout.memberBox.columns, layout.memberBox.headerY, MEMBER_HEADER_HEIGHT);
  for (const row of layout.memberBox.rows) {
    drawMemberTableRow(ctx, layout.memberBox.columns, row);
  }

  // Box 3: transfer table (C5).
  drawSectionBox(ctx, contentX, layout.transferBox.y, contentWidth, layout.transferBox.height);
  drawText(ctx, {
    text: model.transferSectionTitle,
    x: contentX + BOX_PADDING,
    y: layout.transferBox.headingY,
    font: `bold 16px ${FONT_FAMILY}`,
    color: COLOR.heading,
  });
  if (layout.transferBox.rows.length) {
    drawTableHeader(ctx, [layout.transferBox.columns.names, layout.transferBox.columns.amount, layout.transferBox.columns.wallet], layout.transferBox.headerY, TRANSFER_HEADER_HEIGHT);
    for (const row of layout.transferBox.rows) {
      drawTransferTableRow(ctx, layout.transferBox.columns, row);
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
