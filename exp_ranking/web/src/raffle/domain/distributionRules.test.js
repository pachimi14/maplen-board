import { describe, expect, it } from "vitest";
import { allocateDistribution, materializeAutomaticShares, resolveDistributionRules } from "./distributionRules.js";

describe("distribution rules", () => {
  const party = ["a", "b", "c", "d", "e", "f"];

  it("gives a taxed member (100 − tax-rate) ÷ party-size and splits the remainder", () => {
    const result = resolveDistributionRules(party, { a: "50" }, { b: "10" });
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.taxText)).toEqual(["50%", null, null, null, null, null]);
    expect(result.rows.map((row) => row.shareText)).toEqual(["8.3333%", "10%", "20.4166%", "20.4166%", "20.4166%", "20.4166%"]);
    expect(result.rows[0].shareInputText).toBe("8.333333");
  });

  // LULU-164: Tax is the share a member pays, so a taxed member keeps (100 − tax) ÷ party-size.
  it("treats Tax as the share paid: 3 members, B and C at Tax 40 → 60% / 20% / 20%", () => {
    const result = resolveDistributionRules(["A", "B", "C"], { B: "40", C: "40" });
    expect(result.ok).toBe(true);
    expect(result.totalText).toBe("100%");
    expect(result.rows.map((row) => row.taxText)).toEqual([null, "40%", "40%"]);
    expect(result.rows.map((row) => row.shareText)).toEqual(["60%", "20%", "20%"]);
    expect(result.rows.map((row) => row.shareInputText)).toEqual([null, "20", "20"]);
  });

  it("gives a Tax 100 member 0% and leaves the full remainder to untaxed members", () => {
    const result = resolveDistributionRules(["a", "b", "c"], { a: "100" });
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.shareText)).toEqual(["0%", "50%", "50%"]);
    expect(result.rows[0].shareInputText).toBe("0");
  });

  it("gives one Tax 10 member in a 6-member party 15% and the other five 17% each", () => {
    const result = resolveDistributionRules(party, { a: "10" });
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.shareText)).toEqual(["15%", "17%", "17%", "17%", "17%", "17%"]);
  });

  it("combines Tax with an explicit share: B Tax 40 (→ 20%), A share 50 → C automatic 30%", () => {
    const result = resolveDistributionRules(["A", "B", "C"], { B: "40" }, { A: "50" });
    expect(result.ok).toBe(true);
    expect(result.totalText).toBe("100%");
    expect(result.rows.map((row) => row.shareText)).toEqual(["50%", "20%", "30%"]);
    const filled = materializeAutomaticShares(["A", "B", "C"], { B: "40" }, { A: "50" });
    expect(filled.sharePercentByMemberId).toEqual({ A: "50", C: "30" });
  });

  it("supports a zero explicit share while distinguishing it from blank", () => {
    const result = resolveDistributionRules(["a", "b", "c"], {}, { a: "0" });
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.shareText)).toEqual(["0%", "50%", "50%"]);
  });

  it("rejects conflicts, over-allocation, and a party with no receiver", () => {
    expect(resolveDistributionRules(["a"], { a: "50" }, { a: "50" }).errors[0].code).toBe("tax_share_conflict");
    expect(resolveDistributionRules(["a", "b"], {}, { a: "60", b: "50" }).errors[0].code).toBe("distribution_over_100");
    expect(resolveDistributionRules(["a", "b"], { a: "50", b: "50" }, {}).errors[0].code).toBe("no_distribution_receiver");
  });

  it("allocates every NESO and gives integer remainder in party order", () => {
    const resolved = resolveDistributionRules(["a", "b", "c"], {}, { a: "10" });
    const allocations = allocateDistribution(101n, resolved, ["a", "b", "c"]);
    expect([...allocations.values()]).toEqual([11n, 45n, 45n]);
  });

  it("writes automatic shares into blank inputs and keeps the exact total at 100%", () => {
    const filled = materializeAutomaticShares(["a", "b", "c"], {}, {});
    expect(filled.sharePercentByMemberId).toEqual({ a: "33.333334", b: "33.333333", c: "33.333333" });
    expect(resolveDistributionRules(["a", "b", "c"], {}, filled.sharePercentByMemberId).ok).toBe(true);
  });

  it("preserves explicit shares and only fills the remaining blank receivers", () => {
    const filled = materializeAutomaticShares(["a", "b", "c", "d"], { a: "50" }, { b: "10" });
    expect(filled.sharePercentByMemberId).toEqual({ b: "10", c: "38.75", d: "38.75" });
  });

  it("keeps tax-derived shares and the current total visible when explicit shares do not total 100%", () => {
    const result = resolveDistributionRules(
      ["a", "b", "c", "d", "e", "f"],
      { a: "50" },
      { b: "16.6", c: "11", d: "16.6", e: "12", f: "30" },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("distribution_not_100");
    expect(result.rows[0]).toMatchObject({ shareInputText: "8.333333", shareText: "8.3333%" });
    expect(result.totalText).toBe("94.5333%");
  });
});
