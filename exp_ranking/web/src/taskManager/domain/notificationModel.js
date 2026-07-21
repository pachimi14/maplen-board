export const MAX_CUSTOM_NOTIFICATION_RULES = 10;
export const MAX_NOTIFICATION_RULES = 12;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;

export function isQuarterHour(value) {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

export function isValidTimeZone(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function defaultNotificationSettings(timeZone = "UTC") {
  return {
    timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
    daily: { enabled: false, time: "20:00" },
    weekly: { enabled: false, weekday: 3, time: "20:00" },
    custom: {},
  };
}

function normalizeScheduledAt(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCMinutes() % 15 !== 0 || date.getUTCSeconds() !== 0) return null;
  return date.toISOString();
}

export function normalizeNotificationSettings(value, fallbackTimeZone = "UTC") {
  const base = defaultNotificationSettings(fallbackTimeZone);
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const timeZone = isValidTimeZone(value.timeZone) ? value.timeZone : base.timeZone;
  const dailyTime = isQuarterHour(value.daily?.time) ? value.daily.time : base.daily.time;
  const weeklyTime = isQuarterHour(value.weekly?.time) ? value.weekly.time : base.weekly.time;
  const weekday = Number.isInteger(value.weekly?.weekday) && value.weekly.weekday >= 0 && value.weekly.weekday <= 6 ? value.weekly.weekday : base.weekly.weekday;
  const custom = {};
  for (const [taskId, rule] of Object.entries(value.custom || {}).slice(0, MAX_CUSTOM_NOTIFICATION_RULES)) {
    if (!taskId || taskId.length > 128 || !rule?.enabled) continue;
    const scheduledAt = normalizeScheduledAt(rule.scheduledAt);
    if (scheduledAt) custom[taskId] = { enabled: true, scheduledAt };
  }
  return {
    timeZone,
    daily: { enabled: Boolean(value.daily?.enabled), time: dailyTime },
    weekly: { enabled: Boolean(value.weekly?.enabled), weekday, time: weeklyTime },
    custom,
  };
}

export function buildNotificationSnapshot(view, settings) {
  const normalized = normalizeNotificationSettings(settings);
  const tasks = [...(view?.daily || []), ...(view?.weekly || []), ...(view?.custom || [])]
    .filter((task) => !task.hidden && !task.progress?.completed && (task.cadence !== "custom" || Boolean(normalized.custom[task.id])))
    .slice(0, 200)
    .map((task) => ({
      id: task.id,
      title: String(task.label || "").slice(0, 120),
      cadence: task.cadence,
      completed: Boolean(task.progress?.completed),
    }));
  return { schemaVersion: 1, settings: normalized, tasks };
}
