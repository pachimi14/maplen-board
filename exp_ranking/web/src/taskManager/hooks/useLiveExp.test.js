import { describe, expect, it } from "vitest";
import { LIVE_EXP_INTERVAL_MS, refreshIsDue } from "./useLiveExp.js";

describe("live EXP refresh cadence", () => {
  it("allows the first refresh and blocks another for five minutes", () => {
    expect(refreshIsDue(0, 1000)).toBe(true);
    expect(refreshIsDue(1000, 1000 + LIVE_EXP_INTERVAL_MS - 1)).toBe(false);
    expect(refreshIsDue(1000, 1000 + LIVE_EXP_INTERVAL_MS)).toBe(true);
  });
});
