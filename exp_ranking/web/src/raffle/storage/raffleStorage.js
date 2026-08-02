export const RAFFLE_STORAGE_KEY = "maplen-board-raffle-v1";
export const MAX_PARTIES = 10;
export const MAX_MEMBERS = 6;
const SIGNED_INTEGER_PATTERN = /^[+-]?\d+$/;
const MAX_CARRYOVER_DIGITS = 30;

function backendOrDefault(backend) {
  return backend || globalThis.localStorage;
}

export function assetKeyFromHistoryKey(historyKey) {
  return typeof historyKey === "string" && historyKey.startsWith("asset:")
    ? historyKey.slice("asset:".length)
    : "";
}

export function createParty(id, name = "Raffle Party") {
  return { id, name, members: [], carryoverEnabled: false, carryoverByAssetKey: {} };
}

export function createEmptyRaffleState() {
  return { version: 1, activePartyId: "", parties: [] };
}

function normalizeCarryover(value) {
  const text = String(value ?? "0").trim();
  if (!SIGNED_INTEGER_PATTERN.test(text)) return "0";
  const negative = text.startsWith("-");
  const signed = negative || text.startsWith("+");
  const digits = (signed ? text.slice(1) : text).replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_CARRYOVER_DIGITS || /^0+$/.test(digits)) return "0";
  return negative ? "-" + digits : digits;
}

function normalizeMember(member) {
  if (!member || typeof member.assetKey !== "string" || !/^CHAR[A-Za-z0-9_-]{4,124}$/.test(member.assetKey)) return null;
  return {
    assetKey: member.assetKey,
    displayName: typeof member.displayName === "string" && member.displayName ? member.displayName.slice(0, 80) : member.assetKey,
    worldId: typeof member.worldId === "string" ? member.worldId.slice(0, 80) : "",
    level: Number.isInteger(member.level) && member.level >= 0 && member.level <= 999 ? member.level : null,
    jobName: typeof member.jobName === "string" ? member.jobName.slice(0, 80) : "",
    imageUrl: typeof member.imageUrl === "string" && /^https:\/\/[^\s]+$/.test(member.imageUrl) ? member.imageUrl.slice(0, 500) : "",
  };
}

export function normalizeRaffleState(value) {
  if (!value || typeof value !== "object") return { ok: false, code: "invalid" };
  if (value.version !== 1) return { ok: false, code: "unsupportedVersion" };
  const parties = [];
  const ids = new Set();
  for (const rawParty of Array.isArray(value.parties) ? value.parties.slice(0, MAX_PARTIES) : []) {
    if (!rawParty || typeof rawParty.id !== "string" || !rawParty.id || ids.has(rawParty.id)) continue;
    ids.add(rawParty.id);
    const members = [];
    const assets = new Set();
    for (const rawMember of Array.isArray(rawParty.members) ? rawParty.members.slice(0, MAX_MEMBERS) : []) {
      const member = normalizeMember(rawMember);
      if (!member || assets.has(member.assetKey)) continue;
      assets.add(member.assetKey);
      members.push(member);
    }
    const carryoverByAssetKey = {};
    const rawCarryovers = rawParty.carryoverByAssetKey && typeof rawParty.carryoverByAssetKey === "object"
      ? rawParty.carryoverByAssetKey
      : {};
    for (const member of members) {
      carryoverByAssetKey[member.assetKey] = normalizeCarryover(rawCarryovers[member.assetKey]);
    }
    parties.push({
      id: rawParty.id.slice(0, 80),
      name: typeof rawParty.name === "string" && rawParty.name ? rawParty.name.slice(0, 80) : "Raffle Party",
      members,
      carryoverEnabled: rawParty.carryoverEnabled === true,
      carryoverByAssetKey,
    });
  }
  const activePartyId = parties.some((party) => party.id === value.activePartyId)
    ? value.activePartyId
    : parties[0]?.id || "";
  return { ok: true, code: "ok", state: { version: 1, activePartyId, parties } };
}

export function loadRaffleState(backend) {
  const storage = backendOrDefault(backend);
  let raw;
  try {
    raw = storage?.getItem(RAFFLE_STORAGE_KEY);
  } catch {
    return { ok: false, code: "unavailable", state: null };
  }
  if (raw == null) return { ok: true, code: "empty", state: createEmptyRaffleState() };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "corrupt", state: null };
  }
  const normalized = normalizeRaffleState(parsed);
  return normalized.ok ? normalized : { ...normalized, state: null };
}

export function saveRaffleState(value, backend) {
  const normalized = normalizeRaffleState(value);
  if (!normalized.ok) return normalized;
  try {
    backendOrDefault(backend)?.setItem(RAFFLE_STORAGE_KEY, JSON.stringify(normalized.state));
    return { ok: true, code: "ok", state: normalized.state };
  } catch {
    return { ok: false, code: "writeFailed" };
  }
}
