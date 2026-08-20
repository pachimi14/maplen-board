// Builds and draws the "copy settlement as image" PNG. Split in three layers
// on purpose:
//  - buildSettlementShareModel(): pure data assembly (testable without a
//    canvas/DOM -- every number/string comes straight from `calculation`,
//    the same source SettlementResult.jsx renders, so the image and the
//    screen can never show different numbers).
//  - layoutSections(): arithmetic that turns the model into absolute
//    box/row/text/column positions plus the total canvas height. Both
//    measureSettlementShareImageHeight() and drawSettlementShareImage()
//    delegate to this single function so the measured height and the
//    drawn content can never drift apart from each other. Member-table
//    column widths (R2/LULU-119) are measured via ctx.measureText (real
//    text metrics, not a fixed even split) so a header/value can never
//    overlap its neighbor regardless of how many columns are active
//    (carryover + up to 6 categories); when ctx has no measureText (a
//    minimal test mock, or measureSettlementShareImageHeight()'s
//    ctx-less call -- height never depends on column widths) a
//    character-count heuristic is used instead so layout stays
//    self-consistent without ever throwing.
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
// / gross / settlement / next carryover, LULU-119 follow-up round 2 -- no
// raffle-history or assigned-share columns), mirroring SettlementResult.jsx's
// member breakdown table via the shared settlementCategoryColumns/
// settlementMemberCategoryCell helpers so the two tables can never disagree
// about which columns are shown or a member's cell value. Previous carryover
// stays hidden (share-image-only choice; the on-screen table still shows it).
// C5: the transfer section is also a column-aligned table -- all 3 columns
// are packed left-to-right at their own real measured content width
// (LULU-119 follow-up round 2: not stretched to fill the box), with the
// amount column's right edge sitting at the same fixed x on every row
// (independent of name length) so amounts read as a straight vertical
// column instead of drifting per row; the wallet column follows at a fixed
// gap after amount, and any leftover box width to the right is intentional
// whitespace.

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
// R2/LULU-119: soft target cap for how wide the canvas is allowed to grow to
// fit every column (carryover + up to 6 categories can require more than the
// default 1200px). This is a guideline, not a hard wall -- primary settlement
// figures are never truncated/rounded to stay under it (see
// measureMemberTableLayout()'s last-resort secondary-font shrink below).
export const SHARE_IMAGE_MAX_WIDTH = 1800;

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

// Member table comfortable-minimum column widths (C4): member name / gross /
// settlement pill / next-carryover / category columns never shrink below
// these (R2/LULU-119: they also grow past these when ctx.measureText says
// the actual header/value text needs more room, so nothing is ever clipped
// or overlaps its neighbor -- see measureMemberTableLayout()).
const MEMBER_NAME_COL_WIDTH = 170;
const MEMBER_GROSS_COL_WIDTH = 120;
const MEMBER_SETTLE_COL_WIDTH = 190;
const MEMBER_MIN_CATEGORY_COL_WIDTH = 110;
// LULU-119 follow-up round 2: next carryover is back as the member table's
// rightmost column (previous carryover stays hidden). Only added when
// carryoverEnabled, matching the on-screen member table's column order.
const MEMBER_CARRYOVER_COL_WIDTH = 110;
// R2/LULU-119: rounded settlement pill needs extra breathing room beyond its
// text width + CELL_PADDING*2 (it isn't a plain right-aligned number cell).
const SETTLEMENT_PILL_EXTRA_WIDTH = 40;
// R2/LULU-119: the category cell's secondary (sub) line -- e.g. Power
// Crystal's converted-NESO line, coin/FT Item's sale-proceeds line -- is the
// *only* text ever shrunk to fit, and only as a last resort when even the
// SHARE_IMAGE_MAX_WIDTH guideline can't fit every column comfortably. The
// primary number is always drawn at MEMBER_CATEGORY_PRIMARY_FONT_SIZE, in
// full, never truncated/rounded.
const MEMBER_CATEGORY_PRIMARY_FONT_SIZE = 12;
const MEMBER_CATEGORY_SECONDARY_FONT_SIZE_DEFAULT = 10;
const MEMBER_CATEGORY_SECONDARY_FONT_SIZE_MIN = 8;

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

// LULU-119 follow-up (share-image-only column reduction, user report: 10
// columns made the image too wide/hard to read at 1529px). "Equipment drop"
// and "Will FT Item" are merged into a single share-image-only "Other Sales"
// column, shown when either is included: the combined value is the exact
// sum of both categories' already-computed sale proceeds (BigInt addition,
// no new rounding/calculation), with no quantity/icon/two-line breakdown --
// just the total NESO. This does NOT touch settlementCategoryColumns() or
// settlementMemberCategoryCell() in uiText.js (both still return the
// separate "equipment"/"ftItem" keys those functions have always used), so
// SettlementResult.jsx -- which builds its own category list independently
// and never calls settlementCategoryColumns() -- is completely unaffected;
// only this share-image assembly step re-shapes the columns.
const OTHER_SALES_KEY = "otherSales";

function otherSalesCell(member) {
  const amount = BigInt(member.equipmentSaleNeso || "0") + BigInt(member.ftItemSaleNeso || "0");
  return { key: OTHER_SALES_KEY, primary: amount === 0n ? "0" : neso(amount.toString()), secondary: null, zero: amount === 0n };
}

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
  // sub-note carried alongside its column header -- except "equipment"/
  // "ftItem" are collapsed into one "Other Sales" column (see
  // otherSalesCell() above) when either is included.
  const hasOtherSales = Boolean(include?.equipment || include?.ftItem);
  const memberCategoryColumns = settlementCategoryColumns(include, t)
    .filter((column) => column.key !== "equipment" && column.key !== "ftItem")
    .map((column) => ({ ...column, note: column.key === "powerCrystal" ? t("raffle.powerCrystalNonTransferable") : null }));
  if (hasOtherSales) {
    memberCategoryColumns.push({ key: OTHER_SALES_KEY, label: t("raffle.otherSales"), note: null });
  }

  // LULU-119 follow-up round 2 (user adjustment A): the standalone
  // next-carryover block below the transfer table is retired again --
  // next carryover is back as the member table's rightmost column instead,
  // shown for every member (including "0" for members with nothing carried,
  // since it's a table row now, not a filtered list). Previous carryover
  // stays hidden (not restored). Same value/sign as the on-screen carryover
  // badge, via the shared signedNeso helper, so the two can never disagree.
  const memberRows = calculation.members.map((member) => {
    const settlement = describeMemberSettlement(member, { t, carryoverEnabled: calculation.carryoverEnabled });
    return {
      memberId: member.memberId,
      name: memberDisplayName(memberMap, member.memberId),
      categoryCells: memberCategoryColumns.map((column) => column.key === OTHER_SALES_KEY
        ? otherSalesCell(member)
        : { key: column.key, ...settlementMemberCategoryCell(member, column.key, { powerCrystalNesoRate }) }),
      gross: neso(member.gross),
      settlementKind: settlement.kind,
      settlementLabel: settlement.label,
      settlementAmount: settlement.amount != null ? neso(settlement.amount) : null,
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
    // LULU-119 follow-up round 2: the next-carryover column is only added to
    // the member table layout when the party has carryover enabled,
    // matching the on-screen member table's gating rule.
    carryoverEnabled: calculation.carryoverEnabled === true,
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
 * Returns a `(text, font) => width` measurer. With a real 2D context
 * (`ctx.measureText` present), this is exact browser text metrics. Without
 * one (a minimal test mock, or measureSettlementShareImageHeight()'s
 * ctx-less call -- see layoutSections()), a character-count heuristic keeps
 * the layout self-consistent (never throws, never divides by content it
 * can't measure) without needing a real canvas.
 */
function textMeasurer(ctx) {
  if (ctx && typeof ctx.measureText === "function") {
    return (text, font) => {
      ctx.font = font;
      return ctx.measureText(String(text)).width;
    };
  }
  return (text, font) => {
    const sizeMatch = /(\d+)px/.exec(font || "");
    const size = sizeMatch ? Number(sizeMatch[1]) : 12;
    return String(text).length * size * 0.6;
  };
}

function categoryPrimaryFont(bold = true) {
  return `${bold ? "bold " : ""}${MEMBER_CATEGORY_PRIMARY_FONT_SIZE}px ${FONT_FAMILY}`;
}

function categorySecondaryFont(secondaryFontSize) {
  return `${secondaryFontSize}px ${FONT_FAMILY}`;
}

/** Widest of `{ text, font }` entries (measured), plus padding; entries with an empty/nullish text are skipped. */
function requiredWidth(measure, entries, padding) {
  let max = 0;
  for (const { text, font } of entries) {
    if (!text) continue;
    const width = measure(text, font);
    if (width > max) max = width;
  }
  return max + padding;
}

/**
 * Measures every member-table column's *required* width from its header
 * label (+ optional note) and every row's actual cell text (R2/LULU-119:
 * replaces the old fixed/even-split widths, which could overlap once many
 * category columns were active at once). Comfortable minimums
 * (MEMBER_NAME_COL_WIDTH etc.) are still applied as a floor so ordinary
 * short values keep today's familiar column proportions.
 *
 * LULU-119 follow-up: previous carryover is dropped from the share image
 * entirely; next carryover is back as the member table's own rightmost
 * column (round 2 -- an earlier iteration moved it into a standalone block
 * below the transfer table, which the user asked to retire again). Together
 * with collapsing equipment/ftItem into one "Other Sales" column, this keeps
 * the common configuration (member / bossNeso / powerCrystal / ascendantNeso
 * / coin / otherSales / gross / settlement[, next carryover] = 8-9 columns)
 * at or near the default 1200px.
 *
 * If the required total still exceeds SHARE_IMAGE_MAX_WIDTH, the category
 * cells' *secondary* (sub) line is progressively shrunk (font-size only,
 * down to MEMBER_CATEGORY_SECONDARY_FONT_SIZE_MIN) as a last resort -- the
 * primary number is never touched, so settlement amounts are always shown in
 * full (no truncation/rounding of money). If that still isn't enough, the
 * canvas is simply allowed to grow past the guideline rather than clip or
 * round any figure.
 */
function measureMemberTableLayout(ctx, model) {
  const measure = textMeasurer(ctx);
  const maxContentWidth = SHARE_IMAGE_MAX_WIDTH - PADDING * 2;

  function computeAt(secondaryFontSize) {
    const nameWidth = MEMBER_NAME_COL_WIDTH;

    const grossWidth = Math.max(
      MEMBER_GROSS_COL_WIDTH,
      requiredWidth(measure, [
        { text: model.grossColumnLabel, font: categoryPrimaryFont() },
        ...model.memberRows.map((row) => ({ text: row.gross, font: `bold 13px ${FONT_FAMILY}` })),
      ], CELL_PADDING * 2),
    );

    const settlementWidth = Math.max(
      MEMBER_SETTLE_COL_WIDTH,
      requiredWidth(measure, [
        { text: model.settlementColumnLabel, font: categoryPrimaryFont() },
        ...model.memberRows.map((row) => ({ text: row.settlementAmount ? row.settlementLabel + " " + row.settlementAmount : row.settlementLabel, font: categoryPrimaryFont() })),
      ], CELL_PADDING * 2 + SETTLEMENT_PILL_EXTRA_WIDTH),
    );

    const carryoverWidth = model.carryoverEnabled
      ? Math.max(
          MEMBER_CARRYOVER_COL_WIDTH,
          requiredWidth(measure, [
            { text: model.nextCarryoverColumnLabel, font: categoryPrimaryFont() },
            ...model.memberRows.map((row) => ({ text: row.nextCarryover, font: categoryPrimaryFont() })),
          ], CELL_PADDING * 2),
        )
      : 0;

    const categoryWidths = model.memberCategoryColumns.map((column) => {
      const primary = requiredWidth(measure, [
        { text: column.label, font: categoryPrimaryFont() },
        ...model.memberRows.map((row) => ({ text: row.categoryCells.find((cell) => cell.key === column.key)?.primary, font: categoryPrimaryFont() })),
      ], CELL_PADDING * 2);
      const secondary = requiredWidth(measure, [
        { text: column.note, font: categorySecondaryFont(secondaryFontSize) },
        ...model.memberRows.map((row) => ({ text: row.categoryCells.find((cell) => cell.key === column.key)?.secondary, font: categorySecondaryFont(secondaryFontSize) })),
      ], CELL_PADDING * 2);
      return Math.max(MEMBER_MIN_CATEGORY_COL_WIDTH, primary, secondary);
    });

    const categoryTotal = categoryWidths.reduce((sum, width) => sum + width, 0);
    const requiredTotal = nameWidth + categoryTotal + grossWidth + settlementWidth + carryoverWidth;

    return { nameWidth, grossWidth, settlementWidth, carryoverWidth, categoryWidths, requiredTotal };
  }

  let secondaryFontSize = MEMBER_CATEGORY_SECONDARY_FONT_SIZE_DEFAULT;
  let widths = computeAt(secondaryFontSize);
  while (widths.requiredTotal > maxContentWidth && secondaryFontSize > MEMBER_CATEGORY_SECONDARY_FONT_SIZE_MIN) {
    secondaryFontSize -= 1;
    widths = computeAt(secondaryFontSize);
  }

  const defaultContentWidth = SHARE_IMAGE_WIDTH - PADDING * 2;
  const contentWidth = Math.max(defaultContentWidth, widths.requiredTotal);
  // When the measured content needs less than the default box width, spread
  // the leftover evenly across category columns so an ordinary settlement
  // (<=5 categories) keeps filling the box exactly as before (no visual
  // regression for the common case).
  const categoryCount = widths.categoryWidths.length;
  const extraPerCategory = categoryCount ? (contentWidth - widths.requiredTotal) / categoryCount : 0;
  const categoryWidths = widths.categoryWidths.map((width) => width + extraPerCategory);

  return { ...widths, categoryWidths, contentWidth, secondaryFontSize };
}

/**
 * Left-to-right column layout for the member table (C4): member name (fixed)
 * / one column per active category / gross / settlement / next carryover
 * (LULU-119 follow-up round 2: back as the rightmost column, only when
 * carryoverEnabled -- previous carryover stays hidden). Order matches the
 * on-screen member table (SettlementResult.jsx). Every width comes from
 * `memberLayout` (measureMemberTableLayout()) -- real measured requirements,
 * never a fixed even split -- so columns can never overlap (R2/LULU-119).
 */
function buildMemberTableColumns(model, contentX, memberLayout) {
  const columns = [];
  let x = contentX;
  columns.push({ key: "member", label: model.memberColumnLabel, note: null, x, width: memberLayout.nameWidth, align: "left" });
  x += memberLayout.nameWidth;
  model.memberCategoryColumns.forEach((column, index) => {
    const width = memberLayout.categoryWidths[index];
    columns.push({ key: column.key, label: column.label, note: column.note, x, width, align: "right" });
    x += width;
  });
  columns.push({ key: "gross", label: model.grossColumnLabel, note: null, x, width: memberLayout.grossWidth, align: "right" });
  x += memberLayout.grossWidth;
  columns.push({ key: "settlement", label: model.settlementColumnLabel, note: null, x, width: memberLayout.settlementWidth, align: "right" });
  x += memberLayout.settlementWidth;
  if (model.carryoverEnabled) {
    columns.push({ key: "nextCarryover", label: model.nextCarryoverColumnLabel, note: null, x, width: memberLayout.carryoverWidth, align: "right" });
  }
  return columns;
}

// LULU-119 follow-up round 2 (user adjustment B): the transfer table's 3
// columns are packed from the left at their real measured content width
// (ctx.measureText, same mechanism as the member table -- see
// measureMemberTableLayout()) instead of stretching to fill the full box
// width. The amount column still right-aligns its own text within its own
// (now content-tight) width, so digits still line up vertically across
// rows -- packing only changes where the column *starts*, not the
// right-alignment rule. Right-side whitespace in the box is intentional.
const TRANSFER_COLUMN_GAP = 28;

/**
 * Left-to-right column layout for the transfer table (C5): names / amount /
 * wallet, each sized to its own real content (header label + every row's
 * text) plus CELL_PADDING, packed left-to-right with a fixed gap between
 * amount and wallet (TRANSFER_COLUMN_GAP, LULU-119 follow-up round 2). The
 * amount column's right edge still sits at the same fixed x on every row
 * (independent of name length), so amounts read as a straight vertical
 * column instead of drifting per row.
 */
function computeTransferTableColumns(ctx, model, contentX) {
  const measure = textMeasurer(ctx);
  const headerFont = categoryPrimaryFont();

  const namesWidth = requiredWidth(measure, [
    { text: model.transferNamesLabel, font: headerFont },
    ...model.transferRows.map((row) => ({ text: row.from + " \u2192 " + row.to, font: `14px ${FONT_FAMILY}` })),
  ], CELL_PADDING * 2);
  const amountWidth = requiredWidth(measure, [
    { text: model.transferAmountLabel, font: headerFont },
    ...model.transferRows.map((row) => ({ text: row.amount, font: `bold 14px ${FONT_FAMILY}` })),
  ], CELL_PADDING * 2);
  const walletWidth = requiredWidth(measure, [
    { text: model.transferWalletLabel, font: headerFont },
    ...model.transferRows.map((row) => ({ text: row.wallet, font: `12px ${MONOSPACE_FONT_FAMILY}` })),
  ], CELL_PADDING * 2);

  let x = contentX;
  const names = { key: "names", label: model.transferNamesLabel, x, width: namesWidth, align: "left" };
  x += namesWidth + TRANSFER_COLUMN_GAP;
  const amount = { key: "amount", label: model.transferAmountLabel, x, width: amountWidth, align: "right" };
  x += amountWidth + TRANSFER_COLUMN_GAP;
  const wallet = { key: "wallet", label: model.transferWalletLabel, x, width: walletWidth, align: "right" };
  return { names, amount, wallet };
}

/**
 * Layout pass: turns `model` into absolute box/row/column/text positions
 * plus the total canvas width/height. `ctx` is used only to measure the
 * member table's column widths (R2/LULU-119: real text metrics instead of a
 * fixed even split, so columns can never overlap); every other position is
 * pure arithmetic from fixed row-height/box-padding constants and therefore
 * independent of `ctx`/column widths -- the total canvas *height* is
 * identical whether or not a real `ctx` is supplied. This is what lets
 * measureSettlementShareImageHeight() (called before the <canvas> exists, to
 * size it, with no `ctx` available yet) and drawSettlementShareImage() (with
 * a real `ctx`) share this exact same function and never disagree about
 * height.
 */
function layoutSections(model, ctx) {
  const memberLayout = measureMemberTableLayout(ctx, model);
  const contentX = PADDING;
  const contentWidth = memberLayout.contentWidth;
  const width = Math.round(contentWidth + PADDING * 2);
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
  const memberColumns = buildMemberTableColumns(model, contentX, memberLayout);
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
  const transferColumns = computeTransferTableColumns(ctx, model, contentX);
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
    secondaryFontSize: memberLayout.secondaryFontSize,
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

/**
 * Computes the total canvas height needed to draw `model` (rows are bounded:
 * <=6 members, <=n-1 transfers). Called with no `ctx` -- height never
 * depends on the (ctx-measured) column widths, only on fixed row-height/box-
 * padding constants and row counts, so this always agrees with
 * drawSettlementShareImage()'s real-ctx layout (see layoutSections()).
 */
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

/**
 * Draws a table header band spanning `columns`, with each column's label
 * (and optional sub-note, e.g. Power Crystal's "non-transferable")
 * right/left-aligned per column. `noteFontSize` (R2/LULU-119) draws the note
 * at the same possibly-shrunk size used to measure the member table's
 * category columns (measureMemberTableLayout()), so the header note can
 * never be wider than what was actually measured/allotted for it.
 */
function drawTableHeader(ctx, columns, y, height, noteFontSize = MEMBER_CATEGORY_SECONDARY_FONT_SIZE_DEFAULT) {
  const first = columns[0];
  const last = columns[columns.length - 1];
  ctx.fillStyle = COLOR.tableHeaderBg;
  ctx.fillRect(first.x, y, (last.x + last.width) - first.x, height);
  for (const column of columns) {
    const textX = columnTextX(column);
    drawText(ctx, { text: column.label, x: textX, y: y + 17, font: `bold 12px ${FONT_FAMILY}`, color: COLOR.tableHeaderText, align: column.align });
    if (column.note) {
      drawText(ctx, { text: column.note, x: textX, y: y + 31, font: `${noteFontSize}px ${FONT_FAMILY}`, color: COLOR.tableHeaderText, align: column.align });
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
function drawMemberTableRow(ctx, columns, row, secondaryFontSize = MEMBER_CATEGORY_SECONDARY_FONT_SIZE_DEFAULT) {
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
    if (column.key === "nextCarryover") {
      drawText(ctx, { text: member.nextCarryover, x: textX, y: primaryY, font: `bold 12px ${FONT_FAMILY}`, color: carryoverColor(member.nextCarryover), align: column.align });
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
      font: categoryPrimaryFont(!cell.zero),
      color: cell.zero ? COLOR.muted : COLOR.heading,
      align: column.align,
    });
    if (cell.secondary) {
      drawText(ctx, { text: cell.secondary, x: textX, y: secondaryY, font: categorySecondaryFont(secondaryFontSize), color: COLOR.muted, align: column.align });
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
 * mock exposing the same method names). Returns the canvas size used. The
 * canvas width is derived from the actual content (R2/LULU-119: measured via
 * `ctx.measureText`, growing past SHARE_IMAGE_WIDTH up to the
 * SHARE_IMAGE_MAX_WIDTH guideline -- and beyond it only if unavoidable --
 * instead of a caller-supplied fixed width) so it is always wide enough for
 * every member-table column.
 */
export function drawSettlementShareImage(ctx, model) {
  const layout = layoutSections(model, ctx);
  const { contentX, contentWidth, width } = layout;

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
  drawTableHeader(ctx, layout.memberBox.columns, layout.memberBox.headerY, MEMBER_HEADER_HEIGHT, layout.secondaryFontSize);
  for (const row of layout.memberBox.rows) {
    drawMemberTableRow(ctx, layout.memberBox.columns, row, layout.secondaryFontSize);
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
 *
 * The canvas is sized from a real-ctx layout pass *before* drawing
 * (R2/LULU-119: the final width depends on `ctx.measureText`, which doesn't
 * require the canvas to already have its final dimensions -- text metrics
 * only depend on the font, not the canvas size). Resizing `canvas.width`/
 * `height` afterward resets context state per the Canvas spec, but every
 * draw call here always sets its own font/fillStyle first, so that's safe.
 */
export function renderSettlementShareImageBlob(model) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("2d canvas context is not available"));
  }
  const layout = layoutSections(model, ctx);
  canvas.width = layout.width;
  canvas.height = layout.totalHeight;
  drawSettlementShareImage(ctx, model);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}
