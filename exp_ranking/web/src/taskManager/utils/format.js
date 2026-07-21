function formatUnit(value, unit, language) {
  const formatted = new Intl.NumberFormat(language, {
    style: "unit",
    unit,
    unitDisplay: "short",
  }).format(value);
  return /^(ja|zh)/.test(language) ? formatted.replace(/\s/g, "") : formatted;
}

export function formatRemaining(milliseconds, language = "ja") {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return [formatUnit(days, "day", language), formatUnit(hours, "hour", language), formatUnit(minutes, "minute", language)].join(" ");
  if (hours > 0) return [formatUnit(hours, "hour", language), formatUnit(minutes, "minute", language)].join(" ");
  return [formatUnit(minutes, "minute", language), formatUnit(seconds, "second", language)].join(" ");
}

export function formatCompactRemaining(milliseconds, language = "ja") {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(totalMinutes / 1440);
  if (days > 0) return formatUnit(days, "day", language);
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return formatUnit(hours, "hour", language);
  return formatUnit(totalMinutes, "minute", language);
}

export function formatUtcDeadline(value, language = "ja") {
  return new Intl.DateTimeFormat(language, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value)) + " UTC";
}
export function formatExp(value, language = "ja") {
  const amount = Number.isFinite(value) ? value : 0;
  if (amount >= 1_000_000_000_000) return `${(amount / 1_000_000_000_000).toFixed(2)}T`;
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  return new Intl.NumberFormat(language).format(amount);
}

