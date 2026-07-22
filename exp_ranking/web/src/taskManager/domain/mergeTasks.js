import { getCustomResetSnapshot, getCycleKey, millisecondsUntil } from "./reset.js";
import { getTaskProgress, normalizeAssignment, normalizeTaskState } from "./taskModel.js";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInstant(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isBeforeDeadline(endsAt, now) {
  const deadline = parseInstant(endsAt);
  return !endsAt || Boolean(deadline && now < deadline);
}

export function localizeLabel(label, language = "ja") {
  if (typeof label === "string") return label;
  if (!isObject(label)) return "";
  return label[language] || label.ja || label.en || Object.values(label).find((value) => typeof value === "string") || "";
}

function eventEnd(event) {
  const candidates = [event.endsAt, event.claimEndsAt, event.shopEndsAt]
    .map(parseInstant)
    .filter(Boolean);
  return candidates.length ? new Date(Math.max(...candidates.map((date) => date.getTime()))) : null;
}

export function buildEventViews(preset, now, language = "ja") {
  const instant = new Date(now);
  return (Array.isArray(preset?.events) ? preset.events : [])
    .map((event) => {
      const startsAt = parseInstant(event.startsAt);
      const endsAt = parseInstant(event.endsAt);
      const finalDeadline = eventEnd(event);
      if (!event?.id || !startsAt || !endsAt || !finalDeadline) return null;
      const status = instant < startsAt
        ? "upcoming"
        : instant < endsAt
          ? "active"
          : instant < finalDeadline
            ? "closing"
            : "ended";
      return {
        ...event,
        label: localizeLabel(event.label, language) || event.title || event.id,
        status,
        remainingMs: millisecondsUntil(finalDeadline, instant),
        finalDeadlineAt: finalDeadline.toISOString(),
      };
    })
    .filter((event) => event && event.status !== "ended")
    .sort((a, b) => new Date(a.finalDeadlineAt) - new Date(b.finalDeadlineAt));
}

function flattenPresetTasks(preset) {
  const top = Array.isArray(preset?.tasks) ? preset.tasks : [];
  const nested = (Array.isArray(preset?.events) ? preset.events : []).flatMap((event) =>
    (Array.isArray(event.tasks) ? event.tasks : []).map((task) => ({ ...task, eventId: event.id })),
  );
  return [...top, ...nested].map((task, index) => ({ ...task, source: "preset", sourceOrder: index }));
}

export function mergeTasks(preset, rawState, now, options = {}) {
  const instant = new Date(now);
  const language = options.language || "ja";
  const includeHidden = Boolean(options.includeHidden);
  const state = normalizeTaskState(rawState, preset?.version || "");
  const tabById = new Map(state.taskTabs.map((tab) => [tab.id, tab]));
  const events = buildEventViews(preset, now, language);
  const activeEventIds = new Set(events.filter((event) => event.status === "active").map((event) => event.id));
  const custom = state.customTasks.map((task, index) => ({
    ...task,
    label: task.title,
    source: "custom",
    sourceOrder: 10_000 + index,
    defaultEnabled: true,
    defaultNotify: task.notify,
  }));
  const tasks = [...flattenPresetTasks(preset), ...custom]
    .filter((task) => task?.id && ["daily", "weekly", "custom", "once"].includes(task.cadence))
    .filter((task) => !task.eventId || activeEventIds.has(task.eventId))
    .filter((task) => isBeforeDeadline(task.endsAt, instant))
    .filter((task) => isBeforeDeadline(task.visibleUntil, instant))
    .map((task) => {
      const sourceChildren = Array.isArray(task.children) ? task.children : [];
      const activeChildren = sourceChildren.filter((child) => isBeforeDeadline(child.endsAt, instant));
      return { ...task, children: activeChildren, hadChildren: sourceChildren.length > 0 };
    })
    .filter((task) => !task.hadChildren || task.children.length > 0)
    .map((task) => {
      const override = state.taskOverrides[task.id] || {};
      const assignment = normalizeAssignment(override.assignment || task.assignment || { mode: "shared", historyKeys: [] });
      const selectedTab = tabById.get(override.tabId);
      const tabId = selectedTab?.id || null;
      const customReset = task.cadence === "custom" ? getCustomResetSnapshot(now, task) : null;
      const dueAt = parseInstant(task.dueAt);
      const visibleUntil = parseInstant(task.visibleUntil);
      const viewBase = {
        ...task,
        label: task.source === "custom" ? task.label : localizeLabel(task.label, language) || task.id,
        enabled: override.enabled ?? task.defaultEnabled ?? true,
        hidden: override.hidden ?? false,
        notify: override.notify ?? task.defaultNotify ?? false,
        availability: override.availability ?? task.availability ?? "always",
        order: override.order ?? task.sourceOrder,
        assignment,
        tabId,
        cycleKey: getCycleKey(task.cadence, now, task),
        remainingMs: task.endsAt ? millisecondsUntil(parseInstant(task.endsAt), instant) : null,
        dueRemainingMs: dueAt ? millisecondsUntil(dueAt, instant) : null,
        dueOverdue: Boolean(dueAt && instant >= dueAt),
        visibleRemainingMs: visibleUntil ? millisecondsUntil(visibleUntil, instant) : null,
        nextResetAt: customReset?.nextResetAt || null,
        resetRemainingMs: customReset?.remainingMs ?? null,
      };
      const children = (Array.isArray(task.children) ? task.children : []).map((child) => {
        const childView = {
          ...child,
          label: child.title,
          parentId: task.id,
          source: "custom-child",
          cadence: task.cadence,
          eventId: task.eventId,
          assignment,
          tabId,
        cycleKey: getCycleKey(task.cadence, now, task),
          remainingMs: child.endsAt ? millisecondsUntil(parseInstant(child.endsAt), instant) : null,
          children: [],
        };
        return { ...childView, progress: getTaskProgress(state, childView, now) };
      });
      const availabilityState = viewBase.availability === "weekend"
        ? (instant.getUTCDay() === 0 ? "closing" : instant.getUTCDay() === 6 ? "active" : "upcoming")
        : "always";
      const view = { ...viewBase, availabilityState, children };
      return { ...view, progress: getTaskProgress(state, view, now) };
    })
    .filter((task) => task.enabled && (includeHidden || !task.hidden))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return {
    tasks,
    daily: tasks.filter((task) => task.cadence === "daily"),
    weekly: tasks.filter((task) => task.cadence === "weekly"),
    custom: tasks.filter((task) => task.cadence === "custom"),
    event: tasks.filter((task) => task.cadence === "once" || task.eventId),
    events,
  };
}

export function summarizeTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const completed = list.filter((task) => task.progress?.completed).length;
  return {
    total: list.length,
    completed,
    remaining: list.length - completed,
    percent: list.length ? Math.round((completed / list.length) * 100) : 0,
  };
}

