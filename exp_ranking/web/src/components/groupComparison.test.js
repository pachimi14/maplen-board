import { describe, expect, it } from "vitest";
import { buildGroupComparisonRows } from "./groupComparison.js";

const characters = [
  { name: "Alice", job: "Hero", worldId: "Scania", dailyGain: 100, weeklyGain: 700, monthlyGain: 3000 },
  { name: "Bob", job: "Bishop", worldId: "Bera", dailyGain: 50, weeklyGain: 350, monthlyGain: 1500 },
];

describe("buildGroupComparisonRows", () => {
  it("returns an empty array for no members", () => {
    expect(buildGroupComparisonRows({ characters, memberKeys: [], series: [], mode: "total" })).toEqual([]);
  });

  it("one row per member key, in the given order", () => {
    const rows = buildGroupComparisonRows({ characters, memberKeys: ["Alice", "Bob"], series: [], mode: "total" });
    expect(rows.map((row) => row.key)).toEqual(["Alice", "Bob"]);
  });

  it("reads job/server/standing daily-weekly-monthly gains straight from the character (never recomputed)", () => {
    const [row] = buildGroupComparisonRows({ characters, memberKeys: ["Alice"], series: [], mode: "total" });
    expect(row.name).toBe("Alice");
    expect(row.job).toBe("Hero");
    expect(row.worldId).toBe("Scania");
    expect(row.daily).toBe(100);
    expect(row.weekly).toBe(700);
    expect(row.monthly).toBe(3000);
  });

  it("sums the selected-period series values in 'total' mode", () => {
    const series = [
      { snapshotDate: "2026-07-08", Alice: 10, Bob: 5 },
      { snapshotDate: "2026-07-09", Alice: 20, Bob: 15 },
      { snapshotDate: "2026-07-10", Alice: 30, Bob: 25 },
    ];
    const rows = buildGroupComparisonRows({ characters, memberKeys: ["Alice", "Bob"], series, mode: "total" });
    expect(rows.find((r) => r.key === "Alice").periodValue).toBe(60);
    expect(rows.find((r) => r.key === "Bob").periodValue).toBe(45);
  });

  it("averages the selected-period series values in 'average' mode", () => {
    const series = [
      { snapshotDate: "2026-07-08", Alice: 10 },
      { snapshotDate: "2026-07-09", Alice: 20 },
      { snapshotDate: "2026-07-10", Alice: 30 },
    ];
    const rows = buildGroupComparisonRows({ characters, memberKeys: ["Alice"], series, mode: "average" });
    expect(rows[0].periodValue).toBe(20);
    expect(rows[0].periodDayCount).toBe(3);
  });

  it("skips missing/null days when summing or averaging (a gap doesn't count as 0)", () => {
    const series = [
      { snapshotDate: "2026-07-08", Alice: 10 },
      { snapshotDate: "2026-07-09", Alice: null },
      { snapshotDate: "2026-07-10", Alice: 30 },
    ];
    const totalRows = buildGroupComparisonRows({ characters, memberKeys: ["Alice"], series, mode: "total" });
    expect(totalRows[0].periodValue).toBe(40);
    expect(totalRows[0].periodDayCount).toBe(2);

    const avgRows = buildGroupComparisonRows({ characters, memberKeys: ["Alice"], series, mode: "average" });
    expect(avgRows[0].periodValue).toBe(20);
  });

  it("reports periodValue null (not 0/NaN) when there are no comparable days at all", () => {
    const rows = buildGroupComparisonRows({ characters, memberKeys: ["Alice"], series: [], mode: "total" });
    expect(rows[0].periodValue).toBeNull();
    expect(rows[0].periodDayCount).toBe(0);
  });

  it("still produces a row (all null fields, key as name) for a member name that doesn't resolve to a character", () => {
    const rows = buildGroupComparisonRows({
      characters,
      memberKeys: ["Alice", "GoneOrRenamed"],
      series: [{ snapshotDate: "2026-07-10", Alice: 10 }],
      mode: "total",
    });
    const missing = rows.find((r) => r.key === "GoneOrRenamed");
    expect(missing).toBeDefined();
    expect(missing.name).toBe("GoneOrRenamed");
    expect(missing.job).toBeNull();
    expect(missing.worldId).toBeNull();
    expect(missing.daily).toBeNull();
    expect(missing.weekly).toBeNull();
    expect(missing.monthly).toBeNull();
    expect(missing.periodValue).toBeNull();
  });

  it("does not crash for non-array characters/memberKeys/series (defensive defaults)", () => {
    expect(buildGroupComparisonRows({ characters: null, memberKeys: null, series: null, mode: "total" })).toEqual([]);
  });
});
