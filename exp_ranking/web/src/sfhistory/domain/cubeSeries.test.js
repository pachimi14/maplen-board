import { describe, expect, it } from "vitest";
import {
  CUBE_TYPE_COLORS,
  CUBE_TYPE_DISPLAY_NAMES,
  CUBE_TYPE_ORDER,
  buildCubeSeries,
  carryAdditionalCubeTypes,
  currentCubeValue,
  cubeTypeIndex,
  resolveCubeColor,
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

// IMPL_PLAN_SH44 §2-2 (e)/(f): locks down the measured claims
// `CUBE_TYPE_COLORS`' own header comment makes (and this plan's completion
// report cites) as a regression test -- a future edit to these hex values
// fails loudly here instead of silently shipping a color that no longer
// clears contrast/distinctness against this screen's own card background,
// `--sfh-color-cheaper`, or `--sfh-color-costlier`.
describe("CUBE_TYPE_COLORS / resolveCubeColor (e)/(f)", () => {
  const SFH_COLOR_CHEAPER = "#3b82f6";
  const SFH_COLOR_COSTLIER = "#fb7185";
  const DEEP_CARD_BG = "#0f172a"; // taskManager.css's own deep --theme-card-bg base color
  const LIGHT_CARD_BG = "#ffffff"; // light/standard --theme-card-bg's own base color

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  function srgbToLin(c) {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function relLuminance([r, g, b]) {
    const [rl, gl, bl] = [r, g, b].map(srgbToLin);
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  }
  function contrastRatio(hex1, hex2) {
    const L1 = relLuminance(hexToRgb(hex1));
    const L2 = relLuminance(hexToRgb(hex2));
    const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (hi + 0.05) / (lo + 0.05);
  }
  function hueOf(hex) {
    let [r, g, b] = hexToRgb(hex);
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h;
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    return h * 60;
  }
  function hueDiff(hexA, hexB) {
    const d = Math.abs(hueOf(hexA) - hueOf(hexB));
    return Math.min(d, 360 - d);
  }

  it("has all 4 cube types, each with a deep + light hex pair", () => {
    for (const cubeType of CUBE_TYPE_ORDER) {
      expect(CUBE_TYPE_COLORS[cubeType].deep).toMatch(/^#[0-9a-f]{6}$/);
      expect(CUBE_TYPE_COLORS[cubeType].light).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("(e) every deep-branch color clears 3:1 WCAG contrast against the deep card background", () => {
    for (const cubeType of CUBE_TYPE_ORDER) {
      expect(contrastRatio(CUBE_TYPE_COLORS[cubeType].deep, DEEP_CARD_BG)).toBeGreaterThanOrEqual(3);
    }
  });

  it("(e) every light-branch color clears 3:1 WCAG contrast against the light/standard card background", () => {
    for (const cubeType of CUBE_TYPE_ORDER) {
      expect(contrastRatio(CUBE_TYPE_COLORS[cubeType].light, LIGHT_CARD_BG)).toBeGreaterThanOrEqual(3);
    }
  });

  it("(e) every pair of the 4 cube types is mutually distinguishable (>=40 degrees of hue apart, same branch)", () => {
    for (const branch of ["deep", "light"]) {
      for (let i = 0; i < CUBE_TYPE_ORDER.length; i++) {
        for (let j = i + 1; j < CUBE_TYPE_ORDER.length; j++) {
          const a = CUBE_TYPE_COLORS[CUBE_TYPE_ORDER[i]][branch];
          const b = CUBE_TYPE_COLORS[CUBE_TYPE_ORDER[j]][branch];
          expect(hueDiff(a, b)).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  it("(f) no cube color is the literal cheaper/costlier hex, and every one stays >=20 degrees of hue away from both", () => {
    for (const cubeType of CUBE_TYPE_ORDER) {
      for (const branch of ["deep", "light"]) {
        const hex = CUBE_TYPE_COLORS[cubeType][branch];
        expect(hex.toLowerCase()).not.toBe(SFH_COLOR_CHEAPER);
        expect(hex.toLowerCase()).not.toBe(SFH_COLOR_COSTLIER);
        expect(hueDiff(hex, SFH_COLOR_CHEAPER)).toBeGreaterThanOrEqual(20);
        expect(hueDiff(hex, SFH_COLOR_COSTLIER)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("resolveCubeColor picks the deep branch only for themeDepth === 'deep'", () => {
    expect(resolveCubeColor("RED", "deep")).toBe(CUBE_TYPE_COLORS.RED.deep);
    expect(resolveCubeColor("RED", "light")).toBe(CUBE_TYPE_COLORS.RED.light);
    expect(resolveCubeColor("RED", "standard")).toBe(CUBE_TYPE_COLORS.RED.light);
  });

  it("resolveCubeColor degrades gracefully (never throws) for an unknown cube type or themeDepth", () => {
    expect(resolveCubeColor("OCCULT", "deep")).toBeNull();
    expect(resolveCubeColor("RED", "unknown-depth")).toBe(CUBE_TYPE_COLORS.RED.light);
  });
});

// IMPL_PLAN_SH44 §2-1 (k): the "carry over the full comparison set" main-
// switch behavior, as a pure function (see the function's own header,
// domain/cubeSeries.js, for the full decision + rationale).
describe("carryAdditionalCubeTypes (k)", () => {
  it("removes the new main from the additional list when it was already selected there", () => {
    // main=RED, additional=[BLACK, ADDITIONAL] -> switch main to BLACK:
    // BLACK drops out of additional, RED (the old main) takes its place --
    // the displayed SET {RED, BLACK, ADDITIONAL} is unchanged, only which
    // one is bold changes.
    expect(carryAdditionalCubeTypes("RED", ["BLACK", "ADDITIONAL"], "BLACK")).toEqual(["RED", "ADDITIONAL"]);
  });

  it("adds the old main into the additional list when the new main was not previously displayed at all", () => {
    // main=RED, additional=[BLACK] -> switch main to WHITE_ADDITIONAL (not
    // previously shown at all): RED (old main) joins additional, BLACK
    // stays -- the displayed set grows by exactly the new main.
    expect(carryAdditionalCubeTypes("RED", ["BLACK"], "WHITE_ADDITIONAL")).toEqual(["RED", "BLACK"]);
  });

  it("never exceeds 3 additional entries, since the universe is exactly 4 cube types", () => {
    // main=RED, additional=[BLACK, ADDITIONAL, WHITE_ADDITIONAL] (all 4
    // displayed) -> switching main to any already-displayed type must still
    // total exactly 4 (3 additional + 1 main).
    const result = carryAdditionalCubeTypes("RED", ["BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"], "WHITE_ADDITIONAL");
    expect(result).toHaveLength(3);
    expect(result).toEqual(["RED", "BLACK", "ADDITIONAL"]);
  });

  it("returns [] when neither the old main nor any additional survives (no additional selected, switching to a fresh type)", () => {
    expect(carryAdditionalCubeTypes("RED", [], "RED")).toEqual([]);
  });

  it("always returns entries in CUBE_TYPE_ORDER's own fixed order, not selection/click order", () => {
    const result = carryAdditionalCubeTypes("WHITE_ADDITIONAL", ["ADDITIONAL", "RED"], "BLACK");
    expect(result).toEqual(["RED", "ADDITIONAL", "WHITE_ADDITIONAL"]);
  });
});
