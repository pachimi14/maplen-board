export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("A valid date is required");
  }
  return date;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function toUtcDateKey(value) {
  const date = asDate(value);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function startOfUtcDay(value) {
  const date = asDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getDailyCycleKey(now) {
  return `day:${toUtcDateKey(now)}`;
}

export function getWeeklyCycleStart(now) {
  const start = startOfUtcDay(now);
  const daysSinceThursday = (start.getUTCDay() - 4 + 7) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceThursday);
  return start;
}

export function getWeeklyCycleKey(now) {
  return `week:${toUtcDateKey(getWeeklyCycleStart(now))}`;
}

function customResetInfo(now, identity = {}) {
  const rule = identity.resetRule || { mode: "none" };
  if (rule.mode === "none") return { cycleKey: "custom:forever", nextResetAt: null, remainingMs: null };
  const firstAt = new Date(rule.firstAt);
  if (!Number.isFinite(firstAt.getTime())) return { cycleKey: "custom:forever", nextResetAt: null, remainingMs: null };
  const instant = asDate(now);
  if (rule.mode === "once") {
    const before = instant < firstAt;
    return {
      cycleKey: before ? `custom:before:${firstAt.toISOString()}` : `custom:after:${firstAt.toISOString()}`,
      nextResetAt: before ? firstAt.toISOString() : null,
      remainingMs: before ? millisecondsUntil(firstAt, instant) : null,
    };
  }
  const every = Number.isInteger(rule.every) && rule.every > 0 ? rule.every : 1;
  const unitMs = rule.unit === "week" ? WEEK_MS : DAY_MS;
  const intervalMs = every * unitMs;
  const elapsed = instant.getTime() - firstAt.getTime();
  const cycleIndex = elapsed < 0 ? 0 : Math.floor(elapsed / intervalMs) + 1;
  const nextReset = elapsed < 0 ? firstAt : new Date(firstAt.getTime() + cycleIndex * intervalMs);
  return {
    cycleKey: `custom:interval:${firstAt.toISOString()}:${every}:${rule.unit === "week" ? "week" : "day"}:${cycleIndex}`,
    nextResetAt: nextReset.toISOString(),
    remainingMs: millisecondsUntil(nextReset, instant),
  };
}

export function getCustomResetSnapshot(now, identity = {}) {
  return customResetInfo(now, identity);
}
export function getCycleKey(cadence, now, identity = {}) {
  if (cadence === "daily") {
    return getDailyCycleKey(now);
  }
  if (cadence === "weekly") {
    return getWeeklyCycleKey(now);
  }
  if (cadence === "custom") {
    return customResetInfo(now, identity).cycleKey;
  }
  if (cadence === "once") {
    const key = identity.eventId || identity.taskId;
    if (!key) {
      throw new TypeError("once cadence requires eventId or taskId");
    }
    return `once:${key}`;
  }
  throw new TypeError(`Unsupported cadence: ${cadence}`);
}

export function getNextDailyReset(now) {
  const next = startOfUtcDay(now);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function getNextWeeklyReset(now) {
  const next = getWeeklyCycleStart(now);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

export function getNextReset(cadence, now) {
  if (cadence === "daily") {
    return getNextDailyReset(now);
  }
  if (cadence === "weekly") {
    return getNextWeeklyReset(now);
  }
  return null;
}

export function millisecondsUntil(target, now) {
  const remaining = asDate(target).getTime() - asDate(now).getTime();
  return Math.max(0, remaining);
}

export function getResetSnapshot(now) {
  const instant = asDate(now);
  const dailyAt = getNextDailyReset(instant);
  const weeklyAt = getNextWeeklyReset(instant);
  return {
    nowIso: instant.toISOString(),
    daily: {
      cycleKey: getDailyCycleKey(instant),
      nextResetAt: dailyAt.toISOString(),
      remainingMs: millisecondsUntil(dailyAt, instant),
    },
    weekly: {
      cycleKey: getWeeklyCycleKey(instant),
      nextResetAt: weeklyAt.toISOString(),
      remainingMs: millisecondsUntil(weeklyAt, instant),
    },
  };
}

