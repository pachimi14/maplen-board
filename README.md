# MapleN Board（自分用メモ）

ローカル: `C:\Users\pachi\Desktop\msu ranking`  
取引 bot は別フォルダ: `C:\Users\pachi\Desktop\msu trade`（この Git には含めない）

```
exp_ranking/
├── bot/   … API 取得 → SQLite（35日）→ rankings.json
└── web/   … React / Vite
```

## よく使う（ルートの .bat は3つだけ）

| 用途 | 操作 |
|------|------|
| **UI 開発**（本番データ + ホットリロード） | `run_local_dev.bat` → http://localhost:5173/ |
| **push 前確認**（本番ビルド） | `run_local_preview.bat` → http://localhost:4173/ |
| **API から再取得** | `run_fetch.bat` |

`--no-sync` … データ再取得をスキップ（コードだけ直すとき）

旧バッチは `scripts/archive/bat/` に退避済み。

### スナップショット履歴のシード（本番復旧用）

`exp_ranking/bot/data/seed/rankings_seed.json` は **Git に含めます**（公開して問題ないランキングデータ）。CI が DB に無い日付（例: `2026-06-02`）だけを補完します。DB が揃ったらファイルと workflow の `IMPORT_SNAPSHOTS_JSON` を削除してよいです。

### ローカルと GitHub Pages でデータが違うとき

`exp_ranking/bot/data/ranking.db` は **Git に毎日コミット**されます（`git pull` でローカルも追従可能）。  
`exp_ranking/web/public/data/rankings.json` は Git に含めません。本番と揃えるには `run_local_dev.bat`（自動同期）を使ってください。API から作り直す場合は `run_fetch.bat`。

## 公開まわり

- リポジトリ: https://github.com/pachimi14/maplen-board
- 公開 URL: https://lulumi-tools.com/
- 手順・Actions・トラブル: [exp_ranking/DEPLOY.md](exp_ranking/DEPLOY.md)
- bot 設定: [exp_ranking/bot/README.md](exp_ranking/bot/README.md)

GitHub でリポジトリ名を `msu-exp-ranking` から `maplen-board` に変更したあと、**Settings → Pages** でサイト URL が新パスになっているか確認してください。

`ranking.db` は main に毎日コミットされます（詳細は [exp_ranking/DEPLOY.md](exp_ranking/DEPLOY.md)）。
