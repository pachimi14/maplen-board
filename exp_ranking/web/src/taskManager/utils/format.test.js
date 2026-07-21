import { describe, expect, it } from "vitest";
import { formatCompactRemaining } from "./format.js";

describe("compact remaining-time formatting", () => {
  it.each([
    [30 * 86400000 + 14 * 3600000 + 30 * 60000, "30日"],
    [2 * 86400000 + 14 * 3600000 + 30 * 60000, "2日"],
    [14 * 3600000 + 30 * 60000, "14時間"],
    [30 * 60000 + 59000, "30分"],
    [-1000, "0分"],
  ])("formats %i ms as %s", (milliseconds, expected) => {
    expect(formatCompactRemaining(milliseconds)).toBe(expected);
  });
});
