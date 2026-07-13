import { Card, CardContent } from "@/components/ui/card";
import { Star } from "lucide-react";
import CharacterDetail from "../CharacterDetail";
import GroupPanel from "../GroupPanel";
import RankingTable from "../components/RankingTable";
import { useBoard } from "../board/BoardContext";

/**
 * List / group-comparison view (screen composition only; all data/derived
 * values come from useBoard()). Pre-routing (T0 commit 3): still reads
 * `isExpandedDetail` from the shared board state to reproduce the exact
 * original conditional layout (table alone vs. table + compact sidebar).
 */
export default function RankingListView() {
  const {
    t,
    isExpandedDetail,
    isExpandedGroup,
    selectedCharacter,
    selectedHistoryReady,
    characters,
    rankingPool,
    gainRankMaps,
    expTable,
    isFavorite,
    toggleFavorite,
    setSelectedId,
    groupTopRef,
    collapseGroup,
    expandGroup,
    expandDetail,
    groupDetailProps,
    showRankingList,
    rankingListTitle,
    favoritesOnly,
    setFavoritesOnly,
    favoriteCount,
    query,
    setQuery,
    setRankingControlsTarget,
    displayCharacters,
    pagedCharacters,
    showGainRank,
    filteredGainRanks,
    selectedId,
    sortKey,
    safePage,
    totalPages,
    setPage,
    rangeFrom,
    rangeTo,
  } = useBoard();

  return (
    <>
      {isExpandedGroup && selectedCharacter ? (
        <div ref={groupTopRef} className="space-y-4">
          <GroupPanel
            character={selectedCharacter}
            characters={characters}
            mode="expanded"
            onCollapse={collapseGroup}
            onSelectCharacter={setSelectedId}
            {...groupDetailProps}
          />
        </div>
      ) : null}

      {showRankingList ? (
        <div
          className={
            isExpandedDetail
              ? "space-y-6"
              : "grid grid-cols-1 xl:grid-cols-3 gap-6 xl:items-start"
          }
        >
          <RankingTable
            cardClassName={isExpandedDetail ? "" : "xl:col-span-2"}
            title={rankingListTitle}
            favoritesOnly={favoritesOnly}
            onToggleFavoritesOnly={() => setFavoritesOnly((current) => !current)}
            favoriteCount={favoriteCount}
            query={query}
            onQueryChange={setQuery}
            setRankingControlsTarget={setRankingControlsTarget}
            total={displayCharacters.length}
            pagedCharacters={pagedCharacters}
            showGainRank={showGainRank}
            filteredGainRanks={filteredGainRanks}
            selectedId={selectedId}
            onSelectCharacter={setSelectedId}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            sortKey={sortKey}
            safePage={safePage}
            totalPages={totalPages}
            onPrevPage={() => setPage((current) => Math.max(1, current - 1))}
            onNextPage={() => setPage((current) => Math.min(totalPages, current + 1))}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            t={t}
          />

          {!isExpandedDetail ? (
            selectedCharacter ? (
              <div className="xl:col-span-1 min-w-0 space-y-6">
                {selectedHistoryReady ? (
                  <CharacterDetail
                    character={selectedCharacter}
                    characters={rankingPool.length ? rankingPool : characters}
                    allCharacters={characters}
                    gainRankMaps={gainRankMaps}
                    expTable={expTable}
                    isFavorite={isFavorite(selectedCharacter)}
                    onToggleFavorite={() => toggleFavorite(selectedCharacter)}
                    mode="compact"
                    onExpand={expandDetail}
                    onSelectCharacter={setSelectedId}
                  />
                ) : (
                  <div className="min-h-48 flex items-center justify-center text-slate-400">
                    {t("app.loading")}
                  </div>
                )}
                {!isExpandedGroup ? (
                  <GroupPanel
                    character={selectedCharacter}
                    characters={characters}
                    mode="compact"
                    onExpand={expandGroup}
                    onSelectCharacter={setSelectedId}
                    {...groupDetailProps}
                  />
                ) : null}
              </div>
            ) : (
              <Card className="xl:col-span-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl">
                <CardContent className="p-8 text-center text-slate-400">
                  <Star size={32} className="mx-auto mb-3 text-amber-400/60" />
                  <p>{t("favorite.emptyDetail")}</p>
                  <p className="text-sm mt-2">{t("favorite.emptyDetailHint")}</p>
                </CardContent>
              </Card>
            )
          ) : null}
        </div>
      ) : null}
    </>
  );
}
