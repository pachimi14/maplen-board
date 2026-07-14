import { BoardProvider, useBoard } from "./board/BoardContext";
import { ProfileProvider } from "./profile/ProfileContext";
import BoardHeader from "./components/BoardHeader";
import RankingListView from "./pages/RankingListView";
import CharacterDetailView from "./pages/CharacterDetailView";
import GroupCompareView from "./pages/GroupCompareView";

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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        {t("app.loading")}
      </div>
    );
  }

  if (!characters.length) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
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
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
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
