const shardCache = new Map();

function shardUrl(baseUrl, meta, shard) {
  const basePath = String(meta?.historyBasePath || "").replace(/^\/+|\/+$/g, "");
  return `${baseUrl}data/v2/${basePath}/shard-${String(shard).padStart(2, "0")}.json`;
}

async function fetchShard(baseUrl, meta, shard) {
  const url = shardUrl(baseUrl, meta, shard);
  if (!shardCache.has(url)) {
    shardCache.set(
      url,
      fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((payload) => {
          if (payload?.meta?.latestSnapshotDate !== meta.latestSnapshotDate) {
            throw new Error("History data version mismatch");
          }
          return payload.histories || {};
        })
        .catch((error) => {
          shardCache.delete(url);
          throw error;
        }),
    );
  }
  return shardCache.get(url);
}

export async function loadCharacterHistories(baseUrl, meta, characters) {
  if (meta?.dataFormatVersion !== 2 || !meta?.historyBasePath) {
    return new Map();
  }

  const byShard = new Map();
  for (const character of characters) {
    if (!character?.historyKey || character.historyShard == null) {
      continue;
    }
    const rows = byShard.get(character.historyShard) || [];
    rows.push(character);
    byShard.set(character.historyShard, rows);
  }

  const loaded = new Map();
  await Promise.all(
    [...byShard.entries()].map(async ([shard, rows]) => {
      const histories = await fetchShard(baseUrl, meta, shard);
      for (const character of rows) {
        if (Array.isArray(histories[character.historyKey])) {
          loaded.set(character.historyKey, histories[character.historyKey]);
        }
      }
    }),
  );
  return loaded;
}
