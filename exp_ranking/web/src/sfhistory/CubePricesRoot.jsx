import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../components/BoardHeader.jsx";
import { useTranslation } from "../i18n/I18nContext.jsx";
import { useDashboardStore } from "../taskManager/storage/useDashboardStore.js";
import { setDashboardThemeColor, setDashboardThemeDepth } from "../taskManager/domain/dashboardModel.js";
import { sfHistorySource } from "./integrations/sfHistorySource.js";
import { DEFAULT_PERIOD, computeStats, currentPercentile, sliceByPeriod } from "./domain/series.js";
import { CUBE_TYPE_ORDER, buildCubeSeries, currentCubeValue } from "./domain/cubeSeries.js";
import SfHistoryTabs from "./SfHistoryTabs.jsx";
import EquipmentSelector from "./components/EquipmentSelector.jsx";
import CubeTypeSelector from "./components/CubeTypeSelector.jsx";
import PeriodTabs from "./components/PeriodTabs.jsx";
import SfHistoryChart from "./components/SfHistoryChart.jsx";
import SummaryCards from "./components/SummaryCards.jsx";
import WeekdayHeatmap from "./components/WeekdayHeatmap.jsx";
import "./sfhistory.css";

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
      const first = result.items[0];
      setSelectedItemId(first.itemId);
      setSelectedAlias({ itemId: first.itemId, itemName: first.itemName });
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
    setSelectedAlias({ itemId: candidate.itemId, itemName: candidate.itemName });
  }

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
              <CubeTypeSelector value={cubeType} onChange={setCubeType} />
            </div>

            <PeriodTabs value={period} onChange={setPeriod} />

            {/* K2/§3-2: White Cube has no history before this date -- a
                factual note, not an evaluation, shown only while that tab is
                selected. */}
            {cubeType === "WHITE_ADDITIONAL" ? (
              <p className="text-sm text-slate-400">{t("sfhistoryCube.whiteCubeNote", { date: WHITE_CUBE_DATA_START })}</p>
            ) : null}

            <SummaryCards
              currentStatus={latestState.status}
              currentExpected={currentExpected}
              currentUpdatedAt={latestState.latestUpdatedAt}
              stats={stats}
              percentile={percentile}
            />

            <div className="sfh-summary-card">
              {cubePricesState.status === "error" ? (
                <p className="py-8 text-center text-sm text-amber-400">{t("sfhistory.chart.loadError")}</p>
              ) : cubePricesState.status !== "ready" ? (
                <p className="py-8 text-center text-sm text-slate-500">{t("sfhistory.loading")}</p>
              ) : (
                // No `filledBands` for cube prices (K1: no gap-filling --
                // plan §3-2) -- SfHistoryChart's own `filledBandRange`
                // already renders nothing at all for an empty array.
                <SfHistoryChart series={periodSeries} average={stats.average} filledBands={[]} />
              )}
            </div>

            <WeekdayHeatmap series={periodSeries} />
          </>
        ) : null}
      </main>
    </div>
  );
}
