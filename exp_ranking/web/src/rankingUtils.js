import { canonicalJobName, lookupLiteralJob } from "./jobCategories";

export const GAIN_PERIOD_LABELS = {
  daily: "日間",
  weekly: "週間",
  monthly: "月間",
};

/** JST reset boundaries (must match bot ranking_periods.py). */
export const GAIN_PERIOD_RESETS = {
  daily: "毎日 9:00 JST",
  weekly: "毎週木曜 9:00 JST",
  monthly: "毎月1日 9:00 JST",
};

export function gainPeriodRange(meta, period) {
  const block = meta?.gainPeriods?.[period];
  if (!block?.periodStart || !block?.periodEnd) {
    return null;
  }
  return { start: block.periodStart, end: block.periodEnd };
}

export const WORLD_IDS = ["Ain", "Errai", "Fang"];

export function characterWorldId(character) {
  return character?.worldId?.trim() || "";
}

export function getNavigatorUrl(character) {
  if (character?.navigatorUrl) {
    return character.navigatorUrl;
  }
  const key = character?.characterAssetKey?.trim();
  if (!key) {
    return null;
  }
  return `https://msu.io/navigator/character/${encodeURIComponent(key)}`;
}

export function matchesWorldFilter(character, worldFilter) {
  if (!worldFilter || worldFilter === "all") {
    return true;
  }
  return characterWorldId(character) === worldFilter;
}

const JOB_DISPLAY_BY_BASE = {
  HERO: "Hero",
  PALADIN: "Paladin",
  DARKKNIGHT: "Dark Knight",
  FIREPOISON: "Arch Mage(Fire / Poison)",
  FP_ARCH_MAGE: "Arch Mage(Fire / Poison)",
  ICELIGHTNING: "Arch Mage(Ice / Lightning)",
  IL_ARCH_MAGE: "Arch Mage(Ice / Lightning)",
  BISHOP: "Bishop",
  BOWMASTER: "Bowmaster",
  MARKSMAN: "Marksman",
  PATHFINDER: "Pathfinder",
  NIGHTLORD: "Night Lord",
  SHADOWER: "Shadower",
  BLADEMASTER: "Blade Master",
  SOULEMASTER: "Dawn Warrior",
  CORSAIR: "Corsair",
  BUCCANEER: "Buccaneer",
  CANNONMASTER: "Cannon Master",
  CANNONSHOOTER: "Cannon Master",
  EUNWOL: "Shade",
  EVAN: "Evan",
  ARAN: "Aran",
  LUMINOUS: "Luminous",
  MERCEDES: "Mercedes",
  PHANTOM: "Phantom",
  DAWNWARRIOR: "Dawn Warrior",
  BLAZEWIZARD: "Blaze Wizard",
  FLAMEWIZARD: "Blaze Wizard",
  WINDARCHER: "Wind Archer",
  WINDBREAKER: "Wind Archer",
  NIGHTWALKER: "Night Walker",
  THUNDERBREAKER: "Thunder Breaker",
  STRIKER: "Thunder Breaker",
  MIHILE: "Mihile",
  MIKHAEL: "Mihile",
  MIKAEL: "Mihile",
  MICHAEL: "Mihile",
};

/** Normalize API / JSON job label to display name (e.g. Eunwol4 → Shade). */
export function formatJobName(job) {
  if (!job) {
    return "Unknown";
  }
  const raw = String(job).trim();
  const literal = lookupLiteralJob(raw);
  if (literal) {
    return literal;
  }
  const baseKey = raw
    .replace(/^JobCode_/i, "")
    .toUpperCase()
    .replace(/ /g, "_")
    .replace(/\d+$/, "");

  if (JOB_DISPLAY_BY_BASE[baseKey]) {
    return JOB_DISPLAY_BY_BASE[baseKey];
  }

  const stripped = raw
    .replace(/^JobCode_/i, "")
    .replace(/\d+$/, "")
    .replace(/_/g, " ");
  const titled = stripped.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return lookupLiteralJob(titled) ?? canonicalJobName(titled);
}

export function formatExp(value) {
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  return Number(value || 0).toLocaleString();
}

/** EXP record display with 3 fractional digits (e.g. +565.407B). */
export function formatExpRecord(value) {
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(3)}T`;
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(3)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(3)}M`;
  }
  return Number(value || 0).toLocaleString();
}

export const LEVEL_CAP = 275;
export const MILESTONE_LEVEL_250 = 250;

export function levelExpPercent(character) {
  return Number(character?.levelExpPercent ?? character?.expPercent ?? 0);
}

/** Current-level EXP as integer (from API or derived from % × required EXP). */
export function currentLevelExp(character, expTable = {}) {
  if (character?.exp != null && character.exp !== "") {
    return Math.max(0, Number(character.exp));
  }

  const level = character?.level ?? 0;
  if (level >= LEVEL_CAP) {
    return 0;
  }

  const percent = levelExpPercent(character) / 100;
  const required =
    Number(character?.expToNextLevel) || Number(expTable[level]) || 0;
  if (!required) {
    return 0;
  }
  return Math.round(required * percent);
}

/** Full EXP amount with digit separators (ja-JP). */
export function formatExpExact(value) {
  return Math.max(0, Number(value || 0)).toLocaleString("ja-JP");
}

export function formatLevelExp(character) {
  const level = character?.level ?? 0;
  const percent = levelExpPercent(character);
  if (level >= LEVEL_CAP) {
    return `Lv.${level} MAX`;
  }
  return `Lv.${level} ${percent.toFixed(3)}%`;
}

export function getGainAmount(character, period) {
  if (period === "daily") {
    if (character.dailyGain != null) {
      return character.dailyGain;
    }
    return character.history?.at(-1)?.dailyGain ?? 0;
  }
  if (period === "weekly") {
    return character.weeklyGain ?? 0;
  }
  return character.monthlyGain ?? 0;
}

export function gainRankClass(gainRank) {
  if (gainRank === 1) {
    return "text-amber-300";
  }
  if (gainRank === 2) {
    return "text-slate-200";
  }
  if (gainRank === 3) {
    return "text-amber-600";
  }
  return "text-slate-300";
}

export function computeGainRankMaps(characters) {
  const maps = { daily: new Map(), weekly: new Map(), monthly: new Map() };
  for (const period of Object.keys(maps)) {
    const sorted = [...characters].sort(
      (a, b) => getGainAmount(b, period) - getGainAmount(a, period)
    );
    sorted.forEach((character, index) => {
      maps[period].set(character.id, index + 1);
    });
  }
  return maps;
}

export function getGainRank(gainRankMaps, characterId, period) {
  return gainRankMaps[period]?.get(characterId) ?? null;
}

/** Last N history points (oldest → newest). */
export function lastHistoryPoints(character, count = 7) {
  const history = Array.isArray(character.history) ? character.history : [];
  return history.slice(-count);
}

/** History points whose snapshotDate falls in [start, end] (ISO dates). */
export function historyPointsInPeriod(character, periodStart, periodEnd) {
  const history = Array.isArray(character.history) ? character.history : [];
  if (!periodStart || !periodEnd) {
    return history;
  }
  return history.filter((point) => {
    const snapshotDate = point.snapshotDate;
    if (!snapshotDate) {
      return true;
    }
    return snapshotDate >= periodStart && snapshotDate <= periodEnd;
  });
}

/** Per-day daily gain rank among all characters (same date label in history). */
export function buildWeekDailyRankSeries(
  characters,
  characterId,
  days = 7,
  periodStart = null,
  periodEnd = null,
) {
  const target = characters.find((item) => item.id === characterId);
  if (!target) {
    return [];
  }

  const points =
    periodStart && periodEnd
      ? historyPointsInPeriod(target, periodStart, periodEnd)
      : lastHistoryPoints(target, days);

  return points.map((point) => {
    const date = point.date;
    const ranked = characters
      .map((character) => {
        const dayPoint = character.history?.find((item) => item.date === date);
        return {
          id: character.id,
          gain: dayPoint?.dailyGain ?? 0,
        };
      })
      .sort((a, b) => b.gain - a.gain);

    let dailyRank = ranked.length;
    for (let index = 0; index < ranked.length; index += 1) {
      if (ranked[index].id === characterId) {
        dailyRank = index + 1;
        break;
      }
    }

    return {
      date,
      dailyGain: point.dailyGain ?? 0,
      dailyRank,
    };
  });
}

export function enrichRankSeries(series) {
  return series.map((point, index, all) => {
    const previousRank = index > 0 ? all[index - 1].dailyRank : null;
    const rankDelta = previousRank != null ? previousRank - point.dailyRank : null;
    return { ...point, rankDelta };
  });
}

function buildRankTicks(min, max) {
  const span = max - min;
  if (span <= 6) {
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }

  let step = 5;
  if (span > 80) {
    step = 20;
  } else if (span > 40) {
    step = 10;
  }

  const ticks = [];
  for (let value = Math.floor(min / step) * step; value <= max; value += step) {
    if (value >= min) {
      ticks.push(value);
    }
  }
  if (!ticks.includes(min)) {
    ticks.unshift(min);
  }
  if (!ticks.includes(max)) {
    ticks.push(max);
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
}

/** Y-axis domain that zooms to the week's rank movement (1 = top). */
export function buildRankChartScale(ranks) {
  if (!ranks.length) {
    return { domain: [1, 10], ticks: [1, 5, 10] };
  }

  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  const span = maxRank - minRank;
  const padding = span <= 2 ? 1 : Math.max(2, Math.ceil(span * 0.25));
  const low = Math.max(1, minRank - padding);
  const high = maxRank + padding;

  return {
    domain: [low, high],
    ticks: buildRankTicks(low, high),
  };
}

export function findBestDailyGain(character) {
  const history = Array.isArray(character.history) ? character.history : [];
  let bestGain = 0;
  let bestDate = null;
  let bestSnapshotDate = null;

  for (const point of history) {
    const gain = point.dailyGain ?? 0;
    if (gain > bestGain) {
      bestGain = gain;
      bestDate = point.date;
      bestSnapshotDate = point.snapshotDate ?? null;
    }
  }

  return { bestGain, bestDate, bestSnapshotDate };
}

/** Split ISO date (YYYY-MM-DD) into localized year line and month/day line. */
export function datePartsFromIsoDate(isoDate, t) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return {
    year: t("date.yearLine", { year }),
    monthDay: t("date.monthDay", { month, day }),
  };
}

export function remainingExpToLevel(character, expTable, targetLevel) {
  if (character.level >= targetLevel) {
    return 0;
  }

  const requiredCurrentLevel = expTable[character.level] || 0;
  let currentLevelRemaining = 0;
  if (character.exp != null) {
    currentLevelRemaining = Math.max(requiredCurrentLevel - character.exp, 0);
  } else {
    const pct = levelExpPercent(character) / 100;
    currentLevelRemaining = Math.max(requiredCurrentLevel * (1 - pct), 0);
  }

  let totalRemaining = currentLevelRemaining;

  for (let level = character.level + 1; level < targetLevel; level += 1) {
    totalRemaining += expTable[level] || 0;
  }

  return totalRemaining;
}

export function remainingExpTo250(character, expTable) {
  return remainingExpToLevel(character, expTable, MILESTONE_LEVEL_250);
}

export function remainingExpTo275(character, expTable) {
  return remainingExpToLevel(character, expTable, LEVEL_CAP);
}

const JST_TIME_ZONE = "Asia/Tokyo";

/** Fixed label for the daily scheduled fetch slot (same value in JA/EN). */
const SCHEDULED_UPDATE_TIME = "00:20";

function formatUpdateDateLabel(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

/** 「12 Jun 2026, 00:20 UTC」形式（取得 UTC 日 + 固定 00:20、全言語共通）。 */
export function formatScheduledUpdateLabel(meta, t) {
  const updatedAtRaw = String(meta?.updatedAt || "").trim();
  let updateDateIso = "";

  if (updatedAtRaw) {
    const parsed = new Date(updatedAtRaw);
    if (!Number.isNaN(parsed.getTime())) {
      updateDateIso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed);
    }
  }

  if (!updateDateIso) {
    const snapshotDate = String(meta?.latestSnapshotDate || "").trim();
    if (!snapshotDate) {
      return null;
    }
    const rankingDay = new Date(`${snapshotDate}T00:00:00Z`);
    if (Number.isNaN(rankingDay.getTime())) {
      return null;
    }
    rankingDay.setUTCDate(rankingDay.getUTCDate() + 1);
    updateDateIso = rankingDay.toISOString().slice(0, 10);
  }

  const updateDate = formatUpdateDateLabel(updateDateIso);

  if (t) {
    return t("app.updatedAt", {
      date: updateDate,
      time: SCHEDULED_UPDATE_TIME,
    });
  }
  return `${updateDate}, ${SCHEDULED_UPDATE_TIME} UTC`;
}

/** Target calendar date label (JST) for level-cap estimates. */
export function formatTargetDateAfterDays(daysFromToday, t, reference = new Date()) {
  const parts = targetDatePartsAfterDays(daysFromToday, t, reference);
  if (!parts) {
    return null;
  }
  return t("date.yearMonthDay", {
    year: parts.rawYear,
    month: parts.rawMonth,
    day: parts.rawDay,
  });
}

/** Target date as separate year and month/day lines (JST). */
export function targetDatePartsAfterDays(daysFromToday, t, reference = new Date()) {
  if (daysFromToday == null) {
    return null;
  }
  const { year, month, day } = todayPartsInJst(reference);
  const target = new Date(Date.UTC(year, month - 1, day + daysFromToday));
  const rawYear = target.getUTCFullYear();
  const rawMonth = target.getUTCMonth() + 1;
  const rawDay = target.getUTCDate();
  return {
    rawYear,
    rawMonth,
    rawDay,
    year: t("date.yearLine", { year: rawYear }),
    monthDay: t("date.monthDay", { month: rawMonth, day: rawDay }),
  };
}

/** Today’s calendar date in JST (year/month/day). */
export function todayPartsInJst(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(reference);

  const pick = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

/** Format a calendar day as 「M月D日」 (JST). */
export function formatJapaneseMonthDay(year, month, day) {
  return `${month}月${day}日`;
}

/** Add days to today (JST) and return 「M月D日」. */
export function formatJapaneseDateAfterDays(daysFromToday, reference = new Date()) {
  const { year, month, day } = todayPartsInJst(reference);
  const target = new Date(Date.UTC(year, month - 1, day + daysFromToday));
  return formatJapaneseMonthDay(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate()
  );
}

function estimateDaysToLevelFromToday(character, expTable, targetLevel) {
  if (character.level >= targetLevel) {
    return { days: 0, completed: true, noGain: false };
  }

  const todayGain = character.history?.at(-1)?.dailyGain ?? 0;
  const remaining = remainingExpToLevel(character, expTable, targetLevel);

  if (!todayGain) {
    return { days: null, completed: false, noGain: true };
  }

  const days = Math.ceil(remaining / todayGain);
  return {
    days,
    completed: false,
    noGain: false,
  };
}

/** Days until Lv250 using today's daily gain only. */
export function estimateDaysTo250FromToday(character, expTable) {
  return estimateDaysToLevelFromToday(character, expTable, MILESTONE_LEVEL_250);
}

/** Days until Lv275 using today's daily gain only. */
export function estimateDaysTo275FromToday(character, expTable) {
  return estimateDaysToLevelFromToday(character, expTable, LEVEL_CAP);
}

export function topGainersForPeriod(characters, period, limit = 3) {
  return [...characters]
    .sort((a, b) => getGainAmount(b, period) - getGainAmount(a, period))
    .slice(0, limit)
    .map((character, index) => ({
      ...character,
      gainRank: index + 1,
    }));
}

/** Gain leaders per job for a period (sorted by each job's #1 gain). */
export function buildGainRankingByJob(characters, period, limitPerJob = 5) {
  const groups = new Map();

  for (const character of characters) {
    const job = canonicalJobName(formatJobName(character.job));
    if (!groups.has(job)) {
      groups.set(job, []);
    }
    groups.get(job).push(character);
  }

  return [...groups.entries()]
    .map(([job, members]) => {
      const sorted = [...members].sort(
        (a, b) => getGainAmount(b, period) - getGainAmount(a, period)
      );
      return {
        job,
        memberCount: members.length,
        topGain: sorted.length ? getGainAmount(sorted[0], period) : 0,
        top: sorted.slice(0, limitPerJob).map((character, index) => ({
          ...character,
          jobGainRank: index + 1,
        })),
        allSorted: sorted.map((character, index) => ({
          ...character,
          jobGainRank: index + 1,
        })),
      };
    })
    .sort((a, b) => b.topGain - a.topGain);
}

/** @deprecated Use buildGainRankingByJob */
export function buildDailyGainRankingByJob(characters, limitPerJob = 5) {
  return buildGainRankingByJob(characters, "daily", limitPerJob);
}
