export const PROFILE_STORAGE_KEY = "maplen-board-profile-v1";

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeCharacters(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (!row || !nonEmpty(row.historyKey)) continue;
    const historyKey = row.historyKey.trim();
    if (seen.has(historyKey)) continue;
    seen.add(historyKey);
    result.push({
      historyKey,
      name: nonEmpty(row.name) ? row.name.trim() : historyKey,
      job: nonEmpty(row.job) ? row.job.trim() : "",
      worldId: nonEmpty(row.worldId) ? row.worldId.trim() : "",
      imageUrl: nonEmpty(row.imageUrl) ? row.imageUrl : "",
    });
  }
  return result;
}

export function createStaticCharacterSource(rows = []) {
  return {
    async load() {
      return normalizeCharacters(rows);
    },
  };
}

export function createProfileCharacterSource(
  backend = typeof window !== "undefined" ? window.localStorage : null,
  directorySource = null,
) {
  return {
    async load() {
      if (!backend) return [];
      let raw;
      try {
        raw = backend.getItem(PROFILE_STORAGE_KEY);
      } catch {
        return [];
      }
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        const keys = Array.isArray(parsed?.pinnedHistoryKeys) ? parsed.pinnedHistoryKeys : [];
        if (!keys.length || !directorySource?.load) {
          return normalizeCharacters(keys.map((historyKey) => ({ historyKey })));
        }
        const directory = await directorySource.load();
        const rows = directory?.ok ? directory.characters : [];
        const byKey = new Map(rows.map((row) => [row.historyKey, row]));
        return normalizeCharacters(keys.map((historyKey) => byKey.get(historyKey) || { historyKey }));
      } catch {
        return [];
      }
    },
  };
}
