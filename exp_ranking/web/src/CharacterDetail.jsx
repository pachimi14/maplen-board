import React, { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { UserRound } from "lucide-react";
import FavoriteStar from "./FavoriteStar";
import NavigatorLink from "./NavigatorLink";
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
  findBestDailyGain,
  currentLevelExp,
  formatExp,
  formatExpExact,
  formatTargetDateAfterDays,
  getGainRank,
  formatJobName,
  getGainAmount,
  getNavigatorUrl,
  lastHistoryPoints,
  levelExpPercent,
} from "./rankingUtils";

const RECENT_CHART_DAYS = 7;

function RankChartDot({ cx, cy, payload }) {
  if (cx == null || cy == null || !payload) {
    return null;
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="#0ea5e9" stroke="#e0f2fe" strokeWidth={2} />
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

function GainStatCard({ label, amount, rank, hint }) {
  const { t } = useTranslation();
  return (
    <div className="bg-slate-950 rounded-2xl p-4 min-w-0">
      <div className="text-slate-400 text-xs sm:text-sm truncate">{label}</div>
      {hint ? (
        <div className="text-[10px] sm:text-xs text-slate-500 truncate mt-0.5">{hint}</div>
      ) : null}
      <div className="text-lg font-bold text-emerald-400 mt-1 truncate">+{formatExp(amount)}</div>
      <div className="text-xs sm:text-sm text-slate-400 mt-1">
        {t("characterDetail.rank")}{" "}
        <span className="text-slate-100 font-semibold">{rank != null ? `#${rank}` : "-"}</span>
      </div>
    </div>
  );
}

export default function CharacterDetail({
  character,
  characters,
  gainRankMaps,
  expTable,
  isFavorite = false,
  onToggleFavorite,
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

  const weekRankSeries = useMemo(
    () =>
      enrichRankSeries(
        buildWeekDailyRankSeries(characters, character.id, RECENT_CHART_DAYS),
      ),
    [characters, character.id],
  );

  const rankChartScale = useMemo(
    () => buildRankChartScale(weekRankSeries.map((point) => point.dailyRank)),
    [weekRankSeries]
  );

  const bestDaily = useMemo(() => findBestDailyGain(character), [character]);
  const daysTo250 = useMemo(
    () => estimateDaysTo250FromToday(character, expTable),
    [character, expTable]
  );

  const targetDateLabel = useMemo(() => {
    if (!daysTo250.days) {
      return null;
    }
    return formatTargetDateAfterDays(daysTo250.days, t);
  }, [daysTo250.days, t]);

  const level = character.level ?? 0;
  const expPercent = levelExpPercent(character);
  const levelExp = currentLevelExp(character, expTable);
  const navigatorUrl = getNavigatorUrl(character);

  return (
    <Card className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl w-full">
      <CardContent className="p-6 md:p-7 space-y-6">
        <div className="flex items-start gap-4">
          <img
            src={character.imageUrl}
            alt=""
            className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-slate-800 object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <UserRound size={16} />
                {t("characterDetail.title")}
              </div>
              {onToggleFavorite ? (
                <FavoriteStar active={isFavorite} onToggle={onToggleFavorite} size={22} />
              ) : null}
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
                {level >= 250 ? (
                  <span className="text-slate-300 ml-3">MAX</span>
                ) : (
                  <span className="ml-3">{expPercent.toFixed(3)}%</span>
                )}
              </p>
            </div>

            <div className="flex items-baseline justify-between gap-3 mt-1">
              <p className="text-sm text-slate-500 shrink-0">{t("characterDetail.levelRank")}</p>
              {level >= 250 ? (
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

        <div className="grid grid-cols-3 gap-3">
          <GainStatCard
            label={t("characterDetail.gainLabel", { period: dailyPeriod })}
            amount={dailyGain}
            rank={dailyRank}
            hint={t("period.resetDaily")}
          />
          <GainStatCard
            label={t("characterDetail.gainLabel", { period: weeklyPeriod })}
            amount={weeklyGain}
            rank={weeklyRank}
            hint={t("period.resetWeekly")}
          />
          <GainStatCard
            label={t("characterDetail.gainLabel", { period: monthlyPeriod })}
            amount={monthlyGain}
            rank={monthlyRank}
            hint={t("period.resetMonthly")}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 min-w-0">
          <div className="bg-slate-950 rounded-2xl p-5 min-w-0 overflow-hidden">
            <div className="text-slate-400 text-sm leading-snug">
              {t("characterDetail.lv250Title")}
            </div>
            {daysTo250.completed ? (
              <div className="text-xl font-bold mt-1 break-words">
                {t("characterDetail.lv250Done")}
              </div>
            ) : daysTo250.noGain ? (
              <div className="text-xl font-bold mt-1">-</div>
            ) : (
              <>
                <div className="text-xl font-bold mt-1">
                  {t("characterDetail.aboutDays", { days: daysTo250.days })}
                </div>
                <div className="text-base font-semibold text-cyan-300 mt-1 break-words">
                  {targetDateLabel}
                </div>
              </>
            )}
          </div>
          <div className="bg-slate-950 rounded-2xl p-5 min-w-0 overflow-hidden">
            <div className="text-slate-400 text-sm leading-snug">
              {t("characterDetail.bestDailyTitle")}
            </div>
            <div
              className="mt-1 max-w-full overflow-x-auto [scrollbar-width:thin]"
              title={`+${formatExpExact(bestDaily.bestGain)}`}
            >
              <div className="text-base font-bold text-amber-300 tabular-nums leading-tight whitespace-nowrap">
                +{formatExpExact(bestDaily.bestGain)}
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-2 break-words">
              {bestDaily.bestDate
                ? t("characterDetail.recordDate", { date: bestDaily.bestDate })
                : t("characterDetail.noData")}
            </p>
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-3">{t("characterDetail.chartGain7d")}</h3>
          <div className="h-64 md:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekGainSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 13 }} />
                <YAxis
                  tickFormatter={formatExp}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  width={58}
                />
                <Tooltip
                  formatter={(value) => [formatExp(value), t("characterDetail.gainAmount")]}
                />
                <Bar dataKey="dailyGain" fill="#34d399" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-3">{t("characterDetail.chartRank7d")}</h3>
          <div className="h-72 md:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={weekRankSeries}
                margin={{ top: 28, right: 12, left: 4, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#334155"
                  horizontal
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#94a3b8", fontSize: 13 }}
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
                  strokeWidth={2.5}
                  dot={<RankChartDot />}
                  activeDot={{ r: 6, fill: "#0ea5e9", stroke: "#e0f2fe", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
