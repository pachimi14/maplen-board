import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../../components/BoardHeader.jsx";
import { useTranslation } from "../../i18n/I18nContext.jsx";
import { useDashboardStore } from "../../taskManager/storage/useDashboardStore.js";
import { setDashboardThemeColor, setDashboardThemeDepth } from "../../taskManager/domain/dashboardModel.js";
import { discoverySource } from "./integrations/discoverySource.js";
import { formatTooltipDate } from "../domain/format.js";
import { isObservationStale } from "./domain/bands.js";
import SfHistoryTabs from "../SfHistoryTabs.jsx";
import DiscoveryEquipmentSelector from "./components/DiscoveryEquipmentSelector.jsx";
import DiscoveryPriceTable from "./components/DiscoveryPriceTable.jsx";
import DiscoveryRecentList from "./components/DiscoveryRecentList.jsx";
import "../sfhistory.css";

/**
 * `#/starforce/discovery` (IMPL_PLAN_SH32 §2 C): a dedicated page for
 * equipment currently in a DISCOVERY (bonus) period -- reads ONLY what
 * Component A (scripts/scan_discovery.py) and Component B
 * (scripts/poll_discovery.py) have already written; this page's own
 * requests never reach the official upstream (plan §5(i)).
 *
 * Deliberately its own root component/route, not folded into
 * SfHistoryRoot.jsx -- plan §4: "既存の #/starforce は1ピクセルも変えない".
 * Reuses the same shared dashboard theme SfHistoryRoot.jsx already opts
 * into (App.jsx's `usesDashboardTheme` -- see that file's own comment) so
 * this new route does not need a third theme source invented for it.
 */
export default function DiscoveryRoot() {
  const { t, language } = useTranslation();

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
  const [selectedAlias, setSelectedAlias] = useState(null); // { itemId, itemName } -- the exact row picked (may be an alias)
  const [pricesState, setPricesState] = useState({ status: "idle", itemName: null, upgradeCount: 25, observedAt: null, bands: [] });
  const [recentState, setRecentState] = useState({ status: "loading", days: null, items: [] });

  useEffect(() => {
    let cancelled = false;
    discoverySource.loadEquipment().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setEquipmentState({ status: "error", items: [] });
        return;
      }
      setEquipmentState({ status: "ready", items: result.items });
      const first = result.items[0];
      if (first) {
        setSelectedItemId(first.itemId);
        setSelectedAlias({ itemId: first.itemId, itemName: first.itemName });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    discoverySource.loadRecent().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setRecentState({ status: "error", days: null, items: [] });
        return;
      }
      setRecentState({ status: "ready", days: result.days, items: result.items });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedItemId == null) return;
    let cancelled = false;
    setPricesState((prev) => ({ ...prev, status: "loading" }));
    discoverySource.loadPrices(selectedItemId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPricesState({ status: "error", itemName: null, upgradeCount: 25, observedAt: null, bands: [] });
        return;
      }
      setPricesState({
        status: "ready",
        itemName: result.itemName,
        upgradeCount: result.upgradeCount,
        observedAt: result.observedAt,
        bands: result.bands,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  const selectedItem = useMemo(
    () => equipmentState.items.find((item) => item.itemId === selectedItemId) ?? null,
    [equipmentState.items, selectedItemId],
  );

  function handleSelectEquipment(candidate) {
    setSelectedItemId(candidate.representativeItemId);
    setSelectedAlias({ itemId: candidate.itemId, itemName: candidate.itemName });
  }

  const stale = pricesState.status === "ready" && isObservationStale(pricesState.observedAt);

  return (
    <div className="site-theme sfh-root min-h-screen">
      <SiteHeader active="sfhistory" theme={theme} onThemeChange={handleThemeChange} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-8">
        {/* IMPL_PLAN_SH33 §3 (A): same tab bar as SfHistoryRoot.jsx, active
            on this page's own tab. */}
        <SfHistoryTabs active="discovery" />

        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("sfhistoryDiscovery.pageTitle")}</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slate-400">{t("sfhistoryDiscovery.pageDescription")}</p>
        </div>

        {equipmentState.status === "loading" ? (
          <p className="text-sm text-slate-400">{t("sfhistoryDiscovery.loading")}</p>
        ) : equipmentState.status === "error" ? (
          <p className="text-sm text-amber-400">{t("sfhistoryDiscovery.equipment.loadError")}</p>
        ) : equipmentState.items.length === 0 ? (
          <p className="text-sm text-slate-400">{t("sfhistoryDiscovery.equipment.empty")}</p>
        ) : (
          <>
            <DiscoveryEquipmentSelector
              items={equipmentState.items}
              selectedItemId={selectedAlias?.itemId ?? selectedItemId}
              selectedItemName={selectedAlias?.itemName ?? selectedItem?.itemName}
              onSelect={handleSelectEquipment}
            />

            {selectedItem && selectedItem.stepsConsistent === false ? (
              <p className="text-sm text-amber-400">{t("sfhistoryDiscovery.equipment.inconsistentWarning")}</p>
            ) : null}

            <div className="sfh-summary-card">
              {pricesState.status === "error" ? (
                <p className="py-8 text-center text-sm text-amber-400">{t("sfhistoryDiscovery.prices.loadError")}</p>
              ) : pricesState.status !== "ready" ? (
                <p className="py-8 text-center text-sm text-slate-500">{t("sfhistoryDiscovery.loading")}</p>
              ) : (
                <>
                  <div className="mb-3 text-sm">
                    {pricesState.observedAt ? (
                      <span className={stale ? "text-amber-400" : "text-slate-400"}>
                        {t("sfhistoryDiscovery.prices.observedAt", {
                          timestamp: formatTooltipDate(pricesState.observedAt, { locale: language }),
                        })}
                        {stale ? ` ${t("sfhistoryDiscovery.prices.observedAtStale")}` : ""}
                      </span>
                    ) : (
                      <span className="text-slate-500">{t("sfhistoryDiscovery.prices.neverPolled")}</span>
                    )}
                  </div>
                  <DiscoveryPriceTable bands={pricesState.bands} upgradeCount={pricesState.upgradeCount} />
                </>
              )}
            </div>
          </>
        )}

        <section>
          <h2 className="text-lg font-semibold text-slate-100">{t("sfhistoryDiscovery.recent.title")}</h2>
          {/* IMPL_PLAN_SH33 follow-up (post-review): explains WHY this list
              exists -- not "these items ended" (equipment-level framing the
              user found off-target) but "an item stays reachable, with its
              own per-band settling-time table, for `days` days after it
              fully settles" (plan §5(m)). Only rendered once `recentState.
              days` is known (ready/error both still resolve a numeric
              `days` -- `idle`/`loading` do not, so this never shows a
              placeholder "{{days}}" before the real value loads). */}
          {typeof recentState.days === "number" ? (
            <p className="mt-0.5 text-sm text-slate-400">{t("sfhistoryDiscovery.recent.subtitle", { days: recentState.days })}</p>
          ) : null}
          <div className="sfh-summary-card mt-2">
            {recentState.status === "error" ? (
              <p className="py-4 text-sm text-amber-400">{t("sfhistoryDiscovery.recent.loadError")}</p>
            ) : recentState.status !== "ready" ? (
              <p className="py-4 text-sm text-slate-500">{t("sfhistoryDiscovery.loading")}</p>
            ) : (
              <DiscoveryRecentList items={recentState.items} days={recentState.days} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
