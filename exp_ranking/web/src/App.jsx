import { useEffect } from "react";
import { BoardProvider, useBoard } from "./board/BoardContext";
import { ProfileProvider } from "./profile/ProfileContext";
import BoardHeader, { SiteHeader } from "./components/BoardHeader";
import RankingListView from "./pages/RankingListView";
import CharacterDetailView from "./pages/CharacterDetailView";
import GroupCompareView from "./pages/GroupCompareView";
import TaskManagerRoot from "./taskManager/TaskManagerRoot.jsx";
import RaffleCalculatorRoot from "./raffle/RaffleCalculatorRoot.jsx";
import { useDashboardStore } from "./taskManager/storage/useDashboardStore.js";
import SfHistoryRoot from "./sfhistory/SfHistoryRoot.jsx";
import DiscoveryRoot from "./sfhistory/discovery/DiscoveryRoot.jsx";
import CubePricesRoot from "./sfhistory/CubePricesRoot.jsx";
import { useSiteTheme } from "./siteTheme.js";

const RANKING_THEME_STORAGE_KEY = "maplen-board-ranking-theme-v1";
// Theme scope split: raffle used to share RANKING_THEME_STORAGE_KEY (a
// change on either page affected the other). This is raffle's own key
// (LULU-008 naming), seeded once from the current ranking theme the first
// time it's read (see the `useSiteTheme(RAFFLE_THEME_STORAGE_KEY, {
// seedTheme: rankingTheme })` call below), then fully independent.
const RAFFLE_THEME_STORAGE_KEY = "maplen-board-raffle-theme-v1";

export default function App() {
  return (
    <ProfileProvider>
      <BoardProvider>
        <AppShell />
      </BoardProvider>
    </ProfileProvider>
  );
}

function AppShell() {
  const { t, loading, characters, loadError, meta, scheduledUpdateLabel, route } = useBoard();
  // S1 (IMPL_PLAN_RAFFLE_RANKING_SEARCH.md §0): the ranking board is already
  // fetched here on every route by BoardProvider, so raffle's ranking-first
  // search reuses it via props instead of calling useBoard() itself inside
  // src/raffle/** (keeps the raffle domain decoupled/importable in tests
  // without a BoardProvider, per the plan's stop condition §5).
  const rankingCharacters = characters;
  const rankingLoading = loading;
  const rankingLoadError = loadError;
  const dashboardStore = useDashboardStore();
  const [rankingTheme, updateRankingTheme] = useSiteTheme(RANKING_THEME_STORAGE_KEY);
  // Raffle's own independent theme: the first time this key is read (no
  // saved value yet), it seeds once from ranking's current value so
  // splitting the two themes apart doesn't change what's on screen; from
  // then on it's saved under its own key and no longer follows ranking.
  const [raffleTheme, updateRaffleTheme] = useSiteTheme(RAFFLE_THEME_STORAGE_KEY, { seedTheme: rankingTheme });
  const isTaskManagerRoute = route.name === "dashboard" || route.name === "tasks" || route.name === "schedule";
  const isRaffleRoute = route.name === "raffle";
  // IMPL_PLAN_SH10 §1-2: `#/starforce` (SfHistoryRoot) reads/writes the same
  // `useDashboardStore` theme as the Task Manager trio (see
  // SfHistoryRoot.jsx's own comment), so it must share this effect's theme
  // *source* too -- otherwise this effect (which runs on every AppShell
  // render regardless of route, since it can't conditionally skip a Hook)
  // overwrites the dataset with `rankingTheme` right after SfHistoryRoot
  // mounts. This flag only decides which store this dataset-write effect
  // reads from; it does not change which routes render TaskManagerRoot
  // (`isTaskManagerRoute` above still gates that, unchanged). Raffle
  // Calculator has its own scoped theme (`raffleTheme`, above) since the
  // theme-separation change: it's neither the dashboard store nor
  // `rankingTheme` -- the `isRaffleRoute` branch below sources `activeTheme`
  // from it directly.
  // IMPL_PLAN_SH32 §2 C: `#/starforce/discovery` (DiscoveryRoot) shares the
  // same dashboard theme source as `#/starforce` (see SfHistoryRoot.jsx's
  // own comment on this exact flag) -- added to the SAME condition rather
  // than a new one, since it needs identical treatment for identical reasons.
  // IMPL_PLAN_SH41 §2: `#/starforce/cube-prices` (CubePricesRoot) shares the
  // same dashboard theme source as `#/starforce`/`#/starforce/discovery`,
  // for the same reason -- added to the SAME condition.
  const usesDashboardTheme =
    isTaskManagerRoute || route.name === "starforce" || route.name === "starforceDiscovery" || route.name === "starforceCubePrices";
  const activeTheme = usesDashboardTheme
    ? { themeColor: dashboardStore.state.themeColor || "green", themeDepth: dashboardStore.state.themeDepth || "deep" }
    : isRaffleRoute
      ? raffleTheme
      : rankingTheme;
  const siteHeaderVariant = rankingTheme.themeDepth === "deep" ? "dark" : "light";
  const raffleSiteHeaderVariant = raffleTheme.themeDepth === "deep" ? "dark" : "light";

  // Sole writer of `data-theme-color` / `data-theme-depth` (IMPL_PLAN_SH10
  // §1-2: "正が2箇所に住まない") -- SfHistoryRoot no longer has its own copy
  // of this effect.
  useEffect(() => {
    document.documentElement.dataset.themeColor = activeTheme.themeColor;
    document.documentElement.dataset.themeDepth = activeTheme.themeDepth;
  }, [activeTheme.themeColor, activeTheme.themeDepth]);

  if (isRaffleRoute) {
    return (
      <div className="site-theme ranking-root min-h-screen bg-slate-50 dark:bg-slate-950">
        <SiteHeader active="raffle" variant={raffleSiteHeaderVariant} theme={raffleTheme} onThemeChange={updateRaffleTheme} />
        <RaffleCalculatorRoot rankingCharacters={rankingCharacters} rankingLoading={rankingLoading} rankingLoadError={rankingLoadError} />
      </div>
    );
  }
  if (isTaskManagerRoute) {
    return <TaskManagerRoot route={route} />;
  }

  // IMPL_PLAN_SH32 §2 C: `#/starforce/discovery` -- new route, own root
  // component, checked before `starforce` below (both are "not
  // isTaskManagerRoute" branches, order between them does not matter, but
  // this keeps the two visually paired). §4: "既存の #/starforce は1ピクセ
  // ルも変えない" -- the `starforce` branch right below is untouched.
  if (route.name === "starforceDiscovery") {
    return <DiscoveryRoot />;
  }

  // IMPL_PLAN_SH41 §2: `#/starforce/cube-prices` -- new route, own root
  // component, same "checked before the exact `starforce` match" placement
  // as `starforceDiscovery` above.
  if (route.name === "starforceCubePrices") {
    return <CubePricesRoot />;
  }

  // IMPL_PLAN_SH5 §1: `#/starforce` -- new route, own root component, does
  // not join isTaskManagerRoute (that flag is specifically the
  // dashboard/tasks/schedule trio's theme wiring above).
  if (route.name === "starforce") {
    return <SfHistoryRoot />;
  }

  if (loading) {
    return (
      <div className="site-theme ranking-root min-h-screen">
        <SiteHeader active="ranking" variant={siteHeaderVariant} theme={rankingTheme} onThemeChange={updateRankingTheme} />
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">{t("app.loading")}</div>
      </div>
    );
  }

  if (!characters.length) {
    return (
      <div className="site-theme ranking-root min-h-screen">
        <SiteHeader active="ranking" variant={siteHeaderVariant} theme={rankingTheme} onThemeChange={updateRankingTheme} />
        <main className="p-6 md:p-10">
        <div className="max-w-4xl mx-auto pt-12 md:pt-20">
          <h1 className="text-3xl md:text-5xl font-bold mb-5">{t("app.pageTitle")}</h1>
          <p className="max-w-2xl text-slate-300 leading-7">{t("app.pageDescription")}</p>
          <div className="mt-10 border-t border-slate-800 pt-6">
            {loadError ? (
              <>
                <p className="font-semibold">{t("app.loadErrorTitle")}</p>
                <p className="text-sm text-slate-400 mt-1">{t("app.loadErrorHint")}</p>
              </>
            ) : (
              <>
                <p className="font-semibold">{t("app.noDataTitle")}</p>
                <p className="text-sm text-slate-400 mt-1">{t("app.noDataHint")}</p>
              </>
            )}
          </div>
        </div>
        </main>
      </div>
    );
  }

  return (
    <div className="site-theme ranking-root min-h-screen overflow-x-hidden">
      <SiteHeader active="ranking" variant={siteHeaderVariant} theme={rankingTheme} onThemeChange={updateRankingTheme} />
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-2 md:px-8">
        <BoardHeader
          meta={meta}
          loadError={loadError}
          scheduledUpdateLabel={scheduledUpdateLabel}
          t={t}
        />

        {/* RankingListView stays mounted (even while hidden) so its local UI
            toggles (TOP3/filters) survive a round trip through the detail
            or group-compare routes (LULU-011b / T4b §22.4). */}
        <RankingListView active={route.name === "list"} />
        {route.name === "detail" ? <CharacterDetailView /> : null}
        {route.name === "group" ? <GroupCompareView /> : null}
      </div>
    </div>
  );
}
