import React, { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { UserRound } from "lucide-react";
import FavoriteStar from "./FavoriteStar";
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
  GAIN_PERIOD_LABELS,
  getGainRank,
  formatJobName,
  getGainAmount,
  lastHistoryPoints,
  levelExpPercent,
} from "./rankingUtils";

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
        fontSize={11}
        fontWeight={600}
      >
        #{payload.dailyRank}
      </text>
    </g>
  );
}

function RankChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm shadow-lg">
      <div className="text-slate-400">{label}</div>
      <div className="font-bold text-white mt-0.5">順位 #{row.dailyRank}</div>
      {row.rankDelta == null ? null : row.rankDelta > 0 ? (
        <div className="text-emerald-400 mt-1">↑ {row.rankDelta} 位上昇</div>
      ) : row.rankDelta < 0 ? (
        <div className="text-rose-400 mt-1">↓ {Math.abs(row.rankDelta)} 位下降</div>
      ) : (
        <div className="text-slate-400 mt-1">前日と同順位</div>
      )}
    </div>
  );
}

function GainStatCard({ label, amount, rank }) {
  return (
    <div className="bg-slate-950 rounded-2xl p-4">
      <div className="text-slate-400 text-sm">{label}</div>
      <div className="text-xl font-bold text-emerald-400 mt-1">+{formatExp(amount)}</div>
      <div className="text-sm text-slate-400 mt-1">
        順位{" "}
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
  const dailyGain = getGainAmount(character, "daily");
  const weeklyGain = getGainAmount(character, "weekly");
  const monthlyGain = getGainAmount(character, "monthly");

  const dailyRank = getGainRank(gainRankMaps, character.id, "daily");
  const weeklyRank = getGainRank(gainRankMaps, character.id, "weekly");
  const monthlyRank = getGainRank(gainRankMaps, character.id, "monthly");

  const weekGainSeries = useMemo(
    () => lastHistoryPoints(character, 7),
    [character]
  );

  const weekRankSeries = useMemo(
    () => enrichRankSeries(buildWeekDailyRankSeries(characters, character.id, 7)),
    [characters, character.id]
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

  const level = character.level ?? 0;
  const expPercent = levelExpPercent(character);
  const levelExp = currentLevelExp(character, expTable);

  return (
    <Card className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-start gap-4">
          <img
            src={character.imageUrl}
            alt=""
            className="w-16 h-16 rounded-2xl bg-slate-800 object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <UserRound size={16} />
                キャラクター詳細
              </div>
              {onToggleFavorite ? (
                <FavoriteStar active={isFavorite} onToggle={onToggleFavorite} size={22} />
              ) : null}
            </div>
            <h2 className="text-2xl font-bold truncate">{character.name}</h2>
            <p className="text-slate-400">{formatJobName(character.job)}</p>
            <p className="text-sm text-slate-500 mt-1">レベル順位 #{character.rank}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-950 rounded-2xl p-4">
            <div className="text-slate-400 text-sm">レベル</div>
            <div className="text-2xl font-bold mt-1">
              {level >= 250 ? `Lv.${level}` : `Lv.${level}`}
            </div>
          </div>
          <div className="bg-slate-950 rounded-2xl p-4">
            <div className="text-slate-400 text-sm">EXP</div>
            {level >= 250 ? (
              <div className="text-2xl font-bold mt-1">MAX</div>
            ) : (
              <>
                <div className="text-2xl font-bold mt-1">{expPercent.toFixed(3)}%</div>
                <div className="text-base font-semibold text-cyan-300 mt-1 tabular-nums">
                  {formatExpExact(levelExp)}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <GainStatCard
            label={`${GAIN_PERIOD_LABELS.daily}増加`}
            amount={dailyGain}
            rank={dailyRank}
          />
          <GainStatCard
            label={`${GAIN_PERIOD_LABELS.weekly}増加`}
            amount={weeklyGain}
            rank={weeklyRank}
          />
          <GainStatCard
            label={`${GAIN_PERIOD_LABELS.monthly}増加`}
            amount={monthlyGain}
            rank={monthlyRank}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-slate-950 rounded-2xl p-4">
            <div className="text-slate-400 text-sm">今日の増加量で Lv250 まで</div>
            {daysTo250.label ? (
              <div className="text-2xl font-bold mt-1">{daysTo250.label}</div>
            ) : (
              <>
                <div className="text-2xl font-bold mt-1">約 {daysTo250.days} 日</div>
                <div className="text-lg font-semibold text-cyan-300 mt-1">
                  {daysTo250.targetDateLabel}
                </div>
              </>
            )}
          </div>
          <div className="bg-slate-950 rounded-2xl p-4">
            <div className="text-slate-400 text-sm">デイリー増加 過去最高</div>
            <div className="text-2xl font-bold text-amber-300 mt-1">
              +{formatExp(bestDaily.bestGain)}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {bestDaily.bestDate ? `記録日 ${bestDaily.bestDate}` : "データなし"}
            </p>
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-3">直近1週間のデイリー経験値増加量</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekGainSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis tickFormatter={formatExp} tick={{ fill: "#94a3b8", fontSize: 11 }} width={56} />
                <Tooltip formatter={(value) => [formatExp(value), "増加量"]} />
                <Bar dataKey="dailyGain" fill="#34d399" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-3">直近1週間のデイリー増加量順位</h3>
          <div className="h-64">
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
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  axisLine={{ stroke: "#475569" }}
                />
                <YAxis
                  reversed
                  allowDecimals={false}
                  domain={rankChartScale.domain}
                  ticks={rankChartScale.ticks}
                  tickFormatter={(value) => `#${value}`}
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
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
          <p className="text-xs text-slate-500 mt-2">
            上ほど上位（表示範囲はこの1週間の順位変動に合わせて自動調整）
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
