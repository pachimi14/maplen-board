import { describe, expect, it } from "vitest";
import { buildWeekdayHeatmap, extremeHeatmapCells, totalHeatmapCount } from "./weekdayStats.js";

// This project sets no global `TZ` (see vitest.config.js), so every test
// below pins an explicit IANA `timeZone` -- relying on the *host machine's*
// local zone here would make these tests non-deterministic depending on
// who/where they run (exactly the trap IMPL_PLAN_SH11 §2's own note warns
// about for format.js).

function point(date, expected, extra = {}) {
  return { date, expected, provisional: false, ...extra };
}

describe("buildWeekdayHeatmap: shape", () => {
  it("always returns 42 cells (7 weekdays x 6 UTC slots) and 6 columns, even for an empty series", () => {
    const { cells, columns } = buildWeekdayHeatmap([], "UTC");
    expect(cells).toHaveLength(42);
    expect(columns).toHaveLength(6);
    expect(cells.every((cell) => cell.n === 0 && cell.median === null)).toBe(true);
    expect(columns.every((column) => column.localHour === null && column.localMinute === null)).toBe(true);
  });

  it("covers every (weekdayIndex 0..6) x (bucketSlot 0..5) pair exactly once", () => {
    const { cells } = buildWeekdayHeatmap([], "UTC");
    const keys = new Set(cells.map((cell) => `${cell.weekdayIndex}-${cell.bucketSlot}`));
    expect(keys.size).toBe(42);
    for (let w = 0; w < 7; w++) for (let b = 0; b < 6; b++) expect(keys.has(`${w}-${b}`)).toBe(true);
  });
});

describe("buildWeekdayHeatmap: UTC-basis grouping (no timezone conversion)", () => {
  it("2026-03-08 is a Sunday (UTC): a 00:00 point lands in weekdayIndex=0, bucketSlot=0", () => {
    const { cells } = buildWeekdayHeatmap([point("2026-03-08T00:00:00Z", 100)], "UTC");
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 0);
    expect(cell.n).toBe(1);
    expect(cell.median).toBe(100);
  });

  it("groups a 20:00 UTC point into bucketSlot=5 (floor(20/4))", () => {
    const { cells } = buildWeekdayHeatmap([point("2026-03-08T20:00:00Z", 100)], "UTC");
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 5);
    expect(cell.n).toBe(1);
  });
});

describe("buildWeekdayHeatmap: local-timezone weekday shift across midnight", () => {
  it("a UTC Sunday 20:00 point is JST Monday 05:00 -- must land in the Monday row, not Sunday (plan §2's own worked example)", () => {
    // 2026-03-08 is a Sunday (UTC). +9h -> 2026-03-09 05:00, a Monday.
    const { cells } = buildWeekdayHeatmap([point("2026-03-08T20:00:00Z", 100)], "Asia/Tokyo");
    const mondayCell = cells.find((c) => c.weekdayIndex === 1 && c.bucketSlot === 5);
    const sundayCell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 5);
    expect(mondayCell.n).toBe(1);
    expect(sundayCell.n).toBe(0);
  });

  it("the same point's column (bucketSlot=5) is labeled with the real local hour, 05:00, not rounded to a 4h mark", () => {
    const { columns } = buildWeekdayHeatmap([point("2026-03-08T20:00:00Z", 100)], "Asia/Tokyo");
    const column = columns.find((c) => c.bucketSlot === 5);
    expect(column.localHour).toBe(5);
    expect(column.localMinute).toBe(0);
  });

  it("all 6 JST columns land on the plan's own worked example (09/13/17/21/01/05), sorted ascending", () => {
    const points = [0, 4, 8, 12, 16, 20].map((h) => point(`2026-03-08T${String(h).padStart(2, "0")}:00:00Z`, 100));
    const { columns } = buildWeekdayHeatmap(points, "Asia/Tokyo");
    expect(columns.map((c) => c.localHour)).toEqual([1, 5, 9, 13, 17, 21]);
  });
});

describe("buildWeekdayHeatmap: exclusions (plan §3-1/(f) -- SH-7's regulation carried through)", () => {
  it("excludes a provisional point from both n and the median", () => {
    const points = [point("2026-03-08T00:00:00Z", 100), point("2026-03-15T00:00:00Z", 999999, { provisional: true })];
    const { cells } = buildWeekdayHeatmap(points, "UTC");
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 0);
    expect(cell.n).toBe(1);
    expect(cell.median).toBe(100);
  });

  it("excludes a point whose expected is null (a missing-data gap, design §9.1)", () => {
    const points = [point("2026-03-08T00:00:00Z", 100), point("2026-03-15T00:00:00Z", null)];
    const { cells } = buildWeekdayHeatmap(points, "UTC");
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 0);
    expect(cell.n).toBe(1);
  });

  it("plan (d): n across all 42 cells sums to exactly the confirmed, non-null point count -- no point silently dropped", () => {
    const points = [
      point("2026-03-08T00:00:00Z", 100),
      point("2026-03-09T04:00:00Z", 200),
      point("2026-03-10T08:00:00Z", 300),
      point("2026-03-17T00:00:00Z", 999, { provisional: true }),
      point("2026-03-11T12:00:00Z", null),
    ];
    const { cells } = buildWeekdayHeatmap(points, "UTC");
    expect(totalHeatmapCount(cells)).toBe(3);
  });
});

describe("median (representative value, not average -- plan §3-1: 'スパイクに引きずられないため')", () => {
  it("uses the middle value for an odd-length cell", () => {
    const points = [10, 20, 30].map((v) => point("2026-03-08T00:00:00Z", v * 1e6));
    const { cells } = buildWeekdayHeatmap(points, "UTC");
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 0);
    expect(cell.median).toBe(20e6);
  });

  it("averages the two middle values for an even-length cell", () => {
    const points = [10, 20, 30, 1000].map((v) => point("2026-03-08T00:00:00Z", v * 1e6));
    const { cells } = buildWeekdayHeatmap(points, "UTC");
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 0);
    // sorted: 10,20,30,1000 -> (20+30)/2 = 25, not skewed by the 1000 spike
    // the way an average (265) would be.
    expect(cell.median).toBe(25e6);
  });
});

describe("extremeHeatmapCells (plan §3-3: '最安セル・最高セルを視覚的に示す')", () => {
  it("returns both null when no cell has data", () => {
    const { lowest, highest } = extremeHeatmapCells(buildWeekdayHeatmap([], "UTC").cells);
    expect(lowest).toBeNull();
    expect(highest).toBeNull();
  });

  it("picks the lowest/highest-median cell among cells with data, ignoring empty ones", () => {
    const points = [point("2026-03-08T00:00:00Z", 100e6), point("2026-03-09T04:00:00Z", 500e6)];
    const { cells } = buildWeekdayHeatmap(points, "UTC");
    const { lowest, highest } = extremeHeatmapCells(cells);
    expect(lowest.median).toBe(100e6);
    expect(highest.median).toBe(500e6);
  });
});
