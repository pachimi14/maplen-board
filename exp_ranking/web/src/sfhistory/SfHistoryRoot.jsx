import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../components/BoardHeader.jsx";
import { useTranslation } from "../i18n/I18nContext.jsx";
import { useDashboardStore } from "../taskManager/storage/useDashboardStore.js";
import { setDashboardThemeColor, setDashboardThemeDepth } from "../taskManager/domain/dashboardModel.js";
import { sfHistorySource } from "./integrations/sfHistorySource.js";
import { DEFAULT_PERIOD, defaultPresetForMaxStar, isValidStarRange, selectInitialItem } from "./domain/series.js";
import { buildScreenModel, isRangeReady } from "./domain/viewModel.js";
import { formatFormingBandRanges, formatTooltipDate, groupFilledBands } from "./domain/format.js";
import { resolveCarriedSelection } from "./domain/selectionCarry.js";
import { getCarriedSelection, setCarriedSelection } from "./selectionStore.js";
import SfHistoryTabs from "./SfHistoryTabs.jsx";
import EquipmentSelector from "./components/EquipmentSelector.jsx";
import StarRangeSelector from "./components/StarRangeSelector.jsx";
import PeriodTabs from "./components/PeriodTabs.jsx";
import SfHistoryChart from "./components/SfHistoryChart.jsx";
import SummaryCards from "./components/SummaryCards.jsx";
import WeekdayHeatmap from "./components/WeekdayHeatmap.jsx";
import "./sfhistory.css";

/**
 * `#/starforce` (IMPL_PLAN_SH5 §0/§2): pick a piece of gear and a star
 * range, see the Expected-cost history and where the current value sits
 * against it. All computation is client-side (design §4/§8.3 -- no Worker,
 * no cancellation, no memoization beyond React's own memo: measured 32ms
 * for 900 points, ~30x under the 1s stop-condition budget).
 */
export default function SfHistoryRoot() {
  const { t, language } = useTranslation();

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
  const [period, setPeriod] = useState(DEFAULT_PERIOD); // IMPL_PLAN_SH27 §1

  const [pricesState, setPricesState] = useState({ status: "idle", points: [], priceVersion: null, endDate: null, formingBands: [] });
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
      // IMPL_PLAN_SH42 §2 (B): open on whatever equipment was carried from
      // the Cube/New Equipment tab, if it's still present in this page's
      // own items -- falls back to the pre-existing SH-26 default
      // (DEFAULT_INITIAL_ITEM_ID / Arcane Umbra Staff) otherwise, which is
      // also exactly what runs on a fresh page load (the carried store is
      // empty then -- plan §2/(f): "#/starforce を直接開いたときの初期選択
      // は従来どおり").
      const carried = resolveCarriedSelection(result.items, getCarriedSelection());
      const picked = carried
        ? result.items.find((item) => item.itemId === carried.itemId)
        : selectInitialItem(result.items);
      const alias = carried?.alias ?? { itemId: picked.itemId, itemName: picked.itemName };
      setSelectedItemId(picked.itemId);
      setSelectedAlias(alias);
      setCarriedSelection(picked.itemId, alias);
      setRange(defaultPresetForMaxStar(picked.maxStar));
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
    const alias = { itemId: candidate.itemId, itemName: candidate.itemName };
    setSelectedAlias(alias);
    // IMPL_PLAN_SH42 §2 (B): an explicit pick carries over to the Cube/New
    // Equipment tab too, same as the default pick above.
    setCarriedSelection(candidate.representativeItemId, alias);
  }

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
        setPricesState({ status: "error", points: [], priceVersion: null, endDate: null, formingBands: [] });
        return;
      }
      // IMPL_PLAN_SH36 §4: `formingBands` passes straight through --
      // `[]` for every item that is not DISCOVERY-monitored (plan §6(g)).
      setPricesState({
        status: "ready",
        points: result.points,
        priceVersion: result.priceVersion,
        endDate: result.endDate,
        formingBands: result.formingBands,
      });
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
  // IMPL_PLAN_SH29 §4: `fullSeries` is no longer read here -- WeekdayHeatmap
  // now takes `periodSeries` (see below) -- `buildScreenModel` still returns
  // it (viewModel.js untouched; other future call sites may still want it).
  const { periodSeries, stats, currentExpected, percentile, filledBands } = useMemo(
    () => buildScreenModel({ range, period, pricesState, latestState }),
    [range, period, pricesState, latestState],
  );

  // IMPL_PLAN_SH36 §4: which ☆ ranges (if any) are currently price-forming
  // for the selected item -- `pricesState.formingBands` is `[]` for every
  // item that is not DISCOVERY-monitored (plan §6(g)), which is exactly
  // when `formingBandsNote` below is `null` and the note does not render
  // (plan §6(h): "形成中の帯が無ければ出ない"). Structure only comes from
  // `formatFormingBandRanges` (domain/format.js, i18n-free) -- the actual
  // wording is picked here via `t()`, same "domain decides shape, component
  // decides words" split `describeCurrentPercentile`/`SummaryCards` already
  // use.
  const formingBandsNote = useMemo(() => {
    const ranges = formatFormingBandRanges(pricesState.formingBands, (startStar, endStar) =>
      startStar === endStar
        ? t("sfhistory.formingBands.rangeSingle", { star: startStar })
        : t("sfhistory.formingBands.range", { start: startStar, end: endStar }),
    );
    return ranges.length ? t("sfhistory.formingBands.note", { ranges: ranges.join(" / ") }) : null;
  }, [pricesState.formingBands, t]);

  // IMPL_PLAN_SH37 §3/§4/§7(g)(h): a SEPARATE note from `formingBandsNote`
  // above -- that one is about bands CURRENTLY forming (SH-36, unmodified);
  // this one is about bands that finished forming BEFORE the currently
  // selected span's own history began (`filledBands`, already scoped to
  // the selected range by `buildScreenModel`). Rendered as its own list of
  // sentences (never joined into `formingBandsNote`'s string, plan §4:
  // "両方出る場合に混ざらない") -- one line per contiguous star-range +
  // shared `untilDate` group, since two bands that finished forming at
  // different times must not be flattened into one misleading date.
  const filledBandNotes = useMemo(() => {
    return groupFilledBands(filledBands).map((group) => {
      const range =
        group.startStar === group.endStar
          ? t("sfhistory.filledBands.rangeSingle", { star: group.startStar })
          : t("sfhistory.filledBands.range", { start: group.startStar, end: group.endStar });
      return t("sfhistory.filledBands.note", { range, until: formatTooltipDate(group.untilDate, { locale: language }) });
    });
  }, [filledBands, t, language]);

  return (
    <div className="site-theme sfh-root min-h-screen">
      <SiteHeader active="sfhistory" theme={theme} onThemeChange={handleThemeChange} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-8">
        {/* IMPL_PLAN_SH33 §3 (A): in-page tab bar to `#/starforce/discovery`
            and back -- both pages render the same component (§5(g): "両
            ページに同じタブが出る"). */}
        <SfHistoryTabs active="sfHistory" />

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
              <div className="flex flex-col gap-2">
                <EquipmentSelector
                  items={equipmentState.items}
                  selectedItemId={selectedAlias?.itemId ?? selectedItemId}
                  selectedItemName={selectedAlias?.itemName ?? selectedItem.itemName}
                  onSelect={handleSelectEquipment}
                />
              </div>
              <StarRangeSelector
                maxStar={selectedItem.maxStar}
                startStar={range.startStar}
                targetStar={range.targetStar}
                onChange={setRange}
              />
            </div>

            <PeriodTabs value={period} onChange={setPeriod} />

            {/* IMPL_PLAN_SH36 §4: states ONLY which ☆ ranges are currently
                price-forming -- no evaluation/warning/recommendation wording
                (plan §1/§6(i)). Renders nothing at all when there is nothing
                forming (`formingBandsNote` is `null`). */}
            {formingBandsNote != null ? (
              <p className="text-sm text-slate-400">{formingBandsNote}</p>
            ) : null}

            {/* IMPL_PLAN_SH37 §3/§4: states ONLY which ☆ ranges had a
                leading gap filled and until when -- no evaluation/warning
                wording (plan §4: "事実だけを書く"). Renders nothing when
                nothing was filled for the currently selected span
                (`filledBandNotes` is `[]`, plan §7(h)). A separate block
                from `formingBandsNote` above (plan §4: "両方出る場合に混ざら
                ない") -- one line per group. */}
            {filledBandNotes.length ? (
              <div className="space-y-0.5">
                {filledBandNotes.map((note, index) => (
                  <p key={index} className="text-sm text-slate-400">
                    {note}
                  </p>
                ))}
              </div>
            ) : null}

            <SummaryCards
              currentStatus={latestState.status}
              currentExpected={currentExpected}
              currentUpdatedAt={latestState.latestUpdatedAt}
              stats={stats}
              percentile={percentile}
            />

            <div className="sfh-summary-card">
              {pricesState.status === "error" ? (
                <p className="py-8 text-center text-sm text-amber-400">{t("sfhistory.chart.loadError")}</p>
              ) : pricesState.status !== "ready" ? (
                <p className="py-8 text-center text-sm text-slate-500">{t("sfhistory.loading")}</p>
              ) : (
                // IMPL_PLAN_SH38 §1/§2: `filledBands` -- already scoped to
                // the currently selected star range by `buildScreenModel`
                // above (unchanged, same value `filledBandNotes` already
                // reads) -- is now ALSO passed straight through to the
                // chart so it can shade the matching x-range
                // (`domain/chartColumns.js#filledBandRange`). This is the
                // one line SfHistoryRoot.jsx needed to add for the plan's
                // (a)/(b)/(e) acceptance criteria: no other logic in this
                // file changes -- `filledBands` was already computed here
                // (used by `filledBandNotes` two lines above) and was
                // simply never threaded down to the chart before this.
                <SfHistoryChart series={periodSeries} average={stats.average} filledBands={filledBands} />
              )}
            </div>

            {/* IMPL_PLAN_SH29 §4 (2026-08-06, user decision, reverses
                IMPL_PLAN_SH11 §3-2 below): `periodSeries` (same slice the
                chart/stats use), not `fullSeries` -- the heatmap now IS
                connected to the period tab above. `WeekdayHeatmap.jsx`'s own
                `heatmapSampleRange` note is what covers the "7D puts n=0-1
                in most cells" concern SH-11 §3-2 originally raised.
                ~~IMPL_PLAN_SH11 §3-2: `fullSeries` (never `periodSeries`) --
                the heatmap is deliberately not connected to the period tab
                above (7D would put n=1 in every cell).~~ (superseded by
                SH-29 §4 above -- struck through, not deleted.) */}
            <WeekdayHeatmap series={periodSeries} />
          </>
        ) : null}
      </main>
    </div>
  );
}
