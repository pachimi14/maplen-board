import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, RotateCcw, Search, Star } from "lucide-react";
import CharacterDetail from "./CharacterDetail";
import GroupPanel from "./GroupPanel";
import FavoriteStar from "./FavoriteStar";
import TopGainHighlights from "./TopGainHighlights";
import LanguageSwitcher from "./LanguageSwitcher";
import { useGainPeriodLabel, useTranslation } from "./i18n/I18nContext";
import { useFavorites } from "./useFavorites";
import { useGroups } from "./useGroups";
import NavigatorLink from "./NavigatorLink";
import { loadCharacterHistories } from "./historyData";
import { classifyJob, JOB_TAXONOMY } from "./jobCategories";
import {
  computeGainRankMaps,
  formatExp,
  formatJobName,
  formatLevelExp,
  formatScheduledUpdateLabel,
  gainRankClass,
  getGainAmount,
  getNavigatorUrl,
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

const SORT_OPTIONS = [
  { key: "rank", labelKey: "sort.levelRank" },
  { key: "daily", labelKey: "period.dailyShort" },
  { key: "weekly", labelKey: "period.weeklyShort" },
  { key: "monthly", labelKey: "period.monthlyShort" },
];

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
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-slate-400">Lulumi Tools</p>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight">MapleN Exp Ranking</h1>
            {meta.demoGains ? (
              <p className="text-amber-300 text-sm mt-1">
                {t("app.demoGains", { days: meta.demoGainDays || "?" })}
              </p>
            ) : null}
            {loadError ? <p className="text-amber-400 text-sm mt-1">{loadError}</p> : null}
          </div>
          <div className="text-right md:pb-1 shrink-0 space-y-2">
            <LanguageSwitcher />
            <div className="space-y-0.5">
              <p className="text-xs md:text-sm text-slate-500">
                {meta.rankingMinLevel
                  ? `Lv.${meta.rankingMinLevel}+`
                  : meta.rankingTopN
                    ? t("app.fetchedCount", { count: meta.rankingTopN })
                    : null}
              </p>
              {scheduledUpdateLabel ? (
                <p className="text-slate-400 text-sm md:text-base">{scheduledUpdateLabel}</p>
              ) : null}
            </div>
          </div>
        </div>

        {!isExpandedDetail && !isExpandedGroup ? (
          <section className="overflow-hidden rounded-md border border-slate-800">
            <button
              type="button"
              aria-expanded={showHighlights}
              onClick={() => setShowHighlights((current) => !current)}
              className="flex w-full items-center justify-between bg-slate-900/70 px-3 py-2 text-left transition hover:bg-slate-900"
            >
              <h2 className="text-sm font-semibold text-slate-200">TOP3</h2>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <span className="hidden sm:inline">{t(showHighlights ? "filter.clickToCollapse" : "filter.clickToExpand")}</span>
                {showHighlights ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
              </span>
            </button>
            {showHighlights ? (
              <div className="border-t border-slate-800 p-2">
                <TopGainHighlights
                  characters={characters}
                  gainRankMaps={gainRankMaps}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  isFavorite={isFavorite}
                  onToggleFavorite={toggleFavorite}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {rankingControlsTarget ? createPortal((<>
        <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/30 p-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-slate-500">{t("filter.sort")}</span>
            {SORT_OPTIONS.map((option) => (
              <Button key={option.key} type="button" size="sm" variant={sortKey === option.key ? "default" : "outline"} className="h-8 border-slate-700" onClick={() => setSortKey(option.key)}>
                {t(option.labelKey)}
              </Button>
            ))}
          </div>
        </div>

        {!isExpandedDetail ? (
        <div className="overflow-hidden rounded-md border border-slate-800">
          <button
            type="button"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((current) => !current)}
            className="flex w-full items-center justify-between bg-slate-900/70 px-3 py-2 text-left transition hover:bg-slate-900"
          >
            <h2 className="text-sm font-semibold text-slate-200">{t("filter.title")}</h2>
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <span className="hidden sm:inline">{t(showFilters ? "filter.clickToCollapse" : "filter.clickToExpand")}</span>
              {showFilters ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
            </span>
          </button>
          {showFilters ? (
          <div className="divide-y divide-slate-800 border-t border-slate-800">
            <div className="bg-slate-900/20 p-2">
              <div className="space-y-1.5">
                <span className="block text-xs text-slate-400">{t("filter.server")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {worldOptions.map((world) => (
                    <Button key={world} type="button" size="sm" variant={worldFilter === world ? "default" : "outline"} className="h-8 border-slate-700" onClick={() => setWorldFilter(world)}>
                      {world === "all" ? t("view.allServers") : world}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1.5 p-2">
              <span className="text-xs text-slate-400">{t("filter.job")}</span>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant={jobAlliance === "all" ? "default" : "outline"} className="border-slate-700" onClick={() => { setJobAlliance("all"); setJobFilter("all"); }}>
                  {t("filter.allJobs")}
                </Button>
                {JOB_TAXONOMY.map(({ alliance }) => (
                  <Button key={alliance} type="button" size="sm" variant={jobAlliance === alliance ? "default" : "outline"} className="border-slate-700" onClick={() => { setJobAlliance(alliance); setJobFilter("all"); if (alliance === "冒険家") setJobBranch("all"); }}>
                    {translateAlliance(alliance)}
                  </Button>
                ))}
              </div>
              {visibleJobBranches.length ? (
                <div className="flex flex-wrap gap-1.5 border-l-2 border-slate-700 pl-2">
                  <Button type="button" size="sm" variant={jobBranch === "all" ? "secondary" : "outline"} className="border-slate-700" onClick={() => { setJobBranch("all"); setJobFilter("all"); }}>
                    {t("filter.allJobs")}
                  </Button>
                  {visibleJobBranches.map(({ branch }) => (
                    <Button key={branch} type="button" size="sm" variant={jobBranch === branch ? "secondary" : "outline"} className="border-slate-700" onClick={() => { setJobBranch(branch); setJobFilter("all"); }}>
                      {translateBranch(branch)}
                    </Button>
                  ))}
                </div>
              ) : null}
              {visibleJobOptions.length && !(jobAlliance === "冒険家" && jobBranch === "all") ? (
                <div className="flex flex-wrap gap-1.5 border-l-2 border-cyan-700/60 pl-2">
                  {visibleJobOptions.map((job) => (
                    <Button key={job} type="button" size="sm" variant={jobFilter === job ? "default" : "outline"} className="border-slate-700" onClick={() => setJobFilter(job)}>
                      {job}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2 bg-slate-900/30 p-2">
              <label className="mr-2 block w-48 text-xs text-slate-400">
                <span className="mb-1 block">{t("filter.minLevel")}</span>
                <Input type="number" min="225" value={minLevel} onChange={(event) => setMinLevel(event.target.value)} onBlur={() => { if (minLevel === "") setMinLevel("225"); }} className="h-8 bg-slate-900 border-slate-700" />
              </label>
              <div className="space-y-1">
                <span className="block text-xs text-slate-400">{t("filter.minGain")}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {["daily", "weekly", "monthly"].map((period) => (
                    <Button key={period} type="button" size="sm" variant={gainFilterPeriod === period ? "default" : "outline"} className="border-slate-700" onClick={() => setGainFilterPeriod(period)}>
                      {periodLabels[period]}
                    </Button>
                  ))}
                  <Input inputMode="decimal" value={minGainBillions} onChange={(event) => setMinGainBillions(event.target.value)} placeholder="0 B" className="h-8 w-32 bg-slate-900 border-slate-700" />
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto flex h-8 shrink-0 flex-row items-center gap-1.5 whitespace-nowrap border-slate-700 bg-transparent px-3 text-slate-300 hover:bg-slate-800 hover:text-white"
                aria-label={t("filter.reset")}
                title={t("filter.reset")}
                onClick={() => {
                  setWorldFilter("all");
                  setJobFilter("all");
                  setJobAlliance("all");
                  setJobBranch("all");
                  setMinLevel("225");
                  setGainFilterPeriod("daily");
                  setMinGainBillions("");
                }}
              >
                <RotateCcw size={15} className="shrink-0" />
                {t("filter.reset")}
              </Button>
            </div>
          </div>
          ) : null}
        </div>
        ) : null}
        </>), rankingControlsTarget) : null}

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
          <Card
            className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-xl ${
              isExpandedDetail ? "" : "xl:col-span-2"
            }`}
          >
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <h2 className="text-xl font-bold">{rankingListTitle}</h2>
                <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                  <Button
                    type="button"
                    variant={favoritesOnly ? "default" : "outline"}
                    className={
                      favoritesOnly
                        ? "bg-amber-600 hover:bg-amber-500 text-white border-amber-500"
                        : "border-slate-700 bg-slate-950"
                    }
                    onClick={() => setFavoritesOnly((current) => !current)}
                    disabled={favoriteCount === 0 && !favoritesOnly}
                  >
                    <Star
                      size={16}
                      className={`mr-2 inline ${favoritesOnly ? "fill-current" : ""}`}
                    />
                    {t("favorite.only")}
                    {favoriteCount > 0 ? ` (${favoriteCount})` : ""}
                  </Button>
                  <div className="relative w-full md:w-72">
                    <Search className="absolute left-3 top-2.5 text-slate-500" size={18} />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("search.character")}
                      className="pl-10 bg-slate-950 border-slate-800 text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <div ref={setRankingControlsTarget} className="space-y-2" />

              {favoritesOnly && displayCharacters.length === 0 ? (
                <p className="text-sm text-amber-300/90 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
                  {t("favorite.emptyList")}
                </p>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-slate-400">
                <span>
                  {favoritesOnly ? t("pagination.favoritesPrefix") : ""}
                  {t("pagination.range", {
                    total: displayCharacters.length.toLocaleString(),
                    from:
                      displayCharacters.length === 0
                        ? 0
                        : pageStart + 1,
                    to:
                      displayCharacters.length === 0
                        ? 0
                        : Math.min(pageStart + PAGE_SIZE, displayCharacters.length),
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="border-slate-700 bg-slate-950"
                    disabled={safePage <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    {t("pagination.prev")}
                  </Button>
                  <span>
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    className="border-slate-700 bg-slate-950"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  >
                    {t("pagination.next")}
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full min-w-[720px] text-base">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      <th className="text-center p-3 w-12">
                        <Star size={14} className="inline text-amber-400/80" />
                      </th>
                      {showGainRank ? (
                        <th className="text-left p-3">{t("table.gainRank")}</th>
                      ) : null}
                      <th className="text-left p-3">{t("table.levelRank")}</th>
                      <th className="text-left p-3">{t("table.character")}</th>
                      <th className="text-left p-3">{t("table.server")}</th>
                      <th className="text-right p-3 whitespace-nowrap">{t("table.lvExp")}</th>
                      <th className="text-right p-3">{t("table.daily")}</th>
                      <th className="text-right p-3">{t("table.weekly")}</th>
                      <th className="text-right p-3">{t("table.monthly")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedCharacters.map((character) => (
                      <tr
                        key={character.id}
                        onClick={() => setSelectedId(character.id)}
                        className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/70 ${
                          selectedId === character.id ? "bg-slate-800" : ""
                        }`}
                      >
                        <td className="p-3 text-center">
                          <FavoriteStar
                            active={isFavorite(character)}
                            onToggle={() => toggleFavorite(character)}
                          />
                        </td>
                        {showGainRank ? (
                          <td
                            className={`p-3 font-bold ${gainRankClass(
                              filteredGainRanks.get(character.id)
                            )}`}
                          >
                            #{filteredGainRanks.get(character.id) ?? "-"}
                          </td>
                        ) : null}
                        <td className="p-3 font-bold text-slate-400">#{character.rank}</td>
                        <td className="p-3">
                          <div className="font-semibold">
                            <NavigatorLink
                              href={getNavigatorUrl(character)}
                              className="text-inherit hover:text-sky-300"
                            >
                              {character.name}
                            </NavigatorLink>
                          </div>
                          <div className="text-sm text-slate-400">{formatJobName(character.job)}</div>
                        </td>
                        <td className="p-3">
                          {character.worldId ? (
                            <NavigatorLink
                              href={getNavigatorUrl(character)}
                              className="text-sky-400 font-medium"
                            >
                              {character.worldId}
                            </NavigatorLink>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-medium whitespace-nowrap tabular-nums">
                          {formatLevelExp(character)}
                        </td>
                        <td
                          className={`p-3 text-right ${
                            sortKey === "daily" ? "text-emerald-400 font-semibold" : ""
                          }`}
                        >
                          +{formatExp(getGainAmount(character, "daily"))}
                        </td>
                        <td
                          className={`p-3 text-right ${
                            sortKey === "weekly"
                              ? "text-emerald-400 font-semibold"
                              : "text-slate-400"
                          }`}
                        >
                          +{formatExp(character.weeklyGain)}
                        </td>
                        <td
                          className={`p-3 text-right ${
                            sortKey === "monthly"
                              ? "text-emerald-400 font-semibold"
                              : "text-slate-400"
                          }`}
                        >
                          +{formatExp(character.monthlyGain)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

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
