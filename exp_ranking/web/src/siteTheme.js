// Shared site-theme (color + light/standard/deep) load/normalize/save logic,
// parameterized by localStorage key so ranking and raffle can each have
// their own independent, persisted theme without duplicating this logic
// (App.jsx). The Task Manager/starforce trio's theme lives in
// useDashboardStore instead and is untouched by this module.

import { useEffect, useState } from "react";

export const SITE_THEME_COLORS = new Set(["green", "blue", "purple", "orange"]);
export const SITE_THEME_DEPTHS = new Set(["light", "standard", "deep"]);
export const SITE_THEME_DEFAULT = Object.freeze({ themeColor: "green", themeDepth: "deep" });

function backendOrDefault(backend) {
  return backend || (typeof window !== "undefined" ? window.localStorage : undefined);
}

/** Normalizes an arbitrary value into a valid `{ themeColor, themeDepth }`, falling back field-by-field to `fallback`. */
export function normalizeSiteTheme(value, fallback = SITE_THEME_DEFAULT) {
  return {
    themeColor: SITE_THEME_COLORS.has(value?.themeColor) ? value.themeColor : fallback.themeColor,
    themeDepth: SITE_THEME_DEPTHS.has(value?.themeDepth) ? value.themeDepth : fallback.themeDepth,
  };
}

/**
 * Reads and normalizes the theme saved under `storageKey`. `present` is true
 * only when `storageKey` actually had something written to it before (even
 * if it was malformed and normalized down to `fallback`) -- that's what
 * "this key already has its own independent theme" means for the one-time
 * seed logic in `resolveInitialSiteTheme` below. `present` is false when the
 * key was never written, or localStorage itself is unavailable.
 */
export function loadStoredSiteTheme(storageKey, fallback = SITE_THEME_DEFAULT, backend) {
  const storage = backendOrDefault(backend);
  let raw;
  try {
    raw = storage?.getItem(storageKey);
  } catch {
    return { theme: { ...fallback }, present: false };
  }
  if (raw == null) return { theme: { ...fallback }, present: false };
  try {
    return { theme: normalizeSiteTheme(JSON.parse(raw), fallback), present: true };
  } catch {
    return { theme: { ...fallback }, present: true };
  }
}

/** Persists `theme` under `storageKey`. Best-effort: returns false (never throws) when localStorage is unavailable/full. */
export function saveStoredSiteTheme(storageKey, theme, backend) {
  try {
    backendOrDefault(backend)?.setItem(storageKey, JSON.stringify(theme));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the initial in-memory theme for `storageKey`:
 * - If `storageKey` already has its own saved value, use it -- this
 *   instance is already independent, `seedTheme` is ignored.
 * - Otherwise (nothing saved yet under `storageKey`), seed once from
 *   `seedTheme` when given, so splitting a page's theme off of a
 *   previously-shared one doesn't change what's on screen the moment it
 *   happens. Falls back to `fallback` when no seed is given either.
 *
 * This function does not persist anything itself -- callers (`useSiteTheme`)
 * persist the resolved value via their normal "save on change" effect, so
 * the seed only actually happens once per `storageKey`: the moment it's
 * first persisted, that key has "its own saved value" and stops seeding.
 */
export function resolveInitialSiteTheme(storageKey, { seedTheme, fallback = SITE_THEME_DEFAULT, backend } = {}) {
  const { theme, present } = loadStoredSiteTheme(storageKey, fallback, backend);
  if (present) return theme;
  if (seedTheme) return normalizeSiteTheme(seedTheme, fallback);
  return { ...fallback };
}

/**
 * React hook wrapping the above: loads/seeds the initial theme for
 * `storageKey` once, persists it to localStorage whenever it changes, and
 * returns `[theme, updateTheme]` (same shape as `useState`, but
 * `updateTheme` normalizes its input). `seedTheme` is only read on the first
 * render (React's lazy `useState` initializer semantics) -- later changes to
 * whatever produced `seedTheme` do not re-seed an already-independent theme.
 */
export function useSiteTheme(storageKey, { seedTheme, fallback = SITE_THEME_DEFAULT } = {}) {
  const [theme, setTheme] = useState(() => resolveInitialSiteTheme(storageKey, { seedTheme, fallback }));

  useEffect(() => {
    saveStoredSiteTheme(storageKey, theme);
  }, [storageKey, theme]);

  const updateTheme = (nextTheme) => setTheme(normalizeSiteTheme(nextTheme, fallback));

  return [theme, updateTheme];
}
