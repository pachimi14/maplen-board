import { describe, expect, it } from "vitest";
import { formatDiscoveryPrice } from "./priceFormat.js";

// IMPL_PLAN_SH33 §1: real values from the local API (§1-2's own examples +
// a live `/sf-history/discovery/prices` fetch during implementation), so
// this suite exercises the exact numbers the acceptance criteria (a)/(b)
// describe, not synthetic round ones only.
describe("formatDiscoveryPrice", () => {
  it("(a): an untouched ☆1-10 DISCOVERY price (1e-6) never collapses to '0'", () => {
    expect(formatDiscoveryPrice(0.000001)).toBe("0.000001 NESO");
    expect(formatDiscoveryPrice(1e-6)).toBe("0.000001 NESO");
  });

  it("(b): a large value keeps full precision, 3-digit-grouped, trailing zeros dropped", () => {
    expect(formatDiscoveryPrice(1132506.562014)).toBe("1,132,506.562014 NESO");
    expect(formatDiscoveryPrice(96058.335091)).toBe("96,058.335091 NESO");
  });

  it("a value with float noise past the 6th decimal still rounds cleanly (real API sample)", () => {
    // 34599.203715999996 is exactly what the local API returned for one
    // band (upgradeCount=12) -- toFixed(6) rounds it to the true
    // 1e-12-multiple value, not a truncated/noisy one.
    expect(formatDiscoveryPrice(34599.203715999996)).toBe("34,599.203716 NESO");
  });

  it("plan §1-3 example: trims trailing zeros without dropping real precision", () => {
    expect(formatDiscoveryPrice(23758.94)).toBe("23,758.94 NESO");
  });

  it("only an actual 0 renders as bare '0' (never '0.000000')", () => {
    expect(formatDiscoveryPrice(0)).toBe("0 NESO");
  });

  it("a whole-number price never grows a spurious decimal point", () => {
    expect(formatDiscoveryPrice(100)).toBe("100 NESO");
  });

  it("negative values keep the sign (never expected in practice, but never silently dropped)", () => {
    expect(formatDiscoveryPrice(-5.5)).toBe("-5.5 NESO");
  });

  it("null/undefined/NaN/Infinity all render '--', matching formatExactNeso's own contract", () => {
    expect(formatDiscoveryPrice(null)).toBe("--");
    expect(formatDiscoveryPrice(undefined)).toBe("--");
    expect(formatDiscoveryPrice(NaN)).toBe("--");
    expect(formatDiscoveryPrice(Infinity)).toBe("--");
  });
});
