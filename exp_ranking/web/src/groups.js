import { favoriteKey } from "./favorites";

export const MAX_GROUP_MEMBERS = 6;
const STORAGE_KEY = "msu_exp_ranking_groups";
const ACTIVE_KEY = "msu_exp_ranking_active_group";

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
