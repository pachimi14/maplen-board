import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { useGainPeriodLabel, useTranslation } from "./i18n/I18nContext";
import {
  LEVEL_CAP,
  MIN_PLANNER_LEVEL,
  compareGainWith,
  computeGainAverages,
  defaultTargetDateIso,
  estimateDaysToLevelWithGain,
  formatExp,
  getGainAmount,
  parseExpInputBillions,
  requiredGainForLevelByDate,
  slashDateFromParts,
  targetDatePartsAfterDays,
  toDailyGain,
} from "./rankingUtils";

const GAIN_PERIODS = ["daily", "weekly", "monthly"];
const GAIN_SOURCES = ["daily", "weekly", "monthly", "custom"];

function PlannerCard({ title, children, className = "" }) {
  return (
    <div
      className={`bg-slate-950 rounded-2xl p-4 sm:p-5 min-w-0 space-y-4 ${className}`}
    >
      <h3 className="font-bold text-sm sm:text-base">{title}</h3>
      {children}
    </div>
  );
}

function FieldLabel({ children, className = "" }) {
  return (
    <label className={`block text-xs text-slate-400 mb-1 ${className}`}>{children}</label>
  );
}

function ResultLine({ children, accent = "text-emerald-400" }) {
  return <div className={`text-sm font-semibold tabular-nums ${accent}`}>{children}</div>;
}

function GhostZeroInput({ value, onChange, className = "", type = "text", inputMode, suffix = null }) {
  return (
    <div className="relative flex-1 min-w-0">
      {value === "" ? (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none text-sm select-none tabular-nums">
          0
        </span>
      ) : null}
      <Input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={onChange}
        placeholder=""
        className={className}
      />
      {suffix}
    </div>
  );
}

function parseTargetLevelInput(raw) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
}

export function GainAveragesSection({ character, t, variant = "grid", className = "" }) {
  const averages = useMemo(() => computeGainAverages(character), [character]);
  const weeklyPeriod = useGainPeriodLabel("weekly");
  const monthlyPeriod = useGainPeriodLabel("monthly");
  const isSidebar = variant === "stack";

  const renderAvg = (daily, weekly, monthly, days) => {
    if (daily == null) {
      return <div className="text-slate-500 text-sm">{t("characterDetail.noData")}</div>;
    }
    return (
      <div className="space-y-1">
        <div className="text-lg font-bold text-emerald-400 tabular-nums">
          +{formatExp(daily)}
          <span className="text-sm text-slate-400 font-normal ml-1">
            {t("characterDetail.planner.perDay")}
          </span>
        </div>
        <div className="text-xs text-slate-400 tabular-nums leading-relaxed">
          +{formatExp(weekly)} / {weeklyPeriod}
          {isSidebar ? " " : <br />}
          {isSidebar ? "· " : null}+{formatExp(monthly)} / {monthlyPeriod}
        </div>
        {days > 0 ? (
          <div className="text-xs text-slate-500">
            {t("characterDetail.planner.basedOnDays", { count: days })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <PlannerCard
      title={t("characterDetail.planner.avgTitle")}
      className={`h-full ${isSidebar ? "text-center" : ""} ${className}`}
    >
      <div
        className={
          isSidebar ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 sm:grid-cols-2 gap-4"
        }
      >
        <div className={isSidebar ? "min-w-0" : ""}>
          <FieldLabel className={isSidebar ? "text-center" : ""}>
            {t("characterDetail.planner.avg7d")}
          </FieldLabel>
          {renderAvg(
            averages.daily7,
            averages.weekly7,
            averages.daily7 != null ? averages.daily7 * 30 : null,
            averages.days7
          )}
        </div>
        <div className={isSidebar ? "min-w-0" : ""}>
          <FieldLabel className={isSidebar ? "text-center" : ""}>
            {t("characterDetail.planner.avg30d")}
          </FieldLabel>
          {renderAvg(
            averages.daily30,
            averages.daily30 != null ? averages.daily30 * 7 : null,
            averages.monthly30,
            averages.days30
          )}
        </div>
      </div>
    </PlannerCard>
  );
}

function DaysToLevelSection({ character, expTable, t }) {
  const defaultLevel = Math.min(
    Math.max((character.level ?? 0) + 1, MIN_PLANNER_LEVEL),
    LEVEL_CAP
  );
  const [targetLevelInput, setTargetLevelInput] = useState(String(defaultLevel));
  const [gainSource, setGainSource] = useState("daily");
  const [customGainInput, setCustomGainInput] = useState("");
  const [customGainPeriod, setCustomGainPeriod] = useState("daily");

  const parsedTargetLevel = useMemo(
    () => parseTargetLevelInput(targetLevelInput),
    [targetLevelInput]
  );

  const autoGain = useMemo(
    () => ({
      daily: getGainAmount(character, "daily"),
      weekly: getGainAmount(character, "weekly"),
      monthly: getGainAmount(character, "monthly"),
    }),
    [character]
  );

  const periodGain =
    gainSource === "custom" ? parseExpInputBillions(customGainInput) : autoGain[gainSource];
  const gainPeriodForConversion = gainSource === "custom" ? customGainPeriod : gainSource;
  const dailyGain =
    periodGain != null && periodGain > 0 ? toDailyGain(periodGain, gainPeriodForConversion) : 0;

  const estimate = useMemo(() => {
    if (parsedTargetLevel == null) {
      return { days: null, completed: false, noGain: false, empty: true };
    }
    return estimateDaysToLevelWithGain(character, expTable, parsedTargetLevel, dailyGain);
  }, [character, expTable, parsedTargetLevel, dailyGain]);

  const dateParts = useMemo(() => {
    if (!estimate.days || estimate.completed || estimate.noGain) {
      return null;
    }
    return targetDatePartsAfterDays(estimate.days, t);
  }, [estimate, t]);

  return (
    <PlannerCard title={t("characterDetail.planner.daysToLevelTitle")}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel>{t("characterDetail.planner.targetLevel")}</FieldLabel>
          <GhostZeroInput
            type="number"
            inputMode="numeric"
            value={targetLevelInput}
            onChange={(event) => setTargetLevelInput(event.target.value)}
            className="w-full bg-slate-900 border-slate-700 text-slate-100"
          />
        </div>
        <div>
          <FieldLabel>{t("characterDetail.planner.gainRate")}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {GAIN_SOURCES.map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setGainSource(source)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs sm:text-sm transition-colors ${
                  gainSource === source
                    ? "border-sky-500 bg-sky-950/60 text-sky-200"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {source === "custom"
                  ? t("characterDetail.planner.gainCustom")
                  : t(`period.${source}`)}
              </button>
            ))}
          </div>
          {gainSource === "custom" ? (
            <div className="flex gap-2 mt-2">
              <GhostZeroInput
                type="text"
                inputMode="decimal"
                value={customGainInput}
                onChange={(event) => setCustomGainInput(event.target.value)}
                className="w-full bg-slate-900 border-slate-700 text-slate-100 pr-8"
                suffix={
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                    B
                  </span>
                }
              />
              <select
                value={customGainPeriod}
                onChange={(event) => setCustomGainPeriod(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100"
              >
                {GAIN_PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {t(`period.${period}`)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="mt-2 text-lg font-bold text-emerald-400 tabular-nums text-center">
              +{formatExp(autoGain[gainSource])}
            </div>
          )}
        </div>
      </div>

      <div className="pt-2 text-center">
        {estimate.empty ? null : estimate.completed ? (
          <ResultLine accent="text-cyan-300">
            {t("characterDetail.planner.levelReached")}
          </ResultLine>
        ) : estimate.noGain ? (
          <ResultLine accent="text-slate-500">{t("characterDetail.planner.noGain")}</ResultLine>
        ) : (
          <div className="space-y-1">
            <div className="text-lg font-bold tabular-nums">
              {t("characterDetail.aboutDaysInline", { days: estimate.days })}
            </div>
            {dateParts ? (
              <div className="text-sm font-semibold text-cyan-300 tabular-nums">
                {slashDateFromParts(dateParts)}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </PlannerCard>
  );
}

function RequiredGainSection({ character, expTable, t }) {
  const defaultLevel = Math.min(
    Math.max((character.level ?? 0) + 1, MIN_PLANNER_LEVEL),
    LEVEL_CAP
  );
  const [targetLevel, setTargetLevel] = useState(defaultLevel);
  const [targetDate, setTargetDate] = useState(() => defaultTargetDateIso(30));

  const result = useMemo(
    () => requiredGainForLevelByDate(character, expTable, targetLevel, targetDate),
    [character, expTable, targetLevel, targetDate]
  );

  const dailyPeriod = useGainPeriodLabel("daily");
  const weeklyPeriod = useGainPeriodLabel("weekly");
  const monthlyPeriod = useGainPeriodLabel("monthly");

  return (
    <PlannerCard title={t("characterDetail.planner.requiredGainTitle")}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel>{t("characterDetail.planner.targetLevel")}</FieldLabel>
          <Input
            type="number"
            min={MIN_PLANNER_LEVEL}
            max={LEVEL_CAP}
            value={targetLevel}
            onChange={(event) => setTargetLevel(Number(event.target.value))}
            className="w-full bg-slate-900 border-slate-700 text-slate-100"
          />
        </div>
        <div>
          <FieldLabel>{t("characterDetail.planner.targetDate")}</FieldLabel>
          <Input
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
            className="w-full bg-slate-900 border-slate-700 text-slate-100"
          />
        </div>
      </div>

      <div className="pt-1 space-y-1">
        {result.completed ? (
          <ResultLine accent="text-cyan-300">
            {t("characterDetail.planner.levelReached")}
          </ResultLine>
        ) : result.invalid ? (
          <ResultLine accent="text-rose-400">{t("characterDetail.planner.invalidDate")}</ResultLine>
        ) : (
          <>
            <div className="text-xs text-slate-400">
              {t("characterDetail.planner.remainingDays", { days: result.days })}
            </div>
            <ResultLine>
              {t("characterDetail.planner.requiredDaily", {
                amount: formatExp(result.daily),
                period: dailyPeriod,
              })}
            </ResultLine>
            <ResultLine>
              {t("characterDetail.planner.requiredWeekly", {
                amount: formatExp(result.weekly),
                period: weeklyPeriod,
              })}
            </ResultLine>
            <ResultLine>
              {t("characterDetail.planner.requiredMonthly", {
                amount: formatExp(result.monthly),
                period: monthlyPeriod,
              })}
            </ResultLine>
          </>
        )}
      </div>
    </PlannerCard>
  );
}

function CompareSection({ character, characters, t }) {
  const [query, setQuery] = useState("");
  const [compareChar, setCompareChar] = useState(null);

  const dailyPeriod = useGainPeriodLabel("daily");
  const weeklyPeriod = useGainPeriodLabel("weekly");
  const monthlyPeriod = useGainPeriodLabel("monthly");
  const periodLabels = { daily: dailyPeriod, weekly: weeklyPeriod, monthly: monthlyPeriod };

  const candidates = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }
    return characters
      .filter(
        (item) => item.id !== character.id && item.name.toLowerCase().includes(trimmed)
      )
      .slice(0, 20);
  }, [characters, character.id, query]);

  const rows = useMemo(() => {
    if (!compareChar) {
      return [];
    }
    return GAIN_PERIODS.map((period) => ({
      period,
      ...compareGainWith(character, compareChar, period),
    }));
  }, [character, compareChar]);

  return (
    <PlannerCard title={t("characterDetail.planner.compareTitle")}>
      <div>
        <FieldLabel>{t("characterDetail.planner.compareSearch")}</FieldLabel>
        <Input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCompareChar(null);
          }}
          className="w-full bg-slate-900 border-slate-700 text-slate-100"
        />
        {candidates.length > 0 && !compareChar ? (
          <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
            {candidates.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCompareChar(item);
                    setQuery(item.name);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800 text-slate-200"
                >
                  {item.name}
                  <span className="text-slate-500 ml-2">
                    Lv.{item.level} #{item.rank}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {!compareChar ? (
        <div className="text-sm text-slate-500">{t("characterDetail.planner.noCompareSelected")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="pb-2 pr-3 font-medium">{t("characterDetail.planner.period")}</th>
                <th className="pb-2 pr-3 font-medium">{t("characterDetail.planner.compareSelf")}</th>
                <th className="pb-2 pr-3 font-medium">{compareChar.name}</th>
                <th className="pb-2 font-medium">{t("characterDetail.planner.compareDiff")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period} className="border-t border-slate-800">
                  <td className="py-2 pr-3 text-slate-300">{periodLabels[row.period]}</td>
                  <td className="py-2 pr-3 text-emerald-400 tabular-nums">+{formatExp(row.self)}</td>
                  <td className="py-2 pr-3 text-sky-300 tabular-nums">+{formatExp(row.other)}</td>
                  <td
                    className={`py-2 tabular-nums font-semibold ${
                      row.diff > 0 ? "text-emerald-400" : row.diff < 0 ? "text-rose-400" : "text-slate-400"
                    }`}
                  >
                    {row.diff > 0 ? "+" : ""}
                    {formatExp(row.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PlannerCard>
  );
}

export default function CharacterPlannerTools({
  character,
  characters,
  expTable,
  showAverages = true,
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-base">{t("characterDetail.planner.sectionTitle")}</h3>
      {showAverages ? <GainAveragesSection character={character} t={t} /> : null}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DaysToLevelSection character={character} expTable={expTable} t={t} />
        <RequiredGainSection character={character} expTable={expTable} t={t} />
      </div>
      <CompareSection character={character} characters={characters} t={t} />
    </div>
  );
}
