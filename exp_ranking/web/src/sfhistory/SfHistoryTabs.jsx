import { navigateToStarforce, navigateToStarforceCubePrices, navigateToStarforceDiscovery } from "../board/useHashRoute.js";
import { useTranslation } from "../i18n/I18nContext.jsx";

/**
 * IMPL_PLAN_SH33 §3 (A): the two-page tab bar shared by SfHistoryRoot.jsx
 * and DiscoveryRoot.jsx, so a viewer can move between them without going
 * back out through the top nav. Routes stay exactly what they were --
 * `#/starforce` / `#/starforce/discovery` (plan §3: "ルートは1文字も変え
 * ない") -- this only adds a second way to reach the same two routes.
 *
 * `navigateToStarforce`/`navigateToStarforceDiscovery` already existed in
 * `board/useHashRoute.js` before this plan (added in SH-32, unused until
 * now) -- reused read-only here (plan §5: "src/board/ は触らない"), which
 * is also what keeps the shared ranking-filter query intact across the
 * switch, the same as every other in-app navigation.
 *
 * Reuses the existing `.sfh-period-tab*` pill styling (see
 * `components/PeriodTabs.jsx`) rather than inventing a second visual
 * language for "tabs" -- no new CSS added for this. Semantically this is
 * page navigation between two routes, not the ARIA tabpanel switch
 * PeriodTabs implements for its own within-page 7D/14D/... selector, so
 * this uses `<a>` + `aria-current="page"` (the same pattern
 * `components/BoardHeader.jsx`'s own top nav already uses), not
 * `role="tab"`/`aria-selected`.
 *
 * Tab labels are always English in every locale -- same "product/route
 * name, not translated" treatment SH-30 already gave the top nav's own
 * "Enhance History" label (`app.openSfHistory`, identical value in all 6
 * locale files) -- `sfhistoryTabs.sfHistory`/`sfhistoryTabs.newEquipment`/
 * `sfhistoryTabs.cubePrices` (IMPL_PLAN_SH41 §2) below are English in
 * en/ja/es/th/vi/zh-TW alike.
 */
export default function SfHistoryTabs({ active }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("sfhistoryTabs.navLabel")} className="sfh-period-tabs">
      <a
        href="#/starforce"
        aria-current={active === "sfHistory" ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          navigateToStarforce();
        }}
        className={`sfh-period-tab ${active === "sfHistory" ? "sfh-period-tab-active" : ""}`}
      >
        {t("sfhistoryTabs.sfHistory")}
      </a>
      <a
        href="#/starforce/discovery"
        aria-current={active === "discovery" ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          navigateToStarforceDiscovery();
        }}
        className={`sfh-period-tab ${active === "discovery" ? "sfh-period-tab-active" : ""}`}
      >
        {t("sfhistoryTabs.newEquipment")}
      </a>
      {/* IMPL_PLAN_SH41 §2: 3rd tab -- `#/starforce/cube-prices`. */}
      <a
        href="#/starforce/cube-prices"
        aria-current={active === "cubePrices" ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          navigateToStarforceCubePrices();
        }}
        className={`sfh-period-tab ${active === "cubePrices" ? "sfh-period-tab-active" : ""}`}
      >
        {t("sfhistoryTabs.cubePrices")}
      </a>
    </nav>
  );
}
