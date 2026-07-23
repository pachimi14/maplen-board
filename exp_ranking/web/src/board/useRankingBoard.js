import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGainPeriodLabel, useTranslation } from "../i18n/I18nContext";
import { useFavorites } from "../useFavorites";
import { useGroups } from "../useGroups";
import { loadCharacterHistories } from "../historyData";
import { classifyJob, JOB_TAXONOMY } from "../jobCategories";
import { applyRoute, navigateToCharacter, navigateToList, normalizeQuery } from "./useHashRoute";
import {
  computeGainRankMaps,
  formatJobName,
  formatScheduledUpdateLabel,
  getGainAmount,
  matchesWorldFilter,
  WORLD_IDS,
} from "../rankingUtils";

const FALLBACK_EXP_TABLE = {
  225: 251803914538,
  226: 261876071119,
  227: 272351113963,
  228: 283245158520,
  229: 294574964859,
  230: 600932928312,
  231: 612951586876,
  232: 625210618612,
  233: 637714830984,
  234: 650469127602,
  235: 663478510152,
  236: 676748080354,
  237: 690283041960,
  238: 704088702799,
  239: 718170476853,
  240: 1450704363242,
  241: 1465211406872,
  242: 1479863520940,
  243: 1494662156147,
  244: 1509608777707,
  245: 1524704865483,
  246: 1539951914135,
  247: 1555351433275,
  248: 1570904947607,
  249: 1586613997080,
  250: 3204960274103,
  251: 3237009876844,
  252: 3269379975612,
  253: 3302073775368,
  254: 3335094513121,
  255: 3368445458252,
  256: 3402129912835,
  257: 3436151211963,
  258: 3470512724082,
  259: 3505217851323,
  260: 7080540059672,
  261: 7151345460268,
  262: 7222858914871,
  263: 7295087504019,
  264: 7368038379059,
  265: 7441718762849,
  266: 7516135950477,
  267: 7591297309981,
  268: 7667210283080,
  269: 7743882385911,
  270: 15642642419540,
  271: 15799068843735,
  272: 15957059532172,
  273: 16116630127493,
  274: 16277796428768,
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

/**
 * Single source of truth for the ranking board: data fetch, filters, sort,
 * selection and derived values. Mirrors the previous App.jsx (lines 102-465)
 * verbatim (same hook order/deps) so behavior is unchanged (LULU-011 / T0),
 * except that the detail-expanded state is now derived from `route`
 * (hash routing, LULU-011b) instead of a local `detailView` state.
 *
 * `groupView`/`isExpandedGroup`, `showHighlights` and `showFilters` are
 * NOT part of this hook: per LULU-011(b) they are local UI state owned by
 * RankingListView (routing しない), and `showListWhenExpanded` is local to
 * CharacterDetailView.
 *
 * T2 (IMPL_PLAN_T2 §4): the reflected filters (sort/world/alliance/branch/
 * job/minLevel/gainPeriod/minGain/q/page) are no longer local `useState` —
 * they are derived directly from `route.query` (the URL is their single
 * source of truth). Each setter computes the next query and hands it to
 * `updateQuery()`, which merges it onto the current route via the
 * centralized `applyRoute()` from useHashRoute (push for discrete
 * controls, replace for free-text inputs and range corrections).
 * `favoritesOnly` and `selectedId` stay local (not part of the URL, T2 §2).
 */
export function useRankingBoard(route) {
  const { t, translateAlliance, translateBranch } = useTranslation();
  const dailyPeriod = useGainPeriodLabel("daily");
  const weeklyPeriod = useGainPeriodLabel("weekly");
  const monthlyPeriod = useGainPeriodLabel("monthly");
  const periodLabels = {
    daily: dailyPeriod,
    weekly: weeklyPeriod,
    monthly: monthlyPeriod,
  };

  // Reflected filters are derived from the URL (route.query), not local
  // state (IMPL_PLAN_T2 §4/§5 — URL is the single source of truth).
  const query = route.query.q;
  const sortKey = route.query.sort;
  const page = Number(route.query.page) || 1;
  const worldFilter = route.query.world;
  const jobFilter = route.query.job;
  const jobAlliance = route.query.alliance;
  const jobBranch = route.query.branch;
  const minLevel = route.query.minLevel;
  const gainFilterPeriod = route.query.gainPeriod;
  const minGainBillions = route.query.minGain;

  const [selectedId, setSelectedId] = useState(1);
  const [characters, setCharacters] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [favoritesOnly, setFavoritesOnlyState] = useState(false);
  const [rankingControlsTarget, setRankingControlsTarget] = useState(null);
  const detailTopRef = useRef(null);

  /**
   * Merges `partialQuery` onto the *current* route's query (list or
   * detail, whichever is active) and navigates there. Never touches a
   * stale snapshot: `applyRoute` resolves against the latest pending
   * route so several calls issued in the same tick (e.g. a "reset
   * filters" click that sets multiple fields) chain correctly and are
   * coalesced into a single history entry (IMPL_PLAN_T2 §5).
   */
  const updateQuery = useCallback((partialQuery, { replace = false } = {}) => {
    applyRoute(
      (base) => {
        const nextQuery = normalizeQuery({ ...base.query, ...partialQuery });
        return base.name === "detail"
          ? { name: "detail", historyKey: base.historyKey, query: nextQuery }
          : { name: "list", query: nextQuery };
      },
      { replace },
    );
  }, []);

  // Discrete controls (button clicks) push a history entry and reset
  // page to 1 when the value actually changes (IMPL_PLAN_T2 §7), mirroring
  // the previous `useEffect(() => setPage(1), [...])` reset list.
  const setSortKey = useCallback((value) => {
    if (String(route.query.sort) === String(value)) {
      return;
    }
    updateQuery({ sort: value, page: "1" }, { replace: false });
  }, [route.query.sort, updateQuery]);

  const setWorldFilter = useCallback((value) => {
    if (String(route.query.world) === String(value)) {
      return;
    }
    updateQuery({ world: value, page: "1" }, { replace: false });
  }, [route.query.world, updateQuery]);

  const setJobAlliance = useCallback((value) => {
    if (String(route.query.alliance) === String(value)) {
      return;
    }
    // branch/job cascade (§7) is applied structurally by normalizeQuery
    // inside updateQuery, so no separate reset call is needed here.
    updateQuery({ alliance: value, page: "1" }, { replace: false });
  }, [route.query.alliance, updateQuery]);

  const setJobBranch = useCallback((value) => {
    if (String(route.query.branch) === String(value)) {
      return;
    }
    updateQuery({ branch: value, page: "1" }, { replace: false });
  }, [route.query.branch, updateQuery]);

  const setJobFilter = useCallback((value) => {
    if (String(route.query.job) === String(value)) {
      return;
    }
    updateQuery({ job: value, page: "1" }, { replace: false });
  }, [route.query.job, updateQuery]);

  const setGainFilterPeriod = useCallback((value) => {
    if (String(route.query.gainPeriod) === String(value)) {
      return;
    }
    updateQuery({ gainPeriod: value, page: "1" }, { replace: false });
  }, [route.query.gainPeriod, updateQuery]);

  // Free-text inputs replace (no per-keystroke history entries) and also
  // reset page to 1, mirroring the previous reset-page effect.
  const setMinLevel = useCallback((value) => {
    updateQuery({ minLevel: value, page: "1" }, { replace: true });
  }, [updateQuery]);

  const setMinGainBillions = useCallback((value) => {
    updateQuery({ minGain: value, page: "1" }, { replace: true });
  }, [updateQuery]);

  const setQuery = useCallback((value) => {
    updateQuery({ q: value, page: "1" }, { replace: true });
  }, [updateQuery]);

  // Discrete page navigation (Prev/Next) pushes a history entry; range
  // corrections use `replace` (see the safePage effect below).
  const setPage = useCallback((updater) => {
    const currentPage = Number(route.query.page) || 1;
    const nextPage = typeof updater === "function" ? updater(currentPage) : Number(updater);
    const clamped = Number.isFinite(nextPage) && nextPage >= 1 ? Math.trunc(nextPage) : 1;
    updateQuery({ page: String(clamped) }, { replace: false });
  }, [route.query.page, updateQuery]);

  // `favoritesOnly` stays local (not part of the URL, T2 §2) but still
  // resets page to 1 on toggle, mirroring the previous behavior.
  const setFavoritesOnly = useCallback((updater) => {
    setFavoritesOnlyState(updater);
    updateQuery({ page: "1" }, { replace: false });
  }, [updateQuery]);
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
        const candidates = ["data/v2/rankings.json"];
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

  // (page reset to 1 on filter change is now performed per-setter above,
  // via updateQuery's `page: "1"` merge, since page is URL-derived rather
  // than local state — see IMPL_PLAN_T2 §7.)

  useEffect(() => {
    if (favoritesOnly && selectedId && !rankingPool.some((c) => c.id === selectedId)) {
      if (rankingPool.length > 0) {
        setSelectedId(rankingPool[0].id);
      }
    }
  }, [favoritesOnly, rankingPool, selectedId]);

  const totalPages = Math.max(1, Math.ceil(displayCharacters.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  // Correct an out-of-range `page` (e.g. a shared URL whose filters now
  // match fewer results) once the result count is known, so the URL —
  // and a link copied from it — reflects the page actually shown
  // (IMPL_PLAN_T2 §7). Rendering below always uses `safePage`, so this
  // never causes a flash of an empty page; and it never runs while
  // `loading` (result count not yet final), so it never wrongly forces
  // page back to 1 before data arrives.
  useEffect(() => {
    if (loading || page === safePage) {
      return;
    }
    updateQuery({ page: String(safePage) }, { replace: true });
  }, [loading, page, safePage, updateQuery]);

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

  // URL is the sole source of truth for the detail-expanded state (LULU-011b).
  const isExpandedDetail = route.name === "detail";

  const routeCharacter = isExpandedDetail
    ? characters.find((character) => character.historyKey === route.historyKey) ?? null
    : null;
  const notFound = isExpandedDetail && characters.length > 0 && !routeCharacter;

  // Keep the (internal, non-routed) selectedId in sync with the character
  // shown at `#/character/:historyKey`, so collapsing back to `#/` keeps
  // the same character selected in the compact sidebar (LULU-011b).
  useEffect(() => {
    if (!routeCharacter) {
      return;
    }
    setSelectedId((current) => (current === routeCharacter.id ? current : routeCharacter.id));
  }, [routeCharacter]);

  const expandDetail = () => {
    if (!selectedCharacter?.historyKey) {
      return;
    }
    navigateToCharacter(selectedCharacter.historyKey);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const collapseDetail = () => {
    navigateToList();
  };

  useEffect(() => {
    if (!isExpandedDetail || !detailTopRef.current) {
      return;
    }
    detailTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId, isExpandedDetail]);

  return {
    t,
    translateAlliance,
    translateBranch,
    periodLabels,

    query,
    setQuery,
    sortKey,
    setSortKey,
    page,
    setPage,
    selectedId,
    setSelectedId,
    characters,
    meta,
    loading,
    loadError,
    favoritesOnly,
    setFavoritesOnly,
    worldFilter,
    setWorldFilter,
    jobFilter,
    setJobFilter,
    jobAlliance,
    setJobAlliance,
    jobBranch,
    setJobBranch,
    minLevel,
    setMinLevel,
    gainFilterPeriod,
    setGainFilterPeriod,
    minGainBillions,
    setMinGainBillions,
    rankingControlsTarget,
    setRankingControlsTarget,
    detailTopRef,

    favoriteCount,
    favorites,
    isFavorite,
    toggleFavorite,

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

    worldOptions,
    visibleJobBranches,
    visibleJobOptions,
    groupDetailProps,
    scheduledUpdateLabel,
    rankingListTitle,

    expTable,
    rankingPool,
    gainRankMaps,
    ensureHistories,
    showGainRank,
    displayCharacters,
    filteredGainRanks,
    totalPages,
    safePage,
    pageStart,
    pagedCharacters,
    rangeFrom,
    rangeTo,

    selectedCharacter,
    selectedHistoryReady,

    isExpandedDetail,
    routeCharacter,
    notFound,
    expandDetail,
    collapseDetail,
  };
}
