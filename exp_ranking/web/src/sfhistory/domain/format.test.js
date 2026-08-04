import { describe, expect, it } from "vitest";
import { formatAxisDate, formatCompactNeso, formatExactNeso, formatSignedCompactNeso, formatTooltipDate } from "./format.js";

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

describe("date formatting (design §9: labels are bucket-start UTC)", () => {
  it("formatAxisDate is a short MM/DD tick", () => {
    expect(formatAxisDate("2026-03-08T00:00:00Z")).toBe("03/08");
  });

  it("formatTooltipDate is a full UTC date+time", () => {
    expect(formatTooltipDate("2026-03-08T04:00:00Z")).toBe("2026-03-08 04:00 UTC");
  });

  it("both return an empty string for an unparsable date rather than throwing", () => {
    expect(formatAxisDate("not-a-date")).toBe("");
    expect(formatTooltipDate(undefined)).toBe("");
  });
});
