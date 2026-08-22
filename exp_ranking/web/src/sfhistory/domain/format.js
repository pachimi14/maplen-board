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
function weekdayShort(date, locale, timeZone = "UTC") {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone }).format(date);
  } catch {
    return "";
  }
}

// IMPL_PLAN_SH43 (2026-08-22, user decision): every function below that
// renders a *calendar date* (month/day/year order) now lets
// `Intl.DateTimeFormat` pick that order itself, instead of this file
// hand-assembling `${month}/${day}` or `${year}-${month}-${day}` (SH-14's
// ISO-order convention). This is a genuine display change, not a bug fix --
// see docs/reports/SH43_LOCALE_DATE_FORMAT.md for the record -- prompted by
// the user's own observation that `05/06` reads as "5月6日" in ja but
// "June 5" in en/es/vi under the old fixed order. `timeZone: "UTC"` is still
// passed explicitly (SH-14's zone stays authoritative/unchanged) and the
// literal " UTC" suffix is still appended by this file, never handed to
// `Intl`'s own `timeZoneName` (kept consistent with `formatTimeZoneLabel`'s
// own SH-31 rationale a few functions down: `Intl`'s timezone-name
// rendering is inconsistent across locales/zones, e.g. it wraps the name in
// "[...]" brackets for zh-TW -- a literal, untranslated suffix stays the one
// guaranteed-plain form). `Intl` also picks the calendar system itself (no
// `calendar` option passed) -- this is what makes `th` render the Buddhist
// year (2569) without any special-casing here (plan §1/(b): "タイは仏暦の
// まま").
//
// IMPL_PLAN_SH43 §(l)/(m) addendum (2026-08-22, user decision, post-review):
// `hour12` IS now forced -- to `false`, i.e. always 24h -- reversing this
// comment's original "hour12 を強制しない" stance for the *time* portion
// only. The user's actual request was the calendar *date* order (the
// "05/06" ambiguity); letting `Intl` also pick 12h/24h was this file's own
// extra scope, and it surfaced a real inconsistency the architect caught in
// the running app: the tooltip (en/zh-TW, 12h) and the heatmap's column
// headers (`formatClockTime`/`formatLocalClockTime` below, deliberately
// left as fixed 24h -- see those functions' own SH-43 notes) disagreed on
// the same UTC-labeled hour within the very same screen. 24h was picked
// over 12h for both: it is what the heatmap already had (no churn there),
// and it reads unambiguously next to an explicit "UTC" suffix (no
// "12:00 AM"-is-midnight-or-noon guessing). Date order / weekday placement /
// calendar (Buddhist year) are untouched by this addendum -- only `hour12`.
/** Renders `date` as a locale-native calendar string in `timeZone`, with the
 * short weekday folded in via `Intl`'s own `weekday: "short"` option
 * (rather than this file appending "(Weekday)" itself) -- each locale's
 * `Intl` data decides where the weekday sits (e.g. leading "Tue, " in en,
 * trailing "(火)" in ja). `withTime` adds hour/minute, always 24h
 * (`hour12: false`, IMPL_PLAN_SH43 §(l) addendum -- matches the heatmap's
 * own fixed-24h column headers so the same UTC-labeled hour never reads
 * differently in two places on the same screen); omit `withTime` for a
 * date-only string (`formatAxisDate`, which has no hour12 question at all).
 * Returns `null` if `Intl` cannot format the given locale/zone (caller
 * falls back to the always-safe UTC ISO parts, same "never a hardcoded
 * fallback string" discipline `weekdayShort` above already follows). */
function localizedDateString(date, locale, timeZone, { withYear = true, withTime = false } = {}) {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      ...(withYear ? { year: "numeric" } : {}),
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    }).format(date);
  } catch {
    return null;
  }
}

/** Short axis tick label from a bucket-start ISO date, in UTC with the
 * weekday folded in by `Intl` (plan §2/(a): e.g. "Sun, 03/08" in en,
 * "03/08(日)" in ja -- each locale's own month/day order and weekday
 * placement, IMPL_PLAN_SH43). */
export function formatAxisDate(isoDate, { locale = "en" } = {}) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const localized = localizedDateString(date, locale, "UTC", { withYear: false });
  if (localized != null) return localized;
  const parts = utcDateTimeParts(date);
  const weekday = weekdayShort(date, locale);
  return weekday ? `${parts.month}/${parts.day} (${weekday})` : `${parts.month}/${parts.day}`;
}

/** Full tooltip date label (design §9: "ラベルは区間開始時刻"), in UTC with
 * the weekday folded in by `Intl` and an explicit "UTC" suffix
 * (IMPL_PLAN_SH43: locale-native year/month/day order + weekday placement +
 * hour12/24 convention, e.g. "Tue, 08/04/2026, 11:00 AM UTC" in en, "อ.
 * 04/08/2569 11:00 UTC" in th). The literal "UTC" is embedded directly in
 * the string here (IMPL_PLAN_SH14 §0-1/#4): the page no longer has a
 * calc-conditions block to disclose the timezone once elsewhere (SH-13
 * removed that block), so this tooltip is now the disclosure. "UTC" itself
 * is not translated (same treatment as the "NESO" unit in `formatExactNeso`
 * above). */
export function formatTooltipDate(isoDate, { locale = "en" } = {}) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const localized = localizedDateString(date, locale, "UTC", { withTime: true });
  if (localized != null) return `${localized} UTC`;
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

/** IMPL_PLAN_SH36 §4: turns `/sf-history/prices`' `formingBands`
 * (`[{startStar, endStar}]`, already grouped into contiguous ☆ ranges by the
 * server -- `discovery.forming_star_ranges`) into the list of already-
 * localized range strings the note renders (e.g. `["☆1〜10", "☆20〜22"]`).
 * `formatRange(startStar, endStar)` is the ONE locale-specific piece
 * (`sfhistory.formingBands.range` -- "{{start}}〜{{end}}" in ja, "{{start}}
 * –{{end}}" elsewhere, same separator convention `sfhistoryDiscovery.
 * prices.settledRange` already uses) -- this function only decides WHICH
 * ranges exist and their order, never any wording itself (this file's
 * existing i18n-free convention). `[]` in (no forming bands, or a
 * malformed entry) -> `[]` out -- plan §6(h): "形成中の帯が無ければ出ない"
 * is a caller concern this empty array enables (never guesses a range).
 */
export function formatFormingBandRanges(formingBands, formatRange) {
  if (!Array.isArray(formingBands)) return [];
  return formingBands
    .filter((range) => Number.isInteger(range?.startStar) && Number.isInteger(range?.endStar))
    .map((range) => formatRange(range.startStar, range.endStar));
}

/** IMPL_PLAN_SH37 §3/§4: groups `domain/priceGapFill.js#fillLeadingPriceGaps`'s
 * per-band `{ upgrade, untilDate }` list into the star-range shape the note
 * renders -- contiguous `upgrade` runs (`☆(upgrade+1)`, same 1-based
 * convention `discovery.forming_star_ranges`/`formatFormingBandRanges`
 * already use) that ALSO share the exact same `untilDate`, so two bands
 * that both finished forming at different times are never merged into one
 * misleading range (e.g. Hat's ☆11/13/14/15 finishing together but ☆19
 * finishing two days later, plan §7(g)'s worked table). Malformed entries
 * are dropped, never guessed at -- same discipline as
 * `formatFormingBandRanges`. `[]` in -> `[]` out (plan §7(h): "埋めた区間が
 * 無ければ注記が出ない" is the caller's concern this empty array enables).
 */
export function groupFilledBands(filledBands) {
  if (!Array.isArray(filledBands)) return [];
  const valid = filledBands.filter(
    (band) => Number.isInteger(band?.upgrade) && typeof band?.untilDate === "string" && band.untilDate,
  );
  const sorted = [...valid].sort((a, b) => a.upgrade - b.upgrade);
  const groups = [];
  for (const band of sorted) {
    const star = band.upgrade + 1;
    const last = groups[groups.length - 1];
    if (last && star === last.endStar + 1 && band.untilDate === last.untilDate) {
      last.endStar = star;
    } else {
      groups.push({ startStar: star, endStar: star, untilDate: band.untilDate });
    }
  }
  return groups;
}

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
 * (never invents a range).
 *
 * IMPL_PLAN_SH43: kept as a plain 24h "HH:MM" pair for the same reason as
 * `formatClockTime` -- a bare clock range has no month/day-order ambiguity
 * to fix, and the caller's `sfhistory.chart.tooltipBucketRange*` templates
 * already read `{{start}}`/`{{end}}` as this exact "HH:MM" shape in every
 * locale's translation string (`i18n/locales/*.json`, untouched by this
 * plan). */
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

/** IMPL_PLAN_SH18 §3: which *instant* to feed into
 * `formatAxisDate`/`formatTooltipDate` for one series point -- not what to
 * store. The server/DB keep the bucket-*start* convention unchanged
 * (design §9; SH-18 plan §2 "サーバー・DB は触らない": `price_at` / the
 * `date` field's meaning is untouched by this plan). But the stored value
 * is the bucket's *last observed* price (design §9: "代表値=区間内で
 * 最後に存在する時刻のendPrice"), so labeling it with the bucket's
 * *start* was the exact mismatch the user reported (`8/5 0:00` shown for
 * a value that is really `4:00`'s). This is the client-side "+4h" shift
 * that fixes that display, with one carve-out:
 *
 *  - a point carrying `asOf` (SH-17's still-open "未終了の足", the one
 *    point sourced from the live `latest` cache) keeps showing `asOf`
 *    itself (the real current instant) -- unchanged from SH-16/SH-17,
 *    and SH-18 plan §3 keeps this rule as-is ("← SH-17 のまま").
 *  - every other point -- a confirmed bucket, or a "暫定の足(完成済み
 *    未保存)" (a fully elapsed bucket the 4h aggregation job hasn't
 *    persisted to `sf_price_history_4h` yet, `app.py`'s
 *    `derived_by_date` loop) -- shows the bucket's *end* (`date + 4h`).
 *    For either of those two kinds that end is guaranteed to already be
 *    in the past (the bucket has, by construction, fully elapsed).
 *  - the one state neither of the above two bullets is written for: a
 *    still-open bucket whose upstream `latest` call failed, so the
 *    server fell back to a partial hourly value with no `asOf` at all
 *    (`app.py`'s `in_progress_prices` fallback) -- would otherwise
 *    compute a bucket end that has not happened yet. Guarded explicitly
 *    so this never surfaces a future instant (SH-18 plan's "未来の時刻
 *    を表示しないでください"): falls back to the bucket's own *start*,
 *    the exact value every non-`asOf` point displayed before this plan.
 *
 * Accepts an injectable `now` (default `new Date()`) purely so the above
 * boundary is deterministically testable -- the result never actually
 * depends on `now` for a confirmed/elapsed point (its bucket end is
 * necessarily already in the past whenever a real point exists to check
 * it against a realistic `now`); `now` only matters for the still-open,
 * no-`asOf` edge case. Returns `null` for a missing point, and the raw
 * (unparsable) `date` string back unchanged rather than inventing a
 * result -- same "never invent a value" stance as `formatBucketRange`
 * above, left for the caller's own `formatAxisDate`/`formatTooltipDate`
 * (which already return `""` for an unparsable date) to handle. */
export function bucketDisplayDate(point, { now = new Date() } = {}) {
  if (!point) return null;
  if (typeof point.asOf === "string" && point.asOf) return point.asOf;
  if (point.date == null) return null;
  const start = new Date(point.date);
  if (Number.isNaN(start.getTime())) return point.date;
  const end = new Date(start.getTime() + BUCKET_HOURS * 60 * 60 * 1000);
  return end.getTime() <= now.getTime() ? end.toISOString() : point.date;
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
 * "00:00" (never inventing a time that wasn't observed).
 *
 * IMPL_PLAN_SH43 (2026-08-22): deliberately kept a fixed 24h zero-padded
 * clock-position label, not routed through `Intl`/`hour12` like the
 * calendar-date functions above. Two reasons: (1) there is no month/day-
 * order ambiguity for a bare "HH:MM" the way there is for a date -- the
 * problem this plan exists to fix does not apply here; (2) the heatmap's 6
 * columns already share a tight `minmax(0, 1fr)` budget at 375px
 * (sfhistory.css's `.sfh-heatmap-grid`) -- appending "AM"/"PM" (en) or a CJK
 * "上午"/"下午" prefix (zh-TW) measured to roughly double the label width
 * and risks column overflow. Same "narrow-space, judgment call" precedent
 * IMPL_PLAN_SH29 §1 already set for the chart axis staying UTC-only. */
export function formatClockTime(hour, minute) {
  if (hour == null || minute == null) return "--:--";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// IMPL_PLAN_SH29 §1/§2 (2026-08-06, user decision): re-introduces the
// viewer's own local time as a *secondary*, explicitly-labeled display next
// to the UTC one SH-14 made primary/authoritative. This is NOT a revert of
// SH-14 -- every UTC function above (`formatAxisDate`/`formatTooltipDate`/
// `formatTimestamp`/`weekdayShortLabel`/`formatClockTime`) is untouched and
// stays what production reads as "the" time; the functions below are
// additive, always paired with an explicit UTC value at the call site
// (SfHistoryChart's tooltip, WeekdayHeatmap's column headers), never a
// silent replacement of it (plan §2-1's "正直さの要求": never leave the
// viewer unable to tell which zone a number belongs to).
//
// `timeZone` mirrors the exact parameterized shape IMPL_PLAN_SH11 §2 used
// (and SH-14 removed): defaults to `localTimeZone()` so every production
// call site can omit it, while a test can pin a specific IANA zone instead
// of depending on whatever zone the machine running it happens to be in
// (this repo sets no global `TZ` -- vitest.config.js).

/** The runtime's local IANA time zone, e.g. "Asia/Tokyo" -- in a browser,
 * the viewer's own OS/browser timezone. Falls back to "UTC" if `Intl`
 * cannot resolve one. Ported from IMPL_PLAN_SH11 §2/(c) (removed by SH-14,
 * reinstated verbatim here). */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Numeric y/m/d/h/min parts of `date` as read on a wall clock in
 * `timeZone` -- the parameterized counterpart of `utcDateTimeParts` above.
 * Kept as a separate function (rather than adding a `timeZone` parameter to
 * `utcDateTimeParts` itself) so every existing UTC call site above stays a
 * zero-argument, always-UTC call -- nothing above this comment needed to
 * change to add this. */
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

// IMPL_PLAN_SH31 (2026-08-06, user decision): a small static lookup of the
// only two zones whose named abbreviation is safe to show unconditionally
// (docs/reports/SH31_ZONE_ABBREVIATION.md has the full record). A zone
// qualifies only if it satisfies *both*:
//  1. no DST -- the abbreviation never changes with the season, so a static
//     table is never a seasonal lie (this is why "EST"/"PST" etc. are
//     deliberately NOT here: they'd become wrong as "EDT"/"PDT" every
//     summer)
//  2. the abbreviation is globally unique -- no collision with another
//     zone's abbreviation (this is why "CST" -- China / US Central / Cuba
//     -- and "IST" -- India / Israel / Ireland -- are deliberately NOT
//     here)
// Every zone not in this table keeps the exact "UTC+9"-style offset output
// this function already produced before SH-31 (plan §3/(d): 1 bit of
// existing behavior may not change).
//
// Deliberately NOT sourced from `Intl`'s own `timeZoneName: "short"`:
// measured that it resolves a named abbreviation only for *some* locales --
// `Asia/Tokyo` returns "JST" under the `ja` locale but "GMT+9" under
// `en`/`ko`/`es`/`th`/`vi`/`zh-TW`. A viewer's UI language and the timezone
// they physically live in are unrelated (a Japan-based reader may well use
// an English UI), so keying the abbreviation off UI locale would show
// "UTC+9" to exactly the audience this table exists for. This table is
// keyed by IANA zone name only and its values are never translated
// (`i18n/locales/*.json` is untouched by this plan -- same string in every
// locale, like the literal "UTC"/"NESO" units elsewhere in this file).
const ZONE_ABBREVIATIONS = {
  "Asia/Tokyo": "JST",
  "Asia/Seoul": "KST",
};

/** plan §1/§2-1: a short "UTC+9"-style label for `timeZone` (or the
 * viewer's own zone when omitted) -- so a local-time display never leaves
 * the viewer guessing which zone they're looking at. SH-31: for the two
 * zones in `ZONE_ABBREVIATIONS` above, returns that static abbreviation
 * instead (measured to normalize IANA aliases like "Japan"/"ROK" to their
 * canonical "Asia/Tokyo"/"Asia/Seoul" first -- see
 * docs/reports/SH31_ZONE_ABBREVIATION.md §(i) -- so the table only lists
 * canonical names). Every other zone keeps this function's pre-SH-31
 * behavior verbatim: `Intl`'s own `shortOffset` (a numeric offset, e.g.
 * "GMT+9") rather than a named abbreviation -- ICU only resolves
 * abbreviations for a subset of zones/environments, while every
 * environment resolves an offset, so this is the one form guaranteed never
 * to fall back to something less useful than the zone name itself.
 * `referenceDate` only matters for a DST-observing zone; defaults to "now"
 * for display, pinnable for tests. Falls back to the raw IANA zone name
 * (never a guessed offset) if `Intl` cannot resolve one. Ported from
 * IMPL_PLAN_SH11 §2/(c) (removed by SH-14, reinstated verbatim here; SH-31
 * layers the table lookup on top). */
export function formatTimeZoneLabel(timeZone, referenceDate = new Date()) {
  const tz = timeZone || localTimeZone();
  // SH-31 §1-4: normalize a legacy IANA alias (e.g. "Japan" -> "Asia/Tokyo")
  // to its canonical name before checking the table above. Falls through
  // with `canonical === tz` for a zone `Intl` cannot resolve at all -- the
  // offset branch below already has its own fallback for that case, so this
  // normalization attempt never needs to change what an unresolvable zone
  // renders.
  let canonical = tz;
  try {
    canonical = new Intl.DateTimeFormat(undefined, { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    // Unresolvable zone name -- leave `canonical` as the raw `tz`.
  }
  if (Object.prototype.hasOwnProperty.call(ZONE_ABBREVIATIONS, canonical)) {
    return ZONE_ABBREVIATIONS[canonical];
  }
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

/** plan §1: the chart tooltip's *secondary* local-time line -- same shape
 * as `formatTooltipDate` (full date+time+weekday, locale-native order,
 * IMPL_PLAN_SH43) but read in `timeZone` (defaults to the viewer's own),
 * with `formatTimeZoneLabel` appended so the line is self-explaining on its
 * own without needing the UTC line above it for context (e.g. "Tue,
 * 08/05/2026, 09:00 PM UTC+9" in en, "2026/08/05(火) 21:00 UTC+9" in ja).
 * Returns "" for an unparsable date, same as `formatTooltipDate`. */
export function formatTooltipDateLocal(isoDate, { locale = "en", timeZone } = {}) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const tz = timeZone || localTimeZone();
  const zoneLabel = formatTimeZoneLabel(tz, date);
  const localized = localizedDateString(date, locale, tz, { withTime: true });
  if (localized != null) return `${localized} ${zoneLabel}`;
  const parts = localizedDateTimeParts(date, tz);
  const weekday = weekdayShort(date, locale, tz);
  const base = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${zoneLabel}`;
  return weekday ? `${base} (${weekday})` : base;
}

/** plan §2: the heatmap's *local*-time column header -- the same fixed UTC
 * hour every column already represents (`hour`/`minute`, the same values
 * `formatClockTime` above receives), read on a local wall clock instead.
 * Not tied to any specific calendar date -- the same UTC hour recurs every
 * day (design §9's 4h grid) -- `referenceDate` exists purely to read
 * `timeZone`'s *current* UTC offset (so a DST-observing zone shows today's
 * actual offset), defaulting to "now" for display / pinnable for tests.
 * Neither this function nor its result is read by
 * `weekdayStats.js#buildWeekdayHeatmap` -- the cell grouping is computed
 * entirely in fixed UTC before this ever runs, so this cannot move a single
 * cell (plan §2: "集計は UTC 基準のまま変えない"). `null`/`null` (an empty
 * column) still renders "--:--", matching `formatClockTime`.
 *
 * IMPL_PLAN_SH43: same fixed 24h zero-padded output, same rationale as
 * `formatClockTime` above (no date-order ambiguity in a bare clock time;
 * the heatmap column already has two stacked lines in a narrow grid cell). */
export function formatLocalClockTime(hour, minute, { timeZone, referenceDate = new Date() } = {}) {
  if (hour == null || minute == null) return "--:--";
  const tz = timeZone || localTimeZone();
  const reference = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate(), hour, minute, 0),
  );
  const parts = localizedDateTimeParts(reference, tz);
  return `${parts.hour}:${parts.minute}`;
}
