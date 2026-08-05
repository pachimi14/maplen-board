// IMPL_PLAN_SH5 §2: display formatting for the chart / summary / tooltip.
// Pure functions, no i18n (design's chart spec fixes "950M" / "1.25B"
// style regardless of locale -- these are compact-magnitude numbers, not
// translated text) and no DOM.

/** design §2: "縦軸は 950M / 1.25B 形式の省略表示". Two significant digits
 * once the magnitude reaches 100+ of its unit (matching the spec's own
 * "950M" example, not "950.00M"); two decimals below that (matching
 * "1.25B"). */
export function formatCompactNeso(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    const scaled = abs / 1e9;
    return `${sign}${scaled.toFixed(scaled >= 100 ? 0 : 2)}B`;
  }
  if (abs >= 1e6) {
    const scaled = abs / 1e6;
    return `${sign}${scaled.toFixed(scaled >= 100 ? 0 : 2)}M`;
  }
  if (abs >= 1e3) {
    const scaled = abs / 1e3;
    return `${sign}${scaled.toFixed(scaled >= 100 ? 0 : 2)}K`;
  }
  return `${sign}${Math.round(abs)}`;
}

/** Same magnitude formatting, prefixed with an explicit "+" for
 * non-negative deltas (design §2: tooltip shows "前回比" / "期間平均との差"). */
export function formatSignedCompactNeso(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return value >= 0 ? `+${formatCompactNeso(value)}` : formatCompactNeso(value);
}

/** design §2: "ツールチップは正確な数値". Full precision (up to the 2
 * decimals the API already rounds to -- see server/sf-history/app.py),
 * thousands-separated. */
export function formatExactNeso(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} NESO`;
}

// IMPL_PLAN_SH11 §2: page-wide switch from UTC display to the *viewer's own
// local time* (data itself stays UTC end-to-end -- server/, starforce.js and
// series.js are untouched; only these display functions changed). Every
// date/time function below now takes an optional `{ locale, timeZone }`:
// `timeZone` defaults to the browser's own zone (`localTimeZone()`) so
// production callers can omit it entirely, while tests can pin a specific
// IANA zone to stay deterministic regardless of the machine running them
// (this repo sets no global `TZ`, so relying on the *system* local zone in a
// test would be flaky by construction).

/** The runtime's local IANA time zone, e.g. "Asia/Tokyo" -- in a browser,
 * this is the viewer's own OS/browser timezone (plan §2/(c)). Falls back to
 * "UTC" if `Intl` cannot resolve one (extremely old/unusual environments). */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Numeric y/m/d/h/min parts of `date` as read on a wall clock in
 * `timeZone`. Uses `Intl.DateTimeFormat("en-CA", ...).formatToParts` purely
 * to pull out locale-agnostic ASCII digits (the "en-CA" locale is never
 * shown to a user) -- the actual localized weekday name is a separate call
 * in `weekdayShort` below, using whatever locale the caller asked for. */
function localizedDateTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (map.hour === "24") map.hour = "00"; // some ICU builds emit "24" for local midnight
  return map;
}

/** Localized short weekday name for the *instant* `date`, in `timeZone`.
 * design/plan §2: "曜日名は Intl.DateTimeFormat に現在のロケールを渡して得
 * る" -- never a hardcoded 6-locale x 7-weekday table. Returns "" (never a
 * hardcoded fallback name) if `Intl` cannot format the given locale/zone. */
function weekdayShort(date, locale, timeZone) {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone }).format(date);
  } catch {
    return "";
  }
}

/** Short axis tick label from a bucket-start ISO date, in the viewer's local
 * time with the weekday appended (plan §2/(a): "08/04 (月)" style). */
export function formatAxisDate(isoDate, { locale = "en", timeZone } = {}) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const tz = timeZone || localTimeZone();
  const parts = localizedDateTimeParts(date, tz);
  const weekday = weekdayShort(date, locale, tz);
  return weekday ? `${parts.month}/${parts.day} (${weekday})` : `${parts.month}/${parts.day}`;
}

/** Full tooltip date label (design §9: "ラベルは区間開始時刻"), in the
 * viewer's local time with the weekday appended (plan §2/(a): "2026-08-04
 * 20:00 (月)" style). No timezone abbreviation here by design -- the plan
 * puts the one, explicit timezone disclosure in the calc-conditions row
 * (`formatTimeZoneLabel` below), not repeated on every tick/tooltip. */
export function formatTooltipDate(isoDate, { locale = "en", timeZone } = {}) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const tz = timeZone || localTimeZone();
  const parts = localizedDateTimeParts(date, tz);
  const weekday = weekdayShort(date, locale, tz);
  const base = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  return weekday ? `${base} (${weekday})` : base;
}

/** Full label for the "取得時刻" / "最終更新" calc-condition rows. Same
 * local-time + weekday formatting as the tooltip. */
export function formatTimestamp(isoDate, options) {
  return formatTooltipDate(isoDate, options);
}

/** plan §2/(c): "タイムゾーンを画面に明示する" -- a short "UTC+9"-style
 * label for the viewer's own zone (or an explicit `timeZone` override, e.g.
 * for tests). `referenceDate` only affects the offset for zones that
 * observe DST; defaults to "now" for display, but tests can pin it. Falls
 * back to the raw IANA zone name (never a guessed offset) if `Intl` cannot
 * resolve one. */
export function formatTimeZoneLabel(timeZone, referenceDate = new Date()) {
  const tz = timeZone || localTimeZone();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
      hour: "numeric",
    }).formatToParts(referenceDate);
    const offsetPart = parts.find((part) => part.type === "timeZoneName");
    if (offsetPart?.value) return offsetPart.value.replace(/^GMT/, "UTC");
  } catch {
    // Unresolvable/invalid IANA zone name -- fall through to the raw name
    // rather than inventing an offset.
  }
  return tz;
}

const WEEKDAY_REFERENCE_SUNDAY_UTC = Date.UTC(2023, 0, 1); // a known Sunday, UTC

/** Localized short weekday name for a bare `weekdayIndex` (0=Sun..6=Sat,
 * matching `Date#getUTCDay()`) -- used by the heatmap's row headers
 * (`WeekdayHeatmap.jsx`). Computed the same `Intl`-only way as
 * `weekdayShort` above (a fixed, known-Sunday reference date formatted in
 * UTC), so it never needs its own hardcoded weekday-name table either. */
export function weekdayShortLabel(weekdayIndex, locale = "en") {
  const date = new Date(WEEKDAY_REFERENCE_SUNDAY_UTC + weekdayIndex * 86_400_000);
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
  } catch {
    return String(weekdayIndex);
  }
}

/** "HH:MM" for a bare hour/minute pair -- used by the heatmap's column
 * headers, which already carry the real, resolved local wall-clock time
 * from `weekdayStats.js`'s `buildWeekdayHeatmap` (plan §2: never rounded).
 * `null`/`null` (an empty column, no data at all in that slot) renders as
 * "--:--" rather than "00:00" (never inventing a time that wasn't observed). */
export function formatClockTime(hour, minute) {
  if (hour == null || minute == null) return "--:--";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
