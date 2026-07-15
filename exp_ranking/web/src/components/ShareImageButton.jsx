import { useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Image as ImageIcon, Loader2, Share2, X } from "lucide-react";
import { toBlob } from "html-to-image";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  computeGainAverages,
  formatExp,
  formatJobName,
  getGainAmount,
  getGainRank,
  lastHistoryPoints,
  levelExpPercent,
} from "../rankingUtils";
import { toShareProxyUrl } from "../shareImageProxy";
import { buildShareText, characterDetailUrl, safeShareFileName, xIntentUrl } from "../shareImageUtils";

const CARD_WIDTH = 1600;
const CARD_HEIGHT = 900;
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" rx="28" fill="#0f172a"/><circle cx="90" cy="70" r="34" fill="#34d399"/><path d="M36 154c10-38 98-38 108 0" fill="#34d399" opacity="0.84"/><circle cx="78" cy="66" r="5" fill="#0f172a"/><circle cx="102" cy="66" r="5" fill="#0f172a"/></svg>`;
const PLACEHOLDER_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLACEHOLDER_SVG)}`;

function historyForShare(character) {
  const points = lastHistoryPoints(character, 7);
  return points.map((point, index) => ({
    label: point.date || point.snapshotDate?.slice(5)?.replace("-", "/") || `D${index + 1}`,
    dailyGain: Math.max(0, Number(point.dailyGain || 0)),
    dailyGainBillions: Math.max(0, Number(point.dailyGain || 0) / 1_000_000_000),
    dailyRank: Number(point.dailyRank || 0) || null,
  }));
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

function ShareImageCard({ character, gainRankMaps, imageSrc, options, detailUrl, t }) {
  const history = useMemo(() => historyForShare(character), [character]);
  const averages = useMemo(() => computeGainAverages(character), [character]);
  const daily = getGainAmount(character, "daily");
  const weekly = getGainAmount(character, "weekly");
  const monthly = getGainAmount(character, "monthly");
  const expPercent = levelExpPercent(character);
  const dailyRank = getGainRank(gainRankMaps, character.id, "daily");
  const weeklyRank = getGainRank(gainRankMaps, character.id, "weekly");
  const monthlyRank = getGainRank(gainRankMaps, character.id, "monthly");
  const rankData = history.filter((point) => point.dailyRank != null);

  return (
    <div
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      className="relative overflow-hidden bg-slate-950 p-14 text-slate-100"
    >
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-emerald-500/10 to-transparent" />
      <header className="relative z-10 flex items-start justify-between">
        <div>
          <p className="text-2xl font-bold text-sky-300">Lulumi Tools</p>
          <h1 className="mt-2 text-6xl font-extrabold tracking-normal">EXP Share Card</h1>
        </div>
        <div className="text-right text-2xl font-bold text-cyan-300">lulumi-tools.com</div>
      </header>

      <section className="relative z-10 mt-10 grid grid-cols-[190px_1fr_300px] items-center gap-8">
        <div className="grid h-[180px] w-[180px] place-items-center overflow-hidden rounded-[28px] border border-slate-700 bg-slate-900">
          <img src={imageSrc} crossOrigin="anonymous" alt="" className="h-full w-full object-cover scale-[1.5] -translate-y-[8%]" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-slate-400">{t("characterDetail.title")}</p>
          <h2 className="mt-2 break-words text-6xl font-extrabold leading-tight tracking-normal">{character.name}</h2>
          <p className="mt-4 text-3xl font-bold text-blue-200">
            {formatJobName(character.job)} <span className="text-slate-600">·</span> {character.worldId || "-"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-7 text-right">
          <p className="text-2xl font-bold text-slate-400">Lv.{character.level}</p>
          <p className="mt-2 text-5xl font-extrabold tabular-nums">{expPercent.toFixed(3)}%</p>
          <p className="mt-4 text-2xl font-bold text-cyan-300">#{character.rank}</p>
        </div>
      </section>

      <section className="relative z-10 mt-8 grid grid-cols-3 gap-5">
        {[
          ["Daily", daily, dailyRank],
          ["Weekly", weekly, weeklyRank],
          ["Monthly", monthly, monthlyRank],
        ].map(([label, amount, rank]) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6">
            <p className="text-2xl font-bold text-slate-400">{label}</p>
            <p className="mt-3 text-4xl font-extrabold text-emerald-400">+{formatExp(amount)}</p>
            <p className="mt-3 text-xl font-bold text-slate-300">{t("characterDetail.rank")} {rank ? `#${rank}` : "-"}</p>
          </div>
        ))}
      </section>

      {options.includeAverages ? (
        <section className="relative z-10 mt-5 grid grid-cols-2 gap-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <p className="text-xl font-bold text-slate-400">{t("characterDetail.planner.avg7d")}</p>
            <p className="mt-2 text-3xl font-extrabold text-emerald-400">{averages.daily7 != null ? `+${formatExp(averages.daily7)}` : "-"}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <p className="text-xl font-bold text-slate-400">{t("characterDetail.planner.avg30d")}</p>
            <p className="mt-2 text-3xl font-extrabold text-emerald-400">{averages.daily30 != null ? `+${formatExp(averages.daily30)}` : "-"}</p>
          </div>
        </section>
      ) : null}

      {options.includeCharts ? (
        <section className="relative z-10 mt-6 grid grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <h3 className="mb-3 text-2xl font-extrabold">{t("characterDetail.chartGain")}</h3>
            <BarChart width={680} height={260} data={history} margin={{ top: 8, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#263449" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "#93c5fd", fontSize: 16 }} axisLine={{ stroke: "#475569" }} />
              <YAxis tickFormatter={(value) => `${Math.round(value)}B`} tick={{ fill: "#93c5fd", fontSize: 16 }} axisLine={{ stroke: "#475569" }} width={54} />
              <Bar dataKey="dailyGainBillions" fill="#34d399" radius={[8, 8, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <h3 className="mb-3 text-2xl font-extrabold">{t("characterDetail.chartRank")}</h3>
            <LineChart width={680} height={260} data={rankData} margin={{ top: 8, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#263449" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "#93c5fd", fontSize: 16 }} axisLine={{ stroke: "#475569" }} />
              <YAxis reversed tickFormatter={(value) => `#${value}`} tick={{ fill: "#93c5fd", fontSize: 16 }} axisLine={{ stroke: "#475569" }} width={58} />
              <Line type="monotone" dataKey="dailyRank" stroke="#38bdf8" strokeWidth={4} dot={{ r: 5, fill: "#020617", stroke: "#bae6fd", strokeWidth: 3 }} isAnimationActive={false} />
            </LineChart>
          </div>
        </section>
      ) : null}

      <footer className="absolute bottom-8 left-14 right-14 z-10 flex justify-between text-lg font-bold text-slate-400">
        <span>{detailUrl}</span>
        <span>Generated in browser</span>
      </footer>
    </div>
  );
}

export default function ShareImageButton({ character, gainRankMaps, t }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("idle");
  const [blob, setBlob] = useState(null);
  const [imageSrc, setImageSrc] = useState(PLACEHOLDER_DATA_URL);
  const [options, setOptions] = useState({ includeCharts: true, includeAverages: false });
  const cardRef = useRef(null);

  const detailUrl = useMemo(() => characterDetailUrl(character), [character]);
  const fileName = useMemo(() => safeShareFileName(character), [character]);
  const shareText = useMemo(() => buildShareText(character, detailUrl, t), [character, detailUrl, t]);

  const reset = () => {
    setBlob(null);
    setStatus("idle");
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
        backgroundColor: "#020617",
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

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100">{t("shareImage.title")}</h2>
                <p className="mt-1 text-sm text-slate-400">{t("shareImage.description")}</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="border-slate-700" onClick={() => setOpen(false)}>
                <X size={16} />
              </Button>
            </div>

            <div className="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={options.includeCharts} onChange={(event) => { reset(); setOptions((current) => ({ ...current, includeCharts: event.target.checked })); }} />
                {t("shareImage.includeCharts")}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={options.includeAverages} onChange={(event) => { reset(); setOptions((current) => ({ ...current, includeAverages: event.target.checked })); }} />
                {t("shareImage.includeAverages")}
              </label>
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
                gainRankMaps={gainRankMaps}
                imageSrc={imageSrc}
                options={options}
                detailUrl={detailUrl}
                t={t}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
