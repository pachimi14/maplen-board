// IMPL_PLAN_SH33 §1 (D): the NESO price display for THIS page only.
// `formatExactNeso` in `../../domain/format.js` -- shared with #/starforce's
// own chart tooltip/summary cards/heatmap tooltip -- is left byte-for-byte
// untouched by this plan (plan §5: "formatCompactNeso" 触らない, acceptance
// (c): "チャート側の表示が1文字も変わらない"; format.js is outside this
// plan's §5 scope entirely). This is a fresh, isolated function in
// discovery/domain/ so nothing here can regress the existing #/starforce
// screen's own number formatting.
//
// Upstream prices are always an exact multiple of 1e-6 (統括の実測,
// docs/IMPL_PLAN_SH33.md §1-2 -- e.g. `235000000000000` -> `0.000235`,
// `96058335091000000000000` -> `96,058.335091`): 6 decimal digits is
// therefore enough to show ANY price -- from a raw, untouched ☆1 value near
// 0.000001 up through a fully-progressed six-figure ☆25 value -- with zero
// information loss; the 7th digit onward is always 0.
// `formatExactNeso`'s own `maximumFractionDigits: 2` is exactly what
// collapsed every such ☆1-10 value to the indistinguishable "0.00 NESO"
// this plan exists to fix (plan §1-1) -- this page's own values are shown
// at up to 6 decimals instead, with trailing zeros dropped (plan §1-3:
// "0.000001" / "1,132,506.562014" / "23,758.94"-style trimming) so a fully-
// settled, exactly-round price does not grow spurious zeros either.
//
// `0` is only ever returned for a value that is actually 0 (plan §1-3: "0
// と表示してよいのは、値が本当に0のときだけ") -- every other value keeps at
// least the digits needed to distinguish it from 0.
export function formatDiscoveryPrice(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const fixed = abs.toFixed(6);
  const [intPart, fracPart] = fixed.split(".");
  const trimmedFrac = fracPart.replace(/0+$/, "");
  const intFormatted = Number(intPart).toLocaleString("en-US");
  const digits = trimmedFrac ? `${intFormatted}.${trimmedFrac}` : intFormatted;
  return `${sign}${digits} NESO`;
}
