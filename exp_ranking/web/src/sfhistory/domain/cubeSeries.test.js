import { describe, expect, it } from "vitest";
import {
  CUBE_TYPE_DISPLAY_NAMES,
  CUBE_TYPE_ORDER,
  buildCubeSeries,
  currentCubeValue,
  cubeTypeIndex,
} from "./cubeSeries.js";
import { computeStats, currentPercentile, sliceByPeriod, withDeltas } from "./series.js";
import { buildWeekdayHeatmap } from "./weekdayStats.js";
import { withChartColumns } from "./chartColumns.js";

const CUBE_ORDER = ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"];

describe("CUBE_TYPE_ORDER / CUBE_TYPE_DISPLAY_NAMES", () => {
  it("has exactly the 4 sub-types, each with a display name", () => {
    expect(CUBE_TYPE_ORDER).toEqual(["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"]);
    for (const cubeType of CUBE_TYPE_ORDER) {
      expect(typeof CUBE_TYPE_DISPLAY_NAMES[cubeType]).toBe("string");
    }
  });
});

describe("cubeTypeIndex", () => {
  it("returns the position of cubeType within the response's own cubeOrder", () => {
    expect(cubeTypeIndex(CUBE_ORDER, "BLACK")).toBe(1);
    expect(cubeTypeIndex(CUBE_ORDER, "WHITE_ADDITIONAL")).toBe(3);
  });

  it("returns -1 for an unknown cube type or malformed cubeOrder", () => {
    expect(cubeTypeIndex(CUBE_ORDER, "OCCULT")).toBe(-1);
    expect(cubeTypeIndex(null, "RED")).toBe(-1);
    expect(cubeTypeIndex(undefined, "RED")).toBe(-1);
  });
});

describe("buildCubeSeries (K1/K2)", () => {
  const points = [
    { date: "2026-03-25T00:00:00Z", cubes: [894882.28, 1638568.1, 2185268.35, null], provisional: false, closed: true },
    { date: "2026-08-21T20:00:00Z", cubes: [636809.13, 778760.18, 1048901.68, 1202408.98], provisional: false, closed: true },
    {
      date: "2026-08-22T00:00:00Z",
      cubes: [630000, 770000, 1040000, 1200000],
      provisional: true,
      closed: false,
      asOf: "2026-08-22T00:05:00Z",
    },
  ];

  it("K1: reads the raw price straight through -- no computation, no starforce.js", () => {
    const series = buildCubeSeries(points, CUBE_ORDER, "RED");
    expect(series.map((row) => row.expected)).toEqual([894882.28, 636809.13, 630000]);
  });

  it("K2: a cube sub-type with no data at a point stays null -- never 0, never backfilled", () => {
    const series = buildCubeSeries(points, CUBE_ORDER, "WHITE_ADDITIONAL");
    expect(series[0].expected).toBeNull();
    expect(series[1].expected).toBe(1202408.98);
  });

  it("carries provisional/closed/asOf straight through, same shape domain/series.js#buildExpectedSeries produces", () => {
    const series = buildCubeSeries(points, CUBE_ORDER, "BLACK");
    expect(series[2]).toEqual({
      date: "2026-08-22T00:00:00Z",
      expected: 770000,
      provisional: true,
      asOf: "2026-08-22T00:05:00Z",
      closed: false,
    });
  });

  it("returns an all-null series for an unknown cube type rather than throwing", () => {
    const series = buildCubeSeries(points, CUBE_ORDER, "OCCULT");
    expect(series.every((row) => row.expected === null)).toBe(true);
  });

  it("handles an empty/missing points array", () => {
    expect(buildCubeSeries([], CUBE_ORDER, "RED")).toEqual([]);
    expect(buildCubeSeries(undefined, CUBE_ORDER, "RED")).toEqual([]);
  });
});

describe("currentCubeValue", () => {
  const latestCubes = [636809.13, 778760.18, 1048901.68, 1202408.98];

  it("reads the current price for the given cube type", () => {
    expect(currentCubeValue(latestCubes, CUBE_ORDER, "ADDITIONAL")).toBe(1048901.68);
  });

  it("is null for an unknown cube type or missing data", () => {
    expect(currentCubeValue(latestCubes, CUBE_ORDER, "OCCULT")).toBeNull();
    expect(currentCubeValue(null, CUBE_ORDER, "RED")).toBeNull();
    expect(currentCubeValue([null, null, null, null], CUBE_ORDER, "RED")).toBeNull();
  });
});

// IMPL_PLAN_SH41 §3-1 (g): the actual regression guard on "shared, not
// reimplemented" -- runs a cube series through the SAME `./series.js` /
// `./weekdayStats.js` / `./chartColumns.js` functions SfHistoryRoot.jsx
// already uses for star-force, unmodified, and checks they behave exactly
// as documented for an ordinary `{ date, expected, ... }` series.
describe("shared statistics tools operate on a buildCubeSeries() result unmodified", () => {
  const points = [
    { date: "2026-08-13T00:00:00Z", cubes: [100, 200, 300, 400] },
    { date: "2026-08-13T04:00:00Z", cubes: [110, 210, 310, 410] },
    { date: "2026-08-13T08:00:00Z", cubes: [90, 190, 290, 390] },
  ];
  const series = buildCubeSeries(points, CUBE_ORDER, "RED");

  it("sliceByPeriod / computeStats / currentPercentile", () => {
    const sliced = sliceByPeriod(series, "7D");
    const stats = computeStats(sliced);
    expect(stats).toEqual({ average: 100, high: 110, low: 90, count: 3 });
    expect(currentPercentile(sliced, 110)).toBe(100);
  });

  it("withDeltas / withChartColumns produce the same column shapes as a star-force series", () => {
    const withCols = withChartColumns(withDeltas(series));
    expect(withCols[0].delta).toBeNull();
    expect(withCols[1].delta).toBe(10);
    expect(withCols.every((row) => typeof row.displayDate === "string")).toBe(true);
  });

  it("buildWeekdayHeatmap aggregates without throwing", () => {
    const { cells } = buildWeekdayHeatmap(series);
    expect(cells).toHaveLength(42);
  });
});
