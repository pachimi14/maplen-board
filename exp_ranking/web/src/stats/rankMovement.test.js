import { describe, expect, it } from "vitest";
import { computePassedAndOvertaken } from "./rankMovement.js";

// Target: previousRank=5 (yesterday), rank=3 (today).
const target = { historyKey: "T1", name: "Target", previousRank: 5, rank: 3 };

describe("computePassedAndOvertaken", () => {
  it("finds every character the target passed, sorted by (rank, historyKey)", () => {
    const all = [
      // Was ahead (prev 2 < 5), now behind (target 3 < 5): passed, rank=5
      { historyKey: "H1", name: "Hana", previousRank: 2, rank: 5 },
      // Was ahead (prev 4 < 5), now behind (target 3 < 6): passed, rank=6
      { historyKey: "A1", name: "Alice", previousRank: 4, rank: 6 },
      // Was ahead (prev 1 < 5), now behind (target 3 < 6): passed, rank=6 (tie with A1)
      { historyKey: "G1", name: "Gina", previousRank: 1, rank: 6 },
    ];

    const result = computePassedAndOvertaken(target, all);

    expect(result.overtakenBy).toEqual([]);
    expect(result.passed).toEqual([
      { historyKey: "H1", name: "Hana", previousRank: 2, rank: 5 },
      { historyKey: "A1", name: "Alice", previousRank: 4, rank: 6 },
      { historyKey: "G1", name: "Gina", previousRank: 1, rank: 6 },
    ]);
  });

  it("finds every character that overtook the target", () => {
    const all = [
      // Was behind (prev 10 > 5), now ahead (rank 1 < 3): overtook, rank=1
      { historyKey: "C1", name: "Carol", previousRank: 10, rank: 1 },
      // Was behind (prev 20 > 5), now ahead (rank 2 < 3): overtook, rank=2
      { historyKey: "I1", name: "Ivan", previousRank: 20, rank: 2 },
    ];

    const result = computePassedAndOvertaken(target, all);

    expect(result.passed).toEqual([]);
    expect(result.overtakenBy).toEqual([
      { historyKey: "C1", name: "Carol", previousRank: 10, rank: 1 },
      { historyKey: "I1", name: "Ivan", previousRank: 20, rank: 2 },
    ]);
  });

  it("excludes an opponent with previousRank null (new/re-entered/missing yesterday)", () => {
    const all = [
      { historyKey: "N1", name: "Newbie", previousRank: null, rank: 1 },
    ];
    const result = computePassedAndOvertaken(target, all);
    expect(result).toEqual({ passed: [], overtakenBy: [] });
  });

  it("returns both lists empty when the target's own previousRank is null", () => {
    const noPrevTarget = { historyKey: "T1", name: "Target", previousRank: null, rank: 3 };
    const all = [
      { historyKey: "H1", name: "Hana", previousRank: 2, rank: 5 },
    ];
    const result = computePassedAndOvertaken(noPrevTarget, all);
    expect(result).toEqual({ passed: [], overtakenBy: [] });
  });

  it("produces identical results regardless of input order (shuffled)", () => {
    const inOrder = [
      { historyKey: "H1", name: "Hana", previousRank: 2, rank: 5 },
      { historyKey: "A1", name: "Alice", previousRank: 4, rank: 6 },
      { historyKey: "C1", name: "Carol", previousRank: 10, rank: 1 },
      { historyKey: "I1", name: "Ivan", previousRank: 20, rank: 2 },
    ];
    const shuffled = [inOrder[3], inOrder[1], inOrder[2], inOrder[0]];

    const resultInOrder = computePassedAndOvertaken(target, inOrder);
    const resultShuffled = computePassedAndOvertaken(target, shuffled);

    expect(resultShuffled).toEqual(resultInOrder);
  });

  it("identifies by historyKey, not name (same name, different historyKey are distinct)", () => {
    const all = [
      { historyKey: "A1", name: "Alice", previousRank: 4, rank: 6 },
      { historyKey: "A2", name: "Alice", previousRank: 1, rank: 6 },
    ];
    const result = computePassedAndOvertaken(target, all);
    expect(result.passed).toEqual([
      { historyKey: "A1", name: "Alice", previousRank: 4, rank: 6 },
      { historyKey: "A2", name: "Alice", previousRank: 1, rank: 6 },
    ]);
  });

  it("excludes candidates missing historyKey, even the target itself", () => {
    const all = [
      { historyKey: null, name: "Ghost", previousRank: 1, rank: 6 },
      { historyKey: "", name: "Empty", previousRank: 1, rank: 6 },
      { historyKey: "H1", name: "Hana", previousRank: 2, rank: 5 },
    ];
    const result = computePassedAndOvertaken(target, all);
    expect(result.passed).toEqual([
      { historyKey: "H1", name: "Hana", previousRank: 2, rank: 5 },
    ]);

    const targetWithoutKey = { historyKey: null, name: "Target", previousRank: 5, rank: 3 };
    expect(computePassedAndOvertaken(targetWithoutKey, all)).toEqual({
      passed: [],
      overtakenBy: [],
    });
  });

  it("returns empty lists when no rank crossover occurred", () => {
    const all = [
      // previousRank equal to target's: neither side is strictly ahead/behind.
      { historyKey: "J1", name: "Jill", previousRank: 5, rank: 4 },
      // Was behind target, still behind target: no crossover.
      { historyKey: "K1", name: "Kai", previousRank: 8, rank: 8 },
    ];
    const result = computePassedAndOvertaken(target, all);
    expect(result).toEqual({ passed: [], overtakenBy: [] });
  });
});
