/**
 * A. Top-percent (uses an already-computed rank; never recomputes it).
 *
 * Works for overall / job / world rankings alike: callers pass whichever
 * (rank, total) pair applies, e.g. (rank, characterCount),
 * (jobRank, jobRankTotal), (worldRank, worldRankTotal).
 *
 * @param {number} rank
 * @param {number} total
 * @returns {number|null} rank / total * 100, unrounded, or null when the
 *   inputs are not comparable (non-finite, total<=0, rank<=0, rank>total).
 */
export function calculateTopPercent(rank, total) {
  const r = Number(rank);
  const t = Number(total);
  if (!Number.isFinite(r) || !Number.isFinite(t)) {
    return null;
  }
  if (t <= 0) {
    return null;
  }
  if (r <= 0) {
    return null;
  }
  if (r > t) {
    return null;
  }
  return (r / t) * 100;
}
