// Post-review follow-up (実機レビュー, 本番): DiscoveryPriceTable.jsx (☆) and
// DiscoveryCubeTable.jsx (cube) sit directly on top of each other and must
// render with IDENTICAL column lefts -- with `table-layout: auto` (the
// previous behavior) each table sizes its own first column from its own
// content ("☆11" vs "Bonus Potential Cube"), so the two tables drift apart
// column by column even though both share the same outer width/left.
//
// The fix: BOTH tables read the SAME four column widths from here (never
// redefined per-table -- that is exactly how the two widths drifted apart
// last time) and render them via an identical `<colgroup>` with
// `table-layout: fixed`. `table-layout: fixed` makes column widths depend
// ONLY on these declared widths (plus each table's own overall width) --
// never on cell content -- so as long as both tables render at the same
// overall width (they do: both are `w-full` inside the same
// `.sfh-summary-card`), their column lefts are mathematically identical
// regardless of what text lands in any cell.
//
// Column 0 (label -- ☆NN or a cube name) must fit the longest value either
// table will ever show without wrapping (plan (w)): "Bonus Potential Cube"
// measured at 346px in production at this table's font/padding -- 360 here
// leaves a small margin. The other three widths are picked generously
// (price up to 7 figures + 6 fixed decimals; the settled-at range shows two
// formatted timestamps). `MIN_TABLE_WIDTH` is the sum -- both table
// components apply it as `min-width` on the `<table>` itself (not the
// column widths as %), wrapped in their own `overflow-x-auto` container, so
// a narrow viewport scrolls the TABLE, never the page (plan (x)).
export const DISCOVERY_TABLE_COLUMN_WIDTHS_PX = [360, 200, 140, 340]; // label / price / status / settledAt

export const DISCOVERY_TABLE_MIN_WIDTH_PX = DISCOVERY_TABLE_COLUMN_WIDTHS_PX.reduce((sum, w) => sum + w, 0);
