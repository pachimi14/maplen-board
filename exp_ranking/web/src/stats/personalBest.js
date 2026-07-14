import { isValidIsoDate, normalizeHistoryPoints } from "./streaks.js";

function isComparableGain(dailyGain) {
  return Number.isFinite(dailyGain) && dailyGain >= 0;
}

/**
 * D. Where today's (or a given date's) daily gain ranks among the
 * character's own comparable history (competition ranking: 100,100,90 → 1,1,3).
 *
 * @param {Array<object>} history
 * @param {{onDate?: string}} [options]
 * @returns {{rank: number|null, totalComparableDays: number, gain: number|null, isTied: boolean}}
 */
export function computeDailyGainSelfRank(history, options = {}) {
  const points = normalizeHistoryPoints(history);
  const comparablePoints = points.filter((point) => isComparableGain(point.dailyGain));
  const totalComparableDays = comparablePoints.length;

  const requestedDate = options?.onDate;
  const basisDate = isValidIsoDate(requestedDate)
    ? requestedDate
    : points.length
      ? points[points.length - 1].snapshotDate
      : null;

  if (basisDate == null) {
    return { rank: null, totalComparableDays, gain: null, isTied: false };
  }

  const targetPoint = comparablePoints.find((point) => point.snapshotDate === basisDate);
  if (!targetPoint) {
    return { rank: null, totalComparableDays, gain: null, isTied: false };
  }

  const gain = targetPoint.dailyGain;
  let strictlyGreater = 0;
  let tied = false;
  for (const point of comparablePoints) {
    if (point === targetPoint) {
      continue;
    }
    if (point.dailyGain > gain) {
      strictlyGreater += 1;
    } else if (point.dailyGain === gain) {
      tied = true;
    }
  }

  return { rank: 1 + strictlyGreater, totalComparableDays, gain, isTied: tied };
}
