import { LEVEL_CAP, addDaysToIsoDate, daysUntilJstDate, remainingExpToLevel } from "../rankingUtils.js";
import { isValidIsoDate, normalizeHistoryPoints } from "./streaks.js";

function resolveTodayIso(character, overrideTodayIso) {
  if (isValidIsoDate(overrideTodayIso)) {
    return overrideTodayIso;
  }
  const history = Array.isArray(character?.history) ? character.history : [];
  const points = normalizeHistoryPoints(history);
  return points.length ? points[points.length - 1].snapshotDate : null;
}

/** Calendar days between two ISO dates (target − today), reusing daysUntilJstDate. */
function daysBetweenIso(todayIso, targetDateIso) {
  // daysUntilJstDate derives "today" from a Date by reading its JST calendar
  // day; midnight UTC of todayIso converts to 09:00 JST the *same* day, so
  // this yields exactly todayIso's calendar date without drifting.
  const reference = new Date(`${todayIso}T00:00:00Z`);
  return daysUntilJstDate(targetDateIso, reference);
}

/**
 * E. Progress toward a level/date goal, given an externally-computed pace.
 * `averageDailyGain` must be supplied by the caller (see gainPace.js `F`);
 * this function never selects a pace source itself.
 *
 * @param {object} character
 * @param {object} expTable
 * @param {{targetLevel: number, targetDateIso: string}} goal
 * @param {{averageDailyGain?: number|null, todayIso?: string}} [options]
 */
export function computeGoalProgress(character, expTable, goal, options = {}) {
  const targetLevel = Number(goal?.targetLevel);
  const targetLevelFinite = Number.isFinite(targetLevel);
  const targetLevelValid = targetLevelFinite && targetLevel <= LEVEL_CAP;

  const targetDateIso = goal?.targetDateIso;
  const targetDateValid = isValidIsoDate(targetDateIso);

  const level = Number(character?.level ?? 0);
  const todayIso = resolveTodayIso(character, options?.todayIso);

  const averageDailyGainInput = options?.averageDailyGain;
  const averageDailyGainValid = Number.isFinite(averageDailyGainInput) && averageDailyGainInput > 0;
  const averageDailyGainOut = averageDailyGainValid ? averageDailyGainInput : null;

  const remainingExp = targetLevelFinite ? remainingExpToLevel(character, expTable, targetLevel) : null;

  const daysUntilTarget =
    targetDateValid && todayIso != null ? daysBetweenIso(todayIso, targetDateIso) : null;

  // 1. achieved — checked before any other validity, per contract priority.
  const achieved = targetLevelFinite && level >= targetLevel;
  if (achieved) {
    const daysToArrive = 0; // remainingExp is 0 once achieved, regardless of pace.
    const requiredDailyGain =
      daysUntilTarget != null && daysUntilTarget > 0
        ? Math.ceil(remainingExp / daysUntilTarget)
        : null;
    const estimatedArrivalDate = todayIso != null ? addDaysToIsoDate(todayIso, daysToArrive) : null;
    const daysDelta = daysUntilTarget != null ? daysUntilTarget - daysToArrive : null;
    return {
      status: "achieved",
      daysDelta,
      estimatedArrivalDate,
      targetDate: targetDateValid ? targetDateIso : null,
      requiredDailyGain,
      averageDailyGain: averageDailyGainOut,
      remainingExp,
      daysUntilTarget,
    };
  }

  // 2. insufficientData
  if (!targetLevelValid || !targetDateValid || !averageDailyGainValid || todayIso == null) {
    return {
      status: "insufficientData",
      daysDelta: null,
      estimatedArrivalDate: null,
      targetDate: targetDateValid ? targetDateIso : null,
      requiredDailyGain: null,
      averageDailyGain: averageDailyGainOut,
      remainingExp,
      daysUntilTarget,
    };
  }

  const requiredDailyGain = daysUntilTarget > 0 ? Math.ceil(remainingExp / daysUntilTarget) : null;
  const daysToArrive = Math.ceil(remainingExp / averageDailyGainInput);
  const estimatedArrivalDate = addDaysToIsoDate(todayIso, daysToArrive);
  const daysDelta = daysUntilTarget - daysToArrive;

  // 3. past target date, still not achieved → behind (structural values still returned).
  // 4. otherwise, classify by daysDelta sign.
  let status;
  if (daysUntilTarget <= 0) {
    status = "behind";
  } else if (daysDelta > 0) {
    status = "ahead";
  } else if (daysDelta < 0) {
    status = "behind";
  } else {
    status = "onTrack";
  }

  return {
    status,
    daysDelta,
    estimatedArrivalDate,
    targetDate: targetDateIso,
    requiredDailyGain,
    averageDailyGain: averageDailyGainOut,
    remainingExp,
    daysUntilTarget,
  };
}
