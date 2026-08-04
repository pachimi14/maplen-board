import { useEffect, useState } from "react";
import { BoardProvider, useBoard } from "./board/BoardContext";
import { ProfileProvider } from "./profile/ProfileContext";
import BoardHeader, { SiteHeader } from "./components/BoardHeader";
import RankingListView from "./pages/RankingListView";
import CharacterDetailView from "./pages/CharacterDetailView";
import GroupCompareView from "./pages/GroupCompareView";
import TaskManagerRoot from "./taskManager/TaskManagerRoot.jsx";
import { useDashboardStore } from "./taskManager/storage/useDashboardStore.js";
import SfHistoryRoot from "./sfhistory/SfHistoryRoot.jsx";
const RANKING_THEME_STORAGE_KEY = "maplen-board-ranking-theme-v1";
const RANKING_THEME_DEFAULT = Object.freeze({ themeColor: "green", themeDepth: "deep" });
const RANKING_THEME_COLORS = new Set(["green", "blue", "purple", "orange"]);
const RANKING_THEME_DEPTHS = new Set(["light", "standard", "deep"]);

function normalizeRankingTheme(value) {
  return {
    themeColor: RANKING_THEME_COLORS.has(value?.themeColor) ? value.themeColor : RANKING_THEME_DEFAULT.themeColor,
    themeDepth: RANKING_THEME_DEPTHS.has(value?.themeDepth) ? value.themeDepth : RANKING_THEME_DEFAULT.themeDepth,
  };
}

function loadRankingTheme() {
  try {
    return normalizeRankingTheme(JSON.parse(window.localStorage.getItem(RANKING_THEME_STORAGE_KEY) || "null"));
  } catch {
    return { ...RANKING_THEME_DEFAULT };
  }
}

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
  const dashboardStore = useDashboardStore();
  const [rankingTheme, setRankingTheme] = useState(loadRankingTheme);
  const isTaskManagerRoute = route.name === "dashboard" || route.name === "tasks" || route.name === "schedule";
  const activeTheme = isTaskManagerRoute
    ? { themeColor: dashboardStore.state.themeColor || "green", themeDepth: dashboardStore.state.themeDepth || "deep" }
    : rankingTheme;
  const siteHeaderVariant = rankingTheme.themeDepth === "deep" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.dataset.themeColor = activeTheme.themeColor;
    document.documentElement.dataset.themeDepth = activeTheme.themeDepth;
  }, [activeTheme.themeColor, activeTheme.themeDepth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RANKING_THEME_STORAGE_KEY, JSON.stringify(rankingTheme));
    } catch {
      // Theme persistence is optional; the in-memory choice still applies.
    }
  }, [rankingTheme]);

  const updateRankingTheme = (nextTheme) => setRankingTheme(normalizeRankingTheme(nextTheme));

  if (isTaskManagerRoute) {
    return <TaskManagerRoot route={route} />;
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
