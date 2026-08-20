// UI-only text/formatting helpers for the raffle calculator. These functions
// never touch domain calculations; they only translate raw values (job
// progress stages, API error codes, settlement validation errors, and
// round timestamps) into human-readable, localized text.

const STAGE_MESSAGE_KEYS = Object.freeze({
  queued: "raffle.progressStageQueued",
  normalizing: "raffle.progressStageNormalizing",
  complete: "raffle.progressStageComplete",
  partial: "raffle.progressStagePartial",
  error: "raffle.progressStageError",
  cancelled: "raffle.progressStageCancelled",
});

/** Turns a job progress object into a single human-readable status line. */
export function describeProgressStage(progress, { t }) {
  const stage = progress?.stage;
  if (stage === "fetching") {
    return t("raffle.progressStageFetching", {
      completed: progress?.completedCharacters,
      total: progress?.totalCharacters,
    });
  }
  const key = STAGE_MESSAGE_KEYS[stage];
  if (key) return t(key);
  return t("raffle.progressStageUnknown");
}

function resolveMemberName(memberMap, memberId) {
  if (!memberId) return "";
  return memberMap?.[memberId]?.displayName || memberMap?.[memberId]?.name || memberId;
}

const CODE_MESSAGE_KEYS = Object.freeze({
  rateLimited: "raffle.errorRateLimited",
  client_rate_limited: "raffle.errorRateLimited",
  upstream_daily_budget_exceeded: "raffle.errorRateLimited",
  networkError: "raffle.errorNetwork",
  httpError: "raffle.errorNetwork",
  upstream_unavailable: "raffle.errorNetwork",
  api_key_not_configured: "raffle.errorNetwork",
  queue_full: "raffle.errorNetwork",
  job_not_found: "raffle.errorNetwork",
  aborted: "raffle.errorAborted",
  invalidResponse: "raffle.errorInvalidResponse",
  metadata_timeout: "raffle.errorMetadataUnavailable",
  item_metadata_unavailable: "raffle.errorMetadataUnavailable",
  ambiguous_party_cluster: "raffle.errorAmbiguousPartyCluster",
  fixture_mode: "raffle.warningFixtureMode",
});

/** Turns an API/job result code into a human-readable, localized message. */
export function describeRaffleCode(code, { t, memberId = "", memberMap = {} } = {}) {
  if (code === "history_unavailable") {
    return t("raffle.errorHistoryUnavailable", { name: resolveMemberName(memberMap, memberId) });
  }
  if (code === "wallet_not_available") {
    return t("raffle.errorWalletUnavailable", { name: resolveMemberName(memberMap, memberId) });
  }
  const key = CODE_MESSAGE_KEYS[code];
  if (key) return t(key);
  return t("raffle.errorUnknownCode", { code: code || "unknown" });
}

/** Convenience wrapper for a warning/error entry shaped like { code, memberId }. */
export function describeRaffleEntry(entry, { t, memberMap = {} } = {}) {
  return describeRaffleCode(entry?.code, { t, memberId: entry?.memberId, memberMap });
}

const SETTLEMENT_FIELD_LABEL_KEYS = Object.freeze({
  bossNeso: "raffle.item_bossNeso",
  ascendantNeso: "raffle.item_ascendantNeso",
  powerCrystalAmount: "raffle.item_powerCrystal",
  powerCrystalNesoRate: "raffle.powerCrystalRate",
  previousCarryover: "raffle.previousCarryover",
  saleNeso: "raffle.saleAmount",
  dropQuantity: "raffle.quantity",
});

function settlementFieldLabel(t, field) {
  const key = SETTLEMENT_FIELD_LABEL_KEYS[field];
  return key ? t(key) : t("raffle.settlement");
}

function settlementDescriptor(error, { t, memberMap = {}, dropNameByDropId = {} }) {
  const name = resolveMemberName(memberMap, error?.memberId);
  const dropName = error?.dropId ? dropNameByDropId?.[error.dropId] || "" : "";
  const subject = [name, dropName].filter(Boolean).join(" — ");
  const field = settlementFieldLabel(t, error?.field);
  return subject ? t("raffle.errorFieldFor", { subject, field }) : field;
}

const SETTLEMENT_STATIC_KEYS = Object.freeze({
  invalid_rate: "raffle.errorInvalidRate",
  fractional_neso: "raffle.errorFractionalNeso",
  invalid_boss: "raffle.errorInvalidBoss",
  incomplete_clear: "raffle.errorIncompleteClear",
  invalid_member_count: "raffle.errorInvalidMemberCount",
  party_mismatch: "raffle.errorPartyMismatch",
  invalid_drop: "raffle.errorInvalidDrop",
  carryover_not_balanced: "raffle.carryoverNotBalanced",
});

/**
 * Turns a `calculateSettlement` validation error (shape:
 * `{ code, field, memberId, dropId }`) into a human-readable, localized
 * message. Member/drop identifiers are resolved to display names when a
 * `memberMap`/`dropNameByDropId` lookup is provided.
 */
export function describeSettlementError(error, options = {}) {
  const { t } = options;
  const code = error?.code;
  const staticKey = SETTLEMENT_STATIC_KEYS[code];
  if (staticKey) return t(staticKey);
  const descriptor = settlementDescriptor(error, options);
  switch (code) {
    case "invalid_integer":
      return t("raffle.errorInvalidIntegerField", { descriptor });
    case "input_too_large":
      return t("raffle.errorInputTooLarge", { descriptor });
    case "invalid_signed_integer":
      return t("raffle.errorInvalidSignedInteger", { descriptor });
    case "result_too_large":
      return t("raffle.errorResultTooLarge", { descriptor });
    default:
      return t("raffle.errorUnknownCode", { code: code || "unknown" });
  }
}

/**
 * Formats an ISO raffle round timestamp in a given locale/timeZone. The
 * `timeZone` parameter makes this deterministic and testable without
 * depending on the host machine's timezone; when omitted, the runtime's
 * local timezone is used (the intended production behavior).
 */
export function formatRaffleRoundLocal(isoString, { locale = "en", timeZone } = {}) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const options = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  };
  if (timeZone) options.timeZone = timeZone;
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(date);
  }
}

/** Formats an ISO raffle round timestamp as `HH:MM UTC`. */
export function formatRaffleRoundUtc(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return hours + ":" + minutes + " UTC";
}

/**
 * Returns a settlement member's PC-converted NESO portion (decimal string)
 * when it is non-zero, else null. Gates the "incl. PC conversion" note on
 * both the settlement card (SettlementResult.jsx) and the share image
 * (shareImage.js, C2).
 */
export function pcPortionAmount(member) {
  try {
    return BigInt(member?.powerCrystalNeso ?? "0") > 0n ? member.powerCrystalNeso : null;
  } catch {
    return null;
  }
}

/**
 * Formats a decimal-string NESO amount as "1,234" using a fixed en-US
 * grouping regardless of the app's active display language -- matches every
 * other raw NESO amount rendered in the raffle calculator.
 */
export function formatNeso(value) {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return String(value ?? "");
  }
}

/** Formats a decimal-string NESO amount with its unit suffix, e.g. "1,234 NESO". */
export function neso(value) {
  return formatNeso(value) + " NESO";
}

/**
 * Formats a signed decimal-string carryover amount with an explicit "+" for
 * positive values (negative already carries its own "-" from toLocaleString),
 * e.g. "+1,234 NESO" / "-1,234 NESO" / "0 NESO". Shared by the on-screen
 * carryover badges (SettlementResult.jsx) and the share-image member table
 * (shareImage.js, F3/LULU-119) so both always show the exact same value and
 * sign for a member's previous/next carryover.
 */
export function signedNeso(value) {
  try {
    const amount = BigInt(value);
    return (amount > 0n ? "+" : "") + amount.toLocaleString("en-US") + " NESO";
  } catch {
    return String(value ?? "") + " NESO";
  }
}

const CATEGORY_COLUMN_DEFS = Object.freeze([
  { key: "bossNeso", includeKey: "bossNeso", labelKey: "raffle.item_bossNeso" },
  { key: "powerCrystal", includeKey: "powerCrystal", labelKey: "raffle.item_powerCrystal" },
  { key: "ascendantNeso", includeKey: "ascendantNeso", labelKey: "raffle.item_ascendantNeso" },
  { key: "coin", includeKey: "coin", labelKey: "raffle.item_coin" },
  { key: "equipment", includeKey: "equipment", labelKey: "raffle.item_equipment" },
  { key: "ftItem", includeKey: "ftItem", labelKey: "raffle.item_ftItem" },
]);

/**
 * Returns the settlement's active member-table category columns
 * (`{ key, label }[]`), in a fixed left-to-right order, filtered to only the
 * categories currently `include`d. Shared by the on-screen member table
 * (SettlementResult.jsx) and the share-image member table (shareImage.js,
 * C4) so both always show exactly the same set of columns in the same order.
 */
export function settlementCategoryColumns(include, t) {
  return CATEGORY_COLUMN_DEFS.filter((def) => include?.[def.includeKey]).map((def) => ({ key: def.key, label: t(def.labelKey) }));
}

/**
 * Returns one member's formatted value for a category column as
 * `{ primary, secondary, zero }` (`secondary` is null when there is no
 * second line; `zero` marks a zero value that should render dimmed). Every
 * number comes straight from `member` (a `calculateSettlement` output row)
 * via `formatNeso`/`neso` -- no new computation, only formatting -- so a
 * member's cell can never show a different number in the on-screen member
 * table vs. the share-image member table (C4), which both call this.
 * `equipment` intentionally has no icon here (icons cannot be embedded as
 * canvas-drawn text): callers that can render icons (SettlementResult.jsx)
 * special-case `equipment` themselves instead of using this cell for it.
 */
export function settlementMemberCategoryCell(member, key, { powerCrystalNesoRate } = {}) {
  if (key === "powerCrystal") {
    if (member.powerCrystalAmount === "0") return { primary: "0", secondary: null, zero: true };
    const showConvertedNeso = powerCrystalNesoRate !== "1";
    return {
      primary: formatNeso(member.powerCrystalAmount) + " PC",
      secondary: showConvertedNeso ? neso(member.powerCrystalNeso) : null,
      zero: false,
    };
  }
  if (key === "coin") {
    if (member.coinQuantity === "0") return { primary: "0", secondary: null, zero: true };
    return { primary: "× " + formatNeso(member.coinQuantity), secondary: neso(member.coinSaleNeso), zero: false };
  }
  if (key === "equipment") {
    if (!member.equipmentDrops?.length) return { primary: "—", secondary: null, zero: true };
    return { primary: neso(member.equipmentSaleNeso), secondary: null, zero: false };
  }
  if (key === "ftItem") {
    if (member.ftItemQuantity === "0") return { primary: "0", secondary: null, zero: true };
    return { primary: "× " + formatNeso(member.ftItemQuantity), secondary: neso(member.ftItemSaleNeso), zero: false };
  }
  if (member[key] === "0") return { primary: "0", secondary: null, zero: true };
  return { primary: neso(member[key]), secondary: null, zero: false };
}

/** Resolves a settlement member's display name, falling back to the raw memberId. */
export function memberDisplayName(memberMap, memberId) {
  return memberMap?.[memberId]?.displayName || memberId;
}

/**
 * Resolves a member's own owner wallet address from the job's `memberWallets`
 * map (LULU-069/LULU-103), or null when it is missing/malformed. This is the
 * single place that decides "does this member have a known wallet" -- the
 * transfer notification text, the settlement transfer rows, and the share
 * image all call this instead of re-deriving the rule.
 */
export function resolveMemberWallet(memberWallets, memberId) {
  const wallet = memberWallets?.[memberId];
  return typeof wallet === "string" && wallet ? wallet : null;
}

/**
 * Builds the plain-text Discord/manual transfer notification (LULU-103): one
 * two-line block per transfer ("SENDER → RECEIVER AMOUNT NESO" then the
 * receiver's wallet address on its own line), blocks separated by a blank
 * line. When a receiver's wallet is unknown, the second line is a localized
 * placeholder instead of being silently dropped.
 */
export function buildTransferNotificationText(transfers, memberMap, memberWallets, { t }) {
  const list = Array.isArray(transfers) ? transfers : [];
  return list
    .map((transfer) => {
      const from = memberDisplayName(memberMap, transfer.fromMemberId);
      const to = memberDisplayName(memberMap, transfer.toMemberId);
      const wallet = resolveMemberWallet(memberWallets, transfer.toMemberId) || t("raffle.walletUnavailable");
      return from + " → " + to + " " + neso(transfer.amount) + "\n" + wallet;
    })
    .join("\n\n");
}

/**
 * Describes a settlement member's transfer status as
 * `{ kind: "pays" | "receives" | "settled", label, amount }` (`amount` is
 * the raw decimal-string NESO value, or null when nothing is owed). Shared
 * by the settlement result cards/table (SettlementResult.jsx) and the
 * share-image model (shareImage.js) so both always agree on who
 * pays/receives/is settled -- the same rule is never re-implemented twice.
 */
export function describeMemberSettlement(member, { t, carryoverEnabled }) {
  if (BigInt(member.payment) > 0n) return { kind: "pays", label: t("raffle.pays"), amount: member.payment };
  if (BigInt(member.receipt) > 0n) return { kind: "receives", label: t("raffle.receives"), amount: member.receipt };
  const noTransfer = carryoverEnabled && BigInt(member.nextCarryover) !== 0n;
  return { kind: "settled", label: t(noTransfer ? "raffle.noTransferThisWeek" : "raffle.settled"), amount: null };
}

/** Smoothly scrolls an element into view, respecting reduced-motion preference. */
export function scrollElementIntoView(element) {
  if (!element || typeof element.scrollIntoView !== "function") return;
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
