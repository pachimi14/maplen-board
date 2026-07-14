import { addDaysToIsoDate } from "../rankingUtils.js";
import { isValidIsoDate, normalizeHistoryPoints } from "./streaks.js";

/**
 * F. Average daily EXP gain over a trailing calendar-day window.
 * Independent from goalProgress (E) so the pace source (today/7d/30d/etc.)
 * stays an explicit, caller-chosen input rather than an implicit default.
 *
 * @param {Array<object>} history
 * @param {{days: number, endDate?: string}} options
 * @returns {number|null}
 */
export function calculateAverageDailyGain(history, options = {}) {
  const days = Number(options?.days);
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }

  const points = normalizeHistoryPoints(history);
  const requestedEndDate = options?.endDate;
  const endDate = isValidIsoDate(requestedEndDate)
    ? requestedEndDate
    : points.length
      ? points[points.length - 1].snapshotDate
      : null;

  if (endDate == null) {
    return null;
  }

  const windowStart = addDaysToIsoDate(endDate, -(days - 1));
  if (!windowStart) {
    return null;
  }

  let sum = 0;
  let count = 0;
  for (const point of points) {
    const snapshotDate = point.snapshotDate;
    if (snapshotDate < windowStart || snapshotDate > endDate) {
      continue;
    }
    const gain = point.dailyGain;
    if (Number.isFinite(gain) && gain >= 0) {
      sum += gain;
      count += 1;
    }
  }

  if (count === 0) {
    return null;
  }
  return sum / count;
}
