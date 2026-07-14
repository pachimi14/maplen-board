/**
 * B. Passed / overtaken — crossovers in overall level rank (`rank`) between
 * yesterday (`previousRank`) and today (`rank`). Unrelated to daily-gain rank.
 *
 * Identity is `historyKey` (canonical id, LULU-005) — never `name`. Any
 * candidate (including the target) missing a `historyKey` is treated as
 * unidentifiable and excluded rather than falling back to name matching.
 *
 * @param {{historyKey?: string|null, name?: string, rank?: number, previousRank?: number|null}} target
 * @param {Array<{historyKey?: string|null, name?: string, rank?: number, previousRank?: number|null}>} allCharacters
 * @returns {{passed: Array<{historyKey: string, name: string, previousRank: number, rank: number}>, overtakenBy: Array<{historyKey: string, name: string, previousRank: number, rank: number}>}}
 */
export function computePassedAndOvertaken(target, allCharacters) {
  const empty = { passed: [], overtakenBy: [] };

  const targetKey = normalizeKey(target?.historyKey);
  if (!targetKey) {
    return empty;
  }

  const targetPrev = target?.previousRank;
  if (targetPrev == null || !Number.isFinite(targetPrev)) {
    return empty;
  }
  const targetRank = target?.rank;

  const passed = [];
  const overtakenBy = [];

  const candidates = Array.isArray(allCharacters) ? allCharacters : [];
  for (const x of candidates) {
    const xKey = normalizeKey(x?.historyKey);
    if (!xKey) {
      continue;
    }
    if (xKey === targetKey) {
      continue;
    }
    const xPrev = x?.previousRank;
    if (xPrev == null || !Number.isFinite(xPrev)) {
      continue;
    }
    const xRank = x?.rank;

    const entry = { historyKey: xKey, name: x?.name, previousRank: xPrev, rank: xRank };

    if (xPrev < targetPrev && targetRank < xRank) {
      passed.push(entry);
    } else if (targetPrev < xPrev && xRank < targetRank) {
      overtakenBy.push(entry);
    }
  }

  const byRankThenKey = (a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.historyKey < b.historyKey ? -1 : a.historyKey > b.historyKey ? 1 : 0;
  };

  passed.sort(byRankThenKey);
  overtakenBy.sort(byRankThenKey);

  return { passed, overtakenBy };
}

function normalizeKey(historyKey) {
  const key = String(historyKey ?? "").trim();
  return key || null;
}
