export const DASHBOARD_STORAGE_KEY = "maplen-board-dashboard-v1";
export const DASHBOARD_SCHEMA_VERSION = 3;
export const DASHBOARD_CHARACTER_LIMIT = 2;
export const DASHBOARD_THEME_COLORS = ["green", "blue", "purple", "orange"];
export const DASHBOARD_THEME_DEPTHS = ["light", "standard", "deep"];

const GOAL_INPUT = /^(\d+(?:\.\d+)?)$/;
const BILLION = 1000000000n;

export function parseDailyExpGoal(value) {
  const text = String(value ?? "").trim().replaceAll(",", "");
  const match = GOAL_INPUT.exec(text);
  if (!match) return null;
  const numeric = match[1];
  const [whole, fraction = ""] = numeric.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(`${whole}${fraction}`) * BILLION;
  if (scaled % scale !== 0n) return null;
  const result = scaled / scale;
  return result > 0n ? result.toString() : null;
}

function normalizeGoal(value) {
  const text = typeof value === "string" ? value : Number.isSafeInteger(value) ? String(value) : "";
  return /^\d+$/.test(text) && BigInt(text) > 0n ? text : "";
}

function normalizeThemeColor(value) {
  const legacy = { mint: "green", lavender: "purple", peach: "orange" };
  const color = legacy[value] || value;
  return DASHBOARD_THEME_COLORS.includes(color) ? color : "green";
}

function normalizeThemeDepth(value, hasLegacyTheme = false) {
  if (DASHBOARD_THEME_DEPTHS.includes(value)) return value;
  return hasLegacyTheme ? "light" : "deep";
}

export function createDefaultDashboardState() {
  return { schemaVersion: DASHBOARD_SCHEMA_VERSION, reminderMemo: "", dailyExpGoals: {}, legacyDailyExpGoal: "", characterHistoryKeys: [], themeColor: "green", themeDepth: "deep" };
}

export function normalizeDashboardState(raw) {
  if (!raw || typeof raw !== "object" || ![1, 2, DASHBOARD_SCHEMA_VERSION].includes(raw.schemaVersion)) {
    return createDefaultDashboardState();
  }
  const dailyExpGoals = raw.schemaVersion >= 2 && raw.dailyExpGoals && typeof raw.dailyExpGoals === "object"
    ? Object.fromEntries(Object.entries(raw.dailyExpGoals).map(([key, value]) => [key, normalizeGoal(value)]).filter(([key, value]) => key && value))
    : {};
  const characterHistoryKeys = Array.isArray(raw.characterHistoryKeys)
    ? [...new Set(raw.characterHistoryKeys.filter((key) => typeof key === "string" && key.trim()).map((key) => key.trim()))].slice(0, DASHBOARD_CHARACTER_LIMIT)
    : [];
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    reminderMemo: typeof raw.reminderMemo === "string" ? raw.reminderMemo.slice(0, 4000) : "",
    dailyExpGoals,
    characterHistoryKeys,
    legacyDailyExpGoal: normalizeGoal(raw.schemaVersion === 1 ? raw.dailyExpGoal : raw.legacyDailyExpGoal),
    themeColor: normalizeThemeColor(raw.themeColor || raw.theme),
    themeDepth: normalizeThemeDepth(raw.themeDepth, Boolean(raw.theme)),
  };
}

export function addDashboardCharacter(state, historyKey) {
  const base = normalizeDashboardState(state);
  const key = typeof historyKey === "string" ? historyKey.trim() : "";
  if (!key) return { state: base, ok: false, code: "invalidKey" };
  if (base.characterHistoryKeys.includes(key)) return { state: base, ok: false, code: "alreadyPinned" };
  if (base.characterHistoryKeys.length >= DASHBOARD_CHARACTER_LIMIT) return { state: base, ok: false, code: "limitReached" };
  return { state: { ...base, characterHistoryKeys: [...base.characterHistoryKeys, key] }, ok: true };
}

export function removeDashboardCharacter(state, historyKey) {
  const base = normalizeDashboardState(state);
  if (!base.characterHistoryKeys.includes(historyKey)) return { state: base, ok: false, code: "notPinned" };
  return { state: { ...base, characterHistoryKeys: base.characterHistoryKeys.filter((key) => key !== historyKey) }, ok: true };
}

export function setReminderMemo(state, reminderMemo) {
  const base = normalizeDashboardState(state);
  return { ...base, reminderMemo: String(reminderMemo ?? "").slice(0, 4000) };
}

export function getDailyExpGoal(state, historyKey) {
  return normalizeDashboardState(state).dailyExpGoals[historyKey] || "";
}

export function setDailyExpGoal(state, historyKey, dailyExpGoal) {
  const base = normalizeDashboardState(state);
  return { ...base, dailyExpGoals: { ...base.dailyExpGoals, [historyKey]: normalizeGoal(dailyExpGoal) } };
}

export function claimLegacyDailyExpGoal(state, historyKey) {
  const base = normalizeDashboardState(state);
  if (!historyKey || !base.legacyDailyExpGoal) return base;
  return {
    ...base,
    dailyExpGoals: base.dailyExpGoals[historyKey] ? base.dailyExpGoals : { ...base.dailyExpGoals, [historyKey]: base.legacyDailyExpGoal },
    legacyDailyExpGoal: "",
  };
}

export function setDashboardThemeColor(state, themeColor) {
  const base = normalizeDashboardState(state);
  return { ...base, themeColor: normalizeThemeColor(themeColor) };
}

export function setDashboardThemeDepth(state, themeDepth) {
  const base = normalizeDashboardState(state);
  return { ...base, themeDepth: normalizeThemeDepth(themeDepth) };
}

export function dailyExpGoalRemaining(gain, goal) {
  if (!/^\d+$/.test(String(gain ?? "")) || !/^\d+$/.test(String(goal ?? "")) || BigInt(goal) <= 0n) return null;
  const remaining = BigInt(goal) - BigInt(gain);
  return (remaining > 0n ? remaining : 0n).toString();
}

export function dailyExpGoalProgress(gain, goal) {
  if (!/^\d+$/.test(String(gain ?? "")) || !/^\d+$/.test(String(goal ?? "")) || BigInt(goal) <= 0n) return null;
  const basisPoints = BigInt(gain) * 10000n / BigInt(goal);
  return Number(basisPoints) / 100;
}

