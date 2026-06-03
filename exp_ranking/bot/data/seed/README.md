# Snapshot seed (`rankings_seed.json`)

One-time recovery source for ranking **snapshot history** (copied from local `rankings.json`).

## Contents (current seed)

- `latestSnapshotDate`: `2026-06-02`
- History dates: `06/01`, `06/02` (UTC ranking days `2026-06-01`, `2026-06-02`)

## How CI uses it

`main.py` runs **before** today's API fetch:

1. Compare dates in this file vs SQLite
2. If any seed date is missing (e.g. `2026-06-02`), import via `INSERT OR IGNORE`
3. Then normal fetch adds the current ranking day

Set in workflow: `IMPORT_SNAPSHOTS_JSON=data/seed/rankings_seed.json`

## After production DB has all days

You may delete `rankings_seed.json` and remove the workflow env line.  
Git history will still contain the file. Cached `data/ranking.db` on Actions keeps the data.

## Refresh seed (optional)

Replace with a current export that has the days you need:

```bat
copy /Y ..\web\public\data\rankings.json data\seed\rankings_seed.json
```
