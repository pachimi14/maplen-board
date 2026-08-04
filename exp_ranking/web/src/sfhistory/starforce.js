// 移植物。正は maplenEnhancebot packages/engine/src/starforce.ts
// (commit c62b14fb3dff3e29205b932224c650c361649ca3)。
// このファイルを直接編集しない。修正は向こうを直してから再移植する。
// 一致は starforce.test.js が maplenEnhancebot の parity fixture(越境 golden)と
// 照合して保証する(docs/DESIGN_SF_COST_HISTORY.md §8)。
//
// 移植範囲(docs/IMPL_PLAN_SH4.md §2): STAR_PROBABILITIES / effectiveProbabilities /
// applyStarCatchInverse / applySafeguard / minReachableStar / requiredPriceStars /
// spanHasDropOrBoom / expectedStarforceCostExact とその内部ヘルパのみ。
// analyticStarforceCostPercentiles / starforceCost は持ち込まない
// (docs/DESIGN_SF_COST_HISTORY.md §12: 分位は本ツールで出さない。
// p90 = expected * 1.85 という固定係数の経験則であり、drop/boom span は別経路の実分位。
// 「無い数字を発明しない」)。
//
// 型注釈のみを機械的に除去した変換で、ロジック・演算順序・ループ順序・ピボット選択・
// 比較演算子は一切変更していない。Gaussian elimination は Python の
// pivot/elimination 順序を意図的に再現しているため、「きれいに書き直す」と浮動小数の
// 結果が変わる(勝手に整理しないこと)。

export const STAR_FORCE_MIN = 0;
export const STAR_FORCE_MAX = 25;
export const STAR_CATCH_MULTIPLIER = 1.05;
export const BOOM_RESET_STAR = 10;

// Rates already include Star Catch (+5%); do not re-apply. Transcribed from STAR_PROBABILITIES.
export const STAR_PROBABILITIES = {
  0: { success: 0.9975, keep: 0.0025, drop: 0.0, boom: 0.0 },
  1: { success: 0.945, keep: 0.055, drop: 0.0, boom: 0.0 },
  2: { success: 0.8925, keep: 0.1075, drop: 0.0, boom: 0.0 },
  3: { success: 0.8925, keep: 0.1075, drop: 0.0, boom: 0.0 },
  4: { success: 0.84, keep: 0.16, drop: 0.0, boom: 0.0 },
  5: { success: 0.7875, keep: 0.2125, drop: 0.0, boom: 0.0 },
  6: { success: 0.735, keep: 0.265, drop: 0.0, boom: 0.0 },
  7: { success: 0.6825, keep: 0.3175, drop: 0.0, boom: 0.0 },
  8: { success: 0.63, keep: 0.37, drop: 0.0, boom: 0.0 },
  9: { success: 0.5775, keep: 0.4225, drop: 0.0, boom: 0.0 },
  10: { success: 0.525, keep: 0.475, drop: 0.0, boom: 0.0 },
  11: { success: 0.4725, keep: 0.0, drop: 0.5275, boom: 0.0 },
  12: { success: 0.42, keep: 0.0, drop: 0.5742, boom: 0.0058 },
  13: { success: 0.3675, keep: 0.0, drop: 0.61985, boom: 0.01265 },
  14: { success: 0.315, keep: 0.0, drop: 0.6713, boom: 0.0137 },
  15: { success: 0.315, keep: 0.6644, drop: 0.0, boom: 0.0206 },
  16: { success: 0.315, keep: 0.0, drop: 0.6644, boom: 0.0206 },
  17: { success: 0.315, keep: 0.0, drop: 0.6644, boom: 0.0206 },
  18: { success: 0.315, keep: 0.0, drop: 0.6576, boom: 0.0274 },
  19: { success: 0.315, keep: 0.0, drop: 0.6576, boom: 0.0274 },
  20: { success: 0.315, keep: 0.6165, drop: 0.0, boom: 0.0685 },
  21: { success: 0.315, keep: 0.0, drop: 0.6165, boom: 0.0685 },
  22: { success: 0.0315, keep: 0.0, drop: 0.7748, boom: 0.1937 },
  23: { success: 0.021, keep: 0.0, drop: 0.6853, boom: 0.2937 },
  24: { success: 0.0105, keep: 0.0, drop: 0.5937, boom: 0.3958 },
};

function validateStarRange(startStar, targetStar) {
  if (!(STAR_FORCE_MIN <= startStar && startStar < targetStar && targetStar <= STAR_FORCE_MAX)) {
    throw new Error(`Star range must satisfy ${STAR_FORCE_MIN} <= start < target <= ${STAR_FORCE_MAX}`);
  }
  const missing = [];
  for (let s = startStar; s < targetStar; s++) if (!(s in STAR_PROBABILITIES)) missing.push(s);
  if (missing.length) throw new Error(`No probability data for star levels: ${missing}`);
}

function starAfterDrop(star) {
  const floor = star >= 15 ? 15 : star >= 12 ? 10 : STAR_FORCE_MIN;
  return Math.max(floor, star - 1);
}

export function minReachableStar(startStar) {
  let star = startStar;
  for (;;) {
    const next = starAfterDrop(star);
    if (next >= star) return star;
    star = next;
  }
}

export function requiredPriceStars(startStar, targetStar) {
  validateStarRange(startStar, targetStar);
  const floor = Math.min(minReachableStar(startStar), BOOM_RESET_STAR);
  const out = [];
  for (let s = floor; s < targetStar; s++) out.push(s);
  return out;
}

export function spanHasDropOrBoom(startStar, targetStar) {
  validateStarRange(startStar, targetStar);
  for (let star = startStar; star < targetStar; star++) {
    const p = STAR_PROBABILITIES[star];
    if (p.drop > 0 || p.boom > 0) return true;
  }
  return false;
}

export function applySafeguard(probs, star, safeguardStars) {
  if (!safeguardStars.includes(star) || probs.boom === 0) return probs;
  const adjusted = { ...probs, boom: 0 };
  const boom = probs.boom;
  const totalOther = probs.success + probs.keep + probs.drop;
  if (totalOther === 0) {
    adjusted.drop = boom;
  } else {
    adjusted.success = probs.success + boom * (probs.success / totalOther);
    adjusted.keep = probs.keep + boom * (probs.keep / totalOther);
    adjusted.drop = probs.drop + boom * (probs.drop / totalOther);
  }
  return adjusted;
}

export function applyStarCatchInverse(probs) {
  const oldSuccess = probs.success;
  const newSuccess = oldSuccess / STAR_CATCH_MULTIPLIER;
  const extra = oldSuccess - newSuccess;
  const failTotal = 1.0 - oldSuccess;
  if (failTotal <= 0) return { ...probs, success: newSuccess };
  const scale = (failTotal + extra) / failTotal;
  return {
    success: newSuccess,
    keep: probs.keep * scale,
    drop: probs.drop * scale,
    boom: probs.boom * scale,
  };
}

export function effectiveProbabilities(star, opts = {}) {
  let probs = { ...STAR_PROBABILITIES[star] };
  if (opts.withoutStarCatch) probs = applyStarCatchInverse(probs);
  if (opts.safeguardStars && opts.safeguardStars.length) probs = applySafeguard(probs, star, opts.safeguardStars);
  return probs;
}

function enhancementCost(star, sfPrices, safeguardStars, safeguardCostMultiplier) {
  let cost = sfPrices[star];
  if (safeguardStars.includes(star)) cost *= safeguardCostMultiplier;
  return cost;
}

function failStreakAfterOutcome(failStreak, outcome, useChanceTime, chanceTimeCountsKeep) {
  if (!useChanceTime) return failStreak;
  if (outcome === "success") return 0;
  if (outcome === "keep" && !chanceTimeCountsKeep) return failStreak;
  return Math.min(failStreak + 1, 2);
}

function stateIndex(star, failStreak) {
  return star * 3 + failStreak;
}

/** Gaussian elimination with partial pivoting - mirrors _solve_linear_system exactly. */
function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  const aug = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    // Python max() keeps the first row on ties -> use strict '>' when scanning downward.
    let pivotRow = col;
    let best = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row][col]);
      if (v > best) {
        best = v;
        pivotRow = row;
      }
    }
    if (Math.abs(aug[pivotRow][col]) < 1e-12) throw new Error("Singular linear system in star force DP");
    if (pivotRow !== col) {
      const t = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = t;
    }
    const pivot = aug[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
  const solution = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let total = aug[row][n];
    for (let col = row + 1; col < n; col++) total -= aug[row][col] * solution[col];
    solution[row] = total / aug[row][row];
  }
  return solution;
}

/** Exact expected meso cost via backward DP on (star, fail_streak) - ports
 * expected_starforce_cost_exact. */
export function expectedStarforceCostExact(args) {
  const { startStar, targetStar, sfPrices } = args;
  const withoutStarCatch = args.withoutStarCatch ?? false;
  const safeguardStars = args.safeguardStars ?? [];
  const chanceTimeCountsKeep = args.chanceTimeCountsKeep ?? false;
  const useChanceTime = args.useChanceTime ?? true;
  const safeguardCostMultiplier = args.safeguardCostMultiplier ?? 2.0;

  validateStarRange(startStar, targetStar);
  const missing = requiredPriceStars(startStar, targetStar).filter((s) => !(s in sfPrices));
  if (missing.length) {
    const floor = Math.min(minReachableStar(startStar), BOOM_RESET_STAR);
    throw new Error(
      `Missing enhancement costs for star levels: ${missing} (need ${floor}-${targetStar - 1} incl. drop recovery and boom reset)`,
    );
  }

  const nStates = targetStar * 3;
  const matrix = Array.from({ length: nStates }, () => new Array(nStates).fill(0));
  const rhs = new Array(nStates).fill(0);

  for (let star = 0; star < targetStar; star++) {
    for (let fail = 0; fail < 3; fail++) {
      const row = stateIndex(star, fail);
      const cost = enhancementCost(star, sfPrices, safeguardStars, safeguardCostMultiplier);

      if (useChanceTime && fail >= 2) {
        matrix[row][row] = 1.0;
        const nextStar = star + 1;
        if (nextStar < targetStar) matrix[row][stateIndex(nextStar, 0)] -= 1.0;
        rhs[row] = cost;
        continue;
      }

      const probs = effectiveProbabilities(star, { withoutStarCatch, safeguardStars });
      const pSuccess = probs.success;
      const pKeep = probs.keep;
      const pDrop = probs.drop;
      const pBoom = probs.boom;

      matrix[row][row] = 1.0;
      rhs[row] = cost;

      const nextSuccess = star + 1;
      if (nextSuccess < targetStar) matrix[row][stateIndex(nextSuccess, 0)] -= pSuccess;

      const dropStar = starAfterDrop(star);
      const failDrop = failStreakAfterOutcome(fail, "drop", useChanceTime, chanceTimeCountsKeep);
      if (dropStar < targetStar) matrix[row][stateIndex(dropStar, failDrop)] -= pDrop;

      const failBoom = failStreakAfterOutcome(fail, "boom", useChanceTime, chanceTimeCountsKeep);
      if (BOOM_RESET_STAR < targetStar) matrix[row][stateIndex(BOOM_RESET_STAR, failBoom)] -= pBoom;

      if (chanceTimeCountsKeep && useChanceTime) {
        const failKeep = failStreakAfterOutcome(fail, "keep", useChanceTime, true);
        matrix[row][stateIndex(star, failKeep)] -= pKeep;
      } else if (pKeep > 0) {
        matrix[row][row] -= pKeep;
      }
    }
  }

  const values = solveLinearSystem(matrix, rhs);
  return values[stateIndex(startStar, 0)];
}
