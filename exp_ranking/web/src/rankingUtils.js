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
  ARK: "Ark",
  ADELE: "Adele",
  LEF_PIRATE: "Ark",
  LEFPIRATE: "Ark",
  LEF_WARRIOR: "Adele",
  LEFWARRIOR: "Adele",
  HOYOUNG: "Ho Young",
  HO_YOUNG: "Ho Young",
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

/** EXP record display with 2 fractional digits (e.g. +565.41B). */
export function formatExpRecord(value) {
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
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

export function addDaysToIsoDate(isoDate, days) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Latest snapshotDate among group members (ISO yyyy-mm-dd). */
export function latestSnapshotDateAmong(characters, memberKeys) {
  let latest = "";
  for (const key of memberKeys) {
    const character = findCharacterByMemberKey(characters, key);
    const history = Array.isArray(character?.history) ? character.history : [];
    for (const point of history) {
      const snapshotDate = String(point.snapshotDate || "").trim();
      if (snapshotDate && snapshotDate > latest) {
        latest = snapshotDate;
      }
    }
  }
  return latest;
}

export function defaultGroupChartCustomRange(characters, memberKeys, spanDays = 7) {
  const end = latestSnapshotDateAmong(characters, memberKeys);
  if (!end) {
    return { start: "", end: "" };
  }
  const start = addDaysToIsoDate(end, -(spanDays - 1));
  return { start, end };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (channel) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 20 colors spaced ~90° on the hue wheel so consecutive members stay in
 * different families (red → yellow → cyan → blue → orange → …).
 */
const GROUP_HUE_SEQUENCE = [
  0, 90, 180, 270, 45, 135, 225, 315, 20, 110, 200, 290, 55, 145, 235, 75, 165, 255, 345, 125,
];

export const GROUP_LINE_COLORS = GROUP_HUE_SEQUENCE.map((hue) => hslToHex(hue, 82, 56));

/** Resolve a stored group member key (character name) to a ranking row. */
export function findCharacterByMemberKey(characters, memberKey) {
  const key = String(memberKey || "").trim();
  if (!key) {
    return null;
  }
  return characters.find((character) => String(character.name || "").trim() === key) ?? null;
}

/**
 * Merge daily gain history for multiple characters into chart rows.
 * range: { days: number } or { start: "yyyy-mm-dd", end: "yyyy-mm-dd" }
 */
export function buildGroupGainSeries(characters, memberKeys, range = { days: 7 }) {
  const resolvePoints = (character) => {
    if (range.start && range.end) {
      return historyPointsInPeriod(character, range.start, range.end);
    }
    return lastHistoryPoints(character, range.days ?? 7);
  };

  const members = memberKeys
    .map((key) => {
      const character = findCharacterByMemberKey(characters, key);
      if (!character) {
        return null;
      }
      return {
        key,
        name: character.name,
        character,
        color: GROUP_LINE_COLORS[0],
        points: resolvePoints(character),
      };
    })
    .filter(Boolean);

  members.forEach((member, index) => {
    member.color = GROUP_LINE_COLORS[index % GROUP_LINE_COLORS.length];
  });

  const snapshotDates = new Set();
  for (const member of members) {
    for (const point of member.points) {
      if (point.snapshotDate) {
        snapshotDates.add(point.snapshotDate);
      }
    }
  }

  const sortedSnapshotDates = [...snapshotDates].sort();
  const series = sortedSnapshotDates.map((snapshotDate) => {
    const row = { snapshotDate };
    for (const member of members) {
      const point = member.points.find((item) => item.snapshotDate === snapshotDate);
      row[member.key] = point?.dailyGain ?? null;
      if (point?.date) {
        row.date = point.date;
      }
    }
    if (!row.date) {
      row.date = snapshotDate;
    }
    return row;
  });

  return { series, members };
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
    if (point.dailyGain == null || point.dailyGain <= 0) {
      return {
        date,
        dailyGain: null,
        dailyRank: null,
      };
    }
    if (point.dailyRank != null) {
      return {
        date,
        dailyGain: point.dailyGain,
        dailyRank: point.dailyRank,
      };
    }
    const ranked = characters
      .map((character) => {
        const dayPoint = character.history?.find((item) => item.date === date);
        if (dayPoint?.dailyGain == null || dayPoint.dailyGain <= 0) {
          return null;
        }
        return {
          id: character.id,
          gain: dayPoint.dailyGain,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.gain - a.gain);

    let dailyRank = null;
    for (let index = 0; index < ranked.length; index += 1) {
      if (ranked[index].id === characterId) {
        dailyRank = index + 1;
        break;
      }
    }

    return {
      date,
      dailyGain: point.dailyGain,
      dailyRank,
    };
  });
}

export function enrichRankSeries(series) {
  return series.map((point, index, all) => {
    const previousRank = index > 0 ? all[index - 1].dailyRank : null;
    const rankDelta = previousRank != null && point.dailyRank != null
      ? previousRank - point.dailyRank
      : null;
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
    rawYear: year,
    rawMonth: month,
    rawDay: day,
    year: t("date.yearLine", { year }),
    monthDay: t("date.monthDay", { month, day }),
  };
}

/** Calendar date as `2026/7/25`. */
export function formatDateSlash(rawYear, rawMonth, rawDay) {
  if (rawYear == null || rawMonth == null || rawDay == null) {
    return null;
  }
  return `${rawYear}/${rawMonth}/${rawDay}`;
}

export function slashDateFromParts(parts) {
  if (!parts) {
    return null;
  }
  if (parts.rawYear != null) {
    return formatDateSlash(parts.rawYear, parts.rawMonth, parts.rawDay);
  }
  return null;
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

/** 「12 Jun 2026, 00:35 UTC」形式（meta.updatedAt の取得時刻を UTC 表示）。 */
export function formatScheduledUpdateLabel(meta, t) {
  const updatedAtRaw = String(meta?.updatedAt || "").trim();
  if (updatedAtRaw) {
    const parsed = new Date(updatedAtRaw);
    if (!Number.isNaN(parsed.getTime())) {
      const updateDateIso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed);
      const updateDate = formatUpdateDateLabel(updateDateIso);
      const updateTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(parsed);

      if (t) {
        return t("app.updatedAt", {
          date: updateDate,
          time: updateTime,
        });
      }
      return `${updateDate}, ${updateTime} UTC`;
    }
  }

  const snapshotDate = String(meta?.latestSnapshotDate || "").trim();
  if (!snapshotDate) {
    return null;
  }
  const rankingDay = new Date(`${snapshotDate}T00:00:00Z`);
  if (Number.isNaN(rankingDay.getTime())) {
    return null;
  }
  rankingDay.setUTCDate(rankingDay.getUTCDate() + 1);
  const updateDateIso = rankingDay.toISOString().slice(0, 10);
  const updateDate = formatUpdateDateLabel(updateDateIso);

  if (t) {
    return t("app.updatedAt", {
      date: updateDate,
      time: "—",
    });
  }
  return `${updateDate}, — UTC`;
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

/**
 * §22.14: arrival-date parts for the level planner, anchored to the
 * character's *latest snapshot date* (`character.history` tail
 * `snapshotDate`) rather than wall-clock "today" — the same basis already
 * used (correctly) by the 250/275 milestone estimates
 * (`addDaysToIsoDate(latestGainSnapshotDate, days)`) and the goal card's
 * arrival estimate (`computeGoalProgress`'s `resolveTodayIso`). §22.11 B's
 * `today + (N-1)` was only correct when the data happened to already be
 * updated for the current calendar day; with stale data (site not yet
 * refreshed for "today") it drifted a day late, since wall-clock today
 * could be a day ahead of the actual latest snapshot.
 *
 * `daysNeeded` = 1 means "reached the day after the snapshot" (day 1 of
 * the plan is the day *after* the last confirmed data point, matching the
 * milestone/goal-card convention of `snapshot + days`) — not "day 1 of the
 * plan is the snapshot day itself". This is a deliberate change from
 * §22.11 B's (incorrect) "today is day 1" framing.
 *
 * Delegates to `datePartsFromIsoDate`/`addDaysToIsoDate` (snapshot path)
 * or `targetDatePartsAfterDays` (fallback path) for the actual date
 * arithmetic — never duplicates it here.
 *
 * @param {string|null|undefined} latestSnapshotIso the character's latest confirmed data date (YYYY-MM-DD), or null/invalid if unavailable
 * @param {number} daysNeeded must be >= 1 (finite); anything else returns null
 * @param {(key: string, params?: object) => string} t
 * @param {Date} [reference] only used for the no-snapshot fallback (wall-clock "today")
 */
export function arrivalDatePartsFromSnapshot(latestSnapshotIso, daysNeeded, t, reference = new Date()) {
  if (!Number.isFinite(daysNeeded) || daysNeeded < 1) {
    return null;
  }
  const hasValidSnapshot = /^\d{4}-\d{2}-\d{2}$/.test(String(latestSnapshotIso || ""));
  if (hasValidSnapshot) {
    return datePartsFromIsoDate(addDaysToIsoDate(latestSnapshotIso, daysNeeded), t);
  }
  // No usable snapshot date (e.g. history not loaded yet) — same
  // wall-clock fallback as the 250/275 milestone estimates use in the
  // equivalent situation.
  return targetDatePartsAfterDays(daysNeeded, t, reference);
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

export const MIN_PLANNER_LEVEL = 225;
export const GAIN_PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 };

/** Parse user input like `10B`, `1.5T`, or plain numbers. */
export function parseExpInput(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  const normalized = String(raw).trim().replace(/,/g, "");
  const match = normalized.match(/^(-?[\d.]+)\s*([kmbt])?$/i);
  if (!match) {
    return null;
  }
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  const suffix = (match[2] || "").toLowerCase();
  const multipliers = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 };
  return num * (multipliers[suffix] ?? 1);
}

/** Parse a plain number as billions (465 → 465B EXP). Optional trailing `B` is ignored. */
export function parseExpInputBillions(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  const normalized = String(raw).trim().replace(/,/g, "").replace(/\s*[bB]$/, "");
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  return num * 1_000_000_000;
}

export function toDailyGain(amount, period) {
  const days = GAIN_PERIOD_DAYS[period] ?? 1;
  return amount / days;
}

export function fromDailyGain(daily, period) {
  const days = GAIN_PERIOD_DAYS[period] ?? 1;
  return daily * days;
}

/** Mean daily gain from the last N history points (positive gains only). */
export function averageDailyGainFromHistory(character, count = 7) {
  const points = lastHistoryPoints(character, count);
  const gains = points.map((point) => point.dailyGain ?? 0).filter((gain) => gain > 0);
  if (!gains.length) {
    return null;
  }
  return Math.round(gains.reduce((sum, gain) => sum + gain, 0) / gains.length);
}

export function computeGainAverages(character) {
  const points7 = lastHistoryPoints(character, 7);
  const points30 = lastHistoryPoints(character, 30);
  const daily7 = averageDailyGainFromHistory(character, 7);
  const daily30 = averageDailyGainFromHistory(character, 30);
  const days7 = points7.filter((point) => (point.dailyGain ?? 0) > 0).length;
  const days30 = points30.filter((point) => (point.dailyGain ?? 0) > 0).length;

  return {
    daily7,
    daily30,
    weekly7: daily7 != null ? daily7 * 7 : null,
    monthly30: daily30 != null ? daily30 * 30 : null,
    days7,
    days30,
  };
}

export function estimateDaysToLevelWithGain(character, expTable, targetLevel, dailyGain) {
  if (character.level >= targetLevel) {
    return { days: 0, completed: true, noGain: false };
  }

  const gain = Number(dailyGain);
  if (!gain || gain <= 0) {
    return { days: null, completed: false, noGain: true };
  }

  const remaining = remainingExpToLevel(character, expTable, targetLevel);
  return {
    days: Math.ceil(remaining / gain),
    completed: false,
    noGain: false,
  };
}

/** Calendar days from today (JST) until target ISO date (YYYY-MM-DD). */
export function daysUntilJstDate(targetIso, reference = new Date()) {
  const match = String(targetIso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const { year, month, day } = todayPartsInJst(reference);
  const start = Date.UTC(year, month - 1, day);
  const end = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

export function defaultTargetDateIso(daysAhead = 30, reference = new Date()) {
  const parts = targetDatePartsAfterDays(daysAhead, (key) => key, reference);
  if (!parts) {
    return "";
  }
  const month = String(parts.rawMonth).padStart(2, "0");
  const day = String(parts.rawDay).padStart(2, "0");
  return `${parts.rawYear}-${month}-${day}`;
}

export function requiredGainForLevelByDate(
  character,
  expTable,
  targetLevel,
  targetDateIso,
  reference = new Date()
) {
  if (character.level >= targetLevel) {
    return { completed: true, invalid: false };
  }

  const days = daysUntilJstDate(targetDateIso, reference);
  if (days == null || days <= 0) {
    return { completed: false, invalid: true, days };
  }

  const remaining = remainingExpToLevel(character, expTable, targetLevel);
  const daily = Math.ceil(remaining / days);
  return {
    completed: false,
    invalid: false,
    days,
    remaining,
    daily,
    weekly: daily * 7,
    monthly: daily * 30,
  };
}


export function topGainersForPeriod(characters, period, limit = 3, gainRankMaps = null) {
  return [...characters]
    .sort((a, b) => getGainAmount(b, period) - getGainAmount(a, period))
    .slice(0, limit)
    .map((character) => ({
      ...character,
      gainRank: gainRankMaps
        ? getGainRank(gainRankMaps, character.id, period)
        : null,
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
