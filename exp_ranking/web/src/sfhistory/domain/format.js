// IMPL_PLAN_SH5 §2: display formatting for the chart / summary / tooltip.
// Pure functions, no i18n (design's chart spec fixes "950M" / "1.25B"
// style regardless of locale -- these are compact-magnitude numbers, not
// translated text) and no DOM.

/** IMPL_PLAN_SH12 §3: always two decimal digits once a K/M/B unit applies
 * (`380.12M`, `12.43B`) -- the magnitude no longer decides the decimal
 * count (a prior "drop the decimals at >=100 of the unit" rule made
 * `380,120,000` render as the indistinguishable-from-rounder `380M`,
 * which is exactly what prompted this change). This only changes the
 * *display* string: the `value` passed in is never rounded here or
 * upstream (see `domain/weekdayStats.js` / `domain/series.js`, both
 * untouched by this plan) -- rounding stays confined to this formatting
 * layer, as it always has. Below 1 of the smallest unit (K), values stay
 * a plain rounded integer (no unit, unchanged from before). */
export function formatCompactNeso(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    return `${sign}${(abs / 1e9).toFixed(2)}B`;
  }
  if (abs >= 1e6) {
    return `${sign}${(abs / 1e6).toFixed(2)}M`;
  }
  if (abs >= 1e3) {
    return `${sign}${(abs / 1e3).toFixed(2)}K`;
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

// IMPL_PLAN_SH14 §2 (2026-08-05, user decision): reverts IMPL_PLAN_SH11 §2's
// page-wide switch to the *viewer's own local time*. This is a deliberate
// reversal, not a bug fix -- see docs/reports/SH14_UTC_AND_ORDER.md for the
// record, and docs/reports/SH11_LOCAL_TIME_HEATMAP.md's own addendum (that
// report's original body is left untouched, per the plan's "旧文は書き換え
// ない"). Every date/time function below is now a fixed UTC -- there is no
// more `timeZone` option to pass or default, and SH-11's `localTimeZone()` /
// `formatTimeZoneLabel()` are removed outright (no local-time trace left).
// The weekday *name* is still resolved purely via `Intl` (never a hardcoded
// 6-locale x 7-weekday table -- that regulation from SH-11 carries forward
// unchanged), just with `timeZone: "UTC"` passed explicitly rather than left
// to the runtime's own zone.

/** Numeric y/m/d/h/min parts of `date` as read on a UTC wall clock. Uses
 * `Intl.DateTimeFormat("en-CA", ...).formatToParts` purely to pull out
 * locale-agnostic ASCII digits (the "en-CA" locale is never shown to a
 * user) -- the actual localized weekday name is a separate call in
 * `weekdayShort` below, using whatever locale the caller asked for. */
function utcDateTimeParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (map.hour === "24") map.hour = "00"; // some ICU builds emit "24" for UTC midnight
  return map;
}

/** Localized short weekday name for the *instant* `date`, computed in UTC
 * (IMPL_PLAN_SH14 §2: "曜日もUTCで算出する"). Never a hardcoded weekday/
 * locale table -- resolved purely via `Intl.DateTimeFormat`. Returns ""
 * (never a hardcoded fallback name) if `Intl` cannot format the given
 * locale. */
function weekdayShort(date, locale) {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
  } catch {
    return "";
  }
}

/** Short axis tick label from a bucket-start ISO date, in UTC with the
 * weekday appended (plan §2/(a): "08/04 (Thu)" style). */
export function formatAxisDate(isoDate, { locale = "en" } = {}) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const parts = utcDateTimeParts(date);
  const weekday = weekdayShort(date, locale);
  return weekday ? `${parts.month}/${parts.day} (${weekday})` : `${parts.month}/${parts.day}`;
}

/** Full tooltip date label (design §9: "ラベルは区間開始時刻"), in UTC with
 * the weekday appended (plan §2/(a): "2026-08-04 20:00 UTC (Thu)" style).
 * The literal "UTC" is embedded directly in the string here (IMPL_PLAN_SH14
 * §0-1/#4): the page no longer has a calc-conditions block to disclose the
 * timezone once elsewhere (SH-13 removed that block), so this tooltip is now
 * the disclosure. "UTC" itself is not translated (same treatment as the
 * "NESO" unit in `formatExactNeso` above). */
export function formatTooltipDate(isoDate, { locale = "en" } = {}) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const parts = utcDateTimeParts(date);
  const weekday = weekdayShort(date, locale);
  const base = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} UTC`;
  return weekday ? `${base} (${weekday})` : base;
}

/** Full label for timestamp displays. Same UTC + weekday formatting as the
 * tooltip. */
export function formatTimestamp(isoDate, options) {
  return formatTooltipDate(isoDate, options);
}

// design §9: 4-hour buckets. Same constant `domain/series.js`'s
// `BUCKETS_PER_DAY = 6` (24 / 4) is derived from, kept local here since this
// function only needs the duration, not the per-day count.
const BUCKET_HOURS = 4;

/** IMPL_PLAN_SH17 §4-2: `{ start, end }` HH:MM clock-range for a
 * bucket-start ISO date -- the bucket's own start and (start + 4h) end,
 * both read on a UTC wall clock. Returned as separate parts (not a single
 * pre-joined string) so each locale's `{{start}}`/`{{end}}` template
 * (`sfhistory.chart.tooltipBucketRange`/`tooltipBucketRangeOpen`) controls
 * its own separator/word order. This is what lets the tooltip explain *why*
 * a point sits where it does (design's "ラベルは区間開始時刻" put the
 * bucket-start *position* under a same-looking label before this, which is
 * what prompted this slice -- see docs/reports/SH17_BUCKET_RANGE.md).
 * Handles a day rollover the same way `utcDateTimeParts` already normalizes
 * any UTC-midnight "24" ICU can emit, so a bucket starting `20:00` correctly
 * ends at `00:00` (not `24:00`). Returns `null` for an unparsable date
 * (never invents a range). */
export function formatBucketRange(isoDate) {
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + BUCKET_HOURS * 60 * 60 * 1000);
  const startParts = utcDateTimeParts(start);
  const endParts = utcDateTimeParts(end);
  return {
    start: `${startParts.hour}:${startParts.minute}`,
    end: `${endParts.hour}:${endParts.minute}`,
  };
}

const WEEKDAY_REFERENCE_SUNDAY_UTC = Date.UTC(2023, 0, 1); // a known Sunday, UTC

/** Localized short weekday name for a bare `weekdayIndex` (0=Sun..6=Sat,
 * matching `Date#getUTCDay()`) -- used by the heatmap's row headers
 * (`WeekdayHeatmap.jsx`). Computed the same `Intl`-only way as
 * `weekdayShort` above (a fixed, known-Sunday reference date formatted in
 * UTC), so it never needs its own hardcoded weekday-name table either. This
 * function was already UTC-only before IMPL_PLAN_SH14 (unchanged here). */
export function weekdayShortLabel(weekdayIndex, locale = "en") {
  const date = new Date(WEEKDAY_REFERENCE_SUNDAY_UTC + weekdayIndex * 86_400_000);
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
  } catch {
    return String(weekdayIndex);
  }
}

/** "HH:MM" for a bare hour/minute pair -- used by the heatmap's column
 * headers (IMPL_PLAN_SH14 §4: now always a fixed UTC hour -- 00/04/08/12/
 * 16/20 -- rather than a resolved local wall-clock time). `null`/`null` (an
 * empty column, no data at all in that slot) renders as "--:--" rather than
 * "00:00" (never inventing a time that wasn't observed). */
export function formatClockTime(hour, minute) {
  if (hour == null || minute == null) return "--:--";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
