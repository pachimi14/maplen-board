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
 * locale files).
 *
 * IMPL_PLAN_SH42 §1 (A): two levels, not three tabs side by side --
 *   [Enhance History] [New Equipment]   <- top level (this is what used to
 *                                           be the 3-wide strip)
 *     [SF] [Cube]                       <- 2nd level, only rendered while on
 *                                           one of the two Enhance History
 *                                           pages (plan: "現在地が2階層とも
 *                                           一目で分かる")
 * `SF` and `Cube` are new, shorter labels for the same two routes this file
 * already linked to via the old 3rd/1st tabs (`sfhistoryTabs.cubePrices` /
 * `sfhistoryTabs.sfHistory`) -- shortened because "SF History"/"Cube
 * Prices" read as redundant once nested one level under a tab that already
 * reads "Enhance History" (plan §3's same reasoning for dropping the page
 * `<h1>`), and because a second, narrower row of tabs is what keeps this
 * from repeating the top nav's own known 375px-overflow problem (plan
 * §"(i)"). The top-level "Enhance History" tab reuses `app.openSfHistory`
 * (the exact same string the site's main nav already shows for this same
 * destination, `components/BoardHeader.jsx`) instead of a new locale key --
 * one source of truth for that product name, not two that could drift.
 *
 * The top-level "Enhance History" tab is `aria-current="page"` whenever
 * `active` is EITHER `sfHistory` OR `cubePrices` (plan §1: "SF と Cube の
 * どちらにいても選択状態になる") -- `onEnhanceHistoryPage` below is exactly
 * that OR, computed once and reused for both the top-level tab and the
 * decision to render the 2nd-level strip at all.
 */
export default function SfHistoryTabs({ active }) {
  const { t } = useTranslation();
  const onEnhanceHistoryPage = active === "sfHistory" || active === "cubePrices";

  return (
    <div className="sfh-tabs-group">
      <nav aria-label={t("sfhistoryTabs.navLabel")} className="sfh-period-tabs">
        <a
          href="#/starforce"
          aria-current={onEnhanceHistoryPage ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigateToStarforce();
          }}
          className={`sfh-period-tab ${onEnhanceHistoryPage ? "sfh-period-tab-active" : ""}`}
        >
          {t("app.openSfHistory")}
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
      </nav>

      {onEnhanceHistoryPage ? (
        <nav aria-label={t("sfhistoryTabs.subNavLabel")} className="sfh-period-tabs">
          <a
            href="#/starforce"
            aria-current={active === "sfHistory" ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigateToStarforce();
            }}
            className={`sfh-period-tab ${active === "sfHistory" ? "sfh-period-tab-active" : ""}`}
          >
            {t("sfhistoryTabs.sf")}
          </a>
          <a
            href="#/starforce/cube-prices"
            aria-current={active === "cubePrices" ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigateToStarforceCubePrices();
            }}
            className={`sfh-period-tab ${active === "cubePrices" ? "sfh-period-tab-active" : ""}`}
          >
            {t("sfhistoryTabs.cube")}
          </a>
        </nav>
      ) : null}
    </div>
  );
}
