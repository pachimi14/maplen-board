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

/**
 * IMPL_PLAN_SH44 §2-1(k): what happens to the ADDITIONAL cube selection
 * when the user switches which cube type is MAIN. Chosen behavior: *carry
 * over the full comparison set* -- the set of cube types visibly on screen
 * (`{ previousMainCubeType } ∪ previousAdditionalCubeTypes`) is preserved
 * across a main switch, minus the new main itself (it can't be both main
 * and additional at once -- plan §2-1's own "重複を作らない"); the OLD main
 * takes over the vacated additional slot. In other words: switching main
 * only changes which line is bold, never which cube types are visible.
 *
 * Why this over resetting to `[]` on every main switch: a reset would make
 * the more deliberate action (building a 3-4-cube comparison) the more
 * fragile one -- one click on `CubeTypeSelector` to glance at a different
 * cube as the bold line would silently throw the whole comparison away.
 * Carrying over what is already on screen matches how a "make X primary"
 * control reads in most comparison UIs (e.g. spreadsheet "set as primary
 * axis"): the working set doesn't change, only which member of it is
 * emphasized. The only user-visible consequence is the OLD main
 * reappearing as a (now thin) additional line instead of disappearing --
 * judged less surprising than losing the additional selections outright
 * (`docs/reports/SH44_completion.md` (k) has the full write-up).
 *
 * Since the universe of cube types has exactly 4 members
 * (`CUBE_TYPE_ORDER`), the returned array's length is always <=3 by
 * construction: the full displayed set before the switch (main + up to 3
 * additional) is at most 4, and this only ever removes `newMainCubeType`
 * from it, never adds beyond that set.
 *
 * Returns in `CUBE_TYPE_ORDER`'s own fixed order (not raw `Set` iteration
 * order) -- keeps the additional list in the same stable order
 * `CubeCompareSelector`/`CubeLegend` already render in, regardless of which
 * cube type was clicked or when.
 */
export function carryAdditionalCubeTypes(previousMainCubeType, previousAdditionalCubeTypes, newMainCubeType) {
  const displayed = new Set([previousMainCubeType, ...previousAdditionalCubeTypes]);
  displayed.delete(newMainCubeType);
  return CUBE_TYPE_ORDER.filter((candidate) => displayed.has(candidate));
}

/**
 * IMPL_PLAN_SH44 §2-2/(e)(f): one fixed line color per cube sub-type, used
 * when overlaying more than one cube type's price line on the same chart
 * (`SfHistoryChart`'s new `mainColor`/`extraSeries[].color`). Two branches
 * only -- `deep` vs everything else (`light`/`standard` share one value) --
 * the same "depth-branched, theme-color-NON-following" convention
 * `--sfh-color-current-ring` (sfhistory.css) already uses for this screen,
 * so a cube's own line color never changes when the user switches between
 * the 4 accent themes (green/blue/purple/orange), only when they switch
 * DEPTH (Light/Standard vs Deep) -- because this screen's own chart
 * background (`--theme-card-bg`, `.sfh-summary-card`) is itself depth-only,
 * never theme-color-tinted (`taskManager.css`'s own `--theme-card-bg`
 * values are identical across every `html[data-theme-color="..."]` block;
 * only the 3 `html[data-theme-depth="..."]` blocks touch it).
 *
 * Deliberately does NOT reuse `--sfh-color-cheaper`(#3b82f6)/
 * `--sfh-color-costlier`(#fb7185) (plan (f)) -- those two carry the specific
 * meaning "cheaper/costlier than before"; reusing either here would make
 * whichever cube got it look like it is claiming to BE the cheap/expensive
 * line, not just "the Nth cube type".
 *
 * Deliberately does NOT try to match each cube's own name to an intuitive
 * color either (Red Cube = red, White Cube = white, ...): a literal white
 * would vanish against this screen's Light/Standard (near-white) card
 * background, and a literal red/black would sit in (or next to) the same
 * hue family as `--sfh-color-costlier`/this screen's own dark text -- so
 * all 4 are picked purely for mutual + background contrast, never for name
 * association. Each cube's own name is still always shown next to its
 * swatch in the legend (`components/CubeLegend.jsx`), so the color/name
 * link is never left for the reader to guess.
 *
 * Plain hex, not a CSS custom property: `SfHistoryChart`'s `<Line
 * stroke="...">` reads this value straight as a React prop, rendered as a
 * literal SVG presentation attribute -- this stays a plain string so the
 * result never depends on a browser's (less consistent, engine-version-
 * dependent) support for resolving `var()` inside an SVG presentation
 * attribute specifically. `resolveCubeColor` below is this feature's own
 * single source of truth for the resolved value -- the chart's line stroke
 * and every legend/selector swatch all read it, so they can never drift
 * apart from each other.
 *
 * Measured (docs/reports/SH44_completion.md): every value is >=3:1 WCAG
 * contrast against this screen's own card background for its branch (the
 * `deep` value against `#0f172a`-ish dark navy, the `light` value against
 * white), every pair among the 4 is >=43 degrees apart in hue, and every
 * value is >=24 degrees of hue away from both `--sfh-color-cheaper` and
 * `--sfh-color-costlier`.
 */
export const CUBE_TYPE_COLORS = {
  RED: { deep: "#e0d452", light: "#847a0b" },
  BLACK: { deep: "#86e052", light: "#37840b" },
  ADDITIONAL: { deep: "#52d9e0", light: "#0b7e84" },
  WHITE_ADDITIONAL: { deep: "#e052d9", light: "#840b7e" },
};

/**
 * `themeDepth` is `"light" | "standard" | "deep"`
 * (`taskManager/domain/dashboardModel.js#DASHBOARD_THEME_DEPTHS`) -- only
 * `"deep"` gets its own branch; `"light"`/`"standard"` share the other, the
 * same 2-way split `sfhistory.css`'s own `:not([data-theme-depth="deep"])`
 * selector already uses throughout this feature (see `CUBE_TYPE_COLORS`
 * above). Falls back to the `light` branch for an unrecognized `cubeType`
 * or `themeDepth` rather than throwing -- "穏当に劣化する", this repo's own
 * norm (see e.g. `sliceByPeriod`'s unknown-`periodKey` fallback, `./series.js`).
 */
export function resolveCubeColor(cubeType, themeDepth) {
  const pair = CUBE_TYPE_COLORS[cubeType];
  if (!pair) return null;
  return themeDepth === "deep" ? pair.deep : pair.light;
}
