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

// IMPL_PLAN_SH33 §4 (B): "15件 -> 3件" -- fold the 15 alias rows above back
// into their (currently 3) representative groups for display, without
// changing what a query can match. `groupDiscoveryCandidates` filters over
// the SAME `matchesDiscoveryQuery` every alias already went through above
// (a query still finds a group via any of its 5 job-variant names or item
// IDs, plan §4 "★どの職業名でも引ける性質は維持") -- it only changes how
// many *rows* the result renders as, never the match rule itself, so B can
// never regress (j)/(k) by construction.

/** The middle word(s) that differ between `itemName` and its sibling
 * aliases -- e.g. "Arcane Umbra Knight Hat" among the 5 "Arcane Umbra
 * <job> Hat" aliases -> "Knight". Derived purely from the *shared* prefix/
 * suffix word run across every name in `allItemNames` (never a hardcoded
 * job-name list -- this page's own monitored set is arbitrary upstream
 * data, plan §4's "Knight / Mage / Archer / Thief / Pirate" is only an
 * example, not a fixed vocabulary). Falls back to the full `itemName`
 * whenever there is no common prefix+suffix structure to strip (e.g. a
 * group of one, or names that do not share one) -- this is a display label
 * only, so it never needs to be a single word to be correct, it only needs
 * to never claim a part of the name that is not actually there. */
export function deriveAliasLabel(itemName, allItemNames) {
  const words = itemName.trim().split(/\s+/);
  const tokenized = (allItemNames ?? []).map((name) => name.trim().split(/\s+/));
  if (tokenized.length < 2) return itemName;
  const minLen = Math.min(...tokenized.map((t) => t.length));
  let prefixLen = 0;
  while (prefixLen < minLen && tokenized.every((t) => t[prefixLen] === tokenized[0][prefixLen])) {
    prefixLen++;
  }
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    tokenized.every((t) => t[t.length - 1 - suffixLen] === tokenized[0][tokenized[0].length - 1 - suffixLen])
  ) {
    suffixLen++;
  }
  const middle = words.slice(prefixLen, words.length - suffixLen);
  return middle.length ? middle.join(" ") : itemName;
}

/** `items` (server's `/sf-history/discovery/equipment` `items[]`, already
 * normalized -- each carrying its own full `aliases` list, representative
 * included) + the raw search `query` -> one row per monitored GROUP whose
 * aliases include at least one match, each still carrying its full alias
 * list (for the small per-job badges, plan §4 "同じグループの職業違い5種を
 * ...小さく併記する") and which of those aliases actually matched (plan §4
 * "一致したalias名を候補内で示す -- 黙って別名を出さない"). Sorted by
 * representative name, same as `flattenDiscoveryCandidates` above. */
export function groupDiscoveryCandidates(items, query) {
  const groups = [];
  for (const item of items ?? []) {
    const aliases = item.aliases?.length ? item.aliases : [{ itemId: item.itemId, itemName: item.itemName }];
    const allNames = aliases.map((alias) => alias.itemName);
    const matchedItemIds = new Set(
      aliases
        .filter((alias) => matchesDiscoveryQuery({ itemId: alias.itemId, itemName: alias.itemName }, query))
        .map((alias) => alias.itemId),
    );
    if (matchedItemIds.size === 0) continue;
    groups.push({
      key: String(item.itemId),
      representativeItemId: item.itemId,
      representativeItemName: item.itemName,
      aliases: aliases.map((alias) => ({
        itemId: alias.itemId,
        itemName: alias.itemName,
        label: deriveAliasLabel(alias.itemName, allNames),
        matched: matchedItemIds.has(alias.itemId),
      })),
    });
  }
  groups.sort((a, b) => a.representativeItemName.localeCompare(b.representativeItemName));
  return groups;
}
