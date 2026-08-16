import { DISCOVERY_TABLE_COLUMN_WIDTHS_PX } from "../domain/tableColumns.js";

/** The single `<colgroup>` markup shared by DiscoveryPriceTable.jsx and
 * DiscoveryCubeTable.jsx (post-review follow-up, 実機レビュー) -- rendering
 * this same component in both tables, rather than each table writing its
 * own four `<col>` elements from `tableColumns.js`'s numbers, is what keeps
 * a future edit from being made in only one place again (plan (v): "列幅の
 * 定義を1箇所に持つ"). */
export default function DiscoveryTableColgroup() {
  return (
    <colgroup>
      {DISCOVERY_TABLE_COLUMN_WIDTHS_PX.map((width, index) => (
        // eslint-disable-next-line react/no-array-index-key -- always exactly 4, fixed order, never reordered
        <col key={index} style={{ width: `${width}px` }} />
      ))}
    </colgroup>
  );
}
