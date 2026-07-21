import { describe, expect, it } from "vitest";
import { absoluteExpFromLevel, calculateLiveExp, parseExpInteger } from "./liveExp.js";

const now = new Date("2026-07-20T12:00:00Z");
const expTable = { 240: "1000", 241: "2000", 242: "3000", 243: "4000" };

describe("live EXP calculation", () => {
  it("calculates the measured same-level difference exactly", () => {
    const prefix = 28623769201147n - 1599334784349n;
    const measuredTable = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [240 + index, "0"]));
    measuredTable[240] = prefix.toString();
    const result = calculateLiveExp({
      baseline: { totalExpFrom240: "28623769201147", levelExpPercent: 39.135 },
      current: { level: 252, exp: "1909381016556", levelExpPercent: 46.721 },
      expTable: measuredTable,
      baselineUpdatedAt: "2026-07-20T00:28:19Z",
      now,
    });
    expect(result).toMatchObject({ ok: true, gain: "310046232207", levelExpPercent: 46.721 });
  });

  it.each([
    [241, "100", "1100"],
    [242, "100", "3100"],
    [243, "100", "6100"],
  ])("handles level %i exactly", (level, exp, expected) => {
    expect(absoluteExpFromLevel(level, exp, expTable)).toBe(BigInt(expected));
  });

  it("rejects stale baselines, negative gains, and unsafe numeric EXP", () => {
    expect(calculateLiveExp({
      baseline: { totalExpFrom240: "10" }, current: { level: 240, exp: "20" }, expTable,
      baselineUpdatedAt: "2026-07-19T23:59:59Z", now,
    }).code).toBe("baselinePending");
    expect(calculateLiveExp({
      baseline: { totalExpFrom240: "20" }, current: { level: 240, exp: "10" }, expTable,
      baselineUpdatedAt: "2026-07-20T00:00:00Z", now,
    }).code).toBe("negativeGain");
    expect(parseExpInteger(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});
