export const EVENTS_STORAGE_KEY = "maplen-board-events-v1";
export const EVENTS_SCHEMA_VERSION = 1;

function isObject(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function instant(value) { if (typeof value !== "string") return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString(); }

export function normalizeUserEvent(value) {
  if (!isObject(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.title !== "string" || !value.title.trim()) return null;
  const startsAt = instant(value.startsAt); const endsAt = instant(value.endsAt);
  if (!startsAt || !endsAt || new Date(endsAt) < new Date(startsAt)) return null;
  const claimEndsAt = instant(value.claimEndsAt); const shopEndsAt = instant(value.shopEndsAt);
  const note = typeof value.note === "string" ? value.note.trim().slice(0, 120) : "";
  return { id: value.id.trim(), title: value.title.trim(), note, startsAt, endsAt, claimEndsAt, shopEndsAt, createdAt: instant(value.createdAt) || new Date(0).toISOString() };
}

export function createDefaultEventState() { return { schemaVersion: EVENTS_SCHEMA_VERSION, items: [] }; }
export function normalizeEventState(raw) {
  if (!isObject(raw) || raw.schemaVersion !== EVENTS_SCHEMA_VERSION) return createDefaultEventState();
  const seen = new Set(); const items = [];
  for (const candidate of Array.isArray(raw.items) ? raw.items : []) { const item = normalizeUserEvent(candidate); if (item && !seen.has(item.id)) { seen.add(item.id); items.push(item); } }
  return { schemaVersion: EVENTS_SCHEMA_VERSION, items };
}
export function upsertUserEvent(state, input) {
  const base = normalizeEventState(state); const item = normalizeUserEvent(input);
  if (!item) return { state: base, code: "invalidEvent" };
  const exists = base.items.some((current) => current.id === item.id);
  return { state: { ...base, items: exists ? base.items.map((current) => current.id === item.id ? item : current) : [...base.items, item] }, code: exists ? "updated" : "added" };
}
export function removeUserEvent(state, id) { const base = normalizeEventState(state); return { ...base, items: base.items.filter((item) => item.id !== id) }; }
export function instantiateEventTemplate(template, id, now = new Date()) {
  return normalizeUserEvent({ ...template, id, title: template?.label?.ja || template?.title || "", createdAt: now.toISOString() });
}
