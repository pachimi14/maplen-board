import { describe, expect, it } from "vitest";
import {
  formatAxisDate,
  formatClockTime,
  formatCompactNeso,
  formatExactNeso,
  formatSignedCompactNeso,
  formatTooltipDate,
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
describe("date formatting (IMPL_PLAN_SH14 §2: fixed UTC + weekday)", () => {
  it("formatAxisDate: UTC MM/DD plus the localized short weekday", () => {
    // 2026-03-08T00:00:00Z is a Sunday (UTC).
    expect(formatAxisDate("2026-03-08T00:00:00Z", { locale: "ja" })).toBe("03/08 (日)");
    expect(formatAxisDate("2026-03-08T00:00:00Z", { locale: "en" })).toBe("03/08 (Sun)");
  });

  it("formatAxisDate: a late-UTC-hour point stays on the same UTC day (no timezone shift applies)", () => {
    // 2026-03-08T20:00:00Z is still 03-08 UTC (a Sunday) -- unlike SH-11's
    // JST rollover example, there is no zone conversion left to roll it
    // into the next day.
    expect(formatAxisDate("2026-03-08T20:00:00Z", { locale: "en" })).toBe("03/08 (Sun)");
  });

  it("formatTooltipDate: full UTC date+time (with an explicit 'UTC' marker) plus weekday", () => {
    expect(formatTooltipDate("2026-08-04T11:00:00Z", { locale: "ja" })).toBe("2026-08-04 11:00 UTC (火)");
    expect(formatTooltipDate("2026-08-04T11:00:00Z", { locale: "en" })).toBe("2026-08-04 11:00 UTC (Tue)");
  });

  it("both return an empty string for an unparsable date rather than throwing", () => {
    expect(formatAxisDate("not-a-date")).toBe("");
    expect(formatTooltipDate(undefined)).toBe("");
  });

  it("both fall back to the default 'en' locale when no options are given (no crash, still a valid-looking string)", () => {
    expect(formatAxisDate("2026-03-08T00:00:00Z")).toMatch(/^\d{2}\/\d{2} \(.+\)$/);
    expect(formatTooltipDate("2026-03-08T00:00:00Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \(.+\)$/);
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
