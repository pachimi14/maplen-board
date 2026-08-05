import { describe, expect, it } from "vitest";
import {
  formatAxisDate,
  formatClockTime,
  formatCompactNeso,
  formatExactNeso,
  formatSignedCompactNeso,
  formatTimeZoneLabel,
  formatTooltipDate,
  localTimeZone,
  weekdayShortLabel,
} from "./format.js";

describe("formatCompactNeso (design §2: '950M' / '1.25B' style)", () => {
  it("matches the two examples given in the design/plan verbatim", () => {
    expect(formatCompactNeso(950_000_000)).toBe("950M");
    expect(formatCompactNeso(1_250_000_000)).toBe("1.25B");
  });

  it("uses two decimals below 100 of a unit, none at/above 100", () => {
    expect(formatCompactNeso(1_500_000)).toBe("1.50M");
    expect(formatCompactNeso(150_000_000)).toBe("150M");
    expect(formatCompactNeso(1_500)).toBe("1.50K");
  });

  it("handles small values and negatives", () => {
    expect(formatCompactNeso(500)).toBe("500");
    expect(formatCompactNeso(-950_000_000)).toBe("-950M");
    expect(formatCompactNeso(0)).toBe("0");
  });

  it("returns a placeholder for null/undefined/NaN", () => {
    expect(formatCompactNeso(null)).toBe("--");
    expect(formatCompactNeso(undefined)).toBe("--");
    expect(formatCompactNeso(NaN)).toBe("--");
  });
});

describe("formatSignedCompactNeso", () => {
  it("prefixes non-negative deltas with +, keeps the built-in - for negatives", () => {
    expect(formatSignedCompactNeso(950_000_000)).toBe("+950M");
    expect(formatSignedCompactNeso(-950_000_000)).toBe("-950M");
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

// IMPL_PLAN_SH11 §2: date/time display is now the *viewer's local time*
// (data stays UTC -- only these display functions changed), with the
// weekday appended. This repo sets no global `TZ` (vitest.config.js), so
// every case below pins an explicit `timeZone` rather than relying on
// whatever zone the test happens to run in.
describe("date formatting (IMPL_PLAN_SH11 §2: local time + weekday, UTC data unchanged)", () => {
  it("formatAxisDate: local MM/DD plus the localized short weekday", () => {
    // 2026-03-08T00:00:00Z, JST (+9) -> still 03-08, a Sunday.
    expect(formatAxisDate("2026-03-08T00:00:00Z", { locale: "ja", timeZone: "Asia/Tokyo" })).toBe("03/08 (日)");
    expect(formatAxisDate("2026-03-08T00:00:00Z", { locale: "en", timeZone: "Asia/Tokyo" })).toBe("03/08 (Sun)");
  });

  it("formatAxisDate: a late-UTC point rolls into the next local day/weekday (JST)", () => {
    // 2026-03-08T20:00:00Z (Sunday) + 9h -> 2026-03-09 05:00, a Monday.
    expect(formatAxisDate("2026-03-08T20:00:00Z", { locale: "en", timeZone: "Asia/Tokyo" })).toBe("03/09 (Mon)");
  });

  it("formatTooltipDate: full local date+time plus weekday, matching the plan's own worked example", () => {
    // 2026-08-04T11:00:00Z + 9h -> 2026-08-04 20:00 JST, a Tuesday.
    expect(formatTooltipDate("2026-08-04T11:00:00Z", { locale: "ja", timeZone: "Asia/Tokyo" })).toBe("2026-08-04 20:00 (火)");
  });

  it("formatTooltipDate: a different timezone renders a different wall-clock time for the same instant", () => {
    expect(formatTooltipDate("2026-08-04T11:00:00Z", { locale: "en", timeZone: "UTC" })).toBe("2026-08-04 11:00 (Tue)");
    expect(formatTooltipDate("2026-08-04T11:00:00Z", { locale: "en", timeZone: "America/New_York" })).toBe("2026-08-04 07:00 (Tue)");
  });

  it("both return an empty string for an unparsable date rather than throwing", () => {
    expect(formatAxisDate("not-a-date", { timeZone: "UTC" })).toBe("");
    expect(formatTooltipDate(undefined, { timeZone: "UTC" })).toBe("");
  });

  it("both fall back to the runtime's own local zone when no timeZone is given (no crash, still a valid-looking string)", () => {
    expect(formatAxisDate("2026-03-08T00:00:00Z")).toMatch(/^\d{2}\/\d{2} \(.+\)$/);
    expect(formatTooltipDate("2026-03-08T00:00:00Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(.+\)$/);
  });
});

describe("localTimeZone (plan §2/(c): drives the on-screen timezone disclosure)", () => {
  it("resolves to a non-empty IANA zone name (or the documented UTC fallback)", () => {
    expect(typeof localTimeZone()).toBe("string");
    expect(localTimeZone().length).toBeGreaterThan(0);
  });
});

describe("formatTimeZoneLabel (plan §2/(c): '表示時刻: ... (UTC+9)')", () => {
  it("renders JST as UTC+9", () => {
    expect(formatTimeZoneLabel("Asia/Tokyo", new Date("2026-08-04T00:00:00Z"))).toBe("UTC+9");
  });

  it("renders UTC as UTC (no explicit +0)", () => {
    expect(formatTimeZoneLabel("UTC", new Date("2026-08-04T00:00:00Z"))).toBe("UTC");
  });

  it("renders a negative-offset zone with the sign preserved", () => {
    expect(formatTimeZoneLabel("America/New_York", new Date("2026-08-04T00:00:00Z"))).toBe("UTC-4");
  });

  it("falls back to the raw zone name for an unresolvable zone rather than inventing an offset", () => {
    expect(formatTimeZoneLabel("Not/AZone", new Date("2026-08-04T00:00:00Z"))).toBe("Not/AZone");
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

describe("formatClockTime (heatmap column headers)", () => {
  it("pads a bare hour/minute pair", () => {
    expect(formatClockTime(5, 0)).toBe("05:00");
    expect(formatClockTime(21, 0)).toBe("21:00");
  });

  it("never invents a time for an empty column (null/null)", () => {
    expect(formatClockTime(null, null)).toBe("--:--");
  });
});
