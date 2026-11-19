import { raffleRoundResetAt } from "../domain/raffleRound.js";
import { MANUAL_BOSSES, MANUAL_DIFFICULTIES_BY_BOSS } from "../domain/manualClear.js";
import { raffleHistoryCacheId } from "./historyCache.js";

// LULU-145 (docs/IMPL_PLAN_RAFFLE_MANUAL_MODE.md S2.4): manual-mode entries,
// one entry per raffle round x party (sorted assetKey set -- same id as the
// history cache). Members are keyed by assetKey, never by the position-based
// memberId. Entries expire at the round's Thursday 00:00 UTC reset.
export const RAFFLE_MANUAL_ENTRY_KEY = "maplen-board-raffle-manual-v1";
const MAX_ENTRIES = 12;
const MAX_VALUE_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_ROWS = 50;
const INCLUDE_KEYS = ["coin", "equipment", "ftItem", "box", "bossNeso", "powerCrystal", "ascendantNeso"];
const VALUE_FIELDS = ["bossNeso", "ascendantNeso", "powerCrystalAmount", "coinQuantity", "coinSaleNeso", "ftItemQuantity", "ftItemSaleNeso"];
const ROW_FIELDS = ["equipment", "box"];

function backendOrDefault(backend) {
  return backend || globalThis.localStorage;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shortString(value, max) {
  return typeof value === "string" && value.length <= max ? value : null;
}

function sanitizeRows(value) {
  if (!Array.isArray(value)) return [];
  const rows = [];
  for (const row of value.slice(0, MAX_ROWS)) {
    const rowId = shortString(row?.rowId, MAX_VALUE_LENGTH);
    if (!rowId) continue;
    rows.push({ rowId, name: shortString(row.name, MAX_NAME_LENGTH) ?? "", saleNeso: shortString(row.saleNeso, MAX_VALUE_LENGTH) ?? "" });
  }
  return rows;
}

function sanitizeMemberEntry(value) {
  const entry = {};
  if (!isObject(value)) return entry;
  for (const field of VALUE_FIELDS) {
    const text = shortString(value[field], MAX_VALUE_LENGTH);
    if (text != null) entry[field] = text;
  }
  for (const field of ROW_FIELDS) {
    const rows = sanitizeRows(value[field]);
    if (rows.length) entry[field] = rows;
  }
  return entry;
}

/** Drops anything malformed; never throws. Missing fields are left for the caller's defaults. */
export function sanitizeManualBosses(value) {
  const bosses = {};
  if (!isObject(value)) return bosses;
  for (const boss of MANUAL_BOSSES) {
    const saved = value[boss];
    if (!isObject(saved)) continue;
    const result = {};
    if (MANUAL_DIFFICULTIES_BY_BOSS[boss].includes(saved.difficulty)) result.difficulty = saved.difficulty;
    if (isObject(saved.include)) {
      result.include = Object.fromEntries(INCLUDE_KEYS.filter((key) => typeof saved.include[key] === "boolean").map((key) => [key, saved.include[key]]));
    }
    result.entriesByAssetKey = {};
    if (isObject(saved.entriesByAssetKey)) {
      for (const [assetKey, entry] of Object.entries(saved.entriesByAssetKey)) {
        if (assetKey && assetKey.length <= 160) result.entriesByAssetKey[assetKey] = sanitizeMemberEntry(entry);
      }
    }
    bosses[boss] = result;
  }
  return bosses;
}

function readAll(backend) {
  try {
    const parsed = JSON.parse(backendOrDefault(backend)?.getItem(RAFFLE_MANUAL_ENTRY_KEY) || "{}");
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isLive(entry, now) {
  return isObject(entry) && Number.isFinite(entry.savedAt) && Number.isFinite(entry.expiresAt) && now < entry.expiresAt && now >= entry.savedAt;
}

/** Always returns `{ bosses }` (empty when missing, expired or malformed). */
export function loadManualEntries(round, assetKeys, { backend, now = Date.now() } = {}) {
  const entry = readAll(backend)[raffleHistoryCacheId(round, assetKeys)];
  if (!isLive(entry, now)) return { ok: false, code: "miss", bosses: {} };
  return { ok: true, code: "hit", bosses: sanitizeManualBosses(entry.bosses), savedAt: entry.savedAt };
}

export function saveManualEntries(round, assetKeys, bosses, { backend, now = Date.now() } = {}) {
  const storage = backendOrDefault(backend);
  const expiresAt = raffleRoundResetAt(round);
  if (expiresAt == null || now >= expiresAt) return { ok: false, code: "expiredRound" };
  const all = Object.fromEntries(Object.entries(readAll(storage)).filter(([, entry]) => isLive(entry, now)));
  all[raffleHistoryCacheId(round, assetKeys)] = { savedAt: now, expiresAt, bosses: sanitizeManualBosses(bosses) };
  const trimmed = Object.fromEntries(Object.entries(all)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_ENTRIES));
  try {
    storage?.setItem(RAFFLE_MANUAL_ENTRY_KEY, JSON.stringify(trimmed));
    return { ok: true, code: "ok", savedAt: now };
  } catch {
    return { ok: false, code: "writeFailed" };
  }
}
