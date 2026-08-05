// IMPL_PLAN_SH9 §3-3: pure search/select logic for EquipmentSelector.jsx,
// split into its own domain module (matching this directory's existing
// series.js/viewModel.js/format.js convention) purely so it is testable
// through this project's lightweight vitest config -- vitest.config.js
// intentionally has no "@/" alias / JSX-component test setup, and
// EquipmentSelector.jsx itself imports "@/components/ui/input" (see that
// file's own header comment). No behavior lives only here that isn't also
// reachable from EquipmentSelector.jsx; this file has no React import.
//
// Candidates are the flattened per-alias rows (one per itemId in a group,
// design §7 -- "検索対象はグループ内の全itemId"), each carrying both its
// own itemId/itemName *and* the group's representative -- so a player
// wearing an alias piece (e.g. an AbsoLab Knight Gloves wearer, the
// "AbsoLab Mage Gloves" group's representative being a different piece) can
// find and select their own item by name, while the caller still resolves
// to the representative for `prices`/`latest` (design §7: "取得・表示は
// 代表"). Falls back to a single self-named row when an item has no
// `aliases` at all (a pre-SH9 `/sf-history/equipment` response --
// sfHistorySource.js's own normalizer already guarantees at least that one
// row, so this is defense in depth, not the primary path).
export function flattenCandidates(items) {
  const rows = [];
  for (const item of items) {
    const aliases = item.aliases?.length ? item.aliases : [{ itemId: item.itemId, itemName: item.itemName }];
    for (const alias of aliases) {
      rows.push({
        key: `${item.itemId}-${alias.itemId}`,
        representativeItemId: item.itemId,
        representativeItemName: item.itemName,
        itemId: alias.itemId,
        itemName: alias.itemName,
        maxStar: item.maxStar,
      });
    }
  }
  return rows;
}

export function matchesEquipmentQuery(candidate, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (candidate.itemName.toLowerCase().includes(normalized)) return true;
  return String(candidate.itemId).includes(normalized);
}
