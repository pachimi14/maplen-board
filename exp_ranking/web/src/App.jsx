import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Star } from "lucide-react";
import CharacterDetail from "./CharacterDetail";
import FavoriteStar from "./FavoriteStar";
import TopGainHighlights from "./TopGainHighlights";
import JobGainRankings from "./JobGainRankings";
import { useFavorites } from "./useFavorites";
import NavigatorLink from "./NavigatorLink";
import {
  computeGainRankMaps,
  formatExp,
  formatJobName,
  formatLevelExp,
  gainRankClass,
  GAIN_PERIOD_LABELS,
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
};

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { key: "rank", label: "レベル順位" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

function rankingListTitle(sortKey, gainRankView) {
  if (gainRankView === "byJob" && sortKey !== "rank") {
    return `${GAIN_PERIOD_LABELS[sortKey]} 増加量 — 職業別ランキング`;
  }
  if (sortKey === "rank") {
    return "レベル順位ランキング";
  }
  return `${GAIN_PERIOD_LABELS[sortKey]} 増加量ランキング`;
}

function parseExpTable(meta) {
  const table = meta?.expTable || {};
  const parsed = { ...FALLBACK_EXP_TABLE };
  for (const [level, value] of Object.entries(table)) {
    parsed[Number(level)] = Number(value);
  }
  return parsed;
}

export default function App() {
  const [query, setQuery] = useState("");
  const [gainRankView, setGainRankView] = useState("overall");
  const [expandedJob, setExpandedJob] = useState(null);
  const [sortKey, setSortKey] = useState("daily");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(1);
  const [characters, setCharacters] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [worldFilter, setWorldFilter] = useState("all");
  const { favoriteCount, isFavorite, toggleFavorite } = useFavorites();

  const worldOptions = useMemo(() => {
    const fromMeta = Array.isArray(meta.worldIds) ? meta.worldIds : WORLD_IDS;
    return ["all", ...fromMeta];
  }, [meta.worldIds]);

  useEffect(() => {
    let cancelled = false;

    async function loadRankings() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/rankings.json`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
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
          setLoadError(String(error));
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

  const expTable = useMemo(() => parseExpTable(meta), [meta]);

  const rankingPool = useMemo(() => {
    let pool = characters;
    if (worldFilter !== "all") {
      pool = pool.filter((character) => matchesWorldFilter(character, worldFilter));
    }
    if (!favoritesOnly) {
      return pool;
    }
    return pool.filter((character) => isFavorite(character));
  }, [characters, favoritesOnly, isFavorite, worldFilter]);

  const gainRankMaps = useMemo(() => computeGainRankMaps(rankingPool), [rankingPool]);

  const isLevelSort = sortKey === "rank";
  const showGainRank = !isLevelSort;
  const showJobRanking = !isLevelSort && gainRankView === "byJob";

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
    const sorted = isLevelSort
      ? [...filteredCharacters].sort((a, b) => a.rank - b.rank)
      : [...filteredCharacters].sort(
          (a, b) => getGainAmount(b, sortKey) - getGainAmount(a, sortKey)
        );

    if (isLevelSort) {
      return sorted;
    }

    return sorted.map((character, index) => ({
      ...character,
      gainRank: index + 1,
    }));
  }, [filteredCharacters, isLevelSort, sortKey]);

  useEffect(() => {
    setPage(1);
  }, [query, sortKey, favoritesOnly, gainRankView, expandedJob, worldFilter]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        ランキングデータを読み込み中...
      </div>
    );
  }

  if (!characters.length) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <h1 className="text-2xl font-bold mb-4">データがありません</h1>
        <p className="text-slate-400 mb-4">
          先に bot を実行して rankings.json を生成してください。
        </p>
        {loadError ? <p className="text-red-400">{loadError}</p> : null}
        <pre className="bg-slate-900 p-4 rounded-xl text-sm text-slate-300">
          run_exp_ranking_fetch.bat
        </pre>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-slate-400">MapleStory N</p>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight">EXP Ranking</h1>
            {meta.demoGains ? (
              <p className="text-amber-300 text-sm mt-1">
                デモ用ダミー増加量データ（{meta.demoGainDays || "?"} 日分）
              </p>
            ) : null}
            {loadError ? <p className="text-amber-400 text-sm mt-1">{loadError}</p> : null}
          </div>
          <p className="text-slate-400 text-sm md:text-base text-right md:pb-1 shrink-0">
            {[
              meta.rankingMinLevel
                ? `Lv.${meta.rankingMinLevel}+`
                : meta.rankingTopN
                  ? `取得 ${meta.rankingTopN} 人`
                  : null,
              meta.latestSnapshotDate ? `最新 ${meta.latestSnapshotDate}` : null,
            ]
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>

        <TopGainHighlights
          characters={rankingPool}
          selectedId={selectedId}
          onSelect={setSelectedId}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
        />

        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map((option) => (
            <Button
              key={option.key}
              variant={sortKey === option.key ? "default" : "outline"}
              onClick={() => {
                setSortKey(option.key);
                if (option.key === "rank") {
                  setGainRankView("overall");
                  setExpandedJob(null);
                }
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {!isLevelSort ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={gainRankView === "overall" ? "default" : "outline"}
              onClick={() => {
                setGainRankView("overall");
                setExpandedJob(null);
              }}
            >
              全体
            </Button>
            <Button
              variant={gainRankView === "byJob" ? "default" : "outline"}
              onClick={() => {
                setGainRankView("byJob");
                setExpandedJob(null);
              }}
            >
              職業別
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {worldOptions.map((world) => (
            <Button
              key={world}
              variant={worldFilter === world ? "default" : "outline"}
              onClick={() => setWorldFilter(world)}
            >
              {world === "all" ? "全サーバー" : world}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 xl:items-start">
          <Card className="xl:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl">
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <h2 className="text-xl font-bold">{rankingListTitle(sortKey, gainRankView)}</h2>
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
                    お気に入りのみ
                    {favoriteCount > 0 ? ` (${favoriteCount})` : ""}
                  </Button>
                  <div className="relative w-full md:w-72">
                    <Search className="absolute left-3 top-2.5 text-slate-500" size={18} />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="キャラ名・職業・サーバーで検索"
                      className="pl-10 bg-slate-950 border-slate-800 text-slate-100"
                    />
                  </div>
                </div>
              </div>

              {showJobRanking ? (
                <JobGainRankings
                  characters={rankingPool}
                  period={sortKey}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  isFavorite={isFavorite}
                  onToggleFavorite={toggleFavorite}
                  expandedJob={expandedJob}
                  onExpandJob={setExpandedJob}
                />
              ) : null}

              {favoritesOnly && displayCharacters.length === 0 && !showJobRanking ? (
                <p className="text-sm text-amber-300/90 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
                  お気に入りに登録されたキャラがいません。一覧の☆を押して追加してください。
                </p>
              ) : null}

              {!showJobRanking ? (
                <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-slate-400">
                <span>
                  {favoritesOnly ? "お気に入り " : ""}
                  {displayCharacters.length.toLocaleString()} 件中{" "}
                  {displayCharacters.length === 0
                    ? 0
                    : `${pageStart + 1}-${Math.min(pageStart + PAGE_SIZE, displayCharacters.length)}`}
                  件を表示
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="border-slate-700 bg-slate-950"
                    disabled={safePage <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    前へ
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
                    次へ
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-800">
                <table className="w-full text-base">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      <th className="text-center p-3 w-12">
                        <Star size={14} className="inline text-amber-400/80" />
                      </th>
                      {showGainRank ? (
                        <th className="text-left p-3">増加順位</th>
                      ) : null}
                      <th className="text-left p-3">レベル順位</th>
                      <th className="text-left p-3">Character</th>
                      <th className="text-left p-3">Server</th>
                      <th className="text-right p-3">Lv / EXP%</th>
                      <th className="text-right p-3">Daily</th>
                      <th className="text-right p-3">Weekly</th>
                      <th className="text-right p-3">Monthly</th>
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
                          <td className={`p-3 font-bold ${gainRankClass(character.gainRank)}`}>
                            #{character.gainRank}
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
                        <td className="p-3 text-right font-medium">{formatLevelExp(character)}</td>
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
                </>
              ) : null}
            </CardContent>
          </Card>

          {selectedCharacter ? (
            <div className="xl:col-span-1 min-w-0">
              <CharacterDetail
                character={selectedCharacter}
                characters={rankingPool.length ? rankingPool : characters}
                gainRankMaps={gainRankMaps}
                expTable={expTable}
                isFavorite={isFavorite(selectedCharacter)}
                onToggleFavorite={() => toggleFavorite(selectedCharacter)}
              />
            </div>
          ) : (
            <Card className="xl:col-span-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl">
              <CardContent className="p-8 text-center text-slate-400">
                <Star size={32} className="mx-auto mb-3 text-amber-400/60" />
                <p>お気に入りに登録されたキャラがいません。</p>
                <p className="text-sm mt-2">一覧の☆を押して追加してください。</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
