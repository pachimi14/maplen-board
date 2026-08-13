import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SITE_THEME_DEFAULT,
  loadStoredSiteTheme,
  normalizeSiteTheme,
  resolveInitialSiteTheme,
  saveStoredSiteTheme,
} from "./siteTheme.js";

// vitest.config.js runs this file under environment: "node" (no jsdom), so
// there is no real `window.localStorage`. Every test below passes an
// explicit in-memory `backend` (mirroring the pattern already used by
// raffle/storage/raffleStorage.js) instead of relying on a global.
function makeMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

describe("normalizeSiteTheme", () => {
  it("passes through a fully valid theme untouched", () => {
    expect(normalizeSiteTheme({ themeColor: "blue", themeDepth: "light" })).toEqual({ themeColor: "blue", themeDepth: "light" });
  });

  it("falls back field-by-field to the default when a field is invalid/missing", () => {
    expect(normalizeSiteTheme({ themeColor: "blue" })).toEqual({ themeColor: "blue", themeDepth: SITE_THEME_DEFAULT.themeDepth });
    expect(normalizeSiteTheme({ themeDepth: "light" })).toEqual({ themeColor: SITE_THEME_DEFAULT.themeColor, themeDepth: "light" });
    expect(normalizeSiteTheme({ themeColor: "not-a-color", themeDepth: "not-a-depth" })).toEqual(SITE_THEME_DEFAULT);
    expect(normalizeSiteTheme(null)).toEqual(SITE_THEME_DEFAULT);
    expect(normalizeSiteTheme(undefined)).toEqual(SITE_THEME_DEFAULT);
  });

  it("falls back to a custom `fallback` (not the module default) when given one", () => {
    const fallback = { themeColor: "purple", themeDepth: "standard" };
    expect(normalizeSiteTheme({}, fallback)).toEqual(fallback);
    expect(normalizeSiteTheme({ themeColor: "orange" }, fallback)).toEqual({ themeColor: "orange", themeDepth: "standard" });
  });
});

describe("loadStoredSiteTheme", () => {
  it("reports present: false and the fallback when the key was never written", () => {
    const storage = makeMemoryStorage();
    expect(loadStoredSiteTheme("some-key", SITE_THEME_DEFAULT, storage)).toEqual({ theme: SITE_THEME_DEFAULT, present: false });
  });

  it("reports present: true with the normalized value when the key holds valid JSON", () => {
    const storage = makeMemoryStorage({ "some-key": JSON.stringify({ themeColor: "purple", themeDepth: "light" }) });
    expect(loadStoredSiteTheme("some-key", SITE_THEME_DEFAULT, storage)).toEqual({
      theme: { themeColor: "purple", themeDepth: "light" },
      present: true,
    });
  });

  it("reports present: true (normalized to fallback) for corrupt JSON -- a broken record still counts as \"has its own\"", () => {
    const storage = makeMemoryStorage({ "some-key": "{not json" });
    expect(loadStoredSiteTheme("some-key", SITE_THEME_DEFAULT, storage)).toEqual({ theme: SITE_THEME_DEFAULT, present: true });
  });

  it("reports present: false when the storage backend throws (unavailable localStorage)", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadStoredSiteTheme("some-key", SITE_THEME_DEFAULT, throwingStorage)).toEqual({ theme: SITE_THEME_DEFAULT, present: false });
  });
});

describe("saveStoredSiteTheme", () => {
  it("writes the theme as JSON under the given key", () => {
    const storage = makeMemoryStorage();
    expect(saveStoredSiteTheme("some-key", { themeColor: "blue", themeDepth: "standard" }, storage)).toBe(true);
    expect(storage.getItem("some-key")).toBe(JSON.stringify({ themeColor: "blue", themeDepth: "standard" }));
  });

  it("returns false (never throws) when the backend's setItem throws", () => {
    const throwingStorage = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(saveStoredSiteTheme("some-key", SITE_THEME_DEFAULT, throwingStorage)).toBe(false);
  });
});

// This is the crux of the LULU-... theme-separation ask: raffle's very
// first resolution must look identical to ranking's current theme (no
// visible jump the moment the two themes are split apart), and once
// raffle's own key has been written (by the normal "save on change" effect
// this feeds into via useSiteTheme), it must never be re-seeded again even
// if ranking changes afterwards.
describe("resolveInitialSiteTheme (one-time seed then independence)", () => {
  it("uses the already-stored value when storageKey has one, ignoring seedTheme entirely", () => {
    const storage = makeMemoryStorage({ raffle: JSON.stringify({ themeColor: "orange", themeDepth: "standard" }) });
    const resolved = resolveInitialSiteTheme("raffle", { seedTheme: { themeColor: "blue", themeDepth: "light" }, backend: storage });
    expect(resolved).toEqual({ themeColor: "orange", themeDepth: "standard" });
  });

  it("seeds once from seedTheme (normalized) when storageKey has never been saved", () => {
    const storage = makeMemoryStorage();
    const resolved = resolveInitialSiteTheme("raffle", { seedTheme: { themeColor: "purple", themeDepth: "light" }, backend: storage });
    expect(resolved).toEqual({ themeColor: "purple", themeDepth: "light" });
  });

  it("falls back to the default when storageKey is unsaved and no seedTheme is given", () => {
    const storage = makeMemoryStorage();
    expect(resolveInitialSiteTheme("raffle", { backend: storage })).toEqual(SITE_THEME_DEFAULT);
  });

  it("acceptance pin: ranking saves a theme -> raffle's first resolution inherits it -> after raffle saves its own value, ranking changing further no longer affects raffle", () => {
    const storage = makeMemoryStorage();

    // 1. "Ranking saves a theme" (the pre-split shared behavior).
    const rankingTheme = normalizeSiteTheme({ themeColor: "purple", themeDepth: "light" });
    saveStoredSiteTheme("ranking", rankingTheme, storage);

    // 2. Raffle's key was never saved -> its first resolution (app mount)
    //    inherits ranking's current value verbatim (no visible jump).
    const raffleFirstResolution = resolveInitialSiteTheme("raffle", { seedTheme: rankingTheme, backend: storage });
    expect(raffleFirstResolution).toEqual(rankingTheme);

    // 3. That resolved value gets persisted under raffle's own key (this is
    //    what useSiteTheme's "save on change" effect does on mount).
    saveStoredSiteTheme("raffle", raffleFirstResolution, storage);

    // 4. Ranking changes afterwards...
    const rankingThemeLater = normalizeSiteTheme({ themeColor: "orange", themeDepth: "deep" });
    saveStoredSiteTheme("ranking", rankingThemeLater, storage);

    // 5. ...but raffle, now resolved fresh again (e.g. next app load), keeps
    //    its own independently-saved value and does not re-seed from
    //    ranking's new value.
    const raffleSecondResolution = resolveInitialSiteTheme("raffle", { seedTheme: rankingThemeLater, backend: storage });
    expect(raffleSecondResolution).toEqual(raffleFirstResolution);
    expect(raffleSecondResolution).not.toEqual(rankingThemeLater);
  });
});
