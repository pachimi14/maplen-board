import { describe, expect, it } from "vitest";
import { calculateTopPercent } from "./percentile.js";

describe("calculateTopPercent", () => {
  it("computes rank/total*100 unrounded for a normal case", () => {
    // 5 / 100 * 100 = 5
    expect(calculateTopPercent(5, 100)).toBe(5);
  });

  it("computes a non-integer percent without rounding", () => {
    // 1 / 3 * 100 = 33.333...
    expect(calculateTopPercent(1, 3)).toBeCloseTo(33.3333333333, 9);
  });

  it("returns 100 when rank equals total (last place)", () => {
    expect(calculateTopPercent(100, 100)).toBe(100);
  });

  it("returns null when total is 0", () => {
    expect(calculateTopPercent(5, 0)).toBeNull();
  });

  it("returns null when total is negative", () => {
    expect(calculateTopPercent(5, -10)).toBeNull();
  });

  it("returns null when rank is 0 or negative", () => {
    expect(calculateTopPercent(0, 100)).toBeNull();
    expect(calculateTopPercent(-3, 100)).toBeNull();
  });

  it("returns null for null/NaN inputs", () => {
    expect(calculateTopPercent(null, 100)).toBeNull();
    expect(calculateTopPercent(5, null)).toBeNull();
    expect(calculateTopPercent(NaN, 100)).toBeNull();
    expect(calculateTopPercent(5, NaN)).toBeNull();
    expect(calculateTopPercent(undefined, 100)).toBeNull();
  });

  it("returns null when rank exceeds total", () => {
    expect(calculateTopPercent(101, 100)).toBeNull();
  });
});
