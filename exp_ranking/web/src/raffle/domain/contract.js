export const RAFFLE_SCHEMA_VERSION = 3;
export const RAFFLE_CLASSIFICATION_VERSION = 1;
export const RAFFLE_BOSSES = Object.freeze(["LUCID", "WILL"]);
export const RAFFLE_JOB_STATUSES = Object.freeze(["queued", "resolving", "fetching", "normalizing", "complete", "partial", "error", "cancelled"]);
const RESULT_OUTCOMES = new Set(["WIN", "LOSE", "UNKNOWN"]);
const REWARD_CLASSIFICATIONS = new Set(["NESO", "POWER_CRYSTAL", "COIN", "EQUIPMENT", "ASCENDANT_NESO", "OTHER", "UNKNOWN"]);
const DROP_CATEGORIES = new Set(["COIN", "EQUIPMENT"]);
const ASCENDANT_TIER_BY_CLEAR = Object.freeze({
  "LUCID:EASY": "Dawning Ascendant 2",
  "LUCID:NORMAL": "Mystic Ascendant",
  "LUCID:HARD": "Divine Ascendant",
  "WILL:EASY": "Luminous Ascendant",
  "WILL:NORMAL": "Glorious Ascendant",
  "WILL:HARD": "Eternal Ascendant",
});
const INTEGER_PATTERN = /^\d+$/;
const ITEM_ICON_PATTERN = /^https:\/\/api-static\.msu\.io\/itemimages\/[A-Za-z0-9_./-]+$/;
const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function validIntegerString(value) {
  return typeof value === "string" && INTEGER_PATTERN.test(value) && value.length <= 60;
}

// memberWallets (LULU-069/LULU-103): each requested party member's own owner
// wallet, keyed by memberId. Malformed entries are dropped silently (not a
// hard schema failure) -- a missing/invalid wallet degrades to "wallet
// unknown for this member" in the UI rather than invalidating the whole job
// payload.
function normalizeMemberWallets(value) {
  const result = {};
  if (!value || typeof value !== "object") return result;
  for (const [memberId, wallet] of Object.entries(value)) {
    if (typeof memberId === "string" && memberId && typeof wallet === "string" && WALLET_PATTERN.test(wallet)) {
      result[memberId] = wallet;
    }
  }
  return result;
}

export function normalizeJobPayload(payload) {
  if (!payload || payload.schemaVersion !== RAFFLE_SCHEMA_VERSION || payload.classificationVersion !== RAFFLE_CLASSIFICATION_VERSION || !RAFFLE_JOB_STATUSES.includes(payload.status)) {
    return { ok: false, code: "invalidFormat" };
  }
  const progress = payload.progress;
  if (!progress || !Number.isInteger(progress.completedCharacters) || !Number.isInteger(progress.totalCharacters) || progress.completedCharacters < 0 || progress.totalCharacters < 1 || progress.totalCharacters > 6 || progress.completedCharacters > progress.totalCharacters || !Number.isInteger(progress.elapsedMs) || progress.elapsedMs < 0) {
    return { ok: false, code: "invalidProgress" };
  }

  if (!Array.isArray(payload.raffleResults) || payload.raffleResults.length > 1000) return { ok: false, code: "invalidRaffleResults" };
  const resultIds = new Set();
  for (const result of payload.raffleResults) {
    if (!result || typeof result.resultId !== "string" || !result.resultId || resultIds.has(result.resultId) || typeof result.memberId !== "string" || !result.memberId || typeof result.raffledAt !== "string" || typeof result.layerName !== "string" || typeof result.bossName !== "string" || (result.bossCode !== null && !RAFFLE_BOSSES.includes(result.bossCode)) || !RESULT_OUTCOMES.has(result.outcome) || !Array.isArray(result.rewards) || result.rewards.length > 50) {
      return { ok: false, code: "invalidRaffleResult" };
    }
    resultIds.add(result.resultId);
    for (const reward of result.rewards) {
      if (!reward || typeof reward.rewardName !== "string" || !REWARD_CLASSIFICATIONS.has(reward.classification) || !validIntegerString(reward.quantity) || typeof reward.won !== "boolean" || (reward.iconUrl !== undefined && (typeof reward.iconUrl !== "string" || (reward.iconUrl !== "" && !ITEM_ICON_PATTERN.test(reward.iconUrl))))) return { ok: false, code: "invalidRaffleReward" };
    }
  }

  // Up to 6 party sizes per boss/difficulty (LULU-096 independent clusters) x 3 difficulties x 2 bosses.
  if (!Array.isArray(payload.clears) || payload.clears.length > 36) return { ok: false, code: "invalidClears" };
  const clearIds = new Set();
  const clearIdentities = new Set();
  const dropIds = new Set();
  for (const clear of payload.clears) {
    const registeredCount = Array.isArray(clear?.members) ? clear.members.length : 0;
    const clearKey = clear?.boss + ":" + clear?.bossDifficulty;
    // A given boss+difficulty may legitimately produce multiple independent clear candidates
    // (one per observed partyCount cluster), so uniqueness is keyed on partyCount as well.
    const clearIdentity = clearKey + ":" + clear?.partyCount;
    const expectedAscendantTier = ASCENDANT_TIER_BY_CLEAR[clearKey];
    if (!clear || typeof clear.clearId !== "string" || !clear.clearId || clearIds.has(clear.clearId) || !RAFFLE_BOSSES.includes(clear.boss) || clearIdentities.has(clearIdentity) || clear.complete !== true || !expectedAscendantTier || clear.ascendantTier !== expectedAscendantTier || !Number.isInteger(clear.partyCount) || clear.partyCount < 1 || clear.partyCount > 6 || !Array.isArray(clear.members) || registeredCount < 1 || registeredCount > 6 || !Array.isArray(clear.historyMemberIds) || clear.historyMemberIds.length < 1 || clear.historyMemberIds.length > registeredCount || clear.historyMemberIds.length > clear.partyCount) {
      return { ok: false, code: "invalidClear" };
    }
    clearIds.add(clear.clearId);
    clearIdentities.add(clearIdentity);
    const memberIds = new Set();
    for (const member of clear.members) {
      if (!member || typeof member.memberId !== "string" || !member.memberId || memberIds.has(member.memberId) || !validIntegerString(member.bossNeso) || !validIntegerString(member.powerCrystalAmount) || !validIntegerString(member.ascendantNeso) || !Array.isArray(member.drops)) {
        return { ok: false, code: "invalidClearMember" };
      }
      memberIds.add(member.memberId);
      for (const drop of member.drops) {
        if (!drop || typeof drop.dropId !== "string" || !drop.dropId || dropIds.has(drop.dropId) || !DROP_CATEGORIES.has(drop.category) || typeof drop.name !== "string" || !validIntegerString(drop.quantity) || (drop.imageUrl !== undefined && (typeof drop.imageUrl !== "string" || (drop.imageUrl !== "" && !ITEM_ICON_PATTERN.test(drop.imageUrl))))) {
          return { ok: false, code: "invalidDrop" };
        }
        dropIds.add(drop.dropId);
      }
    }
    const historyMemberIds = new Set(clear.historyMemberIds);
    if (historyMemberIds.size !== clear.historyMemberIds.length || clear.historyMemberIds.some((memberId) => typeof memberId !== "string" || !memberIds.has(memberId))) {
      return { ok: false, code: "invalidClear" };
    }
  }

  return {
    ok: true,
    code: "ok",
    data: {
      schemaVersion: payload.schemaVersion,
      classificationVersion: payload.classificationVersion,
      status: payload.status,
      progress: { completedCharacters: progress.completedCharacters, totalCharacters: progress.totalCharacters, stage: typeof progress.stage === "string" ? progress.stage : payload.status, elapsedMs: progress.elapsedMs },
      raffleResults: payload.raffleResults,
      clears: payload.clears,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      errors: Array.isArray(payload.errors) ? payload.errors : [],
      memberWallets: normalizeMemberWallets(payload.memberWallets),
    },
  };
}