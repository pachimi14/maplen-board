import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../components/BoardHeader.jsx";
import { useTranslation } from "../i18n/I18nContext.jsx";
import { useDashboardStore } from "../taskManager/storage/useDashboardStore.js";
import { setDashboardThemeColor, setDashboardThemeDepth } from "../taskManager/domain/dashboardModel.js";
import { sfHistorySource } from "./integrations/sfHistorySource.js";
import { defaultPresetForMaxStar, isValidStarRange } from "./domain/series.js";
import { buildScreenModel, isRangeReady } from "./domain/viewModel.js";
import EquipmentSelector from "./components/EquipmentSelector.jsx";
import StarRangeSelector from "./components/StarRangeSelector.jsx";
import PeriodTabs from "./components/PeriodTabs.jsx";
import SfHistoryChart from "./components/SfHistoryChart.jsx";
import SummaryCards from "./components/SummaryCards.jsx";
import CalcConditions from "./components/CalcConditions.jsx";
import "./sfhistory.css";

/**
 * `#/starforce` (IMPL_PLAN_SH5 §0/§2): pick a piece of gear and a star
 * range, see the Expected-cost history and where the current value sits
 * against it. All computation is client-side (design §4/§8.3 -- no Worker,
 * no cancellation, no memoization beyond React's own memo: measured 32ms
 * for 900 points, ~30x under the 1s stop-condition budget).
 */
export default function SfHistoryRoot() {
  const { t } = useTranslation();

  // IMPL_PLAN_SH9 §4: reuses TaskManagerRoot's own theme storage
  // (`useDashboardStore` + `setDashboardThemeColor`/`setDashboardThemeDepth`
  // from taskManager/domain/dashboardModel.js) rather than inventing a
  // second theme store -- "新しい仕組みを発明しない". Read-only import of an
  // already-exported hook/pair of functions; no taskManager/ file is
  // modified by this slice.
  //
  // IMPL_PLAN_SH10 §1-2: the actual `document.documentElement.dataset`
  // write is App.jsx's sole responsibility (its one dataset-write effect
  // now treats the `starforce` route the same as the Task Manager trio,
  // reading from this same `useDashboardStore`). This component only reads
  // the store for its own picker UI (`theme` below, passed to
  // `SiteHeader`) and writes to it on user interaction
  // (`handleThemeChange`); it does not touch the dataset itself, so there
  // is exactly one place in the app that does. This also resolves SH-9's
  // known first-navigation race (App.jsx's effect now reads the same
  // source this page does, so there is nothing for it to clobber).
  const dashboardStore = useDashboardStore();
  const theme = useMemo(
    () => ({ themeColor: dashboardStore.state.themeColor, themeDepth: dashboardStore.state.themeDepth }),
    [dashboardStore.state.themeColor, dashboardStore.state.themeDepth],
  );
  const handleThemeChange = (next) => {
    dashboardStore.update((state) => setDashboardThemeDepth(setDashboardThemeColor(state, next.themeColor), next.themeDepth));
  };

  const [equipmentState, setEquipmentState] = useState({ status: "loading", items: [] });
  const [selectedItemId, setSelectedItemId] = useState(null); // representative id -- drives prices/latest
  // IMPL_PLAN_SH9 §3-3: the exact alias row the user picked (may differ from
  // `selectedItemId`'s own representative name/id -- see EquipmentSelector's
  // header comment). Drives the search box's closed-state text and the
  // "shared group" note below; never used for API calls.
  const [selectedAlias, setSelectedAlias] = useState(null); // { itemId, itemName }
  const [range, setRange] = useState(null); // { startStar, targetStar }
  const [period, setPeriod] = useState("150D");

  const [pricesState, setPricesState] = useState({ status: "idle", points: [], priceVersion: null, endDate: null });
  const [latestState, setLatestState] = useState({ status: "idle", prices: null, latestUpdatedAt: null });

  // Load the equipment list once. Picks an initial item + a maxStar-valid
  // default range (design §7.1: never open on an invalid range).
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
      setRange(defaultPresetForMaxStar(first.maxStar));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedItem = useMemo(
    () => equipmentState.items.find((item) => item.itemId === selectedItemId) ?? null,
    [equipmentState.items, selectedItemId],
  );

  // IMPL_PLAN_SH9 §3-3: `candidate.representativeItemId` (not
  // `candidate.itemId`) is what drives prices/latest -- picking an alias
  // never fetches a different item's numbers, only displays its name
  // (`selectedAlias`, read by the "shared group" note below).
  function handleSelectEquipment(candidate) {
    setSelectedItemId(candidate.representativeItemId);
    setSelectedAlias({ itemId: candidate.itemId, itemName: candidate.itemName });
  }

  // "強化費用はこのグループ共通(代表: ○○)" (plan §3-3 (d), design §7):
  // shown exactly when the picked alias isn't the representative itself, so
  // the numbers-vs-label mismatch is never silent.
  const isAliasSelection = Boolean(selectedItem && selectedAlias && selectedAlias.itemId !== selectedItem.itemId);

  // design §7.1: if switching equipment makes the current range invalid
  // for the new item's maxStar (e.g. 19->21 on a maxStar=20 device), clamp
  // to a valid default instead of letting the chart render all-null.
  //
  // Uses `isRangeReady` (not a bare `!range` truthiness check) so that a
  // malformed-but-truthy `range` (the exact shape of the crash this effect
  // now also guards against -- see domain/viewModel.js's header) is
  // re-clamped here too, rather than only being caught downstream in
  // buildScreenModel.
  useEffect(() => {
    if (!selectedItem) return;
    if (!isRangeReady(range) || !isValidStarRange(range.startStar, range.targetStar, selectedItem.maxStar)) {
      setRange(defaultPresetForMaxStar(selectedItem.maxStar));
    }
  }, [selectedItem, range]);

  useEffect(() => {
    if (selectedItemId == null) return;
    let cancelled = false;
    setPricesState((prev) => ({ ...prev, status: "loading" }));
    sfHistorySource.loadPrices(selectedItemId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPricesState({ status: "error", points: [], priceVersion: null, endDate: null });
        return;
      }
      setPricesState({ status: "ready", points: result.points, priceVersion: result.priceVersion, endDate: result.endDate });
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
        setLatestState({ status: "error", prices: null, latestUpdatedAt: null });
        return;
      }
      setLatestState({ status: "ready", prices: result.prices, latestUpdatedAt: result.latestUpdatedAt });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  // Post-review fix (統括 P0): all derived-from-async-state computation
  // goes through this single pure function (domain/viewModel.js) instead
  // of being inlined here across several useMemos. That function is the
  // one domain/viewModel.test.js exercises directly (including the exact
  // "range is truthy but malformed" / "one async piece resolved before
  // another" scenarios that crashed this screen) -- keeping the gating
  // logic in one place, called from here, is what makes those tests a
  // real regression guard on production code rather than a parallel
  // reimplementation that could silently drift from what SfHistoryRoot
  // actually does.
  const { periodSeries, stats, currentExpected, percentile } = useMemo(
    () => buildScreenModel({ range, period, pricesState, latestState }),
    [range, period, pricesState, latestState],
  );

  return (
    <div className="site-theme sfh-root min-h-screen">
      <SiteHeader active="sfhistory" theme={theme} onThemeChange={handleThemeChange} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("sfhistory.pageTitle")}</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-400">{t("sfhistory.pageDescription")}</p>
        </div>

        {equipmentState.status === "loading" ? (
          <p className="text-sm text-slate-400">{t("sfhistory.loading")}</p>
        ) : equipmentState.status === "error" ? (
          <p className="text-sm text-amber-400">{t("sfhistory.equipment.loadError")}</p>
        ) : selectedItem && isRangeReady(range) ? (
          <>
            <div className="flex flex-wrap items-end gap-6">
              <EquipmentSelector
                items={equipmentState.items}
                selectedItemId={selectedAlias?.itemId ?? selectedItemId}
                selectedItemName={selectedAlias?.itemName ?? selectedItem.itemName}
                onSelect={handleSelectEquipment}
              />
              <StarRangeSelector
                maxStar={selectedItem.maxStar}
                startStar={range.startStar}
                targetStar={range.targetStar}
                onChange={setRange}
              />
            </div>

            {isAliasSelection ? (
              <p className="sfh-group-shared-note">
                {t("sfhistory.equipment.groupSharedNote", { representativeName: selectedItem.itemName })}
              </p>
            ) : null}

            <PeriodTabs value={period} onChange={setPeriod} />

            <SummaryCards
              currentStatus={latestState.status}
              currentExpected={currentExpected}
              stats={stats}
              percentile={percentile}
            />

            <div className="sfh-summary-card">
              {pricesState.status === "error" ? (
                <p className="py-8 text-center text-sm text-amber-400">{t("sfhistory.chart.loadError")}</p>
              ) : pricesState.status !== "ready" ? (
                <p className="py-8 text-center text-sm text-slate-500">{t("sfhistory.loading")}</p>
              ) : (
                <SfHistoryChart series={periodSeries} average={stats.average} />
              )}
            </div>

            <CalcConditions historyUpdatedAt={pricesState.endDate} currentFetchedAt={latestState.latestUpdatedAt} />
          </>
        ) : null}
      </main>
    </div>
  );
}
