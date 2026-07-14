const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value) {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function parseIsoDateUtcMs(isoDate) {
  const match = ISO_DATE_RE.exec(isoDate);
  if (!match) {
    return NaN;
  }
  return Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)));
}

/** Whole-calendar-day difference (b - a), in days. */
function diffCalendarDays(isoDateA, isoDateB) {
  const a = parseIsoDateUtcMs(isoDateA);
  const b = parseIsoDateUtcMs(isoDateB);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return NaN;
  }
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/** Descending by dailyGain (null/NaN last): used only for duplicate-date dedup. */
function gainDedupKey(dailyGain) {
  return Number.isFinite(dailyGain) ? -dailyGain : Number.POSITIVE_INFINITY;
}

/** Ascending by dailyRank (null/NaN last): used only for duplicate-date dedup. */
function rankDedupKey(dailyRank) {
  return Number.isFinite(dailyRank) ? dailyRank : Number.POSITIVE_INFINITY;
}

function compareForDedup(a, b) {
  const gainDiff = gainDedupKey(a.dailyGain) - gainDedupKey(b.dailyGain);
  if (gainDiff !== 0) {
    return gainDiff;
  }
  const rankDiff = rankDedupKey(a.dailyRank) - rankDedupKey(b.dailyRank);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  // Deterministic, input-order-independent final tiebreak (should not matter
  // in practice per the plan: dailyGain/dailyRank alone resolve real data).
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * Canonical history normalization shared by streaks (C) and gain-pace (F):
 * keep only points with a valid `snapshotDate`, fold duplicate dates down to
 * one representative point per calendar day (dailyGain desc/null-last, then
 * dailyRank asc/null-last), and return points sorted by snapshotDate asc.
 * Deterministic and independent of input order.
 *
 * @param {Array<{snapshotDate?: string, dailyGain?: number|null, dailyRank?: number|null}>} history
 * @returns {Array<object>} unique-per-date points, ascending by snapshotDate
 */
export function normalizeHistoryPoints(history) {
  const points = Array.isArray(history) ? history : [];
  const byDate = new Map();
  for (const point of points) {
    const snapshotDate = point?.snapshotDate;
    if (!isValidIsoDate(snapshotDate)) {
      continue;
    }
    const existing = byDate.get(snapshotDate);
    if (!existing || compareForDedup(point, existing) < 0) {
      byDate.set(snapshotDate, point);
    }
  }
  return [...byDate.keys()].sort().map((date) => byDate.get(date));
}

/**
 * Generic calendar-day streak over normalized (unique-date, ascending) points.
 * `current` is the run ending at the last point (most recent confirmed
 * date), 0 if that point doesn't qualify. `longest` is the max run anywhere.
 */
function computeStreak(normalizedPoints, conditionFn) {
  let longest = 0;
  let prevRun = 0;
  let prevDate = null;
  let prevQualified = false;

  for (const point of normalizedPoints) {
    const qualifies = conditionFn(point);
    let run;
    if (!qualifies) {
      run = 0;
    } else if (prevQualified && prevDate != null && diffCalendarDays(prevDate, point.snapshotDate) === 1) {
      run = prevRun + 1;
    } else {
      run = 1;
    }
    if (run > longest) {
      longest = run;
    }
    prevRun = run;
    prevDate = point.snapshotDate;
    prevQualified = qualifies;
  }

  const current = prevQualified ? prevRun : 0;
  return { current, longest };
}

/**
 * C1. Consecutive positive-daily-gain streak, calendar-day based.
 * @param {Array<object>} history
 * @returns {{current: number, longest: number}}
 */
export function computePositiveGainStreak(history) {
  const points = normalizeHistoryPoints(history);
  return computeStreak(points, (point) => Number.isFinite(point.dailyGain) && point.dailyGain > 0);
}

/**
 * C2. Consecutive "daily rank within maxRank" streak, calendar-day based.
 * @param {Array<object>} history
 * @param {{maxRank: number}} options
 * @returns {{current: number, longest: number}}
 */
export function computeDailyRankStreak(history, options = {}) {
  const maxRank = Number(options?.maxRank);
  if (!Number.isFinite(maxRank) || maxRank <= 0) {
    return { current: 0, longest: 0 };
  }
  const points = normalizeHistoryPoints(history);
  return computeStreak(
    points,
    (point) =>
      Number.isFinite(point.dailyRank) &&
      Number.isInteger(point.dailyRank) &&
      point.dailyRank >= 1 &&
      point.dailyRank <= maxRank
  );
}
