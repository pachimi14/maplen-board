import { useCallback, useRef, useState } from "react";
import HighlightsSection from "../components/HighlightsSection";
import MyCharacterSummary from "../components/MyCharacterSummary";
import RankingControls from "../components/RankingControls";
import RankingTable from "../components/RankingTable";
import { useBoard } from "../board/BoardContext";
import { navigateToCharacter, navigateToGroup } from "../board/useHashRoute";

/**
 * List view (`#/`). Screen composition only; all data/derived values come
 * from useBoard(). TOP3 open/close and filters open/close are local UI
 * state here (LULU-011b: not routed).
 *
 * `active` controls whether this view is currently shown. It stays
 * mounted (rendering null while inactive) so its local UI state survives
 * a round trip through the detail or group-compare routes
 * (`#/character/:historyKey`, `#/group`), exactly like the pre-routing
 * App.jsx never unmounted these toggles.
 *
 * IMPL_PLAN_T4B §21.4: there is no more compact sidebar / row-selection
 * concept in the list — a row (table or TOP3) click navigates straight to
 * the character's detail route. `selectedId` stays in the board hook
 * (still used by the detail route), it's just not read/written here.
 *
 * §22.4 (decision C): the inline group panel is gone — "グループ比較"
 * navigates to the dedicated `#/group` route instead of toggling a
 * same-page panel (GroupPanel.jsx has been removed; see
 * pages/GroupCompareView.jsx).
 */
export default function RankingListView({ active }) {
  const {
    t,
    characters,
    meta,
    gainRankMaps,
    expTable,
    ensureHistories,
    isFavorite,
    toggleFavorite,
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

  // §21.4: a row click (table or TOP3) navigates directly to the
  // character's detail route via its historyKey; rows without a
  // historyKey are a no-op (no crash, no dead selection state).
  const handleRowNavigate = useCallback((character) => {
    if (character?.historyKey) {
      navigateToCharacter(character.historyKey);
    }
  }, []);

  if (!active) {
    return null;
  }

  return (
    // §21.5/§22.4: one CSS grid, one MyCharacterSummary instance. DOM order
    // (TOP3 -> my character -> operations/filters/list, all inside the two
    // blocks below) matches the required mobile stacking order unassisted
    // (no template-areas at the default/mobile breakpoint, so items simply
    // flow top-to-bottom in source order). From `lg:` up, named grid areas
    // move the my-character block into a sticky right column without
    // duplicating it. The group panel is no longer part of this grid at
    // all (§22.4): "グループ比較" navigates to the dedicated `#/group`
    // route instead.
    <div
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:items-start lg:[grid-template-areas:'top3_mychar'_'list_mychar']"
    >
      <div className="lg:[grid-area:top3]">
        <HighlightsSection
          characters={characters}
          gainRankMaps={gainRankMaps}
          onSelectCharacter={handleRowNavigate}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          showHighlights={showHighlights}
          onToggle={() => setShowHighlights((current) => !current)}
          t={t}
        />
      </div>

      <div className="lg:[grid-area:mychar] lg:sticky lg:top-6 lg:self-start">
        <MyCharacterSummary
          characters={characters}
          meta={meta}
          expTable={expTable}
          ensureHistories={ensureHistories}
          onFocusSearch={focusSearch}
          t={t}
        />
      </div>

      <div className="space-y-6 lg:[grid-area:list]">
        <RankingControls
          target={rankingControlsTarget}
          sortKey={sortKey}
          setSortKey={setSortKey}
          showFilterSection
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          onOpenGroup={() => navigateToGroup()}
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

        <RankingTable
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
          onRowNavigate={handleRowNavigate}
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
      </div>
    </div>
  );
}
