/**
 * Profile store (T4a): pins (primary/sub, max 3) + per-character goals,
 * keyed by historyKey (rename-proof, see DECISION_LOG LULU-005).
 *
 * Three-layer separation (see docs/IMPL_PLAN_T4A.md §4):
 *   (a) pure profile operations (this file, no localStorage access)
 *   (b) storage adapter (createProfileStorage/readProfile/writeProfile)
 *   (c) React binding lives in ProfileContext.jsx, not here.
 *
 * This module never throws for malformed input; all normalization is
 * defensive and falls back to a safe default profile.
 */

export const PROFILE_KEY = "maplen-board-profile-v1";
export const PROFILE_VERSION = 1;
export const MAX_PINS = 3;
export const MIN_TARGET_LEVEL = 225;
export const LEVEL_CAP = 275;

/** Fresh default profile (never share a mutable reference). */
export function defaultProfile() {
  return { version: PROFILE_VERSION, primaryHistoryKey: null, pinnedHistoryKeys: [], goals: {} };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** targetDateIso must be a strict YYYY-MM-DD string that is also a real calendar date. */
function isValidTargetDateIso(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = ISO_DATE_RE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year && asUtc.getUTCMonth() === month - 1 && asUtc.getUTCDate() === day
  );
}

/** targetLevel must be a finite integer within the game's valid level range. */
function isValidTargetLevel(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TARGET_LEVEL &&
    value <= LEVEL_CAP
  );
}

/**
 * Normalize one goal entry (§2.1). Returns a clean { targetLevel, targetDateIso }
 * object (unknown fields stripped) when both fields are valid, otherwise null.
 * No "already achieved" / "past date" judgement here — that is T4b/T3's job.
 */
export function normalizeGoal(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const { targetLevel, targetDateIso } = raw;
  if (!isValidTargetLevel(targetLevel) || !isValidTargetDateIso(targetDateIso)) {
    return null;
  }
  return { targetLevel, targetDateIso };
}

function normalizePinnedKeys(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const deduped = [];
  for (const item of value) {
    if (isNonEmptyString(item) && !seen.has(item)) {
      seen.add(item);
      deduped.push(item);
    }
  }
  return deduped.slice(0, MAX_PINS);
}

function normalizePrimaryKey(value, pinnedHistoryKeys) {
  if (isNonEmptyString(value) && pinnedHistoryKeys.includes(value)) {
    return value;
  }
  return pinnedHistoryKeys[0] ?? null;
}

function normalizeGoals(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  const goals = {};
  for (const [key, rawGoal] of Object.entries(value)) {
    if (!isNonEmptyString(key)) {
      continue;
    }
    const goal = normalizeGoal(rawGoal);
    if (goal) {
      goals[key] = goal;
    }
  }
  return goals;
}

/**
 * Normalize a raw (possibly corrupt/foreign) value into a safe Profile.
 * Applied both on load and immediately before every write (§3).
 * Never throws.
 */
export function normalizeProfile(raw) {
  if (!isPlainObject(raw) || raw.version !== PROFILE_VERSION) {
    return defaultProfile();
  }
  const pinnedHistoryKeys = normalizePinnedKeys(raw.pinnedHistoryKeys);
  const primaryHistoryKey = normalizePrimaryKey(raw.primaryHistoryKey, pinnedHistoryKeys);
  const goals = normalizeGoals(raw.goals);
  return { version: PROFILE_VERSION, primaryHistoryKey, pinnedHistoryKeys, goals };
}

// ---------------------------------------------------------------------------
// (b) storage adapter — thin wrapper so tests can inject in-memory / throwing
// backends without touching real localStorage.
// ---------------------------------------------------------------------------

/**
 * Wrap a getItem/setItem-shaped backend (defaults to window.localStorage)
 * scoped to PROFILE_KEY.
 */
export function createProfileStorage(backend = typeof window !== "undefined" ? window.localStorage : undefined) {
  return {
    read() {
      return backend.getItem(PROFILE_KEY);
    },
    write(serialized) {
      backend.setItem(PROFILE_KEY, serialized);
    },
  };
}

/**
 * Classify a raw serialized payload (string | null | undefined) shared by
 * readProfile and interpretStorageEvent so the corrupt/unsupportedVersion/ok
 * rules live in exactly one place.
 */
function classifyPayload(raw) {
  if (raw === null || raw === undefined) {
    return { profile: defaultProfile(), status: "missing" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { profile: defaultProfile(), status: "corrupt" };
  }
  if (!isPlainObject(parsed) || !Object.prototype.hasOwnProperty.call(parsed, "version")) {
    return { profile: defaultProfile(), status: "corrupt" };
  }
  if (parsed.version !== PROFILE_VERSION) {
    // Recognizable-but-unsupported version: return a safe default for display,
    // but the caller must NOT persist this (see ProfileContext §5).
    return { profile: defaultProfile(), status: "unsupportedVersion" };
  }
  return { profile: normalizeProfile(parsed), status: "ok" };
}

/**
 * Read + classify the persisted profile.
 * status ∈ "ok" | "missing" | "corrupt" | "unsupportedVersion" | "storageError".
 */
export function readProfile(storage) {
  let raw;
  try {
    raw = storage.read();
  } catch {
    return { profile: defaultProfile(), status: "storageError" };
  }
  return classifyPayload(raw);
}

/**
 * Normalize + persist. Returns { ok: boolean }. Never removes the existing
 * stored value on failure (setItem throwing leaves prior state untouched).
 */
export function writeProfile(storage, profile) {
  const normalized = normalizeProfile(profile);
  try {
    storage.write(JSON.stringify(normalized));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Pure interpretation of a `window` "storage" event. Returns null when the
 * event is not about this profile key (including the legacy favorites/groups
 * keys, which must never be reacted to here).
 */
export function interpretStorageEvent(event) {
  if (!event || event.key !== PROFILE_KEY) {
    return null;
  }
  return classifyPayload(event.newValue ?? null);
}

// ---------------------------------------------------------------------------
// (a) pure mutation helpers — each returns { profile, code }. Inputs are
// re-normalized defensively so callers always get an invariant-safe profile.
// ---------------------------------------------------------------------------

/** code: added | alreadyPinned | limitReached | invalidKey */
export function addPin(profile, historyKey) {
  const base = normalizeProfile(profile);
  if (!isNonEmptyString(historyKey)) {
    return { profile: base, code: "invalidKey" };
  }
  if (base.pinnedHistoryKeys.includes(historyKey)) {
    return { profile: base, code: "alreadyPinned" };
  }
  if (base.pinnedHistoryKeys.length >= MAX_PINS) {
    return { profile: base, code: "limitReached" };
  }
  const next = normalizeProfile({
    ...base,
    pinnedHistoryKeys: [...base.pinnedHistoryKeys, historyKey],
  });
  return { profile: next, code: "added" };
}

/** code: removed | notPinned | invalidKey. Goals are never deleted here. */
export function removePin(profile, historyKey) {
  const base = normalizeProfile(profile);
  if (!isNonEmptyString(historyKey)) {
    return { profile: base, code: "invalidKey" };
  }
  if (!base.pinnedHistoryKeys.includes(historyKey)) {
    return { profile: base, code: "notPinned" };
  }
  const pinnedHistoryKeys = base.pinnedHistoryKeys.filter((key) => key !== historyKey);
  const primaryHistoryKey =
    base.primaryHistoryKey === historyKey ? pinnedHistoryKeys[0] ?? null : base.primaryHistoryKey;
  const next = normalizeProfile({
    ...base,
    pinnedHistoryKeys,
    primaryHistoryKey,
    goals: base.goals,
  });
  return { profile: next, code: "removed" };
}

/** code: set | notPinned | invalidKey */
export function setPrimaryPin(profile, historyKey) {
  const base = normalizeProfile(profile);
  if (!isNonEmptyString(historyKey)) {
    return { profile: base, code: "invalidKey" };
  }
  if (!base.pinnedHistoryKeys.includes(historyKey)) {
    return { profile: base, code: "notPinned" };
  }
  const next = normalizeProfile({ ...base, primaryHistoryKey: historyKey });
  return { profile: next, code: "set" };
}

/** code: set | invalidKey | invalidGoal. Invalid goals never clear an existing one. */
export function setGoalIn(profile, historyKey, goal) {
  const base = normalizeProfile(profile);
  if (!isNonEmptyString(historyKey)) {
    return { profile: base, code: "invalidKey" };
  }
  const normalizedGoal = normalizeGoal(goal);
  if (!normalizedGoal) {
    return { profile: base, code: "invalidGoal" };
  }
  const next = normalizeProfile({
    ...base,
    goals: { ...base.goals, [historyKey]: normalizedGoal },
  });
  return { profile: next, code: "set" };
}

/** code: cleared | noGoal | invalidKey */
export function clearGoalIn(profile, historyKey) {
  const base = normalizeProfile(profile);
  if (!isNonEmptyString(historyKey)) {
    return { profile: base, code: "invalidKey" };
  }
  if (!(historyKey in base.goals)) {
    return { profile: base, code: "noGoal" };
  }
  const goals = { ...base.goals };
  delete goals[historyKey];
  const next = normalizeProfile({ ...base, goals });
  return { profile: next, code: "cleared" };
}
