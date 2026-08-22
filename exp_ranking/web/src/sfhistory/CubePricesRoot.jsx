import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../components/BoardHeader.jsx";
import { useTranslation } from "../i18n/I18nContext.jsx";
import { useDashboardStore } from "../taskManager/storage/useDashboardStore.js";
import { setDashboardThemeColor, setDashboardThemeDepth } from "../taskManager/domain/dashboardModel.js";
import { sfHistorySource } from "./integrations/sfHistorySource.js";
import { DEFAULT_PERIOD, computeStats, currentPercentile, sliceByPeriod } from "./domain/series.js";
import {
  CUBE_TYPE_DISPLAY_NAMES,
  CUBE_TYPE_ORDER,
  buildCubeSeries,
  carryAdditionalCubeTypes,
  currentCubeValue,
  resolveCubeColor,
} from "./domain/cubeSeries.js";
import { resolveCarriedSelection } from "./domain/selectionCarry.js";
import { getCarriedSelection, setCarriedSelection } from "./selectionStore.js";
import SfHistoryTabs from "./SfHistoryTabs.jsx";
import EquipmentSelector from "./components/EquipmentSelector.jsx";
import CubeTypeSelector from "./components/CubeTypeSelector.jsx";
import CubeCompareSelector from "./components/CubeCompareSelector.jsx";
import CubeLegend from "./components/CubeLegend.jsx";
import PeriodTabs from "./components/PeriodTabs.jsx";
import SfHistoryChart from "./components/SfHistoryChart.jsx";
import SummaryCards from "./components/SummaryCards.jsx";
import WeekdayHeatmap from "./components/WeekdayHeatmap.jsx";
import "./sfhistory.css";

// IMPL_PLAN_SH44 §2-2: the main line's own stroke width and every
// additional line's stroke width -- plan (c) "メインが最も太い。追加は細い"
// -- kept as named constants (not inlined at the `<SfHistoryChart>` call
// below) so the "main > additional" inequality this plan's own acceptance
// criterion (c) depends on is visible at a glance, not buried in JSX props.
const MAIN_CUBE_LINE_WIDTH = 2.5;
const ADDITIONAL_CUBE_LINE_WIDTH = 1.5;

// IMPL_PLAN_SH41 §0/K2: White Cube has no data before this date -- a fact
// about the data (server: cube.py / update.py's own backfill start), not a
// UI constant this file invents. Shown only as a factual note (§3-2: "評価
// 語は書かない") when the White Cube tab is selected, never used to fill or
// clip a null value.
const WHITE_CUBE_DATA_START = "2026-06-11";

/**
 * `#/starforce/cube-prices` (IMPL_PLAN_SH41): the 3rd `Enhance History` tab
 * -- same equipment picker as `#/starforce`, a cube-type picker (Red/Black/
 * Bonus Potential/White) instead of a star range, and the SAME chart/
 * summary/heatmap components SfHistoryRoot.jsx already uses.
 *
 * K1 (plan §0): cube prices are raw market prices, never an Expected-cost
 * calculation -- this file never imports `./starforce.js`, directly or
 * transitively (`domain/cubeSeries.js`'s own header comment has the same
 * guarantee for the one file it does route through).
 *
 * §3-1: every statistic (`sliceByPeriod`/`computeStats`/`currentPercentile`
 * from `domain/series.js`, `WeekdayHeatmap`'s own `buildWeekdayHeatmap`) and
 * every display component (`EquipmentSelector`/`PeriodTabs`/`SummaryCards`/
 * `SfHistoryChart`/`WeekdayHeatmap`) is the exact same one SfHistoryRoot.jsx
 * uses, imported unmodified -- `domain/cubeSeries.js#buildCubeSeries` is the
 * one adapter that reshapes a cube point into the row shape those shared
 * functions already expect (see that file's own header for why it exists).
 * This file deliberately does NOT reuse `domain/viewModel.js#buildScreenModel`
 * -- that function is star-range-gated and calls into `starforce.js`
 * (K1), so reusing it here would be exactly the "starforce.js を使わないと
 * 実現できない" stop condition (plan §6-3) this page must not hit; the
 * (much simpler, no star-range) derivation below is this page's own, small
 * enough that duplicating `buildScreenModel`'s gating machinery for it would
 * add complexity, not remove it.
 *
 * No leading-gap fill (`domain/priceGapFill.js`) is used here -- plan §3-2:
 * "0として描かない。前の値で埋めない" -- `filledBands` is always `[]` for
 * this page (SfHistoryChart's own `filledBandRange` already renders nothing
 * for an empty list).
 */
export default function CubePricesRoot() {
  const { t } = useTranslation();

  // Same shared dashboard theme source as SfHistoryRoot.jsx / DiscoveryRoot.jsx
  // (App.jsx's `usesDashboardTheme` -- see that file's own comment) -- no
  // third theme store invented for this route.
  const dashboardStore = useDashboardStore();
  const theme = useMemo(
    () => ({ themeColor: dashboardStore.state.themeColor, themeDepth: dashboardStore.state.themeDepth }),
    [dashboardStore.state.themeColor, dashboardStore.state.themeDepth],
  );
  const handleThemeChange = (next) => {
    dashboardStore.update((state) => setDashboardThemeDepth(setDashboardThemeColor(state, next.themeColor), next.themeDepth));
  };

  const [equipmentState, setEquipmentState] = useState({ status: "loading", items: [] });
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedAlias, setSelectedAlias] = useState(null); // { itemId, itemName } -- see SfHistoryRoot.jsx's own note
  const [cubeType, setCubeType] = useState(CUBE_TYPE_ORDER[0]);
  // IMPL_PLAN_SH44 §2-1: the 0-3 ADDITIONAL cube types overlaid on top of
  // `cubeType` (the MAIN one, unchanged state above). Always `[]` on first
  // render (plan (a): "初期は追加ゼロ") -- nothing below ever seeds it from
  // anywhere else.
  const [additionalCubeTypes, setAdditionalCubeTypes] = useState([]);
  const [period, setPeriod] = useState(DEFAULT_PERIOD);

  const [cubePricesState, setCubePricesState] = useState({ status: "idle", points: [], cubeOrder: null });
  const [latestState, setLatestState] = useState({ status: "idle", cubes: null, cubeOrder: null, latestUpdatedAt: null });

  useEffect(() => {
    let cancelled = false;
    sfHistorySource.loadEquipment().then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.items.length) {
        setEquipmentState({ status: "error", items: [] });
        return;
      }
      setEquipmentState({ status: "ready", items: result.items });
      // IMPL_PLAN_SH42 §2 (B): same carry-over as SfHistoryRoot.jsx's own
      // equipment-load effect -- see that file's comment. Falls back to
      // this page's own pre-existing default (items[0]) when nothing was
      // carried, or the carried item isn't in this page's own list.
      const carried = resolveCarriedSelection(result.items, getCarriedSelection());
      const picked = carried ? result.items.find((item) => item.itemId === carried.itemId) : result.items[0];
      const alias = carried?.alias ?? { itemId: picked.itemId, itemName: picked.itemName };
      setSelectedItemId(picked.itemId);
      setSelectedAlias(alias);
      setCarriedSelection(picked.itemId, alias);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedItem = useMemo(
    () => equipmentState.items.find((item) => item.itemId === selectedItemId) ?? null,
    [equipmentState.items, selectedItemId],
  );

  function handleSelectEquipment(candidate) {
    setSelectedItemId(candidate.representativeItemId);
    const alias = { itemId: candidate.itemId, itemName: candidate.itemName };
    setSelectedAlias(alias);
    // IMPL_PLAN_SH42 §2 (B): carries over to SF/New Equipment too.
    setCarriedSelection(candidate.representativeItemId, alias);
  }

  // IMPL_PLAN_SH44 §2-1(k): carries the full displayed comparison set
  // across a MAIN switch -- see `carryAdditionalCubeTypes`'s own header
  // (domain/cubeSeries.js) for the full decision + rationale.
  function handleCubeTypeChange(newCubeType) {
    setAdditionalCubeTypes((previousAdditional) => carryAdditionalCubeTypes(cubeType, previousAdditional, newCubeType));
    setCubeType(newCubeType);
  }

  function handleToggleAdditionalCubeType(candidateCubeType) {
    setAdditionalCubeTypes((previousAdditional) =>
      previousAdditional.includes(candidateCubeType)
        ? previousAdditional.filter((existing) => existing !== candidateCubeType)
        : [...previousAdditional, candidateCubeType],
    );
  }

  // IMPL_PLAN_SH44 §2-2(e)/(f): one fixed hex per cube type, resolved once
  // per theme-depth change (`resolveCubeColor`, domain/cubeSeries.js -- see
  // that function's own header for the full "depth-branched, theme-color-
  // NON-following" rationale). The SAME map feeds `CubeTypeSelector`'s
  // sibling `CubeCompareSelector` swatches, `CubeLegend`'s swatches, and
  // `SfHistoryChart`'s own line `stroke` props below -- one source, so a
  // color can never drift between the selector/legend/chart.
  const colorByType = useMemo(() => {
    const map = {};
    for (const type of CUBE_TYPE_ORDER) map[type] = resolveCubeColor(type, theme.themeDepth);
    return map;
  }, [theme.themeDepth]);

  useEffect(() => {
    if (selectedItemId == null) return;
    let cancelled = false;
    setCubePricesState((prev) => ({ ...prev, status: "loading" }));
    sfHistorySource.loadCubePrices(selectedItemId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setCubePricesState({ status: "error", points: [], cubeOrder: null });
        return;
      }
      setCubePricesState({ status: "ready", points: result.points, cubeOrder: result.cubeOrder });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  useEffect(() => {
    if (selectedItemId == null) return;
    let cancelled = false;
    setLatestState((prev) => ({ ...prev, status: "loading" }));
    sfHistorySource.loadLatest(selectedItemId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLatestState({ status: "error", cubes: null, cubeOrder: null, latestUpdatedAt: null });
        return;
      }
      setLatestState({ status: "ready", cubes: result.cubes, cubeOrder: result.cubeOrder, latestUpdatedAt: result.latestUpdatedAt });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  const cubePricesReady = cubePricesState.status === "ready";
  const fullSeries = useMemo(
    () => (cubePricesReady ? buildCubeSeries(cubePricesState.points, cubePricesState.cubeOrder, cubeType) : []),
    [cubePricesReady, cubePricesState.points, cubePricesState.cubeOrder, cubeType],
  );
  const periodSeries = useMemo(() => sliceByPeriod(fullSeries, period), [fullSeries, period]);
  const stats = useMemo(() => computeStats(periodSeries), [periodSeries]);

  const currentExpected = latestState.status === "ready" ? currentCubeValue(latestState.cubes, latestState.cubeOrder, cubeType) : null;
  const percentile = useMemo(() => currentPercentile(periodSeries, currentExpected), [periodSeries, currentExpected]);

  // IMPL_PLAN_SH44 §2-2: one period-sliced series per ADDITIONAL cube type,
  // built the exact same way `fullSeries`/`periodSeries` above build the
  // MAIN one (`buildCubeSeries` -> `sliceByPeriod`, same `cubePricesState.
  // points`/`cubeOrder`/`period`) -- this is what guarantees every cube
  // type's own series shares the identical `date` sequence
  // `SfHistoryChart`'s `mergeExtraSeriesColumns` relies on (see that
  // function's own header). Statistics/heatmap never read this -- plan §4:
  // "追加のキューブの統計は出さない" -- only the chart's `extraSeries` prop
  // below does.
  const extraSeriesForChart = useMemo(() => {
    if (!cubePricesReady || !additionalCubeTypes.length) return [];
    return additionalCubeTypes.map((type) => {
      const series = sliceByPeriod(buildCubeSeries(cubePricesState.points, cubePricesState.cubeOrder, type), period);
      return { key: type, series, color: colorByType[type], strokeWidth: ADDITIONAL_CUBE_LINE_WIDTH };
    });
  }, [cubePricesReady, cubePricesState.points, cubePricesState.cubeOrder, additionalCubeTypes, period, colorByType]);

  return (
    <div className="site-theme sfh-root min-h-screen">
      <SiteHeader active="sfhistory" theme={theme} onThemeChange={handleThemeChange} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-8">
        <SfHistoryTabs active="cubePrices" />

        <p className="max-w-3xl text-sm text-slate-400">{t("sfhistoryCube.pageDescription")}</p>

        {equipmentState.status === "loading" ? (
          <p className="text-sm text-slate-400">{t("sfhistory.loading")}</p>
        ) : equipmentState.status === "error" ? (
          <p className="text-sm text-amber-400">{t("sfhistory.equipment.loadError")}</p>
        ) : selectedItem ? (
          <>
            <div className="flex flex-wrap items-end gap-6">
              <div className="flex flex-col gap-2">
                <EquipmentSelector
                  items={equipmentState.items}
                  selectedItemId={selectedAlias?.itemId ?? selectedItemId}
                  selectedItemName={selectedAlias?.itemName ?? selectedItem.itemName}
                  onSelect={handleSelectEquipment}
                />
              </div>
              <CubeTypeSelector value={cubeType} onChange={handleCubeTypeChange} />
              {/* IMPL_PLAN_SH44 §2-1: separate control, 0-3 ADDITIONAL cube
                  types (never `cubeType` itself -- see the component's own
                  header). */}
              <CubeCompareSelector
                mainCubeType={cubeType}
                selected={additionalCubeTypes}
                colorByType={colorByType}
                onToggle={handleToggleAdditionalCubeType}
              />
            </div>

            <PeriodTabs value={period} onChange={setPeriod} />

            {/* K2/§3-2: White Cube has no history before this date -- a
                factual note, not an evaluation, shown only while that tab is
                selected. */}
            {cubeType === "WHITE_ADDITIONAL" ? (
              <p className="text-sm text-slate-400">{t("sfhistoryCube.whiteCubeNote", { date: WHITE_CUBE_DATA_START })}</p>
            ) : null}

            {/* IMPL_PLAN_SH44 §3/§4(i): stats/heatmap below are the MAIN
                cube type's own, never blended with any additional
                selection -- this note is what makes that explicit on
                screen, the same "factual note, not an evaluation" register
                as the White Cube note above. */}
            <p className="sfh-field-label">{t("sfhistoryCube.statsScope", { cube: CUBE_TYPE_DISPLAY_NAMES[cubeType] })}</p>

            <SummaryCards
              currentStatus={latestState.status}
              currentExpected={currentExpected}
              currentUpdatedAt={latestState.latestUpdatedAt}
              stats={stats}
              percentile={percentile}
            />

            {/* IMPL_PLAN_SH44 §2-2(d): the legend, directly above the chart
                it describes -- a separate component from SfHistoryChart.jsx
                itself (see that component's own new-props comment for why),
                so SfHistoryChart's own JSX output for a plain single-series
                call (SF History) is untouched by this plan. */}
            <CubeLegend mainCubeType={cubeType} additionalCubeTypes={additionalCubeTypes} colorByType={colorByType} />

            <div className="sfh-summary-card">
              {cubePricesState.status === "error" ? (
                <p className="py-8 text-center text-sm text-amber-400">{t("sfhistory.chart.loadError")}</p>
              ) : cubePricesState.status !== "ready" ? (
                <p className="py-8 text-center text-sm text-slate-500">{t("sfhistory.loading")}</p>
              ) : (
                // No `filledBands` for cube prices (K1: no gap-filling --
                // plan §3-2) -- SfHistoryChart's own `filledBandRange`
                // already renders nothing at all for an empty array.
                //
                // IMPL_PLAN_SH44 §2-2: `mainColor`/`mainStrokeWidth`/
                // `extraSeries` are all new, optional props (plan (j):
                // SfHistoryRoot.jsx's own <SfHistoryChart> call, 2 lines
                // below `import`, still passes none of them).
                <SfHistoryChart
                  series={periodSeries}
                  average={stats.average}
                  filledBands={[]}
                  mainColor={colorByType[cubeType]}
                  mainStrokeWidth={MAIN_CUBE_LINE_WIDTH}
                  extraSeries={extraSeriesForChart}
                />
              )}
            </div>

            <WeekdayHeatmap series={periodSeries} />
          </>
        ) : null}
      </main>
    </div>
  );
}
