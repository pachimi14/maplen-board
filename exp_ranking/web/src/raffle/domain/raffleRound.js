export function currentRaffleRoundUtc(now = new Date()) {
  const value = new Date(now);
  if (Number.isNaN(value.getTime())) throw new TypeError("now must be a valid date");
  const dayOffset = (value.getUTCDay() - 4 + 7) % 7;
  const round = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - dayOffset));
  return round.toISOString().replace(".000Z", "Z");
}

/** Millisecond timestamp of the next Thursday 00:00 UTC reset for a round key. */
export function raffleRoundResetAt(round) {
  const startedAt = new Date(round).getTime();
  return Number.isFinite(startedAt) ? startedAt + 7 * 24 * 60 * 60 * 1000 : null;
}
