export const SCHEDULE_STORAGE_KEY = "maplen-board-schedule-v1";
export const SCHEDULE_SCHEMA_VERSION = 1;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CATEGORIES = new Set(["boss", "other"]);
const RECURRENCES = new Set(["once", "weekly"]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validDate(value) {
  if (!DATE_RE.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function localDateKey(value = new Date()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfScheduleWeek(value = new Date()) {
  const date = new Date(value);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceThursday = (start.getDay() - 4 + 7) % 7;
  start.setDate(start.getDate() - daysSinceThursday);
  return start;
}

export function scheduleWeekDays(value = new Date()) {
  const start = startOfScheduleWeek(value);
  return Array.from({ length: 7 }, (_, index) => (
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
  ));
}
export function createDefaultScheduleState() {
  return { schemaVersion: SCHEDULE_SCHEMA_VERSION, items: [] };
}

export function normalizeScheduleItem(value) {
  if (!isObject(value) || !nonEmpty(value.id) || !nonEmpty(value.title)) return null;
  const recurrence = RECURRENCES.has(value.recurrence) ? value.recurrence : null;
  const category = CATEGORIES.has(value.category) ? value.category : "other";
  if (!recurrence || !TIME_RE.test(value.time || "")) return null;
  const item = {
    id: value.id.trim(),
    title: value.title.trim(),
    category,
    recurrence,
    time: value.time,
    note: typeof value.note === "string" ? value.note.trim().slice(0, 500) : "",
    createdAt: nonEmpty(value.createdAt) ? value.createdAt : null,
  };
  if (recurrence === "once") {
    if (!validDate(value.date)) return null;
    item.date = value.date;
  } else {
    if (!Number.isInteger(value.weekday) || value.weekday < 0 || value.weekday > 6) return null;
    item.weekday = value.weekday;
  }
  return item;
}

export function normalizeScheduleState(raw) {
  if (!isObject(raw) || raw.schemaVersion !== SCHEDULE_SCHEMA_VERSION) {
    return createDefaultScheduleState();
  }
  const seen = new Set();
  const items = [];
  for (const value of Array.isArray(raw.items) ? raw.items : []) {
    const item = normalizeScheduleItem(value);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return { schemaVersion: SCHEDULE_SCHEMA_VERSION, items };
}

export function upsertSchedule(state, input) {
  const base = normalizeScheduleState(state);
  const item = normalizeScheduleItem(input);
  if (!item) return { state: base, code: "invalid" };
  const index = base.items.findIndex((entry) => entry.id === item.id);
  if (index === -1) return { state: { ...base, items: [...base.items, item] }, code: "added" };
  const items = [...base.items];
  items[index] = item;
  return { state: { ...base, items }, code: "updated" };
}

export function removeSchedule(state, id) {
  const base = normalizeScheduleState(state);
  if (!base.items.some((item) => item.id === id)) return { state: base, code: "notFound" };
  return { state: { ...base, items: base.items.filter((item) => item.id !== id) }, code: "removed" };
}

export function schedulesForDate(state, value = new Date()) {
  const base = normalizeScheduleState(state);
  const date = new Date(value);
  const key = localDateKey(date);
  const weekday = date.getDay();
  return base.items
    .filter((item) => item.recurrence === "once" ? item.date === key : item.weekday === weekday)
    .sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title, "ja"));
}

