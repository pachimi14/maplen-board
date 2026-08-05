import { describe, expect, it } from "vitest";
import { buildWeekdayHeatmap, extremeHeatmapCells, totalHeatmapCount } from "./weekdayStats.js";

// IMPL_PLAN_SH14 §2 (2026-08-05, user decision): reverts IMPL_PLAN_SH11 §2's
// local-timezone grouping back to a fixed UTC basis. `buildWeekdayHeatmap`
// no longer takes a `timeZone` argument -- `series[].date` is already a UTC
// instant, so there is nothing left to convert.

function point(date, expected, extra = {}) {
  return { date, expected, provisional: false, ...extra };
}

describe("buildWeekdayHeatmap: shape", () => {
  it("always returns 42 cells (7 weekdays x 6 UTC slots) and 6 fixed UTC columns, even for an empty series", () => {
    const { cells, columns } = buildWeekdayHeatmap([]);
    expect(cells).toHaveLength(42);
    expect(columns).toHaveLength(6);
    expect(cells.every((cell) => cell.n === 0 && cell.median === null)).toBe(true);
    // IMPL_PLAN_SH14 §4: a column's UTC start time is fixed by its
    // bucketSlot alone -- 00/04/08/12/16/20 -- whether or not any point was
    // ever observed in it (unlike SH-11's local-time columns, which were
    // `null`/`null` when empty).
    expect(columns.map((c) => c.hour)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(columns.every((column) => column.minute === 0)).toBe(true);
  });

  it("covers every (weekdayIndex 0..6) x (bucketSlot 0..5) pair exactly once", () => {
    const { cells } = buildWeekdayHeatmap([]);
    const keys = new Set(cells.map((cell) => `${cell.weekdayIndex}-${cell.bucketSlot}`));
    expect(keys.size).toBe(42);
    for (let w = 0; w < 7; w++) for (let b = 0; b < 6; b++) expect(keys.has(`${w}-${b}`)).toBe(true);
  });
});

// IMPL_PLAN_SH18 §4 (2026-08-05, user decision, reverses design §8): a
// point is now grouped by its bucket's *end* weekday/hour, not its start
// (`date` is still a bucket-start ISO instant -- only the grouping key
// derived from it shifted by +4h). Every case below is the direct "+4h"
// re-derivation of the pre-SH18 assertions this replaces -- see the
// dedicated "1枠ずれ" cross-check describe block further down for a
// machine confirmation that the *old* algorithm's cell and the *new*
// algorithm's shifted cell hold the exact same data.
describe("buildWeekdayHeatmap: UTC-basis grouping, keyed by bucket END (IMPL_PLAN_SH18 §4)", () => {
  it("2026-03-08 is a Sunday (UTC): a 00:00-start point (bucket [00:00,04:00)) lands in weekdayIndex=0 (still Sun), bucketSlot=1 (04:00)", () => {
    const { cells } = buildWeekdayHeatmap([point("2026-03-08T00:00:00Z", 100)]);
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 1);
    expect(cell.n).toBe(1);
    expect(cell.median).toBe(100);
  });

  it("a 20:00-start point (bucket [20:00,00:00)) rolls into the NEXT day's bucketSlot=0 (00:00) -- the midnight-crossing case", () => {
    // 2026-03-08 is a Sunday; the bucket [20:00,00:00) ends Monday 00:00.
    const { cells } = buildWeekdayHeatmap([point("2026-03-08T20:00:00Z", 100)]);
    const cell = cells.find((c) => c.weekdayIndex === 1 && c.bucketSlot === 0);
    expect(cell.n).toBe(1);
  });

  it("groups every one of the 6 fixed UTC slots to its own bucketSlot (each point's end, 04/08/12/16/20/next-00)", () => {
    const points = [0, 4, 8, 12, 16, 20].map((h) => point(`2026-03-08T${String(h).padStart(2, "0")}:00:00Z`, 100));
    const { cells } = buildWeekdayHeatmap(points);
    // the first 5 (starts 00/04/08/12/16) end same-day at slots 1..5;
    // the last (start 20) ends next-day (Monday, weekdayIndex=1) at slot 0.
    for (let bucketSlot = 1; bucketSlot <= 5; bucketSlot++) {
      const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === bucketSlot);
      expect(cell.n).toBe(1);
    }
    const rolledOver = cells.find((c) => c.weekdayIndex === 1 && c.bucketSlot === 0);
    expect(rolledOver.n).toBe(1);
  });
});

// IMPL_PLAN_SH18 §6/(d): "★ヒートマップの1枠ずれを機械確認: 新しい
// [木][00:00] の中央値と件数が、旧実装の [水][20:00] と一致することを示す".
// `oldBuildWeekdayHeatmap` below is `buildWeekdayHeatmap` as it existed
// before this plan (grouping by bucket *start*, not end) -- reproduced here
// only to cross-check against the current (post-SH18) implementation on
// the exact same input, never imported/used by any production code.
function oldBuildWeekdayHeatmap(series) {
  const cellGroups = new Map();
  for (const p of series) {
    if (p?.provisional || p?.expected == null) continue;
    const date = new Date(p.date);
    if (Number.isNaN(date.getTime())) continue;
    const weekdayIndex = date.getUTCDay();
    const bucketSlot = Math.floor(date.getUTCHours() / 4);
    const key = `${weekdayIndex}-${bucketSlot}`;
    if (!cellGroups.has(key)) cellGroups.set(key, []);
    cellGroups.get(key).push(p.expected);
  }
  return cellGroups;
}

describe("IMPL_PLAN_SH18 (d): the new [Thu][00:00] cell == the old [Wed][20:00] cell (1枠ずれ, machine-confirmed)", () => {
  it("same n and median for a mixed multi-week series of Wed-20:00-start buckets", () => {
    // 2026-03-04, 2026-03-11, 2026-03-18 are all Wednesdays (UTC).
    const series = [
      point("2026-03-04T20:00:00Z", 100e6),
      point("2026-03-11T20:00:00Z", 300e6),
      point("2026-03-18T20:00:00Z", 200e6),
      // noise in an unrelated cell, to prove this isn't vacuously matching everything:
      point("2026-03-05T00:00:00Z", 999e6),
    ];

    const oldGroups = oldBuildWeekdayHeatmap(series);
    const oldWedTwenty = oldGroups.get("3-5") ?? []; // weekdayIndex=3 (Wed), bucketSlot=5 (20:00)

    const { cells } = buildWeekdayHeatmap(series);
    const newThuZero = cells.find((c) => c.weekdayIndex === 4 && c.bucketSlot === 0); // Thu, 00:00

    expect(oldWedTwenty.length).toBeGreaterThan(0); // sanity: the old cell is non-empty
    expect(newThuZero.n).toBe(oldWedTwenty.length);
    const oldSorted = [...oldWedTwenty].sort((a, b) => a - b);
    const oldMedian =
      oldSorted.length % 2 === 1
        ? oldSorted[Math.floor(oldSorted.length / 2)]
        : (oldSorted[oldSorted.length / 2 - 1] + oldSorted[oldSorted.length / 2]) / 2;
    expect(newThuZero.median).toBe(oldMedian);
    expect(newThuZero.n).toBe(3);
    expect(newThuZero.median).toBe(200e6);
  });
});

describe("buildWeekdayHeatmap: exclusions (plan §3-1/(f) -- SH-7's regulation carried through)", () => {
  it("excludes a provisional point from both n and the median", () => {
    // IMPL_PLAN_SH18 §4: a 00:00-start bucket ends 04:00 same day -> bucketSlot=1.
    const points = [point("2026-03-08T00:00:00Z", 100), point("2026-03-15T00:00:00Z", 999999, { provisional: true })];
    const { cells } = buildWeekdayHeatmap(points);
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 1);
    expect(cell.n).toBe(1);
    expect(cell.median).toBe(100);
  });

  it("excludes a point whose expected is null (a missing-data gap, design §9.1)", () => {
    const points = [point("2026-03-08T00:00:00Z", 100), point("2026-03-15T00:00:00Z", null)];
    const { cells } = buildWeekdayHeatmap(points);
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 1);
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
    const { cells } = buildWeekdayHeatmap(points);
    expect(totalHeatmapCount(cells)).toBe(3);
  });
});

describe("median (representative value, not average -- plan §3-1: 'スパイクに引きずられないため')", () => {
  it("uses the middle value for an odd-length cell", () => {
    // IMPL_PLAN_SH18 §4: a 00:00-start bucket ends 04:00 same day -> bucketSlot=1.
    const points = [10, 20, 30].map((v) => point("2026-03-08T00:00:00Z", v * 1e6));
    const { cells } = buildWeekdayHeatmap(points);
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 1);
    expect(cell.median).toBe(20e6);
  });

  it("averages the two middle values for an even-length cell", () => {
    const points = [10, 20, 30, 1000].map((v) => point("2026-03-08T00:00:00Z", v * 1e6));
    const { cells } = buildWeekdayHeatmap(points);
    const cell = cells.find((c) => c.weekdayIndex === 0 && c.bucketSlot === 1);
    // sorted: 10,20,30,1000 -> (20+30)/2 = 25, not skewed by the 1000 spike
    // the way an average (265) would be.
    expect(cell.median).toBe(25e6);
  });
});

describe("extremeHeatmapCells (plan §3-3: '最安セル・最高セルを視覚的に示す')", () => {
  it("returns both null when no cell has data", () => {
    const { lowest, highest } = extremeHeatmapCells(buildWeekdayHeatmap([]).cells);
    expect(lowest).toBeNull();
    expect(highest).toBeNull();
  });

  it("picks the lowest/highest-median cell among cells with data, ignoring empty ones", () => {
    const points = [point("2026-03-08T00:00:00Z", 100e6), point("2026-03-09T04:00:00Z", 500e6)];
    const { cells } = buildWeekdayHeatmap(points);
    const { lowest, highest } = extremeHeatmapCells(cells);
    expect(lowest.median).toBe(100e6);
    expect(highest.median).toBe(500e6);
  });
});
