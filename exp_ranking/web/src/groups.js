import { favoriteKey } from "./favorites";

export const MAX_GROUP_MEMBERS = 15;
const STORAGE_KEY = "msu_exp_ranking_groups";
const ACTIVE_KEY = "msu_exp_ranking_active_group";
const FAVORITES_PANEL_KEY = "msu_exp_ranking_group_favorites_open";
const CHART_HEIGHT_KEY = "msu_exp_ranking_group_chart_height";
const CHART_PERIOD_KEY = "msu_exp_ranking_group_chart_period";
const CHART_START_KEY = "msu_exp_ranking_group_chart_start";
const CHART_END_KEY = "msu_exp_ranking_group_chart_end";

export const GROUP_CHART_PERIOD_MODES = ["7", "30", "custom"];
export const GROUP_CHART_HEIGHT_LEVELS = ["normal", "large", "xlarge"];

export { favoriteKey as groupMemberKey };

export function createGroupId() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadGroupsState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    const groups = Array.isArray(parsed)
      ? parsed
          .filter((item) => item && typeof item.id === "string")
          .map((item) => ({
            id: item.id,
            name: String(item.name || "").trim() || "Group",
            members: Array.isArray(item.members)
              ? [...new Set(item.members.filter((name) => typeof name === "string" && name.trim()))].slice(
                  0,
                  MAX_GROUP_MEMBERS,
                )
              : [],
          }))
      : [];
    const activeGroupId = localStorage.getItem(ACTIVE_KEY) || groups[0]?.id || "";
    return { groups, activeGroupId };
  } catch {
    return { groups: [], activeGroupId: "" };
  }
}

export function saveGroupsState(groups, activeGroupId) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  if (activeGroupId) {
    localStorage.setItem(ACTIVE_KEY, activeGroupId);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function defaultGroupName(index) {
  return `Group ${index}`;
}

export function loadFavoritesPanelOpen() {
  try {
    return localStorage.getItem(FAVORITES_PANEL_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveFavoritesPanelOpen(open) {
  localStorage.setItem(FAVORITES_PANEL_KEY, open ? "true" : "false");
}

export function loadChartHeightLevel() {
  try {
    const value = localStorage.getItem(CHART_HEIGHT_KEY);
    return GROUP_CHART_HEIGHT_LEVELS.includes(value) ? value : "normal";
  } catch {
    return "normal";
  }
}

export function saveChartHeightLevel(level) {
  if (GROUP_CHART_HEIGHT_LEVELS.includes(level)) {
    localStorage.setItem(CHART_HEIGHT_KEY, level);
  }
}

/** Chart area height in px (variant × level). */
export function groupChartHeightPx(variant, level) {
  const compact = { normal: 208, large: 320, xlarge: 448 };
  const full = { normal: 320, large: 480, xlarge: 640 };
  const table = variant === "compact" ? compact : full;
  return table[level] ?? table.normal;
}

export function loadChartPeriodState() {
  try {
    const mode = localStorage.getItem(CHART_PERIOD_KEY);
    const start = localStorage.getItem(CHART_START_KEY) || "";
    const end = localStorage.getItem(CHART_END_KEY) || "";
    if (GROUP_CHART_PERIOD_MODES.includes(mode)) {
      return { mode, start, end };
    }
    return { mode: "7", start: "", end: "" };
  } catch {
    return { mode: "7", start: "", end: "" };
  }
}

export function saveChartPeriodState({ mode, start, end }) {
  if (!GROUP_CHART_PERIOD_MODES.includes(mode)) {
    return;
  }
  localStorage.setItem(CHART_PERIOD_KEY, mode);
  if (mode === "custom") {
    localStorage.setItem(CHART_START_KEY, start || "");
    localStorage.setItem(CHART_END_KEY, end || "");
  }
}
