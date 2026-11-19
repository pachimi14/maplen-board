import { ASCENDANT_TIER_BY_CLEAR } from "./contract.js";

// LULU-145 (docs/IMPL_PLAN_RAFFLE_MANUAL_MODE.md): while the official API is
// down, the party types its winnings in by hand. This pure function turns those
// typed values into a clear of the SAME shape combineSelectedPartyClears()
// returns for the API path, so calculateSettlement() and everything after it
// (carryover, tax/share rules, extra rewards, share image, transfers) run
// unchanged -- the settlement logic is never re-implemented for manual mode.

export const MANUAL_BOSSES = Object.freeze(["LUCID", "WILL", "SLIME"]);
export const MANUAL_DIFFICULTIES_BY_BOSS = Object.freeze({
  LUCID: Object.freeze(["EASY", "NORMAL", "HARD"]),
  WILL: Object.freeze(["EASY", "NORMAL", "HARD"]),
  // LULU-141: only Chaos Guardian Angel Slime is a distribution target.
  SLIME: Object.freeze(["CHAOS"]),
});
export const MANUAL_DEFAULT_DIFFICULTY = Object.freeze({ LUCID: "HARD", WILL: "HARD", SLIME: "CHAOS" });
// Items each boss can actually award, in on-screen order. Slime has no coin,
// Power Crystal or equipment (LULU-141); FT Item only drops from Will (LULU-119).
export const MANUAL_ITEM_KEYS_BY_BOSS = Object.freeze({
  LUCID: Object.freeze(["bossNeso", "ascendantNeso", "powerCrystal", "coin", "equipment", "box"]),
  WILL: Object.freeze(["bossNeso", "ascendantNeso", "powerCrystal", "coin", "equipment", "box", "ftItem"]),
  SLIME: Object.freeze(["bossNeso", "ascendantNeso", "box"]),
});
// Same names the server emits (server/raffle-api/normalizer.py TARGET_COINS / FT_ITEM_NAME).
export const MANUAL_COIN_NAME_BY_BOSS = Object.freeze({ LUCID: "Phantasma Coin", WILL: "Arachno Coin" });
export const MANUAL_FT_ITEM_NAME = "Sealed Mirror World Nodestone";
const INCLUDE_KEYS = ["coin", "equipment", "ftItem", "box", "bossNeso", "powerCrystal", "ascendantNeso"];

function text(value) {
  return typeof value === "string" ? value.replace(/,/g, "") : value == null ? "" : String(value).replace(/,/g, "");
}

// Blank -> "0"; anything else is passed through untouched so a malformed value
// still reaches calculateSettlement and fails visibly (invalid_integer).
function amount(value) {
  const raw = text(value);
  return raw.trim() === "" ? "0" : raw;
}

function rows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
}

/** Party roster -> the same position-based memberId/memberMap the API job uses. */
export function partySessionFromMembers(sortedMembers) {
  const memberMap = {};
  const partyOrder = (Array.isArray(sortedMembers) ? sortedMembers : []).map((member, index) => {
    const memberId = "member-" + String(index + 1);
    memberMap[memberId] = member;
    return memberId;
  });
  return { partyOrder, memberMap };
}

/**
 * Builds `{ clear, saleNesoByDropId, include }` from hand-typed entries.
 * `entriesByMemberId[memberId]` = { bossNeso, ascendantNeso, powerCrystalAmount,
 * coinQuantity, coinSaleNeso, ftItemQuantity, ftItemSaleNeso,
 * equipment: [{ rowId, name, saleNeso }], box: [{ rowId, name, saleNeso }] }.
 * `include` is returned masked to the items this boss can award (unchecked
 * values stay in the entries; calculateSettlement drops them via include).
 */
export function buildManualClear({ boss, difficulty, partyOrder, include = {}, entriesByMemberId = {}, labels = {} } = {}) {
  const order = Array.isArray(partyOrder) ? partyOrder : [];
  const items = new Set(MANUAL_ITEM_KEYS_BY_BOSS[boss] || []);
  const difficulties = MANUAL_DIFFICULTIES_BY_BOSS[boss] || [];
  const bossDifficulty = difficulties.includes(difficulty) ? difficulty : MANUAL_DEFAULT_DIFFICULTY[boss] || "";
  const bossKey = String(boss || "").toLowerCase();
  const saleNesoByDropId = {};

  const members = order.map((memberId) => {
    const entry = entriesByMemberId?.[memberId] || {};
    const prefix = "manual-" + bossKey + "-" + memberId + "-";
    const drops = [];
    const seen = new Set();
    function pushDrop(kind, category, name, quantity, saleNeso) {
      let dropId = prefix + kind;
      for (let suffix = 2; seen.has(dropId); suffix += 1) dropId = prefix + kind + "~" + suffix;
      seen.add(dropId);
      drops.push({ dropId, category, name, quantity });
      saleNesoByDropId[dropId] = text(saleNeso);
    }
    function pushCounted(kind, category, name, quantityValue, saleValue) {
      if (text(quantityValue).trim() === "" && text(saleValue).trim() === "") return;
      pushDrop(kind, category, name, amount(quantityValue), saleValue);
    }
    function pushRows(kind, category, list, fallbackName) {
      rows(list).forEach((row, index) => {
        const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : fallbackName;
        const rowId = typeof row.rowId === "string" && row.rowId ? row.rowId : String(index);
        pushDrop(kind + "-" + rowId, category, name, "1", row.saleNeso);
      });
    }
    if (items.has("coin")) pushCounted("coin", "COIN", MANUAL_COIN_NAME_BY_BOSS[boss] || "Coin", entry.coinQuantity, entry.coinSaleNeso);
    if (items.has("ftItem")) pushCounted("ftItem", "FT_ITEM", MANUAL_FT_ITEM_NAME, entry.ftItemQuantity, entry.ftItemSaleNeso);
    if (items.has("equipment")) pushRows("equipment", "EQUIPMENT", entry.equipment, labels.equipment || "Equipment");
    if (items.has("box")) pushRows("box", "BOX", entry.box, labels.box || "Box");
    return {
      memberId,
      bossNeso: items.has("bossNeso") ? amount(entry.bossNeso) : "0",
      powerCrystalAmount: items.has("powerCrystal") ? amount(entry.powerCrystalAmount) : "0",
      ascendantNeso: items.has("ascendantNeso") ? amount(entry.ascendantNeso) : "0",
      drops,
    };
  });

  const base = {
    clearId: "manual-" + bossKey + "-" + bossDifficulty.toLowerCase(),
    boss,
    bossDifficulty,
    ascendantTier: ASCENDANT_TIER_BY_CLEAR[boss + ":" + bossDifficulty] || "",
    partyCount: order.length,
    // Every member counts as "has history": no roster-confirmation dialog.
    historyMemberIds: [...order],
    complete: true,
    excludedRewards: [],
    members,
  };
  return {
    clear: { ...base, sourceClears: [base] },
    saleNesoByDropId,
    include: Object.fromEntries(INCLUDE_KEYS.map((key) => [key, include?.[key] === true && items.has(key)])),
  };
}
