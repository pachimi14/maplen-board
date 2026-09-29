import { DEFAULT_SHARE_IMAGE_OPTIONS } from "../shareImage.js";

export const SHARE_IMAGE_PREFERENCES_KEY = "maplen-board-raffle-share-image-v1";

function backendOrDefault(backend) {
  return backend || globalThis.localStorage;
}

export function normalizeShareImagePreferences(value) {
  const result = { ...DEFAULT_SHARE_IMAGE_OPTIONS };
  if (!value || typeof value !== "object") return result;
  for (const key of Object.keys(result)) {
    if (typeof value[key] === "boolean") result[key] = value[key];
  }
  if (!result.showTransfers) result.showWallets = false;
  return result;
}

export function loadShareImagePreferences(backend) {
  try {
    return normalizeShareImagePreferences(JSON.parse(backendOrDefault(backend)?.getItem(SHARE_IMAGE_PREFERENCES_KEY) || "null"));
  } catch {
    return { ...DEFAULT_SHARE_IMAGE_OPTIONS };
  }
}

export function saveShareImagePreferences(value, backend) {
  const normalized = normalizeShareImagePreferences(value);
  try {
    backendOrDefault(backend)?.setItem(SHARE_IMAGE_PREFERENCES_KEY, JSON.stringify(normalized));
  } catch {
    // Image generation remains usable with in-memory preferences when storage is unavailable.
  }
  return normalized;
}
