import { describe, expect, it } from "vitest";
import {
  bucketDisplayDate,
  formatAxisDate,
  formatBucketRange,
  formatClockTime,
  formatCompactNeso,
  formatExactNeso,
  formatFormingBandRanges,
  formatLocalClockTime,
  formatSignedCompactNeso,
  formatTimestamp,
  formatTimeZoneLabel,
  formatTooltipDate,
  formatTooltipDateLocal,
  groupFilledBands,
  localTimeZone,
  weekdayShortLabel,
} from "./format.js";

// IMPL_PLAN_SH12 §3: always two decimals once a K/M/B unit applies, the
// magnitude within the unit no longer decides the decimal count (replaces
// the prior "drop decimals at >=100 of the unit" rule, which made
// `380,120,000` render as the indistinguishable-from-rounder `380M`).
describe("formatCompactNeso (IMPL_PLAN_SH12 §3: always two decimals, e.g. '380.12M' / '12.43B')", () => {
  it("matches the plan's own worked examples verbatim", () => {
    expect(formatCompactNeso(380_120_000)).toBe("380.12M");
    expect(formatCompactNeso(2_630_105_337)).toBe("2.63B");
    expect(formatCompactNeso(1_250_000_000)).toBe("1.25B");
    expect(formatCompactNeso(12_431_992_384)).toBe("12.43B");
  });

  it("always shows two decimals, including at/above 100 of the unit (the boundary the old rule dropped decimals at)", () => {
    expect(formatCompactNeso(950_000_000)).toBe("950.00M");
    expect(formatCompactNeso(150_000_000)).toBe("150.00M");
    expect(formatCompactNeso(1_500_000)).toBe("1.50M");
    expect(formatCompactNeso(1_500)).toBe("1.50K");
    expect(formatCompactNeso(999_000)).toBe("999.00K");
  });

  it("K/M/B all follow the same rule -- no branch by magnitude within a unit", () => {
    expect(formatCompactNeso(1_000)).toBe("1.00K");
    expect(formatCompactNeso(1_000_000)).toBe("1.00M");
    expect(formatCompactNeso(1_000_000_000)).toBe("1.00B");
  });

  it("handles small values (below the K threshold, unit-less, unchanged) and negatives", () => {
    expect(formatCompactNeso(500)).toBe("500");
    expect(formatCompactNeso(999)).toBe("999");
    expect(formatCompactNeso(-950_000_000)).toBe("-950.00M");
    expect(formatCompactNeso(-380_120_000)).toBe("-380.12M");
    expect(formatCompactNeso(0)).toBe("0");
  });

  it("returns a placeholder for null/undefined/NaN", () => {
    expect(formatCompactNeso(null)).toBe("--");
    expect(formatCompactNeso(undefined)).toBe("--");
    expect(formatCompactNeso(NaN)).toBe("--");
  });
});

describe("formatSignedCompactNeso", () => {
  it("prefixes non-negative deltas with +, keeps the built-in - for negatives (auto-follows the two-decimal rule above)", () => {
    expect(formatSignedCompactNeso(950_000_000)).toBe("+950.00M");
    expect(formatSignedCompactNeso(-950_000_000)).toBe("-950.00M");
    expect(formatSignedCompactNeso(380_120_000)).toBe("+380.12M");
    expect(formatSignedCompactNeso(0)).toBe("+0");
  });
});

describe("formatExactNeso", () => {
  it("is thousands-separated with an explicit unit", () => {
    expect(formatExactNeso(2_630_105_337.5)).toBe("2,630,105,337.5 NESO");
  });

  it("returns a placeholder for null", () => {
    expect(formatExactNeso(null)).toBe("--");
  });
});

// IMPL_PLAN_SH14 §2 (2026-08-05, user decision): reverts IMPL_PLAN_SH11 §2's
// viewer-local-time display back to a fixed UTC. There is no more
// `timeZone` option -- every case below is UTC by construction, so (unlike
// SH-11's tests) nothing needs to be pinned to stay deterministic across
// machines.
//
// IMPL_PLAN_SH43 (2026-08-22, user decision): the calendar order (month vs.
// day first) and weekday placement are no longer a hand-assembled
// "MM/DD (Weekday)"/"YYYY-MM-DD HH:MM UTC (Weekday)" shape -- `Intl` now
// picks each locale's own native order (docs/reports/SH43_LOCALE_DATE_FORMAT.md
// has the full record). The zone itself is still fixed UTC (unchanged from
// SH-14) and the literal " UTC" suffix is still appended verbatim.
//
// IMPL_PLAN_SH43 §(l)/(m) addendum (2026-08-22, user decision, post-review):
// the time portion is always 24h (`hour12: false`) in every locale -- the
// architect caught en/zh-TW's 12h tooltip disagreeing with the heatmap's
// always-24h column headers on the same screen. Only `hour12` reversed;
// date order/weekday/calendar are unchanged from the first SH-43 commit.
describe("date formatting (IMPL_PLAN_SH43: locale-native order, fixed UTC zone + weekday, forced 24h)", () => {
  it("formatAxisDate: UTC month/day in each locale's own order, with Intl's own weekday placement", () => {
    // 2026-03-08T00:00:00Z is a Sunday (UTC).
    expect(formatAxisDate("2026-03-08T00:00:00Z", { locale: "ja" })).toBe("03/08(日)");
    expect(formatAxisDate("2026-03-08T00:00:00Z", { locale: "en" })).toBe("Sun, 03/08");
  });

  it("formatAxisDate: a late-UTC-hour point stays on the same UTC day (no timezone shift applies)", () => {
    // 2026-03-08T20:00:00Z is still 03-08 UTC (a Sunday) -- unlike SH-11's
    // JST rollover example, there is no zone conversion left to roll it
    // into the next day.
    expect(formatAxisDate("2026-03-08T20:00:00Z", { locale: "en" })).toBe("Sun, 03/08");
  });

  it("formatTooltipDate: full UTC date+time in each locale's own order (with an explicit 'UTC' marker) plus weekday, always 24h", () => {
    expect(formatTooltipDate("2026-08-04T11:00:00Z", { locale: "ja" })).toBe("2026/08/04(火) 11:00 UTC");
    expect(formatTooltipDate("2026-08-04T11:00:00Z", { locale: "en" })).toBe("Tue, 08/04/2026, 11:00 UTC");
  });

  it("both return an empty string for an unparsable date rather than throwing", () => {
    expect(formatAxisDate("not-a-date")).toBe("");
    expect(formatTooltipDate(undefined)).toBe("");
  });

  it("both fall back to the default 'en' locale when no options are given (no crash, still a valid-looking string)", () => {
    expect(formatAxisDate("2026-03-08T00:00:00Z")).toBe("Sun, 03/08");
    expect(formatTooltipDate("2026-03-08T00:00:00Z")).toBe("Sun, 03/08/2026, 00:00 UTC");
  });

  // IMPL_PLAN_SH15 §3: the current-value card's 20-minute official stamp
  // uses this function -- same UTC + weekday formatting as the tooltip
  // (SH-14's regulation carries forward unchanged, SH-43's locale-order
  // change applies here too since this just delegates), just a distinct
  // export name for that call site.
  it("formatTimestamp: same locale-native UTC date+time+weekday formatting as formatTooltipDate, always 24h", () => {
    expect(formatTimestamp("2026-08-04T18:20:00Z", { locale: "en" })).toBe("Tue, 08/04/2026, 18:20 UTC");
    expect(formatTimestamp("2026-08-04T18:20:00Z", { locale: "ja" })).toBe("2026/08/04(火) 18:20 UTC");
    expect(formatTimestamp("not-a-date")).toBe("");
  });

  // (a)/(c)/(b) IMPL_PLAN_SH43 §5: the full 6-locale spread for one instant,
  // pinned verbatim so a future ICU/Node upgrade that silently reflows one
  // locale's order (or reintroduces 12h) is caught here rather than only in
  // a manual report.
  it("(a)(b)(c)(l) all 6 shipped UI locales render their own standard date order, always 24h, for the same instant (2026-08-18T04:55:00Z, a Tuesday)", () => {
    const iso = "2026-08-18T04:55:00Z";
    expect(formatTooltipDate(iso, { locale: "ja" })).toBe("2026/08/18(火) 04:55 UTC");
    expect(formatTooltipDate(iso, { locale: "en" })).toBe("Tue, 08/18/2026, 04:55 UTC");
    expect(formatTooltipDate(iso, { locale: "zh-TW" })).toBe("2026/08/18（週二） 04:55 UTC");
    // (b) th: Buddhist year 2569 (2026 + 543), day/month order -- never
    // fixed to the Gregorian year (user decision, plan §1/(b)).
    expect(formatTooltipDate(iso, { locale: "th" })).toBe("อ. 18/08/2569 04:55 UTC");
    // (c) vi/es: day/month order (never month/day).
    expect(formatTooltipDate(iso, { locale: "vi" })).toBe("04:55 Th 3, 18/08/2026 UTC");
    expect(formatTooltipDate(iso, { locale: "es" })).toBe("mar, 18/08/2026, 04:55 UTC");
  });

  // (m) IMPL_PLAN_SH43 addendum: en/zh-TW were the only two locales `Intl`
  // resolved to 12h by default (measured in the first SH-43 pass) -- this
  // pins that AM/PM/上午/下午 never appear now that `hour12: false` is
  // forced, across every hour-of-day bucket a chart point can land on
  // (00/04/08/12/16/20 UTC, design §9's 4h grid) so a midday/midnight
  // boundary case can't silently reintroduce a meridiem marker.
  it("(m) never renders AM/PM (en) or 上午/下午 (zh-TW), across every 4h bucket hour", () => {
    for (const hour of [0, 4, 8, 12, 16, 20]) {
      const iso = `2026-08-18T${String(hour).padStart(2, "0")}:00:00Z`;
      const en = formatTooltipDate(iso, { locale: "en" });
      const zhTw = formatTooltipDate(iso, { locale: "zh-TW" });
      expect(en).not.toMatch(/AM|PM/i);
      expect(zhTw).not.toMatch(/上午|下午/);
      // sanity: still a valid-looking, non-empty string for every hour.
      expect(en).toMatch(/\d{2}:00 UTC$/);
      expect(zhTw).toMatch(/\d{2}:00 UTC$/);
    }
  });
});

// plan §2: "曜日名は Intl.DateTimeFormat に現在のロケールを渡して得る.
// 7言語分の曜日名をハードコードしない" -- this exercises all 6 shipped UI
// locales against the real Intl output rather than a hand-maintained table,
// so the assertions themselves cannot drift out of sync with ICU the way a
// hardcoded table would.
describe("weekdayShortLabel (plan §2/(b): ja/en/zh-TW/th/vi/es via Intl, no hardcoded table)", () => {
  const EXPECTED = {
    ja: ["日", "月", "火", "水", "木", "金", "土"],
    en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    "zh-TW": ["週日", "週一", "週二", "週三", "週四", "週五", "週六"],
    th: ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."],
    vi: ["CN", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7"],
    es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
  };

  for (const [locale, names] of Object.entries(EXPECTED)) {
    it(`${locale}: weekdayIndex 0..6 -> ${names.join("/")}`, () => {
      for (let weekdayIndex = 0; weekdayIndex < 7; weekdayIndex++) {
        expect(weekdayShortLabel(weekdayIndex, locale)).toBe(names[weekdayIndex]);
      }
    });
  }
});

// IMPL_PLAN_SH17 §4-2/(e): the tooltip's range note -- `{ start, end }`
// HH:MM parts for a bucket-start ISO date, always its own start + 4h end.
describe("formatBucketRange (IMPL_PLAN_SH17 §4-2: bucket range for the tooltip note)", () => {
  it("returns the bucket's own start and (start + 4h) end", () => {
    expect(formatBucketRange("2026-08-04T04:00:00Z")).toEqual({ start: "04:00", end: "08:00" });
  });

  it("(e): a bucket crossing midnight UTC renders '20:00'-'00:00', not '20:00'-'24:00'", () => {
    expect(formatBucketRange("2026-08-04T20:00:00Z")).toEqual({ start: "20:00", end: "00:00" });
  });

  it("returns null for an unparsable date (never invents a range)", () => {
    expect(formatBucketRange("not-a-date")).toBeNull();
    expect(formatBucketRange(undefined)).toBeNull();
  });
});

// IMPL_PLAN_SH18 §3/(a)/(b): "the point is really the bucket's *end*
// instant" -- `bucketDisplayDate` is the client-side "+4h" shift (server/DB
// keep the bucket-start convention, plan §2). Cases mirror the plan §3
// table verbatim.
describe("bucketDisplayDate (IMPL_PLAN_SH18 §3: which instant a point displays)", () => {
  it("(a) a confirmed point (no asOf, no provisional flag) shows the bucket's end -- plan's own worked example", () => {
    // plan (a): "API の 2026-08-05T00:00:00Z の点が 04:00 と表示される".
    const point = { date: "2026-08-05T00:00:00Z", provisional: false, expected: 1 };
    const now = new Date("2026-08-06T00:00:00Z"); // safely after the bucket ended
    expect(bucketDisplayDate(point, { now })).toBe("2026-08-05T04:00:00.000Z");
    expect(formatAxisDate(bucketDisplayDate(point, { now }), { locale: "en" })).toBe("Wed, 08/05");
  });

  it("a 暫定の足(完成済み未保存) point (provisional, no asOf) also shows the bucket's end", () => {
    const point = { date: "2026-08-04T20:00:00Z", provisional: true, expected: 1 };
    const now = new Date("2026-08-05T00:00:01Z"); // 1s after the bucket ended
    expect(bucketDisplayDate(point, { now })).toBe("2026-08-05T00:00:00.000Z");
  });

  it("a bucket ending exactly at `now` counts as elapsed (boundary is inclusive)", () => {
    const point = { date: "2026-08-05T04:00:00Z", provisional: true, expected: 1 };
    const now = new Date("2026-08-05T08:00:00Z"); // == bucket end
    expect(bucketDisplayDate(point, { now })).toBe("2026-08-05T08:00:00.000Z");
  });

  it("(b) a still-open point (has asOf) shows asOf verbatim, regardless of now -- SH-17 unchanged", () => {
    const point = {
      date: "2026-08-05T04:00:00Z",
      provisional: true,
      asOf: "2026-08-05T06:40:00Z",
      expected: 1,
    };
    expect(bucketDisplayDate(point)).toBe("2026-08-05T06:40:00Z");
    // even with a `now` far in the future, `asOf` still wins:
    expect(bucketDisplayDate(point, { now: new Date("2099-01-01T00:00:00Z") })).toBe(
      "2026-08-05T06:40:00Z",
    );
  });

  it("(b) never invents a future instant: a still-open point with NO asOf (upstream fallback) falls back to the bucket's own start, not its (future) end", () => {
    const point = { date: "2026-08-05T04:00:00Z", provisional: true, expected: 1 };
    const now = new Date("2026-08-05T05:00:00Z"); // bucket [04:00,08:00) has not elapsed yet
    expect(bucketDisplayDate(point, { now })).toBe("2026-08-05T04:00:00Z");
  });

  it("returns null for a missing point, and the raw string back for an unparsable date (never invents a value)", () => {
    expect(bucketDisplayDate(null)).toBeNull();
    expect(bucketDisplayDate({ date: null })).toBeNull();
    expect(bucketDisplayDate({ date: "not-a-date" })).toBe("not-a-date");
  });
});

describe("formatClockTime (heatmap column headers)", () => {
  it("pads a bare hour/minute pair", () => {
    expect(formatClockTime(5, 0)).toBe("05:00");
    expect(formatClockTime(21, 0)).toBe("21:00");
  });

  it("never invents a time for an empty column (null/null)", () => {
    expect(formatClockTime(null, null)).toBe("--:--");
  });
});

// IMPL_PLAN_SH29 §1/§2 (2026-08-06, user decision): re-introduces the
// viewer's local time as an *additive* secondary display -- every case
// below pins an explicit `timeZone` (this repo sets no global `TZ`, so
// relying on the machine's own zone would be flaky by construction, same
// caution SH-11's original tests took).
describe("localTimeZone (plan §1: drives the tooltip/heatmap local display when no explicit zone is given)", () => {
  it("resolves to a non-empty IANA zone name (or the documented UTC fallback)", () => {
    expect(typeof localTimeZone()).toBe("string");
    expect(localTimeZone().length).toBeGreaterThan(0);
  });
});

describe("formatTimeZoneLabel (plan §1/§2-1: 'UTC+9' style zone disclosure)", () => {
  it("renders UTC as UTC (no explicit +0)", () => {
    expect(formatTimeZoneLabel("UTC", new Date("2026-08-04T00:00:00Z"))).toBe("UTC");
  });

  it("renders a negative-offset zone with the sign preserved", () => {
    expect(formatTimeZoneLabel("America/New_York", new Date("2026-08-04T00:00:00Z"))).toBe("UTC-4");
  });

  it("falls back to the raw zone name for an unresolvable zone rather than inventing an offset", () => {
    expect(formatTimeZoneLabel("Not/AZone", new Date("2026-08-04T00:00:00Z"))).toBe("Not/AZone");
  });

  it("does not throw when the zone argument is omitted (falls back to the runtime's own zone)", () => {
    expect(typeof formatTimeZoneLabel()).toBe("string");
  });

  // IMPL_PLAN_SH31 (2026-08-06, user decision): "JST"/"KST" replace the
  // offset form for exactly these two zones -- both DST-free and both
  // world-wide-unique abbreviations (plan §1-3). Every other zone above
  // keeps the pre-SH-31 offset output verbatim (plan §3/(d)).
  describe("SH-31: JST/KST abbreviations for the two DST-free, globally-unique zones", () => {
    it("(a) Asia/Tokyo -> JST", () => {
      expect(formatTimeZoneLabel("Asia/Tokyo", new Date("2026-08-04T00:00:00Z"))).toBe("JST");
    });

    it("(b) Asia/Seoul -> KST", () => {
      expect(formatTimeZoneLabel("Asia/Seoul", new Date("2026-08-04T00:00:00Z"))).toBe("KST");
    });

    it("(c) unchanged across a January and an August reference date (no DST to seasonally break the static table)", () => {
      expect(formatTimeZoneLabel("Asia/Tokyo", new Date("2026-01-15T00:00:00Z"))).toBe("JST");
      expect(formatTimeZoneLabel("Asia/Tokyo", new Date("2026-08-15T00:00:00Z"))).toBe("JST");
      expect(formatTimeZoneLabel("Asia/Seoul", new Date("2026-01-15T00:00:00Z"))).toBe("KST");
      expect(formatTimeZoneLabel("Asia/Seoul", new Date("2026-08-15T00:00:00Z"))).toBe("KST");
    });

    it("(e) Asia/Shanghai stays the offset form ('UTC+8'), never 'CST' (China/US-Central/Cuba all abbreviate to CST)", () => {
      expect(formatTimeZoneLabel("Asia/Shanghai", new Date("2026-08-04T00:00:00Z"))).toBe("UTC+8");
    });

    it("(f) Asia/Kolkata stays the offset form ('UTC+5:30'), never 'IST' (India/Israel/Ireland all abbreviate to IST)", () => {
      expect(formatTimeZoneLabel("Asia/Kolkata", new Date("2026-08-04T00:00:00Z"))).toBe("UTC+5:30");
    });

    // §1-4: measured (Node v22.21.0) that `Intl.DateTimeFormat(undefined, {
    // timeZone: "Japan" }).resolvedOptions().timeZone` already normalizes
    // to "Asia/Tokyo" (and "ROK" to "Asia/Seoul"), so the legacy alias
    // itself is never added to `ZONE_ABBREVIATIONS` -- normalization runs
    // first and the table only ever needs the canonical name.
    it("(i) the legacy IANA alias 'Japan' also resolves to JST (normalized to Asia/Tokyo before the table lookup)", () => {
      expect(formatTimeZoneLabel("Japan", new Date("2026-08-04T00:00:00Z"))).toBe("JST");
    });

    it("(i) the legacy IANA alias 'ROK' also resolves to KST (normalized to Asia/Seoul before the table lookup)", () => {
      expect(formatTimeZoneLabel("ROK", new Date("2026-08-04T00:00:00Z"))).toBe("KST");
    });
  });
});

// IMPL_PLAN_SH43: same locale-native order change as `formatTooltipDate`
// above -- the zone label itself (`formatTimeZoneLabel`) and which instant
// gets converted to which wall clock are both unchanged from SH-29/SH-31.
// §(l)/(m) addendum: always 24h here too (same `hour12: false`, no AM/PM).
describe("formatTooltipDateLocal (plan §1: the chart tooltip's secondary local-time line)", () => {
  it("renders the same instant as formatTooltipDate, converted to the given zone, with the zone label and weekday, always 24h", () => {
    // 2026-08-04T11:00:00Z + 9h -> 2026-08-04 20:00 JST, a Tuesday.
    // IMPL_PLAN_SH31: the zone label is now the "JST" abbreviation (was
    // "UTC+9" before this plan) -- see the ZONE_ABBREVIATIONS table above.
    expect(formatTooltipDateLocal("2026-08-04T11:00:00Z", { locale: "en", timeZone: "Asia/Tokyo" })).toBe(
      "Tue, 08/04/2026, 20:00 JST",
    );
    expect(formatTooltipDateLocal("2026-08-04T11:00:00Z", { locale: "ja", timeZone: "Asia/Tokyo" })).toBe(
      "2026/08/04(火) 20:00 JST",
    );
  });

  // IMPL_PLAN_SH31 §3/(h): the two call sites of `formatTimeZoneLabel`
  // (this function's zone-label suffix, and `WeekdayHeatmap.jsx:94`) must
  // change together -- this pins the change on the `formatTooltipDateLocal`
  // side without touching that function's own body (plan §4/stop condition
  // 2: only `formatTimeZoneLabel`'s return value changes).
  it("(h) the tooltip's local-time line includes the JST abbreviation for Asia/Tokyo", () => {
    expect(formatTooltipDateLocal("2026-08-05T12:00:00Z", { timeZone: "Asia/Tokyo" })).toContain("JST");
  });

  it("a different timezone renders a different wall-clock time for the same instant, always 24h, and never leaves the zone unlabeled", () => {
    expect(formatTooltipDateLocal("2026-08-04T11:00:00Z", { locale: "en", timeZone: "UTC" })).toBe(
      "Tue, 08/04/2026, 11:00 UTC",
    );
    expect(formatTooltipDateLocal("2026-08-04T11:00:00Z", { locale: "en", timeZone: "America/New_York" })).toBe(
      "Tue, 08/04/2026, 07:00 UTC-4",
    );
  });

  it("returns an empty string for an unparsable date, same as formatTooltipDate", () => {
    expect(formatTooltipDateLocal("not-a-date", { timeZone: "UTC" })).toBe("");
    expect(formatTooltipDateLocal(undefined, { timeZone: "UTC" })).toBe("");
  });

  it("falls back to the runtime's own local zone when no timeZone is given (no crash, still a valid-looking string)", () => {
    expect(formatTooltipDateLocal("2026-08-04T11:00:00Z")).toMatch(/^.+\d{2}:\d{2}.*\S.*$/);
  });

  // (m) IMPL_PLAN_SH43 addendum: same AM/PM/上午/下午 absence guarantee as
  // formatTooltipDate above, for the local-time line too.
  it("(m) never renders AM/PM (en) even for an afternoon local hour", () => {
    // 2026-08-04T11:00:00Z + 9h (Asia/Tokyo) = 20:00 -- would be "8:00 PM"
    // under a 12h clock.
    expect(formatTooltipDateLocal("2026-08-04T11:00:00Z", { locale: "en", timeZone: "Asia/Tokyo" })).not.toMatch(
      /AM|PM/i,
    );
  });
});

// IMPL_PLAN_SH29 §2/(b)/(c): the heatmap's local-time column header. Plan's
// own worked example: "JSTなら9:00を左上のUTC0:00のところに表示する" -- the
// column itself always represents UTC 00:00/04:00/.../20:00 (unchanged,
// `formatClockTime` above); this is the *added* local reading of that same
// fixed hour.
describe("formatLocalClockTime (plan §2/(b): heatmap column header, local reading of a fixed UTC hour)", () => {
  it("(b): UTC 00:00 renders as 09:00 in JST -- the plan's own worked example", () => {
    expect(
      formatLocalClockTime(0, 0, { timeZone: "Asia/Tokyo", referenceDate: new Date("2026-08-05T00:00:00Z") }),
    ).toBe("09:00");
  });

  it("covers the full fixed UTC column sequence -> JST equivalents", () => {
    const referenceDate = new Date("2026-08-05T00:00:00Z");
    const cases = [
      [0, "09:00"],
      [4, "13:00"],
      [8, "17:00"],
      [12, "21:00"],
      [16, "01:00"],
      [20, "05:00"],
    ];
    for (const [hour, expected] of cases) {
      expect(formatLocalClockTime(hour, 0, { timeZone: "Asia/Tokyo", referenceDate })).toBe(expected);
    }
  });

  it("a different timezone renders a different local hour for the same fixed UTC column", () => {
    const referenceDate = new Date("2026-08-05T00:00:00Z");
    expect(formatLocalClockTime(0, 0, { timeZone: "UTC", referenceDate })).toBe("00:00");
    expect(formatLocalClockTime(0, 0, { timeZone: "America/New_York", referenceDate })).toBe("20:00");
  });

  it("never invents a time for an empty column (null/null), same as formatClockTime", () => {
    expect(formatLocalClockTime(null, null, { timeZone: "Asia/Tokyo" })).toBe("--:--");
  });
});

// IMPL_PLAN_SH36 §4
describe("formatFormingBandRanges", () => {
  const formatRange = (start, end) => `☆${start}〜${end}`;

  it("maps each range through formatRange, preserving order", () => {
    const result = formatFormingBandRanges(
      [
        { startStar: 1, endStar: 10 },
        { startStar: 20, endStar: 22 },
      ],
      formatRange,
    );
    expect(result).toEqual(["☆1〜10", "☆20〜22"]);
  });

  it("returns [] for an empty/missing input (plan §6(h): no note when nothing is forming)", () => {
    expect(formatFormingBandRanges([], formatRange)).toEqual([]);
    expect(formatFormingBandRanges(null, formatRange)).toEqual([]);
    expect(formatFormingBandRanges(undefined, formatRange)).toEqual([]);
  });

  it("drops a malformed range entry rather than guessing", () => {
    const result = formatFormingBandRanges(
      [{ startStar: 1, endStar: 10 }, { startStar: "x", endStar: 5 }, {}, null],
      formatRange,
    );
    expect(result).toEqual(["☆1〜10"]);
  });

  it("calls formatRange with the raw star numbers, letting the caller decide single-vs-range wording", () => {
    const calls = [];
    formatFormingBandRanges([{ startStar: 22, endStar: 22 }], (start, end) => {
      calls.push([start, end]);
      return "x";
    });
    expect(calls).toEqual([[22, 22]]);
  });
});

// IMPL_PLAN_SH37 §3/§4/§7(g): groups `fillLeadingPriceGaps`'s per-band
// `{ upgrade, untilDate }` list into star-range groups for the note.
describe("groupFilledBands (IMPL_PLAN_SH37 §3/§4)", () => {
  it("converts 0-based upgrade -> 1-based ☆ label (discovery.py's own itemUpgrade+1 convention)", () => {
    expect(groupFilledBands([{ upgrade: 0, untilDate: "d1" }])).toEqual([
      { startStar: 1, endStar: 1, untilDate: "d1" },
    ]);
  });

  it("merges contiguous stars that share the exact same untilDate into one range", () => {
    const result = groupFilledBands([
      { upgrade: 10, untilDate: "d1" }, // ☆11
      { upgrade: 12, untilDate: "d1" }, // ☆13
      { upgrade: 13, untilDate: "d1" }, // ☆14
      { upgrade: 14, untilDate: "d1" }, // ☆15
    ]);
    // ☆11 is isolated (☆12 was never filled -- no adjacency across it);
    // ☆13/14/15 are contiguous and share the same date -> one range.
    expect(result).toEqual([
      { startStar: 11, endStar: 11, untilDate: "d1" },
      { startStar: 13, endStar: 15, untilDate: "d1" },
    ]);
  });

  it("★never merges contiguous stars that finished forming at DIFFERENT times (plan §7(g) worked table: ☆11-18 vs ☆19)", () => {
    const result = groupFilledBands([
      { upgrade: 17, untilDate: "2026-08-18T04:00:00Z" }, // ☆18
      { upgrade: 18, untilDate: "2026-08-20T00:00:00Z" }, // ☆19 -- later
    ]);
    expect(result).toEqual([
      { startStar: 18, endStar: 18, untilDate: "2026-08-18T04:00:00Z" },
      { startStar: 19, endStar: 19, untilDate: "2026-08-20T00:00:00Z" },
    ]);
  });

  it("returns [] for empty/missing input (plan §7(h): no filled interval -> no note)", () => {
    expect(groupFilledBands([])).toEqual([]);
    expect(groupFilledBands(null)).toEqual([]);
    expect(groupFilledBands(undefined)).toEqual([]);
  });

  it("drops a malformed entry rather than guessing", () => {
    const result = groupFilledBands([{ upgrade: 0, untilDate: "d1" }, { upgrade: "x", untilDate: "d1" }, { upgrade: 1 }, null]);
    expect(result).toEqual([{ startStar: 1, endStar: 1, untilDate: "d1" }]);
  });

  it("sorts groups by star even if the input is unsorted", () => {
    const result = groupFilledBands([
      { upgrade: 5, untilDate: "d1" },
      { upgrade: 0, untilDate: "d2" },
    ]);
    expect(result.map((g) => g.startStar)).toEqual([1, 6]);
  });
});
