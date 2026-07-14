// Public API for T3 derived-stats. Pure functions only: no React, fetch,
// localStorage, or DOM. Bot-derived fields (rank/previousRank/
// rankFluctuation/jobRank/worldRank/history.dailyRank) are read, not
// recomputed. Not consumed anywhere yet (T3 ships no UI wiring; see T4).

export { calculateTopPercent } from "./percentile.js";
export { computePassedAndOvertaken } from "./rankMovement.js";
export { computePositiveGainStreak, computeDailyRankStreak } from "./streaks.js";
export { computeDailyGainSelfRank } from "./personalBest.js";
export { computeGoalProgress } from "./goalProgress.js";
export { calculateAverageDailyGain } from "./gainPace.js";
