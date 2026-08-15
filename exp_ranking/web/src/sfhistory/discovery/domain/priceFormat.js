// IMPL_PLAN_SH33 §1 (D): the price display for THIS page only.
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
// at exactly 6 decimals instead.
//
// IMPL_PLAN_SH33 follow-up (post-review, 実機レビュー): the first version of
// this function trimmed trailing zeros (plan §1-3's own "23,758.94"-style
// example), which produced a RAGGED decimal point across the 25-row table
// (some rows 6 decimals, some 5, some 0) -- worse to read than the "0 NESO"
// bug this plan set out to fix. Every value is now padded to exactly 6
// decimals unconditionally (never trimmed), so every row's decimal point
// lines up under a right-aligned, `tabular-nums` column
// (DiscoveryPriceTable.jsx). No information is lost either way -- the 7th
// digit onward is always 0 regardless -- this is a pure alignment fix.
// The literal " NESO" unit suffix has also moved OUT of this function: it
// is now the column header's job (`prices.price` = "Price (NESO)"-style,
// 6 locales) rather than being repeated on all 25 rows, which was itself
// part of what pushed the decimal point around (a variable-width suffix
// after a variable-width number).
//
// `0.000000` is only ever returned for a value that is actually 0 (plan
// §1-3 / follow-up (d): "値が本当に0のときだけ...になる。丸めて0にしない
// 性質は維持") -- a genuine 1e-6 value still renders as `0.000001`, never
// rounds down to all zeros.
export function formatDiscoveryPrice(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const fixed = abs.toFixed(6);
  const [intPart, fracPart] = fixed.split(".");
  const intFormatted = Number(intPart).toLocaleString("en-US");
  return `${sign}${intFormatted}.${fracPart}`;
}
