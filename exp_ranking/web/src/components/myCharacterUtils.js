// Pure helpers for the My-Characters summary (T4b). No React/DOM/localStorage
// access here so these can be unit tested in isolation (see
// docs/IMPL_PLAN_T4B.md §16). Display components import these instead of
// re-deriving the same rules inline.

import { todayPartsInJst } from "../rankingUtils";

const KNOWN_ERROR_CODES = new Set([
  "saveFailed",
  "limitReached",
  "invalidKey",
  "invalidGoal",
  "unsupportedVersion",
]);

/**
 * Maps a T4a mutation result code to its `myCharacters.error.*` i18n key, or
 * null when the code has no dedicated user-facing message (e.g. the no-op
 * codes `notPinned`/`alreadyPinned` from profile.js, which callers should
 * simply ignore rather than surface as an error).
 */
export function errorMessageKeyForCode(code) {
  if (!KNOWN_ERROR_CODES.has(code)) {
    return null;
  }
  return `myCharacters.error.${code}`;
}

/**
 * §11: cap a list (e.g. passed/overtaken) to at most `max` entries, reporting
 * how many were hidden so the caller can render "+N more". T3 itself must
 * keep returning the full list; only T4b's display layer truncates.
 */
export function limitWithOthers(list, max) {
  const items = Array.isArray(list) ? list : [];
  const shown = items.slice(0, Math.max(0, max));
  const othersCount = Math.max(0, items.length - shown.length);
  return { shown, othersCount };
}

/**
 * §7/§20-3: which historyKey the summary should display next.
 * Callers should only invoke this when `current` is no longer a member of
 * `pinnedHistoryKeys` (i.e. it was unpinned, or nothing was ever displayed);
 * when `current` is still pinned it must be left untouched (no state churn,
 * and a since-changed `primaryHistoryKey` alone must never force a switch).
 *
 * Fixed order: ① the current primary (if still pinned) ② the first
 * remaining pin ③ null (nothing pinned → empty/CTA state).
 */
export function resolveDisplayedHistoryKey(current, pinnedHistoryKeys, primaryHistoryKey) {
  const pinned = Array.isArray(pinnedHistoryKeys) ? pinnedHistoryKeys : [];
  if (current != null && pinned.includes(current)) {
    return current;
  }
  if (primaryHistoryKey != null && pinned.includes(primaryHistoryKey)) {
    return primaryHistoryKey;
  }
  return pinned[0] ?? null;
}

/**
 * §20-1: whether `latestSnapshotDate` (meta's latest confirmed data date)
 * matches the device's current JST calendar date — i.e. whether "Today's
 * Summary" wording is honest, or the fallback "Latest Summary" + explicit
 * date should be used instead. Reuses the app's single JST-day helper
 * (`todayPartsInJst`) rather than re-deriving a timezone rule here.
 */
export function isLatestDateToday(latestSnapshotDate, referenceDate = new Date()) {
  if (typeof latestSnapshotDate !== "string" || !latestSnapshotDate) {
    return false;
  }
  const { year, month, day } = todayPartsInJst(referenceDate);
  const todayIso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return latestSnapshotDate === todayIso;
}

/** Round a percent value to `decimals` places; null/non-finite pass through as null. */
export function roundPercent(value, decimals = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const MIN_HISTORY_POINTS_FOR_STATS = 2;

/**
 * §6/§20-4: how the history-dependent ("show more") section should present
 * itself for a given shard-fetch state, independent of React state timing.
 * `historyStatus` is the caller-tracked fetch status (§6): "idle" (not
 * requested yet) | "loading" | "failed" — `history` is the character's
 * current `history` field from board state (the single cache, per §20-4).
 */
export function classifyHistoryAvailability(history, historyStatus) {
  if (historyStatus === "loading") {
    return "loading";
  }
  if (historyStatus === "failed") {
    return "failed";
  }
  if (!Array.isArray(history)) {
    return "idle";
  }
  if (history.length < MIN_HISTORY_POINTS_FOR_STATS) {
    return "insufficient";
  }
  return "ready";
}

/**
 * §10: overall level-rank movement direction, using `rankFluctuation`
 * (already computed server-side, §T1) only when `previousRank` establishes
 * that a comparison is possible at all (per IMPL_PLAN_T1 §"responsibility
 * split": comparability = previousRank, magnitude/sign = rankFluctuation).
 */
export function rankMovementDirection(previousRank, rankFluctuation) {
  if (previousRank == null || !Number.isFinite(previousRank)) {
    return "unknown";
  }
  if (!Number.isFinite(rankFluctuation) || rankFluctuation === 0) {
    return "same";
  }
  return rankFluctuation > 0 ? "up" : "down";
}
