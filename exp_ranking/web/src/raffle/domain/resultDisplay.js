export function groupWonRewards(rewards) {
  const grouped = new Map();
  for (const reward of Array.isArray(rewards) ? rewards : []) {
    if (!reward?.won) continue;
    const key = [reward.rewardName, reward.classification, reward.iconUrl || ""].join("\u0000");
    const current = grouped.get(key);
    const quantity = BigInt(reward.quantity);
    if (current) current.quantity = (BigInt(current.quantity) + quantity).toString();
    else grouped.set(key, { ...reward, iconUrl: reward.iconUrl || "", quantity: quantity.toString() });
  }
  return [...grouped.values()];
}

export function isAscendantRaffleResult(result) {
  return String(result?.bossName || "").trim().toLocaleLowerCase() === "ascendant tier raffle";
}

export function groupRaffleResultsForDisplay(results) {
  const groups = [];
  let ascendantGroup = null;
  for (const result of Array.isArray(results) ? results : []) {
    if (isAscendantRaffleResult(result)) {
      if (!ascendantGroup) {
        ascendantGroup = { kind: "ascendant", results: [] };
        groups.push(ascendantGroup);
      }
      ascendantGroup.results.push(result);
    } else {
      groups.push({ kind: "single", result });
    }
  }
  return groups;
}

const ASCENDANT_BOSS_LABEL_BY_TIER = Object.freeze({
  "dawning ascendant 1": "Normal Guardian Angel Slime",
  "dawning ascendant 2": "Easy Lucid",
  "blessed ascendant 1": "Hard Lotus",
  "blessed ascendant 2": "Hard Damien",
  "mystic ascendant": "Normal Lucid",
  "luminous ascendant": "Easy Will",
  "glorious ascendant": "Normal Will",
  "divine ascendant": "Hard Lucid",
  "eternal ascendant": "Hard Will",
});

const ASCENDANT_TIER_RANK = Object.freeze({
  "dawning ascendant 1": 1,
  "dawning ascendant 2": 2,
  "blessed ascendant 1": 3,
  "blessed ascendant 2": 4,
  "mystic ascendant": 5,
  "luminous ascendant": 6,
  "glorious ascendant": 7,
  "divine ascendant": 8,
  "eternal ascendant": 9,
});

function ascendantTierName(layerName, bossName = "Ascendant Tier Raffle") {
  const layer = splitLayerLabel(layerName, bossName);
  return layer.detail || layer.difficulty || String(layerName || "Ascendant Tier").trim();
}

export function formatAscendantTierTitle(layerName, bossName = "Ascendant Tier Raffle") {
  const tierName = ascendantTierName(layerName, bossName);
  const bossLabel = ASCENDANT_BOSS_LABEL_BY_TIER[tierName.toLocaleLowerCase()];
  const shortTierName = tierName.replace(/\s+Ascendant(?=\s+\d+$|$)/i, "");
  return bossLabel ? `${shortTierName} - ${bossLabel}` : shortTierName;
}

export function sortAscendantResultsByTier(results) {
  return (Array.isArray(results) ? results : [])
    .map((result, index) => ({ result, index }))
    .sort((left, right) => {
      const leftRank = ASCENDANT_TIER_RANK[ascendantTierName(left.result.layerName, left.result.bossName).toLocaleLowerCase()] || 0;
      const rightRank = ASCENDANT_TIER_RANK[ascendantTierName(right.result.layerName, right.result.bossName).toLocaleLowerCase()] || 0;
      return rightRank - leftRank || left.index - right.index;
    })
    .map(({ result }) => result);
}

export function splitLayerLabel(layerName, bossName) {
  const raw = typeof layerName === "string" ? layerName.trim() : "";
  const match = /^\[([^\]]+)]\s*(.*)$/.exec(raw);
  const detail = (match?.[2] || raw).trim();
  return {
    difficulty: (match?.[1] || "").trim(),
    detail: detail && detail.toLocaleLowerCase() !== String(bossName || "").toLocaleLowerCase() ? detail : "",
  };
}

export function bossMonogram(name) {
  const words = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase();
}

export function formatRaffleTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")} UTC`;
}

const POWER_CRYSTAL_COUPON_PATTERN = /^(\d+)([KM]?) Power Crystal Coupon$/i;

export function powerCrystalFaceValue(rewardName) {
  const match = POWER_CRYSTAL_COUPON_PATTERN.exec(String(rewardName || "").trim());
  if (!match) return 0n;
  const multiplier = { "": 1n, K: 1_000n, M: 1_000_000n }[match[2].toLocaleUpperCase()];
  return BigInt(match[1]) * multiplier;
}

export function summarizeRaffleResults(results) {
  const rewards = (Array.isArray(results) ? results : []).flatMap((result) => Array.isArray(result?.rewards) ? result.rewards : []);
  const items = groupWonRewards(rewards).sort((left, right) => {
    const priority = { NESO: 0, ASCENDANT_NESO: 0, POWER_CRYSTAL: 1, COIN: 2, EQUIPMENT: 3, OTHER: 4, UNKNOWN: 5 };
    const priorityDifference = (priority[left.classification] ?? 9) - (priority[right.classification] ?? 9);
    if (priorityDifference) return priorityDifference;
    if (left.classification === "POWER_CRYSTAL" && right.classification === "POWER_CRYSTAL") {
      const faceValueDifference = powerCrystalFaceValue(right.rewardName) - powerCrystalFaceValue(left.rewardName);
      if (faceValueDifference) return faceValueDifference > 0n ? 1 : -1;
    }
    return left.rewardName.localeCompare(right.rewardName, "en");
  });
  let totalNeso = 0n;
  let totalPowerCrystal = 0n;
  for (const item of items) {
    const quantity = BigInt(item.quantity);
    if (item.classification === "NESO" || item.classification === "ASCENDANT_NESO") totalNeso += quantity;
    if (item.classification === "POWER_CRYSTAL") totalPowerCrystal += powerCrystalFaceValue(item.rewardName) * quantity;
  }
  return { totalNeso: totalNeso.toString(), totalPowerCrystal: totalPowerCrystal.toString(), items };
}

export function formatRewardQuantity(value) {
  try { return BigInt(value).toLocaleString("en-US"); } catch { return String(value || "0"); }
}