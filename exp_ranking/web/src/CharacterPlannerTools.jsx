import React, { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { useGainPeriodLabel, useTranslation } from "./i18n/I18nContext";
import {
  LEVEL_CAP,
  MIN_PLANNER_LEVEL,
  computeGainAverages,
  defaultTargetDateIso,
  estimateDaysToLevelWithGain,
  formatExp,
  getGainAmount,
  parseExpInputBillions,
  requiredGainForLevelByDate,
  slashDateFromParts,
  targetDatePartsAfterDays,
} from "./rankingUtils";

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

function GhostZeroInput({ value, onChange, className = "", type = "text", inputMode, suffix = null, ...inputProps }) {
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
        {...inputProps}
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
  const actualDailyGain = getGainAmount(character, "daily");
  const defaultDailyGainInput = String(
    Math.round((actualDailyGain / 1_000_000_000) * 1000) / 1000,
  );
  const [dailyGainInput, setDailyGainInput] = useState(defaultDailyGainInput);

  useEffect(() => {
    setTargetLevelInput(String(defaultLevel));
    setDailyGainInput(defaultDailyGainInput);
  }, [character.id, defaultDailyGainInput, defaultLevel]);

  const parsedTargetLevel = useMemo(
    () => parseTargetLevelInput(targetLevelInput),
    [targetLevelInput]
  );

  const dailyGain = parseExpInputBillions(dailyGainInput) ?? 0;
  const targetLevel =
    parsedTargetLevel != null && Number.isInteger(parsedTargetLevel)
      ? Math.min(LEVEL_CAP, Math.max(MIN_PLANNER_LEVEL, parsedTargetLevel))
      : null;
  const targetReached = targetLevel != null && targetLevel <= character.level;

  const estimates = useMemo(() => {
    if (targetLevel == null || targetReached || dailyGain <= 0) {
      return [];
    }
    const rows = [];
    for (let level = character.level + 1; level <= targetLevel; level += 1) {
      const estimate = estimateDaysToLevelWithGain(character, expTable, level, dailyGain);
      rows.push({
        level,
        days: estimate.days,
        date: estimate.days ? slashDateFromParts(targetDatePartsAfterDays(estimate.days, t)) : "-",
      });
    }
    return rows;
  }, [character, dailyGain, expTable, t, targetLevel, targetReached]);

  return (
    <PlannerCard title={t("characterDetail.planner.daysToLevelTitle")}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel>{t("characterDetail.planner.targetLevel")}</FieldLabel>
          <GhostZeroInput
            type="number"
            inputMode="numeric"
            min={MIN_PLANNER_LEVEL}
            max={LEVEL_CAP}
            value={targetLevelInput}
            onChange={(event) => setTargetLevelInput(event.target.value)}
            className="w-full bg-slate-900 border-slate-700 text-slate-100"
          />
        </div>
        <div>
          <FieldLabel>{t("characterDetail.planner.dailyExp")}</FieldLabel>
          <GhostZeroInput
            type="text"
            inputMode="decimal"
            value={dailyGainInput}
            onChange={(event) => setDailyGainInput(event.target.value)}
            className="w-full bg-slate-900 border-slate-700 text-slate-100 pr-8"
            suffix={
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                B
              </span>
            }
          />
        </div>
      </div>

      {targetReached ? (
        <ResultLine accent="text-cyan-300">{t("characterDetail.planner.levelReached")}</ResultLine>
      ) : dailyGain <= 0 ? (
        <ResultLine accent="text-slate-500">{t("characterDetail.planner.noGain")}</ResultLine>
      ) : estimates.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="p-2 text-left">{t("characterDetail.planner.levelColumn")}</th>
                <th className="p-2 text-right">{t("characterDetail.planner.daysColumn")}</th>
                <th className="p-2 text-right">{t("characterDetail.planner.dateColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((row) => (
                <tr key={row.level} className="border-t border-slate-800">
                  <td className="p-2 font-semibold">Lv.{row.level}</td>
                  <td className="p-2 text-right tabular-nums">{t("characterDetail.aboutDaysInline", { days: row.days })}</td>
                  <td className="p-2 text-right text-cyan-300 tabular-nums">{row.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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
    </div>
  );
}
