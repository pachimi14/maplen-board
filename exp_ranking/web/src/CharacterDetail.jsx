import React, { useMemo } from "react";
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
  lastHistoryPoints,
  LEVEL_CAP,
  levelExpPercent,
} from "./rankingUtils";

const RECENT_CHART_DAYS = 7;
const RECENT_CHART_DAYS_30 = 30;

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
  rankChartScale,
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
        <h3 className="font-bold mb-3">{rankTitle}</h3>
        <div className="h-64 md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
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
            </LineChart>
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

  const weekGainSeries = useMemo(
    () => lastHistoryPoints(character, RECENT_CHART_DAYS),
    [character],
  );

  const monthGainSeries = useMemo(
    () => lastHistoryPoints(character, RECENT_CHART_DAYS_30),
    [character],
  );

  const rankPool = allCharacters ?? characters;

  const weekRankSeries = useMemo(
    () =>
      enrichRankSeries(
        buildWeekDailyRankSeries(rankPool, character.id, RECENT_CHART_DAYS),
      ),
    [rankPool, character.id],
  );

  const monthRankSeries = useMemo(
    () =>
      enrichRankSeries(
        buildWeekDailyRankSeries(rankPool, character.id, RECENT_CHART_DAYS_30),
      ),
    [rankPool, character.id],
  );

  const rankChartScale = useMemo(
    () => buildRankChartScale(weekRankSeries.map((point) => point.dailyRank)),
    [weekRankSeries]
  );

  const rankChartScale30 = useMemo(
    () => buildRankChartScale(monthRankSeries.map((point) => point.dailyRank)),
    [monthRankSeries]
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
          <img
            src={character.imageUrl}
            alt=""
            className={`rounded-2xl bg-slate-800 object-cover shrink-0 ${
              isExpanded ? "w-24 h-24 md:w-28 md:h-28" : "w-20 h-20 md:w-24 md:h-24"
            }`}
          />
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
                    <NavigatorLink href={navigatorUrl} className="text-sky-400 font-medium">
                      {character.worldId}
                    </NavigatorLink>
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

            <div className="space-y-8">
              <HistoryChartRow
                gainTitle={t("characterDetail.chartGain7d")}
                rankTitle={t("characterDetail.chartRank7d")}
                gainSeries={weekGainSeries}
                rankSeries={weekRankSeries}
                rankChartScale={rankChartScale}
                t={t}
              />
              <HistoryChartRow
                gainTitle={t("characterDetail.chartGain30d")}
                rankTitle={t("characterDetail.chartRank30d")}
                gainSeries={monthGainSeries}
                rankSeries={monthRankSeries}
                rankChartScale={rankChartScale30}
                t={t}
                dense
              />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
