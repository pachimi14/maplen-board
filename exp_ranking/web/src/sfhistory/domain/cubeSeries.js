// IMPL_PLAN_SH41 §3-1: the ONLY cube-specific code in this feature's
// statistics path -- everything downstream of this adapter (`sliceByPeriod`/
// `computeStats`/`currentPercentile`/`describeCurrentPercentile`/
// `withDeltas` in `./series.js`, `buildWeekdayHeatmap` in
// `./weekdayStats.js`, `withChartColumns`/`isOpenPoint` in
// `./chartColumns.js`) is the SAME code `SfHistoryRoot.jsx` already uses for
// the star-force Expected series -- reused unmodified, per plan §3-1
// ("同じ計算を別実装で持たない"). This file exists only because a cube
// point's raw shape (`{ date, cubes: [...], provisional, closed, asOf }`,
// `integrations/sfHistorySource.js#normalizeCubePricesPayload`) differs from
// a star-force point's (`{ date, prices: [...] }`) -- it reshapes one into
// the other's already-agreed-on row shape (`{ date, expected, provisional,
// asOf, closed }`) so every one of those shared functions can read a cube
// series exactly as if it were an Expected series, with zero changes to any
// of them.
//
// K1 (IMPL_PLAN_SH41 §0): there is no Expected-cost calculation for a cube --
// `expected` here is simply `point.cubes[index]`, the raw market price
// `normalizeCubePricesPayload` already read straight off the server. This
// file never imports `../starforce.js` and never computes anything; it only
// picks an array index and renames fields.

/** The 4 cube sub-types this feature tracks, in the same fixed order the
 * server's own `cube.CUBE_SUB_TYPES` uses (`cubeOrder` on every
 * `/sf-history/cube-prices` and `/sf-history/latest` response). Used only to
 * decide the selector's button order -- the actual index used to read a
 * point's `cubes[]` array always comes from the RESPONSE's own `cubeOrder`
 * (via `cubeTypeIndex` below), never from this constant's position, so a
 * server-side reordering could never silently point this UI at the wrong
 * slot (it would instead just find no match and read `null`, never a wrong
 * value). */
export const CUBE_TYPE_ORDER = ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"];

/** Display names for the 4 cube sub-types -- server/cube.py's own header
 * comment defers exactly this ("Display names ... belong to the next
 * slice's UI") to this slice. Matches `discovery.CUBE_NAMES`' existing
 * spelling for the same 4 items (RED=5062009/"Red Cube",
 * BLACK=5062010/"Black Cube", ADDITIONAL=5062500/"Bonus Potential Cube",
 * WHITE_ADDITIONAL=5062503/"White Cube") so this page never introduces a
 * second name for a cube this codebase already names elsewhere
 * (`server/sf-history/discovery.py`). Deliberately NOT an i18n key: every
 * other in-game item name in this app (equipment names, from
 * `/sf-history/equipment`) is shown in English regardless of UI locale --
 * these 4 fixed cube names get the same treatment, not a second, divergent
 * convention. */
export const CUBE_TYPE_DISPLAY_NAMES = {
  RED: "Red Cube",
  BLACK: "Black Cube",
  ADDITIONAL: "Bonus Potential Cube",
  WHITE_ADDITIONAL: "White Cube",
};

/** The index of `cubeType` within the RESPONSE's own `cubeOrder` (never
 * `CUBE_TYPE_ORDER` above) -- `-1` if `cubeOrder` is missing/malformed or
 * does not contain `cubeType`. This is the single source of truth for which
 * slot of a point's `cubes[]` array (or `/sf-history/latest`'s own `cubes[]`)
 * belongs to `cubeType`. */
export function cubeTypeIndex(cubeOrder, cubeType) {
  return Array.isArray(cubeOrder) ? cubeOrder.indexOf(cubeType) : -1;
}

/**
 * Reshapes `normalizeCubePricesPayload`'s `points` (raw `cubes[]`-per-point)
 * into the `{ date, expected, provisional, asOf, closed }` row shape
 * `domain/series.js`'s generic functions already expect (the exact shape
 * `buildExpectedSeries` produces for star-force, minus any cost
 * computation). `expected` is `point.cubes[index]` verbatim -- `null` when
 * `index` is `-1` (unknown cube type) or the slot itself is `null` (K2: a
 * cube sub-type with no data yet, e.g. White Cube before 2026-06-11) --
 * never substituted, never interpolated.
 */
export function buildCubeSeries(points, cubeOrder, cubeType) {
  const index = cubeTypeIndex(cubeOrder, cubeType);
  return (points ?? []).map((point) => {
    const cubes = point?.cubes ?? [];
    const value = index >= 0 ? cubes[index] ?? null : null;
    const provisional = point?.provisional === true;
    const asOf = provisional && typeof point?.asOf === "string" ? point.asOf : null;
    const closed = point?.closed !== false;
    return { date: point.date, expected: value, provisional, asOf, closed };
  });
}

/**
 * The current price for `cubeType`, read from `/sf-history/latest`'s own
 * `cubes[]` (index-aligned to that same response's `cubeOrder`) -- the
 * single current-price counterpart of `buildCubeSeries` above. `null` when
 * unavailable, same "no substitute" discipline `computeCurrentExpected`
 * (`./series.js`) already applies to the star-force current value -- this is
 * that same rule, not a re-derivation of it.
 */
export function currentCubeValue(latestCubes, cubeOrder, cubeType) {
  const index = cubeTypeIndex(cubeOrder, cubeType);
  if (index < 0 || !Array.isArray(latestCubes)) return null;
  return latestCubes[index] ?? null;
}
