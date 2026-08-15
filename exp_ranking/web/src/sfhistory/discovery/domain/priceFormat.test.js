import { describe, expect, it } from "vitest";
import { formatDiscoveryPrice } from "./priceFormat.js";

// IMPL_PLAN_SH33 §1: real values from the local API (§1-2's own examples +
// a live `/sf-history/discovery/prices` fetch during implementation), so
// this suite exercises the exact numbers the acceptance criteria (a)/(b)
// describe, not synthetic round ones only.
//
// Post-review follow-up (実機レビュー, ragged decimal point across the
// 25-row table): every value is now padded to exactly 6 decimals, never
// trimmed, and the " NESO" unit suffix has moved to the column header
// (DiscoveryPriceTable.jsx) -- this function returns the bare number only.
describe("formatDiscoveryPrice", () => {
  it("(a): an untouched ☆1-10 DISCOVERY price (1e-6) never collapses to '0'", () => {
    expect(formatDiscoveryPrice(0.000001)).toBe("0.000001");
    expect(formatDiscoveryPrice(1e-6)).toBe("0.000001");
  });

  it("(a): always exactly 6 decimal digits -- '0.000001' and a large settled value line up", () => {
    const small = formatDiscoveryPrice(0.000001);
    const large = formatDiscoveryPrice(40877.246889999995);
    const decimalsOf = (s) => s.split(".")[1].length;
    expect(decimalsOf(small)).toBe(6);
    expect(decimalsOf(large)).toBe(6);
    expect(large).toBe("40,877.246890"); // was "40,877.24689" (5 decimals) before this fix
  });

  it("(b): a large value keeps full precision, 3-digit-grouped, 6 decimals (never trimmed)", () => {
    expect(formatDiscoveryPrice(1132506.562014)).toBe("1,132,506.562014");
    expect(formatDiscoveryPrice(96058.335091)).toBe("96,058.335091");
  });

  it("a value with float noise past the 6th decimal still rounds cleanly (real API sample)", () => {
    // 34599.203715999996 is exactly what the local API returned for one
    // band (upgradeCount=12) -- toFixed(6) rounds it to the true
    // 1e-12-multiple value, not a truncated/noisy one.
    expect(formatDiscoveryPrice(34599.203715999996)).toBe("34,599.203716");
  });

  it("a value whose 6th decimal is a real trailing zero keeps that zero (no trimming)", () => {
    expect(formatDiscoveryPrice(23758.94)).toBe("23,758.940000");
  });

  it("(d): only an actual 0 renders as all-zero decimals -- never a rounded-down non-zero value", () => {
    expect(formatDiscoveryPrice(0)).toBe("0.000000");
  });

  it("a whole-number price still gets the full 6 decimal zeros, not a bare integer", () => {
    expect(formatDiscoveryPrice(100)).toBe("100.000000");
  });

  it("negative values keep the sign (never expected in practice, but never silently dropped)", () => {
    expect(formatDiscoveryPrice(-5.5)).toBe("-5.500000");
  });

  it("null/undefined/NaN/Infinity all render '--', matching formatExactNeso's own contract", () => {
    expect(formatDiscoveryPrice(null)).toBe("--");
    expect(formatDiscoveryPrice(undefined)).toBe("--");
    expect(formatDiscoveryPrice(NaN)).toBe("--");
    expect(formatDiscoveryPrice(Infinity)).toBe("--");
  });
});
