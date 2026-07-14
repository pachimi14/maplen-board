import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Star } from "lucide-react";
import CharacterDetail from "../CharacterDetail";
import GroupPanel from "../GroupPanel";
import HighlightsSection from "../components/HighlightsSection";
import MyCharacterPinButton from "../components/MyCharacterPinButton";
import MyCharacterSummary from "../components/MyCharacterSummary";
import RankingControls from "../components/RankingControls";
import RankingTable from "../components/RankingTable";
import { useBoard } from "../board/BoardContext";

/**
 * List / group-comparison view (`#/`). Screen composition only; all
 * data/derived values come from useBoard(). TOP3 open/close, filters
 * open/close and the group-compare expand/collapse are local UI state
 * here (LULU-011b: not routed).
 *
 * `active` controls whether this view is currently shown. It stays
 * mounted (rendering null while inactive) so its local UI state survives
 * a round trip through the detail route (`#/character/:historyKey`),
 * exactly like the pre-routing App.jsx never unmounted these toggles.
 */
export default function RankingListView({ active }) {
  const {
    t,
    selectedCharacter,
    selectedHistoryReady,
    characters,
    meta,
    rankingPool,
    gainRankMaps,
    expTable,
    ensureHistories,
    isFavorite,
    toggleFavorite,
    setSelectedId,
    groupDetailProps,
    expandDetail,
    rankingListTitle,
    favoritesOnly,
    setFavoritesOnly,
    favoriteCount,
    query,
    setQuery,
    rankingControlsTarget,
    setRankingControlsTarget,
    displayCharacters,
    pagedCharacters,
    showGainRank,
    filteredGainRanks,
    selectedId,
    sortKey,
    setSortKey,
    safePage,
    totalPages,
    setPage,
    rangeFrom,
    rangeTo,
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
  } = useBoard();

  const [showHighlights, setShowHighlights] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [groupView, setGroupView] = useState("compact");
  const groupTopRef = useRef(null);
  const isExpandedGroup = groupView === "expanded";

  // Ref owner for the search input (T4b §3/§20-6): the empty-CTA in
  // MyCharacterSummary asks this view to focus the existing search box
  // rather than owning any search state itself.
  const searchInputRef = useRef(null);
  const focusSearch = useCallback(() => {
    const el = searchInputRef.current;
    if (!el) {
      return;
    }
    const prefersReducedMotion =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    el.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, []);

  const expandGroup = () => {
    setGroupView("expanded");
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const collapseGroup = () => {
    setGroupView("compact");
  };

  useEffect(() => {
    if (!isExpandedGroup || !groupTopRef.current) {
      return;
    }
    groupTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isExpandedGroup]);

  if (!active) {
    return null;
  }

  return (
    <>
      <MyCharacterSummary
        characters={characters}
        meta={meta}
        expTable={expTable}
        ensureHistories={ensureHistories}
        onFocusSearch={focusSearch}
        t={t}
      />

      {!isExpandedGroup ? (
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
        showFilterSection
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 xl:items-start">
        <RankingTable
          cardClassName="xl:col-span-2"
          searchInputRef={searchInputRef}
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

        {selectedCharacter ? (
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
                pinControls={<MyCharacterPinButton character={selectedCharacter} />}
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
        )}
      </div>
    </>
  );
}
