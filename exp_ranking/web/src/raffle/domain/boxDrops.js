// LULU-144 (docs/IMPL_PLAN_RAFFLE_BOX_CATEGORY.md): Ring Box is split out of
// "equipment drop" into its own distribution category "BOX" on the Web side
// only. The server/API contract keep delivering it as EQUIPMENT (LULU-135 S2,
// tier1=Voucher + name suffix "Ring Box"), so contract validation and the
// history/sale-price caches (dropId keys) are untouched; this pure function is
// applied once, right after the active clear is assembled, to re-tag those
// drops before the settlement calculation sees them.

// Same suffix rule as server/raffle-api/normalizer.py RING_BOX_NAME_SUFFIX
// (case-sensitive, matched against the whitespace-trimmed name).
export const RING_BOX_NAME_SUFFIX = "Ring Box";
export const BOX_CATEGORY = "BOX";

export function isRingBoxDrop(drop) {
  return drop?.category === "EQUIPMENT"
    && typeof drop.name === "string"
    && drop.name.trim().endsWith(RING_BOX_NAME_SUFFIX);
}

/**
 * Returns a copy of `clear` whose Ring Box drops carry `category: "BOX"`
 * instead of "EQUIPMENT". Every other field (dropId, name, quantity, imageUrl,
 * member amounts, sourceClears, ...) is kept as-is, and the input is never
 * mutated. A clear without members (or null) is returned unchanged.
 */
export function reclassifyBoxDrops(clear) {
  if (!clear || !Array.isArray(clear.members)) return clear;
  return {
    ...clear,
    members: clear.members.map((member) => (Array.isArray(member?.drops)
      ? { ...member, drops: member.drops.map((drop) => (isRingBoxDrop(drop) ? { ...drop, category: BOX_CATEGORY } : drop)) }
      : member)),
  };
}
