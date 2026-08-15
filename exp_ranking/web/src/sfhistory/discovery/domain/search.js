// IMPL_PLAN_SH32 §5(g-1): "alias 名で検索できる" -- same
// flatten-then-substring-match shape as ../../domain/equipmentSearch.js
// (EquipmentSelector.jsx's own search logic), duplicated here in miniature
// rather than imported, so this new page's search never shares a code path
// with the existing #/starforce screen (plan §4: "既存の #/starforce は
// 1ピクセルも変えない" -- a shared dependency would put a future change to
// one page's search behind a review of the other).

/** `items` (server's `/sf-history/discovery/equipment` `items[]`, already
 * normalized) -> one flattened row per alias itemId (representative
 * included -- same "no separate branch for the representative" choice
 * equipmentSearch.js's own header comment explains), each still carrying
 * its own group's representative id/name for the caller to resolve to. */
export function flattenDiscoveryCandidates(items) {
  const rows = [];
  for (const item of items ?? []) {
    const aliases = item.aliases?.length ? item.aliases : [{ itemId: item.itemId, itemName: item.itemName }];
    for (const alias of aliases) {
      rows.push({
        key: `${item.itemId}-${alias.itemId}`,
        representativeItemId: item.itemId,
        representativeItemName: item.itemName,
        itemId: alias.itemId,
        itemName: alias.itemName,
      });
    }
  }
  rows.sort((a, b) => a.itemName.localeCompare(b.itemName));
  return rows;
}

export function matchesDiscoveryQuery(candidate, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (candidate.itemName.toLowerCase().includes(normalized)) return true;
  return String(candidate.itemId).includes(normalized);
}
