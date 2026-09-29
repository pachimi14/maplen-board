export const RAFFLE_SALE_PRICE_CACHE_KEY = "maplen-board-raffle-sale-prices-v1";
import { raffleRoundResetAt } from "../domain/raffleRound.js";
const INTEGER_PATTERN = /^\d{1,30}$/;
const MAX_ENTRIES = 12;

function backendOrDefault(backend) {
  return backend || globalThis.localStorage;
}

function cacheId(round, assetKeys) {
  return String(round || "") + "|" + [...assetKeys].sort().join(",");
}

function readAll(backend) {
  try {
    const parsed = JSON.parse(backendOrDefault(backend)?.getItem(RAFFLE_SALE_PRICE_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function loadRaffleSalePrices(round, assetKeys, { backend, now = Date.now() } = {}) {
  const entry = readAll(backend)[cacheId(round, assetKeys)];
  if (!entry || !Number.isFinite(entry.savedAt) || !Number.isFinite(entry.expiresAt) || now >= entry.expiresAt || now < entry.savedAt) return {};
  const prices = {};
  for (const [dropId, value] of Object.entries(entry.prices || {})) {
    if (typeof dropId === "string" && dropId && INTEGER_PATTERN.test(String(value))) prices[dropId] = String(value);
  }
  return prices;
}

export function saveRaffleSalePrice(round, assetKeys, dropId, value, { backend, now = Date.now() } = {}) {
  if (typeof dropId !== "string" || !dropId) return;
  const storage = backendOrDefault(backend);
  const all = readAll(storage);
  const id = cacheId(round, assetKeys);
  const expiresAt = raffleRoundResetAt(round);
  if (expiresAt == null || now >= expiresAt) return;
  const current = all[id] && now < all[id].expiresAt ? all[id] : { prices: {} };
  const prices = { ...(current.prices || {}) };
  const text = String(value ?? "");
  if (text === "") delete prices[dropId];
  else if (INTEGER_PATTERN.test(text)) prices[dropId] = text;
  else return;
  all[id] = { savedAt: now, expiresAt, prices };
  const trimmed = Object.fromEntries(Object.entries(all).sort(([, a], [, b]) => (b?.savedAt || 0) - (a?.savedAt || 0)).slice(0, MAX_ENTRIES));
  try { storage?.setItem(RAFFLE_SALE_PRICE_CACHE_KEY, JSON.stringify(trimmed)); } catch { /* keep the live input usable */ }
}
