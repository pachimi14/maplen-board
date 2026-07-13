import { BoardProvider, useBoard } from "./board/BoardContext";
import BoardHeader from "./components/BoardHeader";
import HighlightsSection from "./components/HighlightsSection";
import RankingControls from "./components/RankingControls";
import RankingListView from "./pages/RankingListView";
import CharacterDetailView from "./pages/CharacterDetailView";

export default function App() {
  return (
    <BoardProvider>
      <AppShell />
    </BoardProvider>
  );
}

function AppShell() {
  const board = useBoard();
  const {
    t,
    loading,
    characters,
    loadError,
    meta,
    scheduledUpdateLabel,
    isExpandedDetail,
    isExpandedGroup,
    selectedId,
    setSelectedId,
    gainRankMaps,
    isFavorite,
    toggleFavorite,
    showHighlights,
    setShowHighlights,
    rankingControlsTarget,
    sortKey,
    setSortKey,
    showFilters,
    setShowFilters,
    worldOptions,
    worldFilter,
    setWorldFilter,
    jobAlliance,
    setJobAlliance,
    jobBranch,
    setJobBranch,
    jobFilter,
    setJobFilter,
    visibleJobBranches,
    visibleJobOptions,
    minLevel,
    setMinLevel,
    gainFilterPeriod,
    setGainFilterPeriod,
    minGainBillions,
    setMinGainBillions,
    periodLabels,
    translateAlliance,
    translateBranch,
  } = board;

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
              <p className="text-sm text-slate-400">{t("app.updateNotice")}</p>
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

        {!isExpandedDetail && !isExpandedGroup ? (
          <HighlightsSection
            characters={characters}
            gainRankMaps={gainRankMaps}
            selectedId={selectedId}
            onSelect={setSelectedId}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            showHighlights={showHighlights}
            onToggle={() => setShowHighlights((current) => !current)}
            t={t}
          />
        ) : null}

        <RankingControls
          target={rankingControlsTarget}
          sortKey={sortKey}
          setSortKey={setSortKey}
          showFilterSection={!isExpandedDetail}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          worldOptions={worldOptions}
          worldFilter={worldFilter}
          setWorldFilter={setWorldFilter}
          jobAlliance={jobAlliance}
          setJobAlliance={setJobAlliance}
          jobBranch={jobBranch}
          setJobBranch={setJobBranch}
          jobFilter={jobFilter}
          setJobFilter={setJobFilter}
          visibleJobBranches={visibleJobBranches}
          visibleJobOptions={visibleJobOptions}
          minLevel={minLevel}
          setMinLevel={setMinLevel}
          gainFilterPeriod={gainFilterPeriod}
          setGainFilterPeriod={setGainFilterPeriod}
          minGainBillions={minGainBillions}
          setMinGainBillions={setMinGainBillions}
          periodLabels={periodLabels}
          t={t}
          translateAlliance={translateAlliance}
          translateBranch={translateBranch}
        />

        <div className="space-y-6">
          <CharacterDetailView />
          <RankingListView />
        </div>
      </div>
    </div>
  );
}
