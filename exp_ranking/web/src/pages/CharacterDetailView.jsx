import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import CharacterDetail from "../CharacterDetail";
import MyCharacterPinButton from "../components/MyCharacterPinButton";
import RankingControls from "../components/RankingControls";
import RankingTable from "../components/RankingTable";
import ShareLinkButton from "../components/ShareLinkButton";
import { useBoard } from "../board/BoardContext";
import { navigateToCharacter } from "../board/useHashRoute";

/**
 * Detail-expanded view (`#/character/:historyKey`). Screen composition
 * only; all data/derived values come from useBoard(). `showListWhenExpanded`
 * is local UI state here (LULU-011b): it naturally resets on every fresh
 * mount (i.e. every time the user navigates here from the list), matching
 * the pre-routing `expandDetail()` reset, and survives switching between
 * characters while already in this view (component instance is not
 * remounted, only the route's historyKey segment changes).
 */
export default function CharacterDetailView() {
  const {
    t,
    characters,
    rankingPool,
    gainRankMaps,
    expTable,
    isFavorite,
    toggleFavorite,
    setSelectedId,
    collapseDetail,
    detailTopRef,
    routeCharacter,
    notFound,
    rankingControlsTarget,
    setRankingControlsTarget,
    sortKey,
    setSortKey,
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
    rankingListTitle,
    favoritesOnly,
    setFavoritesOnly,
    favoriteCount,
    query,
    setQuery,
    displayCharacters,
    pagedCharacters,
    showGainRank,
    filteredGainRanks,
    safePage,
    totalPages,
    setPage,
    rangeFrom,
    rangeTo,
  } = useBoard();

  const [showListWhenExpanded, setShowListWhenExpanded] = useState(false);

  if (notFound) {
    return (
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-300">
        <p className="text-lg font-semibold">{t("route.notFoundTitle")}</p>
        <p className="text-sm text-slate-400">{t("route.notFoundHint")}</p>
        <Button
          type="button"
          variant="outline"
          className="border-slate-700 bg-slate-950"
          onClick={collapseDetail}
        >
          {t("route.backToList")}
        </Button>
      </div>
    );
  }

  if (!routeCharacter) {
    // Data not loaded yet (guarded by AppShell's `loading` screen in the
    // normal flow) or historyKey not resolved yet; render nothing rather
    // than crash.
    return null;
  }

  const historyReady = !routeCharacter.historyKey || Array.isArray(routeCharacter.history);

  // The in-detail character search (CharacterSearchPicker, rendered only in
  // expanded mode) must keep the URL as the single source of truth: switch
  // via a hash navigation when possible, otherwise fall back to selecting
  // by id only (deep-link unsupported for rows without historyKey, per T0
  // plan §4).
  const handleSwitchCharacter = (id) => {
    const target = characters.find((character) => character.id === id);
    if (target?.historyKey) {
      navigateToCharacter(target.historyKey);
    } else {
      setSelectedId(id);
    }
  };

  // §21.4: the mini ranking list rendered below (when expanded) uses the
  // same row-navigate contract as the main list — a row click goes
  // straight to that character's detail route, no-op without a
  // historyKey (no selection concept to fall back to here either).
  const handleRowNavigate = (character) => {
    if (character?.historyKey) {
      navigateToCharacter(character.historyKey);
    }
  };

  return (
    <>
      <div ref={detailTopRef} className="space-y-4">
        {/* §22.12/§22.13 #2: a large, clearly-visible "back to list" button
            up top, replacing the small header-embedded "collapse" control
            that used to live inside CharacterDetail.jsx (that file is
            never modified — decision A). Not passing `onCollapse` below
            hides CharacterDetail's own small collapse button (its
            `isExpanded && onCollapse` render gate). §22.13: filled
            (Button's default variant), not outline — the outline version
            blended into the near-black page background. */}
        <Button type="button" className="px-4 py-2.5 font-semibold" onClick={collapseDetail}>
          <ArrowLeft size={16} className="mr-2" />
          {t("route.backToList")}
        </Button>

        {historyReady ? (
          <CharacterDetail
            character={routeCharacter}
            characters={rankingPool.length ? rankingPool : characters}
            allCharacters={characters}
            gainRankMaps={gainRankMaps}
            expTable={expTable}
            isFavorite={isFavorite(routeCharacter)}
            onToggleFavorite={() => toggleFavorite(routeCharacter)}
            mode="expanded"
            onSelectCharacter={handleSwitchCharacter}
            pinControls={<MyCharacterPinButton character={routeCharacter} />}
            shareControls={<ShareLinkButton t={t} />}
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

      <RankingControls
        target={rankingControlsTarget}
        sortKey={sortKey}
        setSortKey={setSortKey}
        showFilterSection={false}
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

      {showListWhenExpanded ? (
        <RankingTable
          cardClassName=""
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
      ) : null}
    </>
  );
}
