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

/** Smoothly scrolls an element into view, respecting reduced-motion preference. */
export function scrollElementIntoView(element) {
  if (!element || typeof element.scrollIntoView !== "function") return;
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
