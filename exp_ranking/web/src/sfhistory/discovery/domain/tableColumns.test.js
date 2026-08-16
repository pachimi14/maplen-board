import { describe, expect, it } from "vitest";
import { DISCOVERY_TABLE_COLUMN_WIDTHS_PX, DISCOVERY_TABLE_MIN_WIDTH_PX } from "./tableColumns.js";

// Post-review follow-up (実機レビュー, 本番): pins the ONE set of column
// widths DiscoveryPriceTable.jsx and DiscoveryCubeTable.jsx both render via
// the shared DiscoveryTableColgroup.jsx -- this is what a future edit to
// only one of those two table files can no longer silently drift away from
// (plan (v): "列幅の定義を1箇所に持つ").
describe("DISCOVERY_TABLE_COLUMN_WIDTHS_PX", () => {
  it("has exactly 4 widths -- label / price / status / settledAt, matching both tables' column count", () => {
    expect(DISCOVERY_TABLE_COLUMN_WIDTHS_PX).toHaveLength(4);
    expect(DISCOVERY_TABLE_COLUMN_WIDTHS_PX.every((w) => Number.isFinite(w) && w > 0)).toBe(true);
  });

  // (w): the longest real label either table shows is a cube name (not a
  // ☆ number) -- "Bonus Potential Cube" measured 346px in production at
  // this table's font/padding. The first column must stay comfortably at
  // or above that so it never wraps.
  it("(w): the first (label) column is wide enough for the longest real cube name without wrapping", () => {
    const PRODUCTION_MEASURED_MIN_PX = 346; // 統括実機実測, "Bonus Potential Cube"
    expect(DISCOVERY_TABLE_COLUMN_WIDTHS_PX[0]).toBeGreaterThanOrEqual(PRODUCTION_MEASURED_MIN_PX);
  });
});

describe("DISCOVERY_TABLE_MIN_WIDTH_PX", () => {
  it("is the sum of every column width", () => {
    const expected = DISCOVERY_TABLE_COLUMN_WIDTHS_PX.reduce((sum, w) => sum + w, 0);
    expect(DISCOVERY_TABLE_MIN_WIDTH_PX).toBe(expected);
  });
});
