const PERCENT_PATTERN = /^(\d{1,3})(?:\.(\d{1,6}))?$/;
const SCALE = 1_000_000n;
const HUNDRED = 100n * SCALE;

function parsePercent(value, { allowZero }) {
  const text = String(value ?? "").trim();
  if (!text) return { blank: true };
  const match = PERCENT_PATTERN.exec(text);
  if (!match) return { error: "invalid_distribution_percent" };
  const units = BigInt(match[1]) * SCALE + BigInt((match[2] || "").padEnd(6, "0"));
  if (units > HUNDRED || (!allowZero && units === 0n)) return { error: "invalid_distribution_percent" };
  return { blank: false, units };
}

function percentText(numerator, denominator = HUNDRED) {
  const scaled = numerator * 1_000_000n / denominator;
  const whole = scaled / 10_000n;
  const fraction = (scaled % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

function percentUnitsInputText(units) {
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function resolvedRows(rows, shareFractions) {
  return rows.map((row) => ({
    memberId: row.memberId,
    taxed: !row.tax.blank,
    taxUnits: row.tax.blank ? 0n : row.tax.units,
    taxText: row.tax.blank ? null : percentText(row.tax.units),
    share: shareFractions.get(row.memberId) || null,
    shareInputText: shareFractions.get(row.memberId)?.taxDerived
      ? percentUnitsInputText(shareFractions.get(row.memberId).units)
      : null,
    shareText: shareFractions.has(row.memberId)
      ? percentText(shareFractions.get(row.memberId).numerator, shareFractions.get(row.memberId).denominator)
      : "—",
  }));
}

export function resolveDistributionRules(partyOrder, taxPercentByMemberId = {}, sharePercentByMemberId = {}) {
  const errors = [];
  const rows = [];
  for (const memberId of partyOrder) {
    const tax = parsePercent(taxPercentByMemberId[memberId], { allowZero: false });
    const share = parsePercent(sharePercentByMemberId[memberId], { allowZero: true });
    if (tax.error) errors.push({ code: tax.error, field: "taxPercent", memberId });
    if (share.error) errors.push({ code: share.error, field: "sharePercent", memberId });
    if (!tax.blank && !share.blank) errors.push({ code: "tax_share_conflict", field: "distribution", memberId });
    rows.push({ memberId, tax, share });
  }
  if (errors.length) return { ok: false, errors };

  const nonTaxMembers = rows.filter((row) => row.tax.blank);
  if (!nonTaxMembers.length) return { ok: false, errors: [{ code: "no_distribution_receiver", field: "distribution" }] };
  const partySize = BigInt(rows.length);
  const taxShareUnits = new Map(rows.filter((row) => !row.tax.blank).map((row) => [row.memberId, row.tax.units / partySize]));
  const explicitTotal = nonTaxMembers.reduce((sum, row) => sum + (row.share.blank ? 0n : row.share.units), 0n);
  const taxShareTotal = [...taxShareUnits.values()].reduce((sum, units) => sum + units, 0n);
  const fixedTotal = explicitTotal + taxShareTotal;
  const automatic = nonTaxMembers.filter((row) => row.share.blank);
  const shareFractions = new Map();
  for (const row of rows) {
    if (!row.tax.blank) {
      const units = taxShareUnits.get(row.memberId);
      shareFractions.set(row.memberId, { numerator: units, denominator: HUNDRED, automatic: false, taxDerived: true, units });
    } else if (!row.share.blank) {
      shareFractions.set(row.memberId, { numerator: row.share.units, denominator: HUNDRED, automatic: false, taxDerived: false, units: row.share.units });
    }
  }
  if (fixedTotal > HUNDRED) {
    return { ok: false, errors: [{ code: "distribution_over_100", field: "sharePercent" }], rows: resolvedRows(rows, shareFractions), totalText: percentText(fixedTotal) };
  }
  if (!automatic.length && fixedTotal !== HUNDRED) {
    return { ok: false, errors: [{ code: "distribution_not_100", field: "sharePercent" }], rows: resolvedRows(rows, shareFractions), totalText: percentText(fixedTotal) };
  }
  const remaining = HUNDRED - fixedTotal;
  for (const row of rows) {
    if (row.tax.blank && row.share.blank) {
      shareFractions.set(row.memberId, { numerator: remaining, denominator: HUNDRED * BigInt(automatic.length), automatic: true, taxDerived: false, units: null });
    }
  }
  return {
    ok: true,
    rows: resolvedRows(rows, shareFractions),
    totalText: "100%",
  };
}

export function allocateDistribution(total, resolved, partyOrder) {
  const byMemberId = new Map(resolved.rows.map((row) => [row.memberId, row]));
  const allocations = new Map();
  let assigned = 0n;
  for (const memberId of partyOrder) {
    const share = byMemberId.get(memberId)?.share;
    if (!share) continue;
    const amount = total * share.numerator / share.denominator;
    allocations.set(memberId, amount);
    assigned += amount;
  }
  let remainder = total - assigned;
  for (const memberId of partyOrder) {
    if (remainder === 0n) break;
    if (!allocations.has(memberId)) continue;
    allocations.set(memberId, allocations.get(memberId) + 1n);
    remainder -= 1n;
  }
  return allocations;
}

/** Replaces blank automatic shares with explicit percentages totaling exactly 100%. */
export function materializeAutomaticShares(partyOrder, taxPercentByMemberId = {}, sharePercentByMemberId = {}) {
  const resolved = resolveDistributionRules(partyOrder, taxPercentByMemberId, sharePercentByMemberId);
  if (!resolved.ok) return resolved;
  const automaticIds = resolved.rows.filter((row) => row.share?.automatic).map((row) => row.memberId);
  if (!automaticIds.length) return { ok: true, sharePercentByMemberId: { ...sharePercentByMemberId } };
  const fixedTotal = resolved.rows.reduce((sum, row) => row.share && !row.share.automatic ? sum + row.share.units : sum, 0n);
  const remaining = HUNDRED - fixedTotal;
  const base = remaining / BigInt(automaticIds.length);
  let remainder = remaining % BigInt(automaticIds.length);
  const next = { ...sharePercentByMemberId };
  for (const memberId of automaticIds) {
    const units = base + (remainder > 0n ? 1n : 0n);
    if (remainder > 0n) remainder -= 1n;
    next[memberId] = percentUnitsInputText(units);
  }
  return { ok: true, sharePercentByMemberId: next };
}

export const DISTRIBUTION_PERCENT_SCALE = SCALE;
