import { useEffect } from "react";
import { BoardProvider, useBoard } from "./board/BoardContext";
import { ProfileProvider } from "./profile/ProfileContext";
import BoardHeader, { SiteHeader } from "./components/BoardHeader";
import RankingListView from "./pages/RankingListView";
import CharacterDetailView from "./pages/CharacterDetailView";
import GroupCompareView from "./pages/GroupCompareView";
import TaskManagerRoot from "./taskManager/TaskManagerRoot.jsx";
import { useDashboardStore } from "./taskManager/storage/useDashboardStore.js";

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
  const themeColor = dashboardStore.state.themeColor || "green";
  const themeDepth = dashboardStore.state.themeDepth || "standard";
  const siteHeaderVariant = themeDepth === "deep" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.dataset.themeColor = themeColor;
    document.documentElement.dataset.themeDepth = themeDepth;
  }, [themeColor, themeDepth]);

  if (route.name === "dashboard" || route.name === "tasks" || route.name === "schedule") {
    return <TaskManagerRoot route={route} />;
  }

  if (loading) {
    return (
      <div className="site-theme ranking-root min-h-screen">
        <SiteHeader active="ranking" variant={siteHeaderVariant} />
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">{t("app.loading")}</div>
      </div>
    );
  }

  if (!characters.length) {
    return (
      <div className="site-theme ranking-root min-h-screen">
        <SiteHeader active="ranking" variant={siteHeaderVariant} />
        <main className="p-6 md:p-10">
        <div className="max-w-4xl mx-auto pt-12 md:pt-20">
          <p className="text-sm text-slate-400 mb-2">Lulumi Tools</p>
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
      <SiteHeader active="ranking" variant={siteHeaderVariant} />
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
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
