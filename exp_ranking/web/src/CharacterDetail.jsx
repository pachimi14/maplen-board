import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, UserRound } from "lucide-react";
import FavoriteStar from "./FavoriteStar";
import NavigatorLink from "./NavigatorLink";
import CharacterPlannerTools, { GainAveragesSection } from "./CharacterPlannerTools";
import CharacterSearchPicker from "./CharacterSearchPicker";
import { useGainPeriodLabel, useTranslation } from "./i18n/I18nContext";
import {
  BarChart,
  Bar,
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildRankChartScale,
  buildWeekDailyRankSeries,
  enrichRankSeries,
  estimateDaysTo250FromToday,
  estimateDaysTo275FromToday,
  findBestDailyGain,
  addDaysToIsoDate,
  currentLevelExp,
  formatExp,
  formatExpExact,
  formatExpRecord,
  datePartsFromIsoDate,
  getGainRank,
  slashDateFromParts,
  targetDatePartsAfterDays,
  formatJobName,
  getGainAmount,
  getNavigatorUrl,
  historyPointsInPeriod,
  lastHistoryPoints,
  LEVEL_CAP,
  levelExpPercent,
} from "./rankingUtils";

const RECENT_CHART_DAYS = 7;
const MAX_CHART_DAYS = 90;

function RankChartDot({ cx, cy, payload, showRankLabel = true }) {
  if (cx == null || cy == null || !payload) {
    return null;
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={showRankLabel ? 5 : 3} fill="#0ea5e9" stroke="#e0f2fe" strokeWidth={2} />
      {showRankLabel ? (
        <text
          x={cx}
          y={cy - 12}
          textAnchor="middle"
          fill="#f8fafc"
          fontSize={12}
          fontWeight={600}
        >
          #{payload.dailyRank}
        </text>
      ) : null}
    </g>
  );
}

function RankChartTooltip({ active, payload, label }) {
  const { t } = useTranslation();
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm shadow-lg">
      <div className="text-slate-400">{label}</div>
      <div className="font-bold text-white mt-0.5">
        {t("characterDetail.rankTooltip", { rank: row.dailyRank })}
      </div>
      {row.rankDelta == null ? null : row.rankDelta > 0 ? (
        <div className="text-emerald-400 mt-1">
          {t("characterDetail.rankUp", { count: row.rankDelta })}
        </div>
      ) : row.rankDelta < 0 ? (
        <div className="text-rose-400 mt-1">
          {t("characterDetail.rankDown", { count: Math.abs(row.rankDelta) })}
        </div>
      ) : (
        <div className="text-slate-400 mt-1">{t("characterDetail.rankSame")}</div>
      )}
    </div>
  );
}

function GainChartTooltip({ active, payload, label }) {
  const { t } = useTranslation();
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm shadow-lg">
      <div className="text-slate-400">{label}</div>
      <div className="font-bold text-emerald-400 mt-0.5">
        {t("characterDetail.gainAmount")}: +{formatExp(payload[0].value)}
      </div>
    </div>
  );
}

function LevelProgressTooltip({ active, payload, label }) {
  const { t } = useTranslation();
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm shadow-lg">
      <div className="text-slate-400">{label}</div>
      <div className="mt-0.5 font-bold text-emerald-400">
        {t("characterDetail.levelProgressTooltip", {
          level: row.level,
          percent: row.levelExpPercent.toFixed(3),
        })}
      </div>
    </div>
  );
}

function formatLevelProgressTick(value) {
  const level = Math.floor(value);
  const percent = Math.max(0, Math.min(99.999, (value - level) * 100));
  return `Lv.${level} ${percent.toFixed(0)}%`;
}

function GainStatCard({ label, amount, rank, compact = false }) {
  const { t } = useTranslation();
  return (
    <div
      className={`bg-slate-950 rounded-2xl min-w-0 ${compact ? "p-3 text-center" : "p-4"}`}
    >
      <div className="text-slate-400 text-xs sm:text-sm truncate">{label}</div>
      {compact ? (
        <div className="mt-1 text-sm sm:text-base tabular-nums whitespace-nowrap">
          <span className="font-bold text-emerald-400">+{formatExp(amount)}</span>
          <span className="text-slate-500 mx-1.5">{t("characterDetail.rank")}</span>
          <span className="font-semibold text-slate-100">{rank != null ? `#${rank}` : "-"}</span>
        </div>
      ) : (
        <>
          <div className="text-lg font-bold text-emerald-400 mt-1 truncate">+{formatExp(amount)}</div>
          <div className="text-xs sm:text-sm text-slate-400 mt-1">
            {t("characterDetail.rank")}{" "}
            <span className="text-slate-100 font-semibold">{rank != null ? `#${rank}` : "-"}</span>
          </div>
        </>
      )}
    </div>
  );
}

function SplitDateLines({ parts }) {
  if (!parts) {
    return (
      <div className="text-sm font-semibold text-cyan-300 mt-2 tabular-nums whitespace-nowrap">
        --
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-0.5 leading-tight">
      <div className="text-sm font-semibold text-cyan-300 tabular-nums whitespace-nowrap">
        {parts.year}
      </div>
      <div className="text-sm font-semibold text-cyan-300 tabular-nums whitespace-nowrap">
        {parts.monthDay}
      </div>
    </div>
  );
}

function AboutDaysDisplay({ days, showPlaceholder, t }) {
  if (showPlaceholder) {
    return <div className="text-lg font-bold mt-2 tabular-nums">--</div>;
  }

  return (
    <div className="mt-2 leading-tight">
      <div className="text-xs text-slate-400">{t("characterDetail.aboutDaysPrefix")}</div>
      <div className="text-lg font-bold tabular-nums mt-0.5">
        {t("characterDetail.aboutDaysCount", { days })}
      </div>
    </div>
  );
}

function LevelEstimateColumn({ label, estimate, dateParts, t, compact = false }) {
  const showPlaceholder = estimate.completed || estimate.noGain;
  const slashDate = slashDateFromParts(dateParts);

  if (compact) {
    return (
      <div className="px-2 sm:px-3 py-1 text-center min-w-0">
        <div className="text-slate-400 text-sm leading-snug">{label}</div>
        {showPlaceholder ? (
          <div className="text-lg font-bold mt-1 tabular-nums">--</div>
        ) : (
          <>
            <div className="text-lg font-bold mt-1 tabular-nums">
              {t("characterDetail.aboutDaysInline", { days: estimate.days })}
            </div>
            <div className="text-sm font-semibold text-cyan-300 mt-1 tabular-nums">{slashDate}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="px-2 sm:px-4 py-1 text-center min-w-0">
      <div className="text-slate-400 text-sm leading-snug">{label}</div>
      <AboutDaysDisplay days={estimate.days} showPlaceholder={showPlaceholder} t={t} />
      <SplitDateLines parts={showPlaceholder ? null : dateParts} />
    </div>
  );
}

function LevelEstimateCard({ daysTo250, daysTo275, dateParts250, dateParts275, t, compact = false }) {
  return (
    <div className={`bg-slate-950 rounded-2xl min-w-0 overflow-hidden ${compact ? "p-4" : "p-5"}`}>
      <p
        className={`text-slate-400 text-sm text-center leading-snug whitespace-nowrap ${
          compact ? "mb-3" : "mb-4"
        }`}
      >
        {t("characterDetail.levelEstimateHeader")}
      </p>
      <div className="grid grid-cols-2 divide-x divide-slate-800">
        <LevelEstimateColumn
          label={t("characterDetail.lvTo250")}
          estimate={daysTo250}
          dateParts={dateParts250}
          t={t}
          compact={compact}
        />
        <LevelEstimateColumn
          label={t("characterDetail.lvTo275")}
          estimate={daysTo275}
          dateParts={dateParts275}
          t={t}
          compact={compact}
        />
      </div>
    </div>
  );
}

function HistoryChartRow({
  gainTitle,
  rankTitle,
  gainSeries,
  rankSeries,
  levelSeries,
  rankChartScale,
  rightChartMode,
  onRightChartModeChange,
  t,
  dense = false,
}) {
  const xTick = dense
    ? { fill: "#94a3b8", fontSize: 9 }
    : { fill: "#94a3b8", fontSize: 13 };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h3 className="font-bold mb-3">{gainTitle}</h3>
        <div className="h-64 md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={gainSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={xTick} minTickGap={dense ? 4 : 8} />
              <YAxis
                tickFormatter={formatExp}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                width={58}
              />
              <Tooltip content={<GainChartTooltip />} />
              <Bar dataKey="dailyGain" fill="#34d399" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">
            {rightChartMode === "rank" ? rankTitle : t("characterDetail.chartLevelProgress")}
          </h3>
          <div className="flex gap-1 rounded-md bg-slate-950 p-1">
            <Button type="button" size="sm" variant={rightChartMode === "rank" ? "default" : "outline"} className="h-8 border-slate-700" onClick={() => onRightChartModeChange("rank")}>
              {t("characterDetail.chartRankMode")}
            </Button>
            <Button type="button" size="sm" variant={rightChartMode === "level" ? "default" : "outline"} className="h-8 border-slate-700" onClick={() => onRightChartModeChange("level")}>
              {t("characterDetail.chartLevelMode")}
            </Button>
          </div>
        </div>
        <div className="h-64 md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            {rightChartMode === "rank" ? <LineChart
              data={rankSeries}
              margin={{ top: dense ? 12 : 28, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#334155"
                horizontal
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={xTick}
                minTickGap={dense ? 4 : 8}
                axisLine={{ stroke: "#475569" }}
              />
              <YAxis
                reversed
                allowDecimals={false}
                domain={rankChartScale.domain}
                ticks={rankChartScale.ticks}
                tickFormatter={(value) => `#${value}`}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                width={44}
                axisLine={{ stroke: "#475569" }}
              />
              {rankChartScale.domain[0] <= 1 && rankChartScale.domain[1] >= 1 ? (
                <ReferenceLine
                  y={1}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                />
              ) : null}
              <Tooltip content={<RankChartTooltip />} />
              <Line
                type="monotone"
                dataKey="dailyRank"
                stroke="#38bdf8"
                strokeWidth={dense ? 2 : 2.5}
                dot={<RankChartDot showRankLabel={!dense} />}
                activeDot={{ r: 6, fill: "#0ea5e9", stroke: "#e0f2fe", strokeWidth: 2 }}
              />
            </LineChart> : <AreaChart data={levelSeries} margin={{ top: 12, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="date" tick={xTick} minTickGap={dense ? 4 : 8} axisLine={{ stroke: "#475569" }} />
              <YAxis
                dataKey="levelProgress"
                domain={["dataMin", "dataMax"]}
                tickFormatter={formatLevelProgressTick}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                width={82}
              />
              <Tooltip content={<LevelProgressTooltip />} />
              <Area type="monotone" dataKey="levelProgress" stroke="#34d399" fill="#34d399" fillOpacity={0.16} strokeWidth={2.5} dot={{ r: dense ? 2 : 3, fill: "#34d399", strokeWidth: 0 }} activeDot={{ r: 5, fill: "#34d399", stroke: "#d1fae5", strokeWidth: 2 }} />
            </AreaChart>}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function BestDailyRecordCard({ bestDaily, recordParts, t, compact = false }) {
  const slashDate = slashDateFromParts(recordParts);

  if (compact) {
    return (
      <div className="bg-slate-950 rounded-2xl min-w-0 overflow-hidden text-center flex flex-col justify-center p-3 sm:p-4">
        <div className="text-slate-400 text-sm leading-snug">
          {t("characterDetail.dailyGainRecordCombined")}
        </div>
        <div className="text-xl font-bold text-amber-300 tabular-nums mt-1 whitespace-nowrap">
          +{formatExpRecord(bestDaily.bestGain)}
        </div>
        {bestDaily.bestGain > 0 ? (
          <div className="text-xs text-slate-500 tabular-nums mt-0.5 whitespace-nowrap">
            +{formatExpExact(bestDaily.bestGain)}
          </div>
        ) : null}
        <div className="text-sm text-slate-400 mt-1 whitespace-nowrap">
          {slashDate
            ? t("characterDetail.recordDateInline", { date: slashDate })
            : t("characterDetail.noData")}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-slate-950 rounded-2xl min-w-0 overflow-hidden text-center flex flex-col justify-center ${
        compact ? "p-3 sm:p-4" : "p-4 sm:p-5"
      }`}
    >
      <div className="text-slate-400 text-xs leading-snug whitespace-nowrap">
        {t("characterDetail.dailyGainRecordTitle")}
      </div>
      <div className="text-slate-400 text-sm leading-snug mt-1 whitespace-nowrap">
        {t("characterDetail.pastBest")}
      </div>
      <div className="text-xl font-bold text-amber-300 tabular-nums mt-2 whitespace-nowrap">
        +{formatExpRecord(bestDaily.bestGain)}
      </div>
      <div className="text-slate-400 text-sm mt-4 whitespace-nowrap">
        {t("characterDetail.recordDateLabel")}
      </div>
      {recordParts ? (
        <SplitDateLines parts={recordParts} />
      ) : (
        <div className="text-slate-500 text-sm mt-1">{t("characterDetail.noData")}</div>
      )}
    </div>
  );
}

export default function CharacterDetail({
  character,
  characters,
  allCharacters,
  gainRankMaps,
  expTable,
  isFavorite = false,
  onToggleFavorite,
  mode = "compact",
  onExpand,
  onCollapse,
  onSelectCharacter,
  pinControls = null,
  shareControls = null,
}) {
  const { t } = useTranslation();
  const dailyPeriod = useGainPeriodLabel("daily");
  const weeklyPeriod = useGainPeriodLabel("weekly");
  const monthlyPeriod = useGainPeriodLabel("monthly");

  const dailyGain = getGainAmount(character, "daily");
  const weeklyGain = getGainAmount(character, "weekly");
  const monthlyGain = getGainAmount(character, "monthly");

  const dailyRank = getGainRank(gainRankMaps, character.id, "daily");
  const weeklyRank = getGainRank(gainRankMaps, character.id, "weekly");
  const monthlyRank = getGainRank(gainRankMaps, character.id, "monthly");

  const rankPool = allCharacters ?? characters;
  const history = Array.isArray(character.history) ? character.history : [];
  const firstHistoryDate = history[0]?.snapshotDate ?? "";
  const lastHistoryDate = history.at(-1)?.snapshotDate ?? "";
  const [chartPeriod, setChartPeriod] = useState("7");
  const [rightChartMode, setRightChartMode] = useState("rank");
  const [customStartDate, setCustomStartDate] = useState(firstHistoryDate);
  const [customEndDate, setCustomEndDate] = useState(lastHistoryDate);

  useEffect(() => {
    setChartPeriod("7");
    setRightChartMode("rank");
    setCustomStartDate(firstHistoryDate);
    setCustomEndDate(lastHistoryDate);
  }, [character.id, firstHistoryDate, lastHistoryDate]);

  const chartGainSeries = useMemo(
    () =>
      chartPeriod === "custom"
        ? historyPointsInPeriod(character, customStartDate, customEndDate)
        : lastHistoryPoints(character, Number(chartPeriod)),
    [character, chartPeriod, customEndDate, customStartDate],
  );

  const chartRankSeries = useMemo(
    () =>
      enrichRankSeries(
        buildWeekDailyRankSeries(
          rankPool,
          character.id,
          chartPeriod === "custom" ? MAX_CHART_DAYS : Number(chartPeriod),
          chartPeriod === "custom" ? customStartDate : null,
          chartPeriod === "custom" ? customEndDate : null,
        ),
      ),
    [rankPool, character.id, chartPeriod, customEndDate, customStartDate],
  );

  const chartLevelSeries = useMemo(
    () =>
      chartGainSeries
        .filter((point) => Number.isFinite(Number(point.level)))
        .map((point) => {
          const percent = Number(point.levelExpPercent ?? point.expPercent ?? 0);
          return {
            ...point,
            levelExpPercent: percent,
            levelProgress: Number(point.level) + percent / 100,
          };
        }),
    [chartGainSeries],
  );

  const rankChartScale = useMemo(
    () => buildRankChartScale(
      chartRankSeries.map((point) => point.dailyRank).filter(Number.isFinite),
    ),
    [chartRankSeries],
  );

  const bestDaily = useMemo(() => findBestDailyGain(character), [character]);
  const daysTo250 = useMemo(
    () => estimateDaysTo250FromToday(character, expTable),
    [character, expTable]
  );

  const daysTo275 = useMemo(
    () => estimateDaysTo275FromToday(character, expTable),
    [character, expTable]
  );

  const latestGainSnapshotDate =
    character.history?.at(-1)?.snapshotDate ?? character.history?.at(-1)?.date ?? null;

  const dateParts250 = useMemo(() => {
    if (!daysTo250.days) {
      return null;
    }
    if (latestGainSnapshotDate) {
      return datePartsFromIsoDate(addDaysToIsoDate(latestGainSnapshotDate, daysTo250.days), t);
    }
    return targetDatePartsAfterDays(daysTo250.days, t);
  }, [daysTo250.days, latestGainSnapshotDate, t]);

  const dateParts275 = useMemo(() => {
    if (!daysTo275.days) {
      return null;
    }
    if (latestGainSnapshotDate) {
      return datePartsFromIsoDate(addDaysToIsoDate(latestGainSnapshotDate, daysTo275.days), t);
    }
    return targetDatePartsAfterDays(daysTo275.days, t);
  }, [daysTo275.days, latestGainSnapshotDate, t]);

  const recordParts = useMemo(() => {
    if (!bestDaily.bestSnapshotDate) {
      return null;
    }
    return datePartsFromIsoDate(bestDaily.bestSnapshotDate, t);
  }, [bestDaily.bestSnapshotDate, t]);

  const level = character.level ?? 0;
  const expPercent = levelExpPercent(character);
  const levelExp = currentLevelExp(character, expTable);
  const navigatorUrl = getNavigatorUrl(character);
  const isExpanded = mode === "expanded";

  const gainStatsRow = (
    <div className={`grid grid-cols-3 ${isExpanded ? "gap-3" : "gap-3"}`}>
      <GainStatCard
        label={t("characterDetail.gainLabel", { period: dailyPeriod })}
        amount={dailyGain}
        rank={dailyRank}
        compact={isExpanded}
      />
      <GainStatCard
        label={t("characterDetail.gainLabel", { period: weeklyPeriod })}
        amount={weeklyGain}
        rank={weeklyRank}
        compact={isExpanded}
      />
      <GainStatCard
        label={t("characterDetail.gainLabel", { period: monthlyPeriod })}
        amount={monthlyGain}
        rank={monthlyRank}
        compact={isExpanded}
      />
    </div>
  );

  const estimateRow = (
    <div className={`grid grid-cols-1 sm:grid-cols-3 min-w-0 ${isExpanded ? "gap-3" : "gap-4"}`}>
      <div className="sm:col-span-2 min-w-0">
        <LevelEstimateCard
          daysTo250={daysTo250}
          daysTo275={daysTo275}
          dateParts250={dateParts250}
          dateParts275={dateParts275}
          t={t}
          compact={isExpanded}
        />
      </div>
      <BestDailyRecordCard
        bestDaily={bestDaily}
        recordParts={recordParts}
        t={t}
        compact={isExpanded}
      />
    </div>
  );

  return (
    <Card className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl w-full">
      <CardContent className="p-6 md:p-7 space-y-6">
        {isExpanded && onSelectCharacter ? (
          <CharacterSearchPicker
            characters={characters}
            selectedId={character.id}
            onSelect={onSelectCharacter}
          />
        ) : null}

        <div className="flex items-start gap-4">
          {/* §22.15 (revised, decision A relaxed for this display wrapper
              only): the source portrait is a 180x180 square with the
              character small and centered, leaving built-in transparent
              margin that a square box's object-cover never crops away.
              Zoom the <img> past the container's edges (overflow hidden
              on the wrapping div — a transform can't be clipped by
              overflow on the element it's applied to) instead of
              enlarging the box, so the whitespace is pushed out of frame
              without touching the source image. */}
          <div
            className={`rounded-2xl bg-slate-800 overflow-hidden shrink-0 ${
              isExpanded ? "w-24 h-24 md:w-28 md:h-28" : "w-20 h-20 md:w-24 md:h-24"
            }`}
          >
            <img src={character.imageUrl} alt="" className="w-full h-full object-cover scale-[1.3]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <UserRound size={16} />
                {t("characterDetail.title")}
                {isExpanded ? (
                  <span className="text-cyan-400/90 text-xs font-medium">
                    {t("characterDetail.expandedBadge")}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isExpanded && onCollapse ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-slate-700 bg-slate-950 text-xs"
                    onClick={onCollapse}
                  >
                    <ChevronUp size={14} className="mr-1" />
                    {t("characterDetail.collapseDetail")}
                  </Button>
                ) : null}
                {shareControls}
                {onToggleFavorite ? (
                  <FavoriteStar active={isFavorite} onToggle={onToggleFavorite} size={22} />
                ) : null}
              </div>
            </div>
            <h2 className="text-2xl font-bold break-words leading-tight mt-1">
              <NavigatorLink href={navigatorUrl} className="text-inherit hover:text-sky-300">
                {character.name}
              </NavigatorLink>
            </h2>

            <div className="flex items-baseline justify-between gap-3 mt-2">
              <p className="text-slate-400 min-w-0">
                {formatJobName(character.job)}
                {character.worldId ? (
                  <>
                    <span className="text-slate-600"> · </span>
                    <span className="text-slate-300 font-medium">{character.worldId}</span>
                  </>
                ) : null}
              </p>
              <p className="shrink-0 text-right tabular-nums font-bold text-lg whitespace-nowrap">
                Lv.{level}
                {level >= LEVEL_CAP ? (
                  <span className="text-slate-300 ml-3">MAX</span>
                ) : (
                  <span className="ml-3">{expPercent.toFixed(3)}%</span>
                )}
              </p>
            </div>

            <div className="flex items-baseline justify-between gap-3 mt-1">
              <p className="text-sm text-slate-500 shrink-0">{t("characterDetail.levelRank")}</p>
              {level >= LEVEL_CAP ? (
                <span className="shrink-0" aria-hidden />
              ) : (
                <p className="min-w-0 max-w-[60%] text-right text-sm font-semibold text-cyan-300 tabular-nums leading-tight break-all">
                  {formatExpExact(levelExp)}
                </p>
              )}
            </div>

            <p className="text-sm text-slate-500 font-semibold mt-0.5">#{character.rank}</p>

            {pinControls ? <div className="mt-2">{pinControls}</div> : null}
          </div>
        </div>

        {isExpanded ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch min-w-0">
            <div className="lg:col-span-2 space-y-3 min-w-0">
              {gainStatsRow}
              {estimateRow}
            </div>
            <div className="lg:col-span-1 min-w-0 flex">
              <GainAveragesSection character={character} t={t} variant="stack" className="w-full" />
            </div>
          </div>
        ) : (
          <>
            {gainStatsRow}
            {estimateRow}
          </>
        )}

        {!isExpanded && onExpand ? (
          <Button
            type="button"
            variant="outline"
            className="w-full border-slate-700 bg-slate-950 hover:bg-slate-800"
            onClick={onExpand}
          >
            <ChevronDown size={16} className="mr-2" />
            {t("characterDetail.expandDetail")}
          </Button>
        ) : null}

        {isExpanded ? (
          <>
            <CharacterPlannerTools
              character={character}
              characters={characters}
              expTable={expTable}
              showAverages={false}
            />

            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3 border-y border-slate-800 py-3">
                <div className="flex flex-wrap gap-2">
                  {["7", "30", "90", "custom"].map((period) => (
                    <Button
                      key={period}
                      type="button"
                      variant={chartPeriod === period ? "default" : "outline"}
                      className="border-slate-700"
                      onClick={() => setChartPeriod(period)}
                    >
                      {period === "custom"
                        ? t("characterDetail.chartCustom")
                        : t("characterDetail.chartDays", { days: period })}
                    </Button>
                  ))}
                </div>
                {chartPeriod === "custom" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-slate-400 space-y-1">
                      <span className="block">{t("characterDetail.chartStart")}</span>
                      <input type="date" min={firstHistoryDate} max={customEndDate || lastHistoryDate} value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} className="h-10 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100" />
                    </label>
                    <label className="text-xs text-slate-400 space-y-1">
                      <span className="block">{t("characterDetail.chartEnd")}</span>
                      <input type="date" min={customStartDate || firstHistoryDate} max={lastHistoryDate} value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} className="h-10 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100" />
                    </label>
                  </div>
                ) : null}
              </div>
              <HistoryChartRow
                gainTitle={t("characterDetail.chartGain")}
                rankTitle={t("characterDetail.chartRank")}
                gainSeries={chartGainSeries}
                rankSeries={chartRankSeries}
                levelSeries={chartLevelSeries}
                rankChartScale={rankChartScale}
                rightChartMode={rightChartMode}
                onRightChartModeChange={setRightChartMode}
                t={t}
                dense={chartPeriod !== "7"}
              />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
