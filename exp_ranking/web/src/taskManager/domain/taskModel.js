import { getCycleKey } from "./reset.js";
import { defaultNotificationSettings, normalizeNotificationSettings } from "./notificationModel.js";

export const TASKS_STORAGE_KEY = "maplen-board-tasks-v1";
export const TASKS_SCHEMA_VERSION = 9;
export const LEGACY_TASKS_SCHEMA_VERSION = 1;
export const SUPPORTED_TASKS_SCHEMA_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const CADENCES = new Set(["daily", "weekly", "once", "custom"]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEndsAt(value) {
  if (!isNonEmptyString(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeResetRule(value) {
  if (!isObject(value) || value.mode === "none") return { mode: "none" };
  const firstAt = normalizeEndsAt(value.firstAt);
  if (!firstAt) return { mode: "none" };
  if (value.mode === "once") return { mode: "once", firstAt };
  if (value.mode !== "interval") return { mode: "none" };
  const every = Number(value.every);
  if (!Number.isInteger(every) || every < 1 || every > 365) return { mode: "none" };
  return { mode: "interval", firstAt, every, unit: value.unit === "week" ? "week" : "day" };
}

function normalizeHistoryKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isNonEmptyString).map((key) => key.trim()))];
}

export function normalizeAssignment(value) {
  if (!isObject(value) || value.mode !== "characters") {
    return { mode: "shared", historyKeys: [] };
  }
  const historyKeys = normalizeHistoryKeys(value.historyKeys);
  return historyKeys.length
    ? { mode: "characters", historyKeys }
    : { mode: "shared", historyKeys: [] };
}

export function createDefaultTaskState(presetVersion = "") {
  return {
    schemaVersion: TASKS_SCHEMA_VERSION,
    presetVersion: typeof presetVersion === "string" ? presetVersion : "",
    taskTabs: [],
    taskOverrides: {},
    customTasks: [],
    completions: {},
    notificationSettings: defaultNotificationSettings(),
  };
}

function normalizeOverride(value) {
  if (!isObject(value)) return null;
  const result = {};
  if (typeof value.enabled === "boolean") result.enabled = value.enabled;
  if (typeof value.hidden === "boolean") result.hidden = value.hidden;
  if (Number.isFinite(value.order)) result.order = Math.trunc(value.order);
  if (typeof value.notify === "boolean") result.notify = value.notify;
  if (["always", "weekend"].includes(value.availability)) result.availability = value.availability;
  if (value.assignment !== undefined) result.assignment = normalizeAssignment(value.assignment);
  if (isNonEmptyString(value.tabId)) result.tabId = value.tabId.trim();
  return result;
}

function normalizeTaskTab(value) {
  if (!isObject(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.name)) return null;
  return { id: value.id.trim(), name: value.name.trim(), createdAt: isNonEmptyString(value.createdAt) ? value.createdAt : null };
}

function normalizeChildTask(value) {
  if (!isObject(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.title)) return null;
  return {
    id: value.id.trim(),
    title: value.title.trim(),
    endsAt: normalizeEndsAt(value.endsAt),
    deadlineCustomized: Boolean(value.deadlineCustomized),
    createdAt: isNonEmptyString(value.createdAt) ? value.createdAt : null,
  };
}

function normalizeCustomTask(value) {
  if (!isObject(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.title)) return null;
  const cadence = CADENCES.has(value.cadence) ? value.cadence : null;
  if (!cadence || (cadence === "once" && !isNonEmptyString(value.eventId))) return null;
  const seenChildren = new Set();
  const children = [];
  for (const candidate of Array.isArray(value.children) ? value.children : []) {
    const child = normalizeChildTask(candidate);
    if (child && !seenChildren.has(child.id)) {
      seenChildren.add(child.id);
      children.push(child);
    }
  }
  return {
    id: value.id.trim(),
    title: value.title.trim(),
    cadence,
    eventId: isNonEmptyString(value.eventId) ? value.eventId.trim() : null,
    templateId: isNonEmptyString(value.templateId) ? value.templateId.trim() : null,
    notify: Boolean(value.notify),
    availability: value.availability === "weekend" && cadence === "weekly" ? "weekend" : "always",
    assignment: normalizeAssignment(value.assignment),
    children,
    endsAt: normalizeEndsAt(value.endsAt),
    dueAt: cadence === "custom" ? normalizeEndsAt(value.dueAt) : null,
    visibleUntil: cadence === "custom" ? normalizeEndsAt(value.visibleUntil) : null,
    resetRule: cadence === "custom" ? normalizeResetRule(value.resetRule) : { mode: "none" },
    deadlineCustomized: Boolean(value.deadlineCustomized),
    createdAt: isNonEmptyString(value.createdAt) ? value.createdAt : null,
  };
}

function normalizeCompletionEntry(value) {
  if (!isObject(value)) return null;
  const entry = { characters: {} };
  if (isNonEmptyString(value.shared)) entry.shared = value.shared;
  if (isObject(value.characters)) {
    for (const [historyKey, completedAt] of Object.entries(value.characters)) {
      if (isNonEmptyString(historyKey) && isNonEmptyString(completedAt)) {
        entry.characters[historyKey] = completedAt;
      }
    }
  }
  return entry.shared || Object.keys(entry.characters).length ? entry : null;
}

export function normalizeTaskState(raw, presetVersion = "") {
  if (!isObject(raw) || !SUPPORTED_TASKS_SCHEMA_VERSIONS.includes(raw.schemaVersion)) {
    return createDefaultTaskState(presetVersion);
  }
  const state = createDefaultTaskState(
    typeof raw.presetVersion === "string" ? raw.presetVersion : presetVersion,
  );
  const tabIdRemap = new Map();
  if (Array.isArray(raw.taskTabs)) {
    const seenTabIds = new Set();
    const tabByName = new Map();
    for (const value of raw.taskTabs) {
      const tab = normalizeTaskTab(value);
      if (!tab || seenTabIds.has(tab.id)) continue;
      seenTabIds.add(tab.id);
      const existing = tabByName.get(tab.name);
      if (existing) {
        tabIdRemap.set(tab.id, existing.id);
        continue;
      }
      tabByName.set(tab.name, tab);
      tabIdRemap.set(tab.id, tab.id);
      state.taskTabs.push(tab);
    }
  }
  if (isObject(raw.taskOverrides)) {
    for (const [taskId, value] of Object.entries(raw.taskOverrides)) {
      if (!isNonEmptyString(taskId)) continue;
      const normalized = normalizeOverride(value);
      if (normalized?.tabId && tabIdRemap.has(normalized.tabId)) normalized.tabId = tabIdRemap.get(normalized.tabId);
      if (normalized) state.taskOverrides[taskId] = normalized;
    }
  }
  if (Array.isArray(raw.customTasks)) {
    const seenIds = new Set();
    for (const value of raw.customTasks) {
      const task = normalizeCustomTask(value);
      if (!task || seenIds.has(task.id)) continue;
      seenIds.add(task.id);
      task.children = task.children.filter((child) => {
        if (seenIds.has(child.id)) return false;
        seenIds.add(child.id);
        return true;
      });
      state.customTasks.push(task);
    }
  }
  state.notificationSettings = normalizeNotificationSettings(raw.notificationSettings);
  if (isObject(raw.completions)) {
    for (const [taskId, cycles] of Object.entries(raw.completions)) {
      if (!isNonEmptyString(taskId) || !isObject(cycles)) continue;
      const normalizedCycles = {};
      for (const [cycleKey, value] of Object.entries(cycles)) {
        if (!isNonEmptyString(cycleKey)) continue;
        const entry = normalizeCompletionEntry(value);
        if (entry) normalizedCycles[cycleKey] = entry;
      }
      if (Object.keys(normalizedCycles).length) state.completions[taskId] = normalizedCycles;
    }
  }
  for (const task of state.customTasks) {
    task.assignment = { mode: "shared", historyKeys: [] };
  }
  for (const [taskId, override] of Object.entries(state.taskOverrides)) {
    if (override.assignment !== undefined) {
      const { assignment: removed, ...rest } = override;
      state.taskOverrides[taskId] = rest;
    }
  }
  for (const cycles of Object.values(state.completions)) {
    for (const entry of Object.values(cycles)) {
      const characterCompletions = Object.values(entry.characters || {});
      if (!entry.shared && characterCompletions.length) {
        entry.shared = characterCompletions.sort().at(-1);
      }
    }
  }  return state;
}

export function addCustomTask(state, input) {
  const base = normalizeTaskState(state, state?.presetVersion);
  const task = normalizeCustomTask(input);
  if (!task) return { state: base, code: "invalidTask" };
  const existingIds = new Set(base.customTasks.flatMap((item) => [item.id, ...item.children.map((child) => child.id)]));
  if (existingIds.has(task.id)) return { state: base, code: "duplicateId" };
  task.children = task.children.filter(
    (child) => child.id !== task.id && !existingIds.has(child.id),
  );
  return { state: { ...base, customTasks: [...base.customTasks, task] }, code: "added" };
}

export function updateCustomTask(state, taskId, patch) {
  const base = normalizeTaskState(state, state?.presetVersion);
  if (!isObject(patch)) return { state: base, code: "invalidTask" };
  const target = base.customTasks.find((task) => task.id === taskId);
  if (!target) return { state: base, code: "notFound" };
  const title = patch.title === undefined ? target.title : patch.title;
  if (!isNonEmptyString(title)) return { state: base, code: "invalidTask" };
  const endsAt = patch.endsAt === undefined ? target.endsAt : normalizeEndsAt(patch.endsAt);
  if (patch.endsAt && !endsAt) return { state: base, code: "invalidTask" };
  const dueAt = patch.dueAt === undefined ? target.dueAt : normalizeEndsAt(patch.dueAt);
  const visibleUntil = patch.visibleUntil === undefined ? target.visibleUntil : normalizeEndsAt(patch.visibleUntil);
  const resetRule = patch.resetRule === undefined ? target.resetRule : normalizeResetRule(patch.resetRule);
  if (patch.dueAt && !dueAt) return { state: base, code: "invalidTask" };
  if (patch.visibleUntil && !visibleUntil) return { state: base, code: "invalidTask" };
  return {
    state: {
      ...base,
      customTasks: base.customTasks.map((task) => task.id === taskId
        ? { ...task, title: title.trim(), endsAt, dueAt, visibleUntil, resetRule, deadlineCustomized: patch.endsAt === undefined ? task.deadlineCustomized : true }
        : task),
    },
    code: "updated",
  };
}

export function reorderItems(items, sourceId, targetId, position = "before") {
  if (!Array.isArray(items) || sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;
  const next = [...items];
  const [source] = next.splice(sourceIndex, 1);
  const adjustedTargetIndex = next.findIndex((item) => item.id === targetId);
  const insertionIndex = adjustedTargetIndex + (position === "after" ? 1 : 0);
  next.splice(insertionIndex, 0, source);
  return next;
}

export function reorderChildTasks(state, parentId, sourceId, targetId, position = "before") {
  const base = normalizeTaskState(state, state?.presetVersion);
  const parent = base.customTasks.find((task) => task.id === parentId);
  if (!parent) return { state: base, code: "notFound" };
  const children = reorderItems(parent.children, sourceId, targetId, position);
  if (children === parent.children) return { state: base, code: "notFound" };
  return {
    state: {
      ...base,
      customTasks: base.customTasks.map((task) => task.id === parentId ? { ...task, children } : task),
    },
    code: "reordered",
  };
}
export function updateChildTask(state, parentId, childId, patch) {
  const base = normalizeTaskState(state, state?.presetVersion);
  if (!isObject(patch)) return { state: base, code: "invalidTask" };
  const parent = base.customTasks.find((task) => task.id === parentId);
  const target = parent?.children.find((child) => child.id === childId);
  if (!target) return { state: base, code: "notFound" };
  const title = patch.title === undefined ? target.title : patch.title;
  if (!isNonEmptyString(title)) return { state: base, code: "invalidTask" };
  const endsAt = patch.endsAt === undefined ? target.endsAt : normalizeEndsAt(patch.endsAt);
  if (patch.endsAt && !endsAt) return { state: base, code: "invalidTask" };
  return {
    state: {
      ...base,
      customTasks: base.customTasks.map((task) => task.id === parentId
        ? {
            ...task,
            children: task.children.map((child) => child.id === childId
              ? { ...child, title: title.trim(), endsAt, deadlineCustomized: patch.endsAt === undefined ? child.deadlineCustomized : true }
              : child),
          }
        : task),
    },
    code: "updated",
  };
}
export function addChildTask(state, parentId, input) {
  const base = normalizeTaskState(state, state?.presetVersion);
  const child = normalizeChildTask(input);
  const parent = base.customTasks.find((task) => task.id === parentId);
  if (!parent) return { state: base, code: "notFound" };
  if (!child) return { state: base, code: "invalidTask" };
  const existingIds = new Set(base.customTasks.flatMap((task) => [task.id, ...task.children.map((item) => item.id)]));
  if (existingIds.has(child.id)) return { state: base, code: "duplicateId" };
  const completions = { ...base.completions };
  if (!parent.children.length) delete completions[parent.id];
  return {
    state: {
      ...base,
      customTasks: base.customTasks.map((task) => task.id === parentId
        ? { ...task, children: [...task.children, child] }
        : task),
      completions,
    },
    code: "added",
  };
}

export function removeChildTask(state, parentId, childId) {
  const base = normalizeTaskState(state, state?.presetVersion);
  const parent = base.customTasks.find((task) => task.id === parentId);
  if (!parent || !parent.children.some((child) => child.id === childId)) {
    return { state: base, code: "notFound" };
  }
  const completions = { ...base.completions };
  delete completions[childId];
  return {
    state: {
      ...base,
      customTasks: base.customTasks.map((task) => task.id === parentId
        ? { ...task, children: task.children.filter((child) => child.id !== childId) }
        : task),
      completions,
    },
    code: "removed",
  };
}

export function removeCustomTask(state, taskId) {
  const base = normalizeTaskState(state, state?.presetVersion);
  const target = base.customTasks.find((task) => task.id === taskId);
  if (!target) return { state: base, code: "notFound" };
  const taskOverrides = { ...base.taskOverrides };
  const completions = { ...base.completions };
  delete taskOverrides[taskId];
  delete completions[taskId];
  for (const child of target.children) delete completions[child.id];
  return {
    state: {
      ...base,
      customTasks: base.customTasks.filter((task) => task.id !== taskId),
      taskOverrides,
      completions,
    },
    code: "removed",
  };
}

export function addTaskTab(state, input) {
  const base = normalizeTaskState(state, state?.presetVersion);
  const tab = normalizeTaskTab(input);
  if (!tab) return { state: base, code: "invalidTab" };
  if (base.taskTabs.some((item) => item.id === tab.id)) return { state: base, code: "duplicateId" };
  return { state: { ...base, taskTabs: [...base.taskTabs, tab] }, code: "added" };
}

export function renameTaskTab(state, tabId, name) {
  const base = normalizeTaskState(state, state?.presetVersion);
  if (!isNonEmptyString(name)) return { state: base, code: "invalidTab" };
  if (!base.taskTabs.some((tab) => tab.id === tabId)) return { state: base, code: "notFound" };
  return { state: { ...base, taskTabs: base.taskTabs.map((tab) => tab.id === tabId ? { ...tab, name: name.trim() } : tab) }, code: "updated" };
}

export function removeTaskTab(state, tabId) {
  const base = normalizeTaskState(state, state?.presetVersion);
  if (!base.taskTabs.some((tab) => tab.id === tabId)) return { state: base, code: "notFound" };
  const taskOverrides = Object.fromEntries(Object.entries(base.taskOverrides).map(([taskId, override]) => {
    if (override.tabId !== tabId) return [taskId, override];
    const { tabId: removed, ...rest } = override;
    return [taskId, rest];
  }));
  return { state: { ...base, taskTabs: base.taskTabs.filter((tab) => tab.id !== tabId), taskOverrides }, code: "removed" };
}

export function listTaskTabs(state) {
  const base = normalizeTaskState(state, state?.presetVersion);
  return base.taskTabs;
}

export function setTaskOverride(state, taskId, patch) {
  const base = normalizeTaskState(state, state?.presetVersion);
  if (!isNonEmptyString(taskId) || !isObject(patch)) return base;
  const normalized = normalizeOverride({ ...(base.taskOverrides[taskId] || {}), ...patch });
  return { ...base, taskOverrides: { ...base.taskOverrides, [taskId]: normalized || {} } };
}

function scopesForTask(task) {
  const assignment = normalizeAssignment(task.assignment);
  return assignment.mode === "characters" ? assignment.historyKeys : ["shared"];
}

function leafProgress(base, task, now) {
  const cycleKey = task.cycleKey || getCycleKey(task.cadence, now, task);
  const entry = base.completions[task.id]?.[cycleKey] || { characters: {} };
  const scopes = scopesForTask(task);
  const completedScopes = scopes.filter((scope) => (
    scope === "shared" ? Boolean(entry.shared) : Boolean(entry.characters?.[scope])
  ));
  return {
    cycleKey,
    completed: completedScopes.length === scopes.length,
    completedCount: completedScopes.length,
    totalCount: scopes.length,
    scopes,
  };
}

function childAsTask(parent, child) {
  return {
    ...parent,
    id: child.id,
    title: child.title,
    label: child.label || child.title,
    children: [],
  };
}

export function getTaskProgress(state, task, now) {
  const base = normalizeTaskState(state, state?.presetVersion);
  const children = Array.isArray(task.children) ? task.children : [];
  if (!children.length) return leafProgress(base, task, now);
  const childProgress = children.map((child) => leafProgress(base, childAsTask(task, child), now));
  return {
    cycleKey: task.cycleKey || getCycleKey(task.cadence, now, task),
    completed: childProgress.every((progress) => progress.completed),
    completedCount: childProgress.filter((progress) => progress.completed).length,
    totalCount: childProgress.length,
    scopes: scopesForTask(task),
  };
}

function setLeafCompleted(completions, task, now, completed) {
  const cycleKey = task.cycleKey || getCycleKey(task.cadence, now, task);
  const scopes = scopesForTask(task);
  completions[task.id] ||= {};
  const entry = structuredClone(completions[task.id][cycleKey] || { characters: {} });
  entry.characters ||= {};
  for (const scope of scopes) {
    if (completed) {
      const completedAt = new Date(now).toISOString();
      if (scope === "shared") entry.shared = completedAt;
      else entry.characters[scope] = completedAt;
    } else if (scope === "shared") {
      delete entry.shared;
    } else {
      delete entry.characters[scope];
    }
  }
  if (!entry.shared && Object.keys(entry.characters).length === 0) {
    delete completions[task.id][cycleKey];
  } else {
    completions[task.id][cycleKey] = entry;
  }
  if (Object.keys(completions[task.id]).length === 0) delete completions[task.id];
}

export function toggleTaskCompletion(state, task, now) {
  const base = normalizeTaskState(state, state?.presetVersion);
  const progress = getTaskProgress(base, task, now);
  const completions = structuredClone(base.completions);
  const children = Array.isArray(task.children) ? task.children : [];
  if (children.length) {
    for (const child of children) setLeafCompleted(completions, childAsTask(task, child), now, !progress.completed);
  } else {
    setLeafCompleted(completions, task, now, !progress.completed);
  }
  return { ...base, completions };
}

