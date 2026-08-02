import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toCanvas } from "html-to-image";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatExp,
  formatJobName,
  getGainAmount,
  levelExpPercent,
  lastHistoryPoints,
} from "../../src/rankingUtils.js";

const CARD_WIDTH = 1600;
const CARD_HEIGHT = 900;
const IMAGE_MODES = [
  "external-img",
  "anonymous-img",
  "fetch-data-url",
  "placeholder-option",
  "no-image",
];

const PLACEHOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" rx="28" fill="#0f172a"/>
  <circle cx="90" cy="68" r="34" fill="#334155"/>
  <path d="M36 154c10-35 98-35 108 0" fill="#334155"/>
  <text x="90" y="166" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#94a3b8">NO IMAGE</text>
</svg>`;

const PLACEHOLDER_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLACEHOLDER_SVG)}`;

function makeBrokenImageUrl() {
  return "https://market-static.msu.io/t7-spike-missing-image.png";
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function fetchImageAsDataUrl(imageUrl) {
  const response = await fetch(imageUrl, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`fetch failed: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function normalizeHistory(character) {
  const points = lastHistoryPoints(character, 7);
  if (points.length) {
    return points.map((point, index) => ({
      label: point.date || point.snapshotDate || `D${index + 1}`,
      gain: Math.max(0, Number(point.dailyGain || 0) / 1_000_000_000),
      rank: Number(point.dailyRank || 0),
    }));
  }
  return [
    { label: "07/09", gain: 460, rank: 540 },
    { label: "07/10", gain: 510, rank: 430 },
    { label: "07/11", gain: 630, rank: 220 },
    { label: "07/12", gain: 590, rank: 260 },
    { label: "07/13", gain: 720, rank: 130 },
    { label: "07/14", gain: 680, rank: 160 },
    { label: "07/15", gain: 810, rank: 92 },
  ];
}

function CharacterPortrait({ mode, imageUrl, fetchedImageUrl }) {
  if (mode === "no-image") {
    return (
      <div className="portrait placeholder">
        <span>No image</span>
      </div>
    );
  }
  if (mode === "placeholder-option") {
    return (
      <div className="portrait">
        <img src={makeBrokenImageUrl()} alt="" />
      </div>
    );
  }
  if (mode === "fetch-data-url") {
    return (
      <div className="portrait">
        {fetchedImageUrl ? <img src={fetchedImageUrl} alt="" /> : <span>Fetch failed</span>}
      </div>
    );
  }
  if (mode === "anonymous-img") {
    return (
      <div className="portrait">
        <img src={imageUrl} crossOrigin="anonymous" alt="" />
      </div>
    );
  }
  return (
    <div className="portrait">
      <img src={imageUrl} alt="" />
    </div>
  );
}

function ShareCard({ character, mode, fetchedImageUrl }) {
  const history = useMemo(() => normalizeHistory(character), [character]);
  const longName = `${character.name} LongNameCheckABCDEFGHIJ`;
  const expPercent = levelExpPercent(character);
  const daily = getGainAmount(character, "daily");
  const weekly = getGainAmount(character, "weekly");
  const monthly = getGainAmount(character, "monthly");

  return (
    <div className="share-card" style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}>
      <div className="card-glow" />
      <header className="card-header">
        <div>
          <p className="brand">Lulumi Tools</p>
          <h1>MapleStory N EXP Share Card</h1>
        </div>
        <div className="domain">lulumi-tools.com</div>
      </header>

      <section className="hero-row">
        <CharacterPortrait mode={mode} imageUrl={character.imageUrl} fetchedImageUrl={fetchedImageUrl} />
        <div className="identity">
          <p className="eyebrow">キャラクター詳細 / รายละเอียดตัวละคร / 角色詳細</p>
          <h2>{longName}</h2>
          <p className="meta">
            {formatJobName(character.job)} <span>·</span> {character.worldId || "-"} <span>·</span> Lv.
            {character.level} {expPercent.toFixed(3)}%
          </p>
          <p className="rank">Level Rank #{character.rank}</p>
        </div>
        <div className="mode-box">
          <p>Image mode</p>
          <strong>{mode}</strong>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <p>Daily</p>
          <strong>+{formatExp(daily)}</strong>
          <span>日間増加量</span>
        </div>
        <div className="stat-card">
          <p>Weekly</p>
          <strong>+{formatExp(weekly)}</strong>
          <span>週間増加量</span>
        </div>
        <div className="stat-card">
          <p>Monthly</p>
          <strong>+{formatExp(monthly)}</strong>
          <span>月間増加量</span>
        </div>
      </section>

      <section className="chart-row">
        <div className="chart-panel">
          <h3>固定サイズ Recharts / デイリー経験値増加量</h3>
          <BarChart width={680} height={330} data={history} margin={{ top: 20, right: 24, bottom: 12, left: 8 }}>
            <CartesianGrid stroke="#24344d" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fill: "#93c5fd", fontSize: 18 }} axisLine={{ stroke: "#475569" }} />
            <YAxis tick={{ fill: "#93c5fd", fontSize: 18 }} axisLine={{ stroke: "#475569" }} />
            <Bar dataKey="gain" fill="#34d399" radius={[10, 10, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </div>
        <div className="chart-panel">
          <h3>順位推移 / Rank movement</h3>
          <LineChart width={680} height={330} data={history} margin={{ top: 20, right: 24, bottom: 12, left: 8 }}>
            <CartesianGrid stroke="#24344d" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fill: "#93c5fd", fontSize: 18 }} axisLine={{ stroke: "#475569" }} />
            <YAxis reversed tick={{ fill: "#93c5fd", fontSize: 18 }} axisLine={{ stroke: "#475569" }} />
            <Line
              type="monotone"
              dataKey="rank"
              stroke="#38bdf8"
              strokeWidth={5}
              dot={{ r: 6, fill: "#020617", stroke: "#bae6fd", strokeWidth: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </div>
      </section>

      <footer>
        <span>Generated locally in browser</span>
        <span>日本語 / ไทย / 繁體中文 text rendering check</span>
      </footer>
    </div>
  );
}

function css() {
  return `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #020617;
      color: #e5e7eb;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", "Noto Sans Thai", "Noto Sans TC", sans-serif;
    }
    .app { padding: 24px; }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 18px;
    }
    button {
      border: 1px solid #334155;
      border-radius: 10px;
      background: #0f172a;
      color: #e5e7eb;
      padding: 10px 14px;
      font-weight: 700;
      cursor: pointer;
    }
    button.active { background: #2563eb; border-color: #60a5fa; }
    button:disabled { opacity: 0.45; cursor: wait; }
    .stage {
      width: ${CARD_WIDTH}px;
      min-height: ${CARD_HEIGHT}px;
      transform-origin: top left;
      transform: scale(0.5);
      margin-bottom: -450px;
      border: 1px solid #1e293b;
    }
    .share-card {
      position: relative;
      overflow: hidden;
      background: #020617;
      color: #e5e7eb;
      padding: 56px 64px 44px;
      isolation: isolate;
    }
    .card-glow {
      position: absolute;
      inset: auto -120px -220px auto;
      width: 720px;
      height: 720px;
      background: radial-gradient(circle, rgba(20, 184, 166, 0.28), rgba(2, 6, 23, 0) 64%);
      z-index: -1;
    }
    .card-header, .hero-row, .stats-grid, .chart-row, footer {
      position: relative;
      z-index: 1;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 36px;
    }
    .brand {
      margin: 0 0 8px;
      color: #93c5fd;
      font-size: 24px;
      font-weight: 700;
    }
    h1 {
      margin: 0;
      font-size: 52px;
      line-height: 1;
      letter-spacing: 0;
    }
    .domain {
      color: #67e8f9;
      font-size: 26px;
      font-weight: 800;
    }
    .hero-row {
      display: grid;
      grid-template-columns: 190px 1fr 300px;
      gap: 34px;
      align-items: center;
      margin-bottom: 28px;
    }
    .portrait {
      width: 180px;
      height: 180px;
      border-radius: 32px;
      overflow: hidden;
      background: #0f172a;
      border: 1px solid #1e293b;
      display: grid;
      place-items: center;
    }
    .portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scale(1.5) translateY(-5%);
    }
    .portrait.placeholder span {
      color: #94a3b8;
      font-weight: 800;
      font-size: 24px;
    }
    .identity { min-width: 0; }
    .eyebrow {
      margin: 0 0 10px;
      color: #94a3b8;
      font-size: 22px;
      font-weight: 700;
    }
    h2 {
      margin: 0;
      font-size: 58px;
      line-height: 1.02;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .meta {
      margin: 16px 0 0;
      color: #bfdbfe;
      font-size: 28px;
      font-weight: 700;
    }
    .meta span { color: #64748b; }
    .rank {
      margin: 8px 0 0;
      color: #67e8f9;
      font-size: 24px;
      font-weight: 800;
    }
    .mode-box, .stat-card, .chart-panel {
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid #1e293b;
      border-radius: 18px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
    }
    .mode-box {
      padding: 26px;
      align-self: stretch;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .mode-box p, .stat-card p {
      margin: 0 0 8px;
      color: #94a3b8;
      font-size: 20px;
      font-weight: 700;
    }
    .mode-box strong {
      font-size: 30px;
      color: #34d399;
      overflow-wrap: anywhere;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
      margin-bottom: 28px;
    }
    .stat-card {
      padding: 22px 28px;
    }
    .stat-card strong {
      color: #34d399;
      font-size: 38px;
      line-height: 1;
    }
    .stat-card span {
      display: block;
      margin-top: 10px;
      color: #93c5fd;
      font-size: 18px;
      font-weight: 700;
    }
    .chart-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
    }
    .chart-panel {
      padding: 22px 20px 14px;
      min-width: 0;
    }
    h3 {
      margin: 0 0 12px 6px;
      font-size: 24px;
      line-height: 1.2;
    }
    footer {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      color: #94a3b8;
      font-size: 18px;
      font-weight: 700;
    }
    .results {
      margin-top: 24px;
      max-width: 1100px;
      white-space: pre-wrap;
      color: #cbd5e1;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 16px;
    }
    .thumbs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 16px;
      max-width: 1200px;
    }
    .thumbs img {
      width: 100%;
      border: 1px solid #334155;
      border-radius: 12px;
    }
  `;
}

function App() {
  const cardRef = useRef(null);
  const [character, setCharacter] = useState(null);
  const [mode, setMode] = useState("external-img");
  const [fetchedImageUrl, setFetchedImageUrl] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [samples, setSamples] = useState([]);

  useEffect(() => {
    async function loadData() {
      const response = await fetch("/data/v2/rankings.json");
      const payload = await response.json();
      const picked =
        payload.characters.find((item) => item.imageUrl && item.historyKey && String(item.name || "").length >= 6) ||
        payload.characters[0];
      setCharacter(picked);
    }
    loadData().catch((error) => setResults([{ mode: "load", ok: false, error: String(error) }]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFetchError("");
    setFetchedImageUrl("");
    if (mode !== "fetch-data-url" || !character?.imageUrl) {
      return;
    }
    fetchImageAsDataUrl(character.imageUrl)
      .then((dataUrl) => {
        if (!cancelled) {
          setFetchedImageUrl(dataUrl);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFetchError(String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, character?.imageUrl]);

  const baseGenerationOptions = useMemo(
    () => ({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      canvasWidth: CARD_WIDTH,
      canvasHeight: CARD_HEIGHT,
      pixelRatio: 1,
      backgroundColor: "#020617",
      cacheBust: true,
    }),
    [],
  );

  async function generateOnce(targetMode = mode, sample = false) {
    if (!character || !cardRef.current) {
      throw new Error("card is not ready");
    }
    let localFetchError = "";
    if (targetMode === "fetch-data-url") {
      try {
        const dataUrl = await fetchImageAsDataUrl(character.imageUrl);
        setFetchedImageUrl(dataUrl);
        setFetchError("");
      } catch (error) {
        localFetchError = String(error);
        setFetchedImageUrl("");
        setFetchError(localFetchError);
      }
    }
    setMode(targetMode);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    const start = performance.now();
    const options =
      targetMode === "placeholder-option"
        ? { ...baseGenerationOptions, imagePlaceholder: PLACEHOLDER_DATA_URL }
        : baseGenerationOptions;
    const canvas = await toCanvas(cardRef.current, options);
    let tainted = false;
    let taintError = "";
    try {
      canvas.getContext("2d").getImageData(0, 0, 1, 1);
    } catch (error) {
      tainted = true;
      taintError = String(error);
    }
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("toBlob returned null"))), "image/png");
    });
    const elapsedMs = Math.round(performance.now() - start);
    const dataUrl = sample ? await blobToDataUrl(blob) : "";
    const dimensions = sample ? await dataUrlToDimensions(dataUrl) : { width: canvas.width, height: canvas.height };
    return {
      mode: targetMode,
      ok: true,
      elapsedMs,
      bytes: blob.size,
      dimensions,
      tainted,
      taintError,
      fetchError: targetMode === "fetch-data-url" ? localFetchError : "",
      dataUrl,
    };
  }

  async function runMode(targetMode) {
    setBusy(true);
    try {
      const result = await generateOnce(targetMode, true);
      setResults((current) => [result, ...current]);
      setSamples((current) => [{ mode: targetMode, dataUrl: result.dataUrl }, ...current].slice(0, 6));
      return result;
    } catch (error) {
      const result = {
        mode: targetMode,
        ok: false,
        error: String(error),
        fetchError: targetMode === "fetch-data-url" ? localFetchError : "",
      };
      setResults((current) => [result, ...current]);
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    setBusy(true);
    const all = [];
    const nextSamples = [];
    try {
      for (const targetMode of IMAGE_MODES) {
        const modeRuns = [];
        for (let index = 0; index < 5; index += 1) {
          try {
            const result = await generateOnce(targetMode, index === 0);
            modeRuns.push({ ...result, dataUrl: undefined });
            if (index === 0 && result.dataUrl) {
              nextSamples.push({ mode: targetMode, dataUrl: result.dataUrl });
            }
          } catch (error) {
            modeRuns.push({
              mode: targetMode,
              ok: false,
              error: String(error),
              fetchError: targetMode === "fetch-data-url" ? localFetchError : "",
            });
          }
        }
        all.push({ mode: targetMode, runs: modeRuns });
      }
      setResults(all);
      setSamples(nextSamples);
      return all;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    window.__t7Spike = {
      runAll,
      generateMode: runMode,
      getResults: () => results,
      getSamples: () => samples,
    };
  });

  useEffect(() => {
    if (!character || window.__t7SpikeAutorunStarted) {
      return;
    }
    if (new URLSearchParams(window.location.search).get("autorun") !== "1") {
      return;
    }
    window.__t7SpikeAutorunStarted = true;
    runAll()
      .then((value) => {
        window.__t7SpikeAutorunResult = value;
        document.documentElement.setAttribute("data-t7-spike-done", "true");
      })
      .catch((error) => {
        window.__t7SpikeAutorunResult = [{ mode: "autorun", runs: [{ ok: false, error: String(error) }] }];
        document.documentElement.setAttribute("data-t7-spike-done", "error");
      });
  }, [character]);

  if (!character) {
    return (
      <>
        <style>{css()}</style>
        <div className="app">Loading ranking data...</div>
      </>
    );
  }

  return (
    <>
      <style>{css()}</style>
      <div className="app">
        <div className="controls">
          {IMAGE_MODES.map((item) => (
            <button key={item} type="button" className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
              {item}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => runMode(mode)}>
            Generate current
          </button>
          <button type="button" disabled={busy} onClick={runAll}>
            Run all x5
          </button>
          <span>{busy ? "Generating..." : "Ready"}</span>
        </div>
        {fetchError ? <p className="results">fetch-data-url error: {fetchError}</p> : null}
        <div className="stage">
          <div ref={cardRef}>
            <ShareCard character={character} mode={mode} fetchedImageUrl={fetchedImageUrl} />
          </div>
        </div>
        <div className="thumbs">
          {samples.map((sample) => (
            <a key={sample.mode} href={sample.dataUrl} download={`t7-spike-${sample.mode}.png`}>
              <img src={sample.dataUrl} alt={sample.mode} />
              <p>{sample.mode}</p>
            </a>
          ))}
        </div>
        <pre className="results">{JSON.stringify(results, null, 2)}</pre>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);

