const DECIMAL_INTEGER = /^\d+$/;

export function parseExpInteger(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && DECIMAL_INTEGER.test(value)) return BigInt(value);
  return null;
}

export function utcDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function absoluteExpFromLevel(level, exp, expTable, baseLevel = 240) {
  if (!Number.isInteger(level) || level < baseLevel) return null;
  const currentExp = parseExpInteger(exp);
  if (currentExp === null || !expTable || typeof expTable !== "object") return null;

  let total = currentExp;
  for (let currentLevel = baseLevel; currentLevel < level; currentLevel += 1) {
    const required = parseExpInteger(expTable[currentLevel] ?? expTable[String(currentLevel)]);
    if (required === null) return null;
    total += required;
  }
  return total;
}

export function calculateLiveExp({
  baseline,
  current,
  expTable,
  baselineUpdatedAt,
  now = new Date(),
}) {
  if (utcDateKey(baselineUpdatedAt) !== utcDateKey(now)) {
    return { ok: false, code: "baselinePending" };
  }

  const baselineTotal = parseExpInteger(baseline?.totalExpFrom240);
  const currentTotal = absoluteExpFromLevel(current?.level, current?.exp, expTable);
  if (baselineTotal === null || currentTotal === null) {
    return { ok: false, code: "invalidData" };
  }
  if (currentTotal < baselineTotal) {
    return { ok: false, code: "negativeGain" };
  }

  const gain = currentTotal - baselineTotal;
  return {
    ok: true,
    code: "ok",
    gain: gain.toString(),
    gainNumber: Number(gain),
    level: current.level,
    levelExpPercent: Number.isFinite(current.levelExpPercent)
      ? current.levelExpPercent
      : baseline?.levelExpPercent,
  };
}
