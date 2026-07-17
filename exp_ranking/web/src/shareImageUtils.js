import { formatExp, getGainAmount, getGainRank, levelExpPercent } from "./rankingUtils";

export function characterDetailUrl(character, locationLike = window.location) {
  const origin = locationLike?.origin || "https://lulumi-tools.com";
  const pathname = locationLike?.pathname || "/";
  const key = character?.historyKey || character?.id || character?.name || "";
  return `${origin}${pathname}#/character/${encodeURIComponent(key)}`;
}

export function safeShareFileName(character, date = new Date()) {
  const rawName = String(character?.name || "character").trim() || "character";
  const safeName = rawName
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60)
    .replace(/^_+|_+$/g, "") || "character";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `lulumi-tools_${safeName}_${year}-${month}-${day}.png`;
}

function rankText(rank) {
  return rank != null ? `No.${rank}` : "No.-";
}

function gainLine(label, amount, rank) {
  return `${label} +${formatExp(amount)} · ${rankText(rank)}`;
}

export function buildShareText(character, detailUrl, _t, gainRankMaps = null) {
  const name = character?.name || "Character";
  const level = character?.level ?? "-";
  const percent = levelExpPercent(character).toFixed(3);
  const job = character?.job || "-";
  const world = character?.worldId || "-";
  const levelRank = character?.rank != null ? `Rank #${character.rank}` : "Rank -";
  const dailyRank = gainRankMaps ? getGainRank(gainRankMaps, character.id, "daily") : null;
  const weeklyRank = gainRankMaps ? getGainRank(gainRankMaps, character.id, "weekly") : null;
  const monthlyRank = gainRankMaps ? getGainRank(gainRankMaps, character.id, "monthly") : null;

  return [
    `My EXP Report — ${name}`,
    `⭐ ${job} · ${world} · Lv.${level} ${percent}% · ${levelRank}`,
    "",
    `📈 ${gainLine("Daily", getGainAmount(character, "daily"), dailyRank)}`,
    `📊 ${gainLine("Weekly", getGainAmount(character, "weekly"), weeklyRank)}`,
    `🌙 ${gainLine("Monthly", getGainAmount(character, "monthly"), monthlyRank)}`,
    "",
    detailUrl,
    "#MapleStoryN #LulumiTools",
  ].join("\n");
}

export function xIntentUrl(text) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}