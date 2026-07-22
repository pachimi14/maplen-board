import { localizeLabel } from "./mergeTasks.js";

function activeUntil(endsAt, now) {
  if (!endsAt) return true;
  const deadline = new Date(endsAt);
  return Number.isFinite(deadline.getTime()) && new Date(now) < deadline;
}

export function listTaskTemplates(preset, cadence, language = "ja", now = new Date()) {
  return (Array.isArray(preset?.templates) ? preset.templates : [])
    .filter((template) => template?.id && template.cadence === cadence && activeUntil(template.endsAt, now))
    .map((template) => {
      const sourceChildren = Array.isArray(template.children) ? template.children : [];
      const children = sourceChildren
        .filter((child) => activeUntil(child.endsAt, now))
        .map((child) => ({ title: localizeLabel(child.label, language), ...(child.endsAt ? { endsAt: child.endsAt } : {}) }))
        .filter((child) => child.title);
      if (sourceChildren.length && !children.length) return null;
      return {
        id: template.id,
        cadence: template.cadence,
        availability: template.availability === "weekend" ? "weekend" : "always",
        title: localizeLabel(template.label, language) || template.id,
        endsAt: template.endsAt || null,
        children,
      };
    })
    .filter(Boolean);
}

export function instantiateTaskTemplate(template, createId, now = new Date()) {
  if (!template || typeof createId !== "function") return null;
  const createdAt = new Date(now).toISOString();
  return {
    id: createId("user"),
    title: template.title,
    templateId: template.id,
    cadence: template.cadence,
    notify: false,
    availability: template.availability === "weekend" ? "weekend" : "always",
    assignment: { mode: "shared", historyKeys: [] },
    endsAt: template.endsAt || null,
    deadlineCustomized: false,
    children: template.children.map((child) => ({
      id: createId("item"),
      title: child.title,
      endsAt: child.endsAt || null,
      deadlineCustomized: false,
      createdAt,
    })),
    createdAt,
  };
}
export function migrateInstalledTemplateDeadlines(state, preset, language = "ja") {
  if (!state || !Array.isArray(state.customTasks)) return state;
  const templates = Array.isArray(preset?.templates) ? preset.templates : [];
  const byId = new Map(templates.map((template) => [template.id, template]));
  const byTitle = new Map(templates.map((template) => [localizeLabel(template.label, language), template]));
  const childCandidates = new Map();
  for (const template of templates) {
    for (const child of Array.isArray(template.children) ? template.children : []) {
      if (!child.endsAt) continue;
      const title = localizeLabel(child.label, language);
      if (!title) continue;
      const rows = childCandidates.get(title) || [];
      rows.push(child);
      childCandidates.set(title, rows);
    }
  }
  let changed = false;
  const customTasks = state.customTasks.map((task) => {
    const template = byId.get(task.templateId) || byTitle.get(task.title) || null;
    const templateChildren = new Map((Array.isArray(template?.children) ? template.children : [])
      .map((child) => [localizeLabel(child.label, language), child]));
    let nextTask = task;
    if (!task.templateId && template) {
      nextTask = { ...nextTask, templateId: template.id };
      changed = true;
    }
    if (!task.deadlineCustomized && !task.endsAt && template?.endsAt) {
      nextTask = { ...nextTask, endsAt: template.endsAt };
      changed = true;
    }
    const children = task.children.map((child) => {
      if (child.deadlineCustomized || child.endsAt) return child;
      const direct = templateChildren.get(child.title);
      const unique = childCandidates.get(child.title);
      const source = direct?.endsAt ? direct : unique?.length === 1 ? unique[0] : null;
      if (!source?.endsAt) return child;
      changed = true;
      return { ...child, endsAt: source.endsAt, deadlineCustomized: false };
    });
    return children === task.children ? nextTask : { ...nextTask, children };
  });
  return changed ? { ...state, customTasks } : state;
}
