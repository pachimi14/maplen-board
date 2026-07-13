import { Button } from "@/components/ui/button";
import CharacterDetail from "../CharacterDetail";
import { useBoard } from "../board/BoardContext";

/**
 * Detail-expanded view (screen composition only; all data/derived values
 * come from useBoard()). Pre-routing (T0 commit 3): visibility is still
 * driven by the shared `isExpandedDetail` board state. The ranking table
 * (shown/hidden via `showListWhenExpanded`) is composed by RankingListView,
 * which already reproduces the `isExpandedDetail` ternary from the
 * original App.jsx so DOM order stays identical.
 */
export default function CharacterDetailView() {
  const {
    t,
    isExpandedDetail,
    selectedCharacter,
    selectedHistoryReady,
    rankingPool,
    characters,
    gainRankMaps,
    expTable,
    isFavorite,
    toggleFavorite,
    collapseDetail,
    setSelectedId,
    showListWhenExpanded,
    setShowListWhenExpanded,
    detailTopRef,
  } = useBoard();

  if (!isExpandedDetail || !selectedCharacter) {
    return null;
  }

  return (
    <div ref={detailTopRef} className="space-y-4">
      {selectedHistoryReady ? (
        <CharacterDetail
          character={selectedCharacter}
          characters={rankingPool.length ? rankingPool : characters}
          allCharacters={characters}
          gainRankMaps={gainRankMaps}
          expTable={expTable}
          isFavorite={isFavorite(selectedCharacter)}
          onToggleFavorite={() => toggleFavorite(selectedCharacter)}
          mode="expanded"
          onCollapse={collapseDetail}
          onSelectCharacter={setSelectedId}
        />
      ) : (
        <div className="min-h-48 flex items-center justify-center text-slate-400">
          {t("app.loading")}
        </div>
      )}
      <div className="flex justify-center">
        <Button
          type="button"
          variant="outline"
          className="border-slate-700 bg-slate-950"
          onClick={() => setShowListWhenExpanded((current) => !current)}
        >
          {showListWhenExpanded ? t("characterDetail.hideList") : t("characterDetail.showList")}
        </Button>
      </div>
    </div>
  );
}
