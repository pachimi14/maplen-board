// IMPL_PLAN_SH5 §2: display formatting for the chart / summary / tooltip.
// Pure functions, no i18n (design's chart spec fixes "950M" / "1.25B"
// style regardless of locale -- these are compact-magnitude numbers, not
// translated text) and no DOM.

/** design §2: "縦軸は 950M / 1.25B 形式の省略表示". Two significant digits
 * once the magnitude reaches 100+ of its unit (matching the spec's own
 * "950M" example, not "950.00M"); two decimals below that (matching
 * "1.25B"). */
export function formatCompactNeso(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    const scaled = abs / 1e9;
    return `${sign}${scaled.toFixed(scaled >= 100 ? 0 : 2)}B`;
  }
  if (abs >= 1e6) {
    const scaled = abs / 1e6;
    return `${sign}${scaled.toFixed(scaled >= 100 ? 0 : 2)}M`;
  }
  if (abs >= 1e3) {
    const scaled = abs / 1e3;
    return `${sign}${scaled.toFixed(scaled >= 100 ? 0 : 2)}K`;
  }
  return `${sign}${Math.round(abs)}`;
}

/** Same magnitude formatting, prefixed with an explicit "+" for
 * non-negative deltas (design §2: tooltip shows "前回比" / "期間平均との差"). */
export function formatSignedCompactNeso(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return value >= 0 ? `+${formatCompactNeso(value)}` : formatCompactNeso(value);
}

/** design §2: "ツールチップは正確な数値". Full precision (up to the 2
 * decimals the API already rounds to -- see server/sf-history/app.py),
 * thousands-separated. */
export function formatExactNeso(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} NESO`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Short axis tick label from a bucket-start ISO date ("2026-03-08T00:00:00Z" -> "03/08"). */
export function formatAxisDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCDate())}`;
}

/** Full tooltip date label including the bucket-start time (design §9:
 * "ラベルは区間開始時刻"). */
export function formatTooltipDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

/** Full label for the "取得時刻" / "最終更新" calc-condition rows. */
export function formatTimestamp(isoDate) {
  return formatTooltipDate(isoDate);
}
