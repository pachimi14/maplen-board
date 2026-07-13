import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import CharacterDetail from "./CharacterDetail";
import GroupPanel from "./GroupPanel";
import BoardHeader from "./components/BoardHeader";
import HighlightsSection from "./components/HighlightsSection";
import RankingControls from "./components/RankingControls";
import RankingTable from "./components/RankingTable";
import { useGainPeriodLabel, useTranslation } from "./i18n/I18nContext";
import { useFavorites } from "./useFavorites";
import { useGroups } from "./useGroups";
import { loadCharacterHistories } from "./historyData";
import { classifyJob, JOB_TAXONOMY } from "./jobCategories";
import {
  computeGainRankMaps,
  formatJobName,
  formatScheduledUpdateLabel,
  getGainAmount,
  matchesWorldFilter,
  WORLD_IDS,
} from "./rankingUtils";

const FALLBACK_EXP_TABLE = {
  225: 314754893173,
  226: 327345088899,
  227: 340438892454,
  228: 354056448150,
  229: 368218706074,
  230: 751166160390,
  231: 766189483595,
  232: 781513273265,
  233: 797143538730,
  234: 813086409503,
  235: 829348137691,
  236: 845935100443,
  237: 862853802451,
  238: 880110878499,
  239: 897713096067,
  240: 1813380454053,
  241: 1831514258591,
  242: 1849829401175,
  243: 1868327695184,
  244: 1887010972134,
  245: 1905881081854,
  246: 1924939892669,
  247: 1944189291594,
  248: 1963631184509,
  249: 1983267496351,
  250: 4006200342629,
  251: 4046262346055,
  252: 4086724969515,
  253: 4127592219210,
  254: 4168868141402,
  255: 4210556822816,
  256: 4252662391044,
  257: 4295189014954,
  258: 4338140905103,
  259: 4381522314154,
  260: 8850675074591,
  261: 8939181825336,
  262: 9028573643589,
  263: 9118859380024,
  264: 9210047973824,
  265: 9302148453562,
  266: 9395169938097,
  267: 9489121637477,
  268: 9584012853851,
  269: 9679852982389,
  270: 19553303024425,
  271: 19748836054669,
  272: 19946324415215,
  273: 20145787659367,
  274: 20347245535960,
};

const PAGE_SIZE = 20;

function parseExpTable(meta) {
  const table = meta?.expTable || {};
  const parsed = { ...FALLBACK_EXP_TABLE };
  for (const [level, value] of Object.entries(table)) {
    parsed[Number(level)] = Number(value);
  }
  return parsed;
}

export default function App() {
  const { t, translateAlliance, translateBranch } = useTranslation();
  const dailyPeriod = useGainPeriodLabel("daily");
  const weeklyPeriod = useGainPeriodLabel("weekly");
  const monthlyPeriod = useGainPeriodLabel("monthly");
  const periodLabels = {
    daily: dailyPeriod,
    weekly: weeklyPeriod,
    monthly: monthlyPeriod,
  };

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("daily");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(1);
  const [characters, setCharacters] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [worldFilter, setWorldFilter] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [jobAlliance, setJobAlliance] = useState("all");
  const [jobBranch, setJobBranch] = useState("all");
  const [minLevel, setMinLevel] = useState("225");
  const [gainFilterPeriod, setGainFilterPeriod] = useState("daily");
  const [minGainBillions, setMinGainBillions] = useState("");
  const [detailView, setDetailView] = useState("compact");
  const [groupView, setGroupView] = useState("compact");
  const [showListWhenExpanded, setShowListWhenExpanded] = useState(false);
  const [showHighlights, setShowHighlights] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [rankingControlsTarget, setRankingControlsTarget] = useState(null);
  const detailTopRef = useRef(null);
  const groupTopRef = useRef(null);
  const { favoriteCount, favorites, isFavorite, toggleFavorite } = useFavorites();
  const {
    groups,
    activeGroup,
    activeGroupId,
    setActiveGroupId,
    createGroup,
    deleteGroup,
    renameGroup,
    addMember,
    removeMember,
    addFavoritesToGroup,
    isInActiveGroup,
    toggleMemberInActiveGroup,
    maxMembers: maxGroupMembers,
  } = useGroups();

  const worldOptions = useMemo(() => {
    const fromMeta = Array.isArray(meta.worldIds) ? meta.worldIds : WORLD_IDS;
    return ["all", ...fromMeta];
  }, [meta.worldIds]);

  const jobOptions = useMemo(
    () =>
      [...new Set(characters.map((character) => formatJobName(character.job)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
    [characters],
  );

  const selectedJobAlliance = useMemo(
    () => JOB_TAXONOMY.find((entry) => entry.alliance === jobAlliance) ?? null,
    [jobAlliance],
  );

  const visibleJobBranches = jobAlliance === "冒険家"
    ? selectedJobAlliance?.branches ?? []
    : [];

  const visibleJobOptions = useMemo(() => {
    if (!selectedJobAlliance) {
      return [];
    }
    const jobs = jobAlliance === "冒険家"
      ? jobBranch === "all"
        ? selectedJobAlliance.branches.flatMap((entry) => entry.jobs)
        : selectedJobAlliance.branches.find((entry) => entry.branch === jobBranch)?.jobs ?? []
      : selectedJobAlliance.branches.flatMap((entry) => entry.jobs);
    return jobs.filter((job) => jobOptions.includes(job));
  }, [jobAlliance, jobBranch, jobOptions, selectedJobAlliance]);

  const groupDetailProps = {
    groups,
    activeGroup,
    activeGroupId,
    setActiveGroupId,
    createGroup,
    deleteGroup,
    renameGroup,
    addMember,
    removeMember,
    addFavoritesToGroup,
    isInActiveGroup,
    toggleMemberInActiveGroup,
    maxGroupMembers,
    favorites,
  };

  const scheduledUpdateLabel = useMemo(
    () => formatScheduledUpdateLabel(meta, t),
    [meta, t]
  );

  const rankingListTitle = useMemo(() => {
    if (sortKey === "rank") {
      return t("sort.levelRanking");
    }
    return t("sort.gainRanking", { period: periodLabels[sortKey] });
  }, [sortKey, t, periodLabels]);

  useEffect(() => {
    let cancelled = false;

    async function loadRankings() {
      try {
        const candidates = ["data/v2/rankings.json", "data/rankings.json"];
        let payload = null;
        let lastError = null;
        for (const candidate of candidates) {
          try {
            const response = await fetch(`${import.meta.env.BASE_URL}${candidate}`);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const parsed = await response.json();
            if (!Array.isArray(parsed?.characters)) {
              throw new Error("Invalid rankings payload");
            }
            payload = parsed;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!payload) {
          throw lastError || new Error("No ranking data available");
        }
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(payload.characters) ? payload.characters : [];
        setCharacters(rows);
        setMeta(payload.meta || {});
        if (rows.length > 0) {
          setSelectedId(rows[0].id);
        }
        setLoadError("");
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load ranking data", error);
          setLoadError("unavailable");
          setCharacters([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadRankings();
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureHistories = useCallback(
    async (targets) => {
      const pending = targets.filter(
        (character) => character?.historyKey && !Array.isArray(character.history),
      );
      if (!pending.length) {
        return;
      }
      try {
        const loaded = await loadCharacterHistories(import.meta.env.BASE_URL, meta, pending);
        if (!loaded.size) {
          return;
        }
        setCharacters((current) =>
          current.map((character) =>
            loaded.has(character.historyKey)
              ? { ...character, history: loaded.get(character.historyKey) }
              : character,
          ),
        );
      } catch (error) {
        console.error("Failed to load character history", error);
      }
    },
    [meta],
  );

  const expTable = useMemo(() => parseExpTable(meta), [meta]);

  const rankingPool = useMemo(() => {
    let pool = characters;
    if (worldFilter !== "all") {
      pool = pool.filter((character) => matchesWorldFilter(character, worldFilter));
    }
    if (jobAlliance !== "all") {
      pool = pool.filter((character) => {
        const category = classifyJob(formatJobName(character.job));
        return category?.alliance === jobAlliance
          && (jobAlliance !== "冒険家" || jobBranch === "all" || category.branch === jobBranch);
      });
    }
    if (jobFilter !== "all") {
      pool = pool.filter((character) => formatJobName(character.job) === jobFilter);
    }
    const parsedMinLevel = Number(minLevel || 225);
    if (Number.isFinite(parsedMinLevel)) {
      pool = pool.filter((character) => character.level >= parsedMinLevel);
    }
    const parsedMinGain = Number(String(minGainBillions).replace(/,/g, ""));
    if (minGainBillions !== "" && Number.isFinite(parsedMinGain) && parsedMinGain > 0) {
      pool = pool.filter(
        (character) => getGainAmount(character, gainFilterPeriod) >= parsedMinGain * 1_000_000_000,
      );
    }
    if (!favoritesOnly) {
      return pool;
    }
    return pool.filter((character) => isFavorite(character));
  }, [
    characters,
    favoritesOnly,
    gainFilterPeriod,
    isFavorite,
    jobAlliance,
    jobBranch,
    jobFilter,
    minGainBillions,
    minLevel,
    worldFilter,
  ]);

  const gainRankMaps = useMemo(() => computeGainRankMaps(characters), [characters]);

  const isLevelSort = sortKey === "rank";
  const showGainRank = !isLevelSort;

  const filteredCharacters = useMemo(() => {
    const lowerQuery = query.toLowerCase();
    return rankingPool.filter((character) => {
      return (
        character.name.toLowerCase().includes(lowerQuery) ||
        formatJobName(character.job).toLowerCase().includes(lowerQuery) ||
        (character.worldId || "").toLowerCase().includes(lowerQuery)
      );
    });
  }, [rankingPool, query]);

  const displayCharacters = useMemo(() => {
    return isLevelSort
      ? [...filteredCharacters].sort((a, b) => a.rank - b.rank)
      : [...filteredCharacters].sort(
          (a, b) => getGainAmount(b, sortKey) - getGainAmount(a, sortKey),
        );
  }, [filteredCharacters, isLevelSort, sortKey]);

  const filteredGainRanks = useMemo(
    () => new Map(displayCharacters.map((character, index) => [character.id, index + 1])),
    [displayCharacters],
  );

  useEffect(() => {
    setPage(1);
  }, [
    favoritesOnly,
    gainFilterPeriod,
    jobAlliance,
    jobBranch,
    jobFilter,
    minGainBillions,
    minLevel,
    query,
    sortKey,
    worldFilter,
  ]);

  useEffect(() => {
    if (favoritesOnly && selectedId && !rankingPool.some((c) => c.id === selectedId)) {
      if (rankingPool.length > 0) {
        setSelectedId(rankingPool[0].id);
      }
    }
  }, [favoritesOnly, rankingPool, selectedId]);

  const totalPages = Math.max(1, Math.ceil(displayCharacters.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagedCharacters = displayCharacters.slice(pageStart, pageStart + PAGE_SIZE);
  const rangeFrom = displayCharacters.length === 0 ? 0 : pageStart + 1;
  const rangeTo = displayCharacters.length === 0
    ? 0
    : Math.min(pageStart + PAGE_SIZE, displayCharacters.length);

  const selectedCharacter = useMemo(() => {
    const pool = favoritesOnly ? rankingPool : characters;
    if (!pool.length) {
      return null;
    }
    return pool.find((character) => character.id === selectedId) || pool[0];
  }, [characters, rankingPool, favoritesOnly, selectedId]);

  useEffect(() => {
    if (selectedCharacter) {
      ensureHistories([selectedCharacter]);
    }
  }, [ensureHistories, selectedCharacter]);

  useEffect(() => {
    if (!activeGroup?.members?.length) {
      return;
    }
    const memberKeys = new Set(activeGroup.members);
    ensureHistories(characters.filter((character) => memberKeys.has(character.name)));
  }, [activeGroup, characters, ensureHistories]);

  const selectedHistoryReady =
    !selectedCharacter?.historyKey || Array.isArray(selectedCharacter.history);

  const isExpandedDetail = detailView === "expanded";
  const isExpandedGroup = groupView === "expanded";
  const showRankingList = !isExpandedDetail || showListWhenExpanded;

  const expandDetail = () => {
    setDetailView("expanded");
    setShowListWhenExpanded(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const collapseDetail = () => {
    setDetailView("compact");
    setShowListWhenExpanded(false);
  };

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
    if (!isExpandedDetail || !detailTopRef.current) {
      return;
    }
    detailTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId, isExpandedDetail]);

  useEffect(() => {
    if (!isExpandedGroup || !groupTopRef.current) {
      return;
    }
    groupTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isExpandedGroup]);

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
          {isExpandedDetail && selectedCharacter ? (
            <div ref={detailTopRef} className="space-y-4">
              {selectedHistoryReady ? <CharacterDetail
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
              /> : (
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
                  {showListWhenExpanded
                    ? t("characterDetail.hideList")
                    : t("characterDetail.showList")}
                </Button>
              </div>
            </div>
          ) : null}

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
                {selectedHistoryReady ? <CharacterDetail
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
                /> : (
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
        </div>
      </div>
    </div>
  );
}
