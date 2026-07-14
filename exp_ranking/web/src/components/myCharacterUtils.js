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
 *
 * Actual data always wins over the caller-tracked status: if `history` is
 * already a real array, this returns "ready"/"insufficient" even when
 * `historyStatus` still (incorrectly, or just staleness from an abandoned
 * fetch attempt) says "loading"/"failed". This is deliberate defense in
 * depth against the class of bug fixed in LULU-028 (a stuck "loading" label
 * for data that had, in fact, already arrived) — the UI must never contradict
 * data it's already holding.
 */
export function classifyHistoryAvailability(history, historyStatus) {
  if (Array.isArray(history)) {
    return history.length < MIN_HISTORY_POINTS_FOR_STATS ? "insufficient" : "ready";
  }
  if (historyStatus === "loading") {
    return "loading";
  }
  if (historyStatus === "failed") {
    return "failed";
  }
  return "idle";
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

/**
 * §6/§20-4/§22.2: pure "should the fetch-triggering effect start a new shard
 * request for this key right now?" decision, extracted so it's testable in
 * isolation from React effect/dependency timing — LULU-028 (P0) was
 * entirely a bug in *when* this got re-evaluated (a "loading" setState
 * re-running the effect and canceling its own in-flight request), not in
 * this decision itself. Callers must not include their own "loading"/
 * "failed" state as a dependency that re-triggers the check; `status`
 * should be read once per (historyKey, retry-signal) change.
 *
 * §22.2: fetching is triggered by *displaying* a character, not by an
 * expand/"show more" toggle (that UI concept no longer exists) — this
 * function never took the "show more" state as a reason to skip a fetch
 * beyond gating on there being a historyKey to fetch for at all.
 *
 * @param {{historyKey: string|null|undefined, history: unknown, status: "loading"|"failed"|undefined}} input
 */
export function shouldStartHistoryFetch({ historyKey, history, status }) {
  if (!historyKey) {
    return false;
  }
  if (Array.isArray(history)) {
    return false;
  }
  return status !== "loading" && status !== "failed";
}
