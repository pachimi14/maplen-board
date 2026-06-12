import { SUPPORTED_LANGUAGE_CODES } from "./languages.js";

const STORAGE_KEY = "maplen-board-lang";

function matchBrowserLanguage(tag) {
  const lower = String(tag || "").toLowerCase();
  if (lower.startsWith("ja")) {
    return "ja";
  }
  if (
    lower === "zh-tw" ||
    lower === "zh-hant" ||
    lower.startsWith("zh-hant") ||
    (lower.startsWith("zh") && lower.includes("tw"))
  ) {
    return "zh-TW";
  }
  if (lower.startsWith("th")) {
    return "th";
  }
  if (lower.startsWith("vi")) {
    return "vi";
  }
  if (lower.startsWith("es")) {
    return "es";
  }
  if (lower.startsWith("en")) {
    return "en";
  }
  return null;
}

export function detectLanguage() {
  if (typeof window === "undefined") {
    return "ja";
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LANGUAGE_CODES.includes(stored)) {
    return stored;
  }

  const candidates = [
    ...(window.navigator.languages ?? []),
    window.navigator.language,
  ];

  for (const tag of candidates) {
    const matched = matchBrowserLanguage(tag);
    if (matched) {
      return matched;
    }
  }

  return "en";
}

export { STORAGE_KEY };
