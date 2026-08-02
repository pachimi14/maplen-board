export function currentRaffleRoundUtc(now = new Date()) {
  const value = new Date(now);
  if (Number.isNaN(value.getTime())) throw new TypeError("now must be a valid date");
  const dayOffset = (value.getUTCDay() - 4 + 7) % 7;
  const round = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - dayOffset));
  return round.toISOString().replace(".000Z", "Z");
}