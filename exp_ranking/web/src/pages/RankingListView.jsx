import { useCallback, useMemo, useRef, useState } from "react";
import GroupPanel from "../GroupPanel";
import HighlightsSection from "../components/HighlightsSection";
import MyCharacterSummary from "../components/MyCharacterSummary";
import RankingControls from "../components/RankingControls";
import RankingTable from "../components/RankingTable";
import { useBoard } from "../board/BoardContext";
import { navigateToCharacter } from "../board/useHashRoute";
import { useProfile } from "../profile/ProfileContext";

/**
 * List view (`#/`). Screen composition only; all data/derived values come
 * from useBoard(). TOP3 open/close and filters open/close are local UI
 * state here (LULU-011b: not routed).
 *
 * `active` controls whether this view is currently shown. It stays
 * mounted (rendering null while inactive) so its local UI state survives
 * a round trip through the detail route (`#/character/:historyKey`),
 * exactly like the pre-routing App.jsx never unmounted these toggles.
 *
 * IMPL_PLAN_T4B §21.4: there is no more compact sidebar / row-selection
 * concept in the list — a row (table or TOP3) click navigates straight to
 * the character's detail route. `selectedId` stays in the board hook
 * (still used by the detail route), it's just not read/written here.
 */
export default function RankingListView({ active }) {
  const {
    t,
    characters,
    meta,
    rankingPool,
    gainRankMaps,
    expTable,
    ensureHistories,
    isFavorite,
    toggleFavorite,
    groupDetailProps,
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
  const { primaryHistoryKey } = useProfile();

  const [showHighlights, setShowHighlights] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  // §21.3: lets the user click through group-member chips to switch which
  // character the group panel is anchored on (add/remove-from-group button,
  // "current" highlight) without leaving the list. Reset whenever the
  // panel closes so reopening always starts from the primary/fallback
  // anchor rather than a stale pick from a previous session.
  const [groupAnchorId, setGroupAnchorId] = useState(null);

  const toggleGroup = useCallback(() => {
    setGroupOpen((current) => {
      const next = !current;
      if (!next) {
        setGroupAnchorId(null);
      }
      return next;
    });
  }, []);

  // §21.3: GroupPanel requires a `character` anchor to render at all. Order:
  // explicit in-panel override -> primary my-character (profile) -> top of
  // the (filtered) ranking pool -> first loaded character -> null (panel
  // stays hidden rather than crashing on an empty roster).
  const groupAnchorCharacter = useMemo(() => {
    if (groupAnchorId != null) {
      const overridden = characters.find((character) => character.id === groupAnchorId);
      if (overridden) {
        return overridden;
      }
    }
    if (primaryHistoryKey) {
      const primary = characters.find((character) => character.historyKey === primaryHistoryKey);
      if (primary) {
        return primary;
      }
    }
    return rankingPool[0] ?? characters[0] ?? null;
  }, [groupAnchorId, primaryHistoryKey, characters, rankingPool]);

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

  const groupPanel = groupOpen && groupAnchorCharacter ? (
    <GroupPanel
      character={groupAnchorCharacter}
      characters={characters}
      mode="expanded"
      onCollapse={toggleGroup}
      onSelectCharacter={setGroupAnchorId}
      {...groupDetailProps}
    />
  ) : null;

  return (
    // §21.5: one CSS grid, one MyCharacterSummary instance. DOM order
    // (TOP3 -> my character -> operations/filters/group panel/list, all
    // inside the two blocks below) matches the required mobile stacking
    // order unassisted (no template-areas at the default/mobile
    // breakpoint, so items simply flow top-to-bottom in source order).
    // From `lg:` up, named grid areas move the my-character block into a
    // sticky right column without duplicating it.
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
          groupOpen={groupOpen}
          onToggleGroup={toggleGroup}
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
          groupPanel={groupPanel}
        />
      </div>
    </div>
  );
}
