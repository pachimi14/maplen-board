import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, Image as ImageIcon, Loader2, Share2, X } from "lucide-react";
import { toBlob } from "html-to-image";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  formatExp,
  formatJobName,
  getGainAmount,
  getGainRank,
  lastHistoryPoints,
  levelExpPercent,
} from "../rankingUtils";
import {
  calculateTopPercent,
  computePassedAndOvertaken,
} from "../stats";
import {
  buildGoalDisplayModel,
  classifyHistoryAvailability,
  limitWithOthers,
  rankMovementDirection,
} from "./myCharacterUtils";
import { useProfile } from "../profile/ProfileContext";
import { toShareProxyUrl } from "../shareImageProxy";
import { DEFAULT_SHARE_IMAGE_THEME, getShareImageTheme, listShareImageThemes } from "../shareImageThemes";
import { buildShareText, characterDetailUrl, safeShareFileName, xIntentUrl } from "../shareImageUtils";

const CARD_WIDTH = 1600;
const CARD_HEIGHT = 900;
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" rx="28" fill="#0f172a"/><circle cx="90" cy="70" r="34" fill="#34d399"/><path d="M36 154c10-38 98-38 108 0" fill="#34d399" opacity="0.84"/><circle cx="78" cy="66" r="5" fill="#0f172a"/><circle cx="102" cy="66" r="5" fill="#0f172a"/></svg>`;
const PLACEHOLDER_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLACEHOLDER_SVG)}`;
const MOVEMENT_DISPLAY_LIMIT = 2;

function historyForShare(character, days) {
  const points = lastHistoryPoints(character, days);
  return points.map((point, index) => ({
    label: point.date || point.snapshotDate?.slice(5)?.replace("-", "/") || "D" + (index + 1),
    snapshotDate: point.snapshotDate || point.date || null,
    dailyGain: Math.max(0, Number(point.dailyGain || 0)),
    dailyGainBillions: Math.max(0, Number(point.dailyGain || 0) / 1_000_000_000),
  }));
}

function formatEnglishDate(isoDate) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(isoDate + "T00:00:00Z"));
}

function topPercentTextEnglish(topPercent) {
  return topPercent != null ? "Top " + topPercent.toFixed(1) + "%" : null;
}

function formatGoalTargetEnglish(goal) {
  if (!goal) return "No goal set";
  return "Lv" + goal.targetLevel + " by " + (formatEnglishDate(goal.targetDateIso) ?? goal.targetDateIso);
}

function goalDeltaTextEnglish(model) {
  if (!model || model.daysDelta == null) return "";
  const days = Math.abs(model.daysDelta);
  const unit = days === 1 ? "day" : "days";
  if (model.daysDelta > 0) return days + " " + unit + " ahead";
  if (model.daysDelta < 0) return days + " " + unit + " behind";
  return "On track";
}

function waitForImages(root) {
  const images = [...root.querySelectorAll("img")];
  return Promise.all(
    images.map((image) => {
      if (image.complete && image.naturalWidth > 0) {
        return Promise.resolve();
      }
      if (image.decode) {
        return image.decode().catch(() => undefined);
      }
      return new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }),
  );
}

function loadImageOrPlaceholder(src) {
  if (!src) {
    return Promise.resolve(PLACEHOLDER_DATA_URL);
  }
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(PLACEHOLDER_DATA_URL), 2500);
    image.crossOrigin = "anonymous";
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(src);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(PLACEHOLDER_DATA_URL);
    };
    image.src = src;
  });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyPngToClipboard(blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function ThemeLayer({ theme }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden"
      style={{ userSelect: "none" }}
    >
      {theme.background ? (
        <img src={theme.background} alt="" draggable={false} className="absolute left-0 top-0 h-[900px] w-[1600px] object-fill" />
      ) : null}
      {theme.frame ? (
        <img src={theme.frame} alt="" draggable={false} className="absolute left-0 top-0 h-[900px] w-[1600px] object-fill" />
      ) : null}
    </div>
  );
}

function ThemePreviewButton({ theme, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group overflow-hidden rounded-xl border bg-slate-950 p-2 text-left transition " +
        (selected ? "border-cyan-400 ring-2 ring-cyan-400/30" : "border-slate-700 hover:border-slate-500")
      }
    >
      <div className="relative aspect-video overflow-hidden rounded-lg bg-slate-900">
        <img src={theme.frame} alt="" draggable={false} className="absolute inset-0 h-full w-full object-fill" />
        <div className="absolute left-[7%] top-[12%] h-[52%] w-[18%] rounded bg-white/60" />
        <div className="absolute left-[25%] top-[19%] h-[48%] w-[47%] rounded bg-white/55">
          <div className="absolute bottom-[18%] left-[10%] h-[34%] w-[10%] rounded-sm bg-emerald-400" />
          <div className="absolute bottom-[18%] left-[24%] h-[42%] w-[10%] rounded-sm bg-emerald-400" />
          <div className="absolute bottom-[18%] left-[38%] h-[56%] w-[10%] rounded-sm bg-emerald-400" />
          <div className="absolute bottom-[18%] left-[52%] h-[46%] w-[10%] rounded-sm bg-emerald-400" />
          <div className="absolute bottom-[18%] left-[66%] h-[50%] w-[10%] rounded-sm bg-emerald-400" />
        </div>
        <div className="absolute right-[5%] top-[20%] flex h-[48%] w-[19%] flex-col gap-[6%]">
          <div className="flex-1 rounded bg-white/65" />
          <div className="flex-1 rounded bg-white/65" />
          <div className="flex-1 rounded bg-white/65" />
        </div>
        <div className="absolute bottom-[6%] left-[5%] h-[20%] w-[29%] rounded bg-white/65" />
        <div className="absolute bottom-[6%] left-[37%] h-[20%] w-[27%] rounded bg-white/65" />
        <div className="absolute bottom-[6%] right-[5%] h-[20%] w-[29%] rounded bg-white/65" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className="font-bold text-slate-100">{theme.name}</span>
        {selected ? <span className="text-xs font-bold text-cyan-300">✓</span> : null}
      </div>
    </button>
  );
}
function rankChangeTextEnglish(character) {
  const direction = rankMovementDirection(character.previousRank, character.rankFluctuation);
  const count = Math.abs(character.rankFluctuation || 0);
  if (direction === "up") {
    return { text: "\u25B2" + count, className: "text-emerald-600" };
  }
  if (direction === "down") {
    return { text: "\u25BC" + count, className: "text-rose-500" };
  }
  if (direction === "same") {
    return { text: "0", className: "text-slate-500" };
  }
  return { text: "New", className: "text-slate-400" };
}

function CharacterHero({ character, imageSrc, allCharacters }) {
  const expPercent = levelExpPercent(character);
  const overallTopPercent = calculateTopPercent(character.rank, allCharacters?.length ?? null);
  const change = rankChangeTextEnglish(character);
  const nameLength = Array.from(String(character.name ?? "")).length || 1;
  const nameFontSize = Math.min(46, Math.max(22, Math.floor(268 / nameLength / 0.58)));

  return (
    <section className="absolute left-[65px] top-[65px] z-10 h-[555px] w-[300px] text-center">
      <div className="absolute left-[30px] top-[18px] grid h-[245px] w-[240px] place-items-center overflow-hidden">
        <img src={imageSrc} crossOrigin="anonymous" alt="" className="h-full w-full object-cover scale-[2] -translate-y-[16%]" />
      </div>
      <div className="absolute left-0 top-[286px] w-full px-4">
        <h2 className="whitespace-nowrap font-black text-slate-950" style={{ fontSize: `${nameFontSize}px`, lineHeight: 1.05 }}>{character.name}</h2>
        <p className="mt-1 text-[25px] font-black leading-tight text-slate-600">
          {formatJobName(character.job)} <span className="text-slate-300">/</span> <span className="text-cyan-600">{character.worldId || "-"}</span>
        </p>
        <p className="mt-2 text-[24px] font-black leading-tight tabular-nums text-slate-900">Lv.{character.level} {expPercent.toFixed(3)}%</p>
        <div className="mt-0 flex items-center justify-center gap-3">
          <p className="text-[38px] font-black leading-none tabular-nums text-cyan-600">#{character.rank}</p>
          <p className={"text-xl font-black " + change.className}>{change.text}</p>
        </div>
        {overallTopPercent != null ? <p className="mt-0 text-base font-black leading-tight text-slate-500">{topPercentTextEnglish(overallTopPercent)}</p> : null}
      </div>
    </section>
  );
}


function PeriodStat({ label, amount, rank, className, amountClass }) {
  return (
    <section className={"absolute z-10 text-slate-950 " + className}>
      <div className="pl-[64px] pr-5 pt-[20px]">
        <p className="text-[24px] font-black text-slate-500">{label}</p>
        <div className="mt-2 -ml-[40px] flex items-baseline gap-4">
          <p className={"whitespace-nowrap text-[34px] font-black leading-none tracking-tight tabular-nums " + amountClass}>+{formatExp(amount)}</p>
          <p className="text-[21px] font-black tabular-nums text-slate-500">#{rank ?? "-"}</p>
        </div>
      </div>
    </section>
  );
}

function MainGainPanel({ character, gainRankMaps, history, days }) {
  const tickInterval = days > 14 ? 4 : 0;
  const latestSnapshotDate = history.at(-1)?.snapshotDate ?? character.history?.at(-1)?.snapshotDate ?? null;
  const daily = getGainAmount(character, "daily");
  const weekly = getGainAmount(character, "weekly");
  const monthly = getGainAmount(character, "monthly");
  const dailyRank = getGainRank(gainRankMaps, character.id, "daily");
  const weeklyRank = getGainRank(gainRankMaps, character.id, "weekly");
  const monthlyRank = getGainRank(gainRankMaps, character.id, "monthly");

  return (
    <>
      <section className="absolute left-[405px] top-[200px] z-10 h-[420px] w-[815px] overflow-hidden text-slate-950">
        <div className="mb-2 flex items-center justify-between gap-4 px-[18px] pt-[18px]">
          <p className="text-[24px] font-black text-slate-700">Daily EXP Gain</p>
          <p className="text-sm font-black text-slate-500">Data as of {formatEnglishDate(latestSnapshotDate) ?? "-"}</p>
        </div>
        <BarChart width={790} height={340} data={history} margin={{ top: 8, right: 8, bottom: 22, left: 0 }}>
          <CartesianGrid stroke="#dbeafe" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            interval={tickInterval}
            tick={{ fill: "#2563eb", fontSize: 16, fontWeight: 800 }}
            axisLine={{ stroke: "#94a3b8" }}
          />
          <YAxis
            tickFormatter={(value) => Math.round(value) + "B"}
            tick={{ fill: "#2563eb", fontSize: 16, fontWeight: 800 }}
            axisLine={{ stroke: "#94a3b8" }}
            width={58}
          />
          <Bar dataKey="dailyGainBillions" fill="#34d399" radius={[14, 14, 3, 3]} isAnimationActive={false} />
        </BarChart>
      </section>
      <PeriodStat label="Daily" amount={daily} rank={dailyRank} amountClass="text-emerald-600" className="left-[1265px] top-[205px] h-[135px] w-[285px]" />
      <PeriodStat label="Weekly" amount={weekly} rank={weeklyRank} amountClass="text-sky-600" className="left-[1265px] top-[365px] h-[135px] w-[285px]" />
      <PeriodStat label="Monthly" amount={monthly} rank={monthlyRank} amountClass="text-violet-600" className="left-[1265px] top-[508px] h-[145px] w-[285px]" />
    </>
  );
}

function RankLine({ title, rank, total, topPercent, accentClass }) {
  const rankText = rank != null ? "#" + rank + (total != null ? "/" + total : "") : "-";
  return (
    <div className="py-1">
      <p className="text-base font-black text-slate-500">{title}</p>
      <div className="mt-1 flex items-baseline gap-3">
        <p className={"text-[31px] font-black leading-none tabular-nums " + accentClass}>{rankText}</p>
        {topPercent != null ? <p className="text-base font-black text-cyan-600">{topPercentTextEnglish(topPercent)}</p> : null}
      </div>
    </div>
  );
}

function RankTableCard({ character }) {
  const jobTopPercent = calculateTopPercent(character.jobRank, character.jobRankTotal);
  const worldTopPercent = calculateTopPercent(character.worldRank, character.worldRankTotal);

  return (
    <section className="absolute left-[75px] top-[665px] z-10 h-[195px] w-[475px] overflow-hidden text-slate-950">
      <div className="pl-[96px] pr-8 pt-0">
        <RankLine title="Job Rank" rank={character.jobRank} total={character.jobRankTotal} topPercent={jobTopPercent} accentClass="text-cyan-600" />
        <RankLine title="Server Rank" rank={character.worldRank} total={character.worldRankTotal} topPercent={worldTopPercent} accentClass="text-violet-600" />
      </div>
    </section>
  );
}

function MovementLine({ title, entry, othersCount }) {
  if (!entry) return null;
  const name = entry.name || entry.historyKey || "-";
  return (
    <div className="py-1">
      <p className="text-base font-black text-slate-500">{title}</p>
      <p className="mt-1 truncate text-[26px] font-black leading-tight text-slate-950">
        {name} <span className="text-lg text-slate-500">#{entry.rank ?? "-"}</span>
        {othersCount > 0 ? <span className="ml-2 text-base text-slate-500">+{othersCount}</span> : null}
      </p>
    </div>
  );
}

function MovementSummaryCard({ character, allCharacters }) {
  const movement = computePassedAndOvertaken(
    { historyKey: character.historyKey, rank: character.rank, previousRank: character.previousRank },
    allCharacters,
  );
  const passed = limitWithOthers(movement.passed, MOVEMENT_DISPLAY_LIMIT);
  const overtaken = limitWithOthers(movement.overtakenBy, MOVEMENT_DISPLAY_LIMIT);

  return (
    <section className="absolute left-[585px] top-[665px] z-10 h-[195px] w-[480px] overflow-hidden text-slate-950">
      <div className="pl-[110px] pr-8 pt-0">
        <p className="text-lg font-black text-slate-500">Level Rank Movement</p>
        {passed.shown.length || overtaken.shown.length ? (
          <>
            <MovementLine title="Passed" entry={passed.shown[0]} othersCount={passed.othersCount} />
            <MovementLine title="Overtaken by" entry={overtaken.shown[0]} othersCount={overtaken.othersCount} />
          </>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-2xl font-black text-slate-400">No movement</p>
          </div>
        )}
      </div>
    </section>
  );
}

function GoalSummaryCard({ character, expTable, goal }) {
  const historyAvailability = classifyHistoryAvailability(character.history, undefined);
  const model = historyAvailability === "ready" && goal
    ? buildGoalDisplayModel({ character, expTable, goal, todayGain: getGainAmount(character, "daily") })
    : null;

  const targetLine = formatGoalTargetEnglish(goal);

  let progressNode = <span className="text-slate-500">-</span>;
  let arrivalNode = <span className="text-slate-500">-</span>;

  if (goal && !model) {
    progressNode = <span className="text-slate-500">Loading</span>;
    arrivalNode = <span className="text-slate-500">Loading</span>;
  } else if (model?.achieved) {
    progressNode = <span className="text-emerald-600">Achieved</span>;
    arrivalNode = <span className="text-emerald-600">Achieved</span>;
  } else if (model?.indeterminate) {
    progressNode = <span className="text-slate-500">Not enough data</span>;
    arrivalNode = <span className="text-slate-500">Not enough data</span>;
  } else if (model) {
    const good = model.achievementRate >= 1;
    const tone = good ? "text-emerald-600" : "text-orange-500";
    const arrivalTone = model.daysDelta > 0 ? "text-emerald-600" : model.daysDelta < 0 ? "text-rose-500" : "text-slate-600";
    progressNode = (
      <>
        <span className={tone}>Today +{formatExp(model.todayGain)}</span>
        <span className="text-slate-400"> / </span>
        <span className={tone}>Need +{formatExp(model.requiredDailyGain)}</span>
        <br />
        <span className={tone}>Progress {Math.round(model.achievementRate * 100)}%</span>
      </>
    );
    arrivalNode = (
      <>
        <span className={arrivalTone}>ETA {formatEnglishDate(model.estimatedArrivalDate) ?? model.estimatedArrivalDate}</span>
        <span className="text-slate-400"> / </span>
        <span className={arrivalTone}>{goalDeltaTextEnglish(model)}</span>
      </>
    );
  }

  return (
    <section className="absolute left-[1100px] top-[665px] z-10 h-[195px] w-[465px] overflow-hidden text-slate-950">
      <div className="pl-[96px] pr-8 pt-0">
        <p className="text-lg font-black text-slate-500">Goal</p>
        <p className="mt-1 text-[27px] font-black leading-tight text-slate-950">{targetLine}</p>
        <p className="mt-2 text-base font-black leading-snug">{progressNode}</p>
        <p className="mt-2 text-base font-black leading-snug">{arrivalNode}</p>
      </div>
    </section>
  );
}

function ShareImageCard({ character, allCharacters, gainRankMaps, expTable, goal, imageSrc, options, t }) {
  const history = useMemo(() => historyForShare(character, options.mainDays), [character, options.mainDays]);
  const theme = getShareImageTheme(options.themeName);

  return (
    <div
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      className="relative overflow-hidden bg-[#FAFCFF] text-slate-950"
    >
      <ThemeLayer theme={theme} />
      <CharacterHero character={character} imageSrc={imageSrc} allCharacters={allCharacters} />
      <MainGainPanel character={character} gainRankMaps={gainRankMaps} history={history} days={options.mainDays} />
      <RankTableCard character={character} />
      <MovementSummaryCard character={character} allCharacters={allCharacters} />
      <GoalSummaryCard character={character} expTable={expTable} goal={goal} />
    </div>
  );
}
export default function ShareImageButton({ character, allCharacters = [], gainRankMaps, expTable, t }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("idle");
  const [blob, setBlob] = useState(null);
  const [imageSrc, setImageSrc] = useState(PLACEHOLDER_DATA_URL);
  const [options, setOptions] = useState({ mainDays: 7, themeName: DEFAULT_SHARE_IMAGE_THEME });
  const cardRef = useRef(null);
  const { getGoal } = useProfile();

  const detailUrl = useMemo(() => characterDetailUrl(character), [character]);
  const fileName = useMemo(() => safeShareFileName(character), [character]);
  const shareText = useMemo(() => buildShareText(character, detailUrl, t, gainRankMaps), [character, detailUrl, gainRankMaps, t]);
  const goal = character?.historyKey ? getGoal(character.historyKey) : null;
  const themes = useMemo(() => listShareImageThemes(), []);

  useEffect(() => {
    setBlob(null);
    setStatus("idle");
    setImageSrc(PLACEHOLDER_DATA_URL);
  }, [character?.historyKey]);

  const reset = () => {
    setBlob(null);
    setStatus("idle");
  };

  const updateMainDays = (mainDays) => {
    reset();
    setOptions((current) => ({ ...current, mainDays }));
  };

  const updateTheme = (themeName) => {
    reset();
    setOptions((current) => ({ ...current, themeName }));
  };

  const generateBlob = async () => {
    if (busy) {
      return blob;
    }
    setBusy(true);
    setStatus("generating");
    try {
      const proxiedUrl = toShareProxyUrl(character.imageUrl);
      const resolvedImage = await loadImageOrPlaceholder(proxiedUrl || PLACEHOLDER_DATA_URL);
      setImageSrc(resolvedImage);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      if (!cardRef.current) {
        throw new Error("share card is not ready");
      }
      await waitForImages(cardRef.current);
      const nextBlob = await toBlob(cardRef.current, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        canvasWidth: CARD_WIDTH,
        canvasHeight: CARD_HEIGHT,
        pixelRatio: 1,
        backgroundColor: "#f8fafc",
        cacheBust: true,
        imagePlaceholder: PLACEHOLDER_DATA_URL,
      });
      if (!nextBlob) {
        throw new Error("toBlob returned null");
      }
      setBlob(nextBlob);
      setStatus("ready");
      return nextBlob;
    } catch (error) {
      setStatus("failed");
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      const nextBlob = blob || (await generateBlob());
      const ok = await copyPngToClipboard(nextBlob);
      if (ok) {
        setStatus("copied");
      } else {
        downloadBlob(nextBlob, fileName);
        setStatus("downloadedFallback");
      }
    } catch {
      setStatus("failed");
    }
  };

  const handleDownload = async () => {
    try {
      const nextBlob = blob || (await generateBlob());
      downloadBlob(nextBlob, fileName);
      setStatus("downloaded");
    } catch {
      setStatus("failed");
    }
  };

  const handleXShare = () => {
    window.open(xIntentUrl(shareText), "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-8 border-slate-700" onClick={() => setOpen(true)}>
        <ImageIcon size={14} className="mr-1.5 inline" />
        {t("shareImage.open")}
      </Button>

      {open ? createPortal((
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100">{t("shareImage.title")}</h2>
                <p className="mt-1 text-sm text-slate-400">{t("shareImage.description")}</p>
                {!goal ? (
                  <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                    {t("shareImage.goalHint")}
                  </p>
                ) : null}
              </div>
              <Button type="button" size="sm" variant="outline" className="border-slate-700" onClick={() => setOpen(false)}>
                <X size={16} />
              </Button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
              <p className="mb-2 font-bold text-slate-200">{t("shareImage.theme")}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {themes.map((theme) => (
                  <ThemePreviewButton
                    key={theme.id}
                    theme={theme}
                    selected={options.themeName === theme.id}
                    onClick={() => updateTheme(theme.id)}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{t("shareImage.themeHelp")}</p>
            </div>

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
              <p className="mb-2 font-bold text-slate-200">{t("shareImage.mainMetric")}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={options.mainDays === 7 ? "default" : "outline"} className={options.mainDays === 7 ? "" : "border-slate-700"} onClick={() => updateMainDays(7)}>
                  {t("shareImage.main7d")}
                </Button>
                <Button type="button" size="sm" variant={options.mainDays === 30 ? "default" : "outline"} className={options.mainDays === 30 ? "" : "border-slate-700"} onClick={() => updateMainDays(30)}>
                  {t("shareImage.main30d")}
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={handleCopy} disabled={busy}>
                {busy ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Copy size={16} className="mr-2" />}
                {t("shareImage.copyPng")}
              </Button>
              <Button type="button" variant="outline" className="border-slate-700" onClick={handleDownload} disabled={busy}>
                <Download size={16} className="mr-2" />
                {t("shareImage.downloadPng")}
              </Button>
              <Button type="button" variant="outline" className="border-slate-700" onClick={handleXShare}>
                <Share2 size={16} className="mr-2" />
                {t("shareImage.openX")}
              </Button>
            </div>

            <p className="mt-3 min-h-5 text-sm text-slate-400">
              {status === "generating" ? t("shareImage.generating") : null}
              {status === "ready" ? t("shareImage.ready") : null}
              {status === "copied" ? t("shareImage.copied") : null}
              {status === "downloaded" ? t("shareImage.downloaded") : null}
              {status === "downloadedFallback" ? t("shareImage.downloadedFallback") : null}
              {status === "failed" ? t("shareImage.failed") : null}
            </p>
          </div>

          <div className="pointer-events-none fixed -left-[20000px] top-0" aria-hidden="true">
            <div ref={cardRef}>
              <ShareImageCard
                character={character}
                allCharacters={allCharacters}
                gainRankMaps={gainRankMaps}
                expTable={expTable}
                goal={goal}
                imageSrc={imageSrc}
                options={options}
                t={t}
              />
            </div>
          </div>
        </div>
      ), document.body) : null}
    </>
  );
}
