// Pure row-builder for the group comparison table (T4b §22.5). No React/
// DOM access here so it can be unit tested in isolation, same as
// myCharacterUtils.js. GroupComparisonTable.jsx (display) and
// CharacterGroupTools.jsx (wiring) consume this instead of re-deriving the
// same aggregation inline.

import { findCharacterByMemberKey, formatJobName, getGainAmount } from "../rankingUtils";

/**
 * §22.5: one row per group member (key/job/server + standing daily/weekly/
 * monthly gains + the currently-selected-period total or average).
 *
 * The standing daily/weekly/monthly figures are read directly via the same
 * `getGainAmount`/`formatJobName` the rest of the app uses (never
 * recomputed here). The "period" column is derived from `series` — the
 * *same* `buildGroupGainSeries(characters, memberKeys, chartRange)` output
 * already driving the existing chart for this exact `chartRange` — so the
 * table always agrees with the chart it sits under; this function never
 * re-aggregates history independently.
 *
 * A member name that doesn't resolve to a loaded character (removed from
 * the ranking, or renamed — §22.6: group membership is a name array,
 * unmigrated) still gets a row, so the table's row count always matches
 * the group's member count 1:1; every numeric/text field for that row is
 * `null` (the caller renders "-") rather than the row being silently
 * dropped or the function throwing.
 *
 * @param {{characters: object[], memberKeys: string[], series: Array<Record<string, number|null>>, mode: "total"|"average"}} input
 * @returns {Array<{key:string, name:string, job:string|null, worldId:string|null, daily:number|null, weekly:number|null, monthly:number|null, periodValue:number|null, periodDayCount:number}>}
 */
export function buildGroupComparisonRows({ characters, memberKeys, series, mode }) {
  const keys = Array.isArray(memberKeys) ? memberKeys : [];
  const seriesRows = Array.isArray(series) ? series : [];
  const pool = Array.isArray(characters) ? characters : [];

  return keys.map((key) => {
    const character = findCharacterByMemberKey(pool, key);

    const points = seriesRows
      .map((row) => row?.[key])
      .filter((value) => value != null && Number.isFinite(value));

    let periodValue = null;
    if (points.length > 0) {
      const total = points.reduce((sum, value) => sum + value, 0);
      periodValue = mode === "average" ? total / points.length : total;
    }

    return {
      key,
      name: character?.name ?? key,
      job: character ? formatJobName(character.job) : null,
      worldId: character?.worldId ?? null,
      daily: character ? getGainAmount(character, "daily") : null,
      weekly: character ? getGainAmount(character, "weekly") : null,
      monthly: character ? getGainAmount(character, "monthly") : null,
      periodValue,
      periodDayCount: points.length,
    };
  });
}
