import { normalizeJobPayload } from "../domain/contract.js";
import { raffleRoundResetAt } from "../domain/raffleRound.js";

export const RAFFLE_HISTORY_CACHE_KEY = "maplen-board-raffle-history-v1";
const MAX_CACHE_ENTRIES = 12;

function backendOrDefault(backend) {
  return backend || globalThis.localStorage;
}

export function raffleHistoryCacheId(round, assetKeys) {
  return String(round || "") + "|" + [...assetKeys].sort().join(",");
}

function readEntries(backend) {
  try {
    const parsed = JSON.parse(backendOrDefault(backend)?.getItem(RAFFLE_HISTORY_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function loadRaffleHistoryCache(round, assetKeys, { backend, now = Date.now() } = {}) {
  const entry = readEntries(backend)[raffleHistoryCacheId(round, assetKeys)];
  if (!entry || !Number.isFinite(entry.savedAt) || !Number.isFinite(entry.expiresAt) || now >= entry.expiresAt || now < entry.savedAt) {
    return { ok: false, code: "miss" };
  }
  const normalized = normalizeJobPayload(entry.data);
  return normalized.ok
    ? { ok: true, code: "hit", data: normalized.data, savedAt: entry.savedAt }
    : { ok: false, code: "invalid" };
}

export function saveRaffleHistoryCache(round, assetKeys, data, { backend, now = Date.now() } = {}) {
  const normalized = normalizeJobPayload(data);
  if (!normalized.ok) return normalized;
  const storage = backendOrDefault(backend);
  const entries = readEntries(storage);
  const expiresAt = raffleRoundResetAt(round);
  if (expiresAt == null || now >= expiresAt) return { ok: false, code: "expiredRound" };
  entries[raffleHistoryCacheId(round, assetKeys)] = { savedAt: now, expiresAt, data: normalized.data };
  const trimmed = Object.fromEntries(Object.entries(entries)
    .sort(([, a], [, b]) => (b?.savedAt || 0) - (a?.savedAt || 0))
    .slice(0, MAX_CACHE_ENTRIES));
  try {
    storage?.setItem(RAFFLE_HISTORY_CACHE_KEY, JSON.stringify(trimmed));
    return { ok: true, code: "ok", savedAt: now };
  } catch {
    return { ok: false, code: "writeFailed" };
  }
}
