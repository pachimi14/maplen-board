# MapleN Board（自分用メモ）

ローカル: `C:\Users\pachi\Desktop\msu ranking`  
取引 bot は別フォルダ: `C:\Users\pachi\Desktop\msu trade`（この Git には含めない）

```
exp_ranking/
├── bot/   … API 取得 → SQLite（90日）→ v2 rankings.json + history shards
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

### ローカルと GitHub Pages でデータが違うとき

DB は **GitHub Release `db-store`** に日次で保存されます（T12 P3 以降。**Git への日次コミットは廃止**）。  
本番と揃えるには `run_local_dev.bat`（**公開 v2 rankings.json + history shards を自動同期**）を使ってください。API から作り直す場合は `run_fetch.bat`（ローカルの `data/ranking.db` を更新）。

`exp_ranking/web/public/data/rankings.json` は **旧 v1 の廃止案内（145バイト）**で、データ源ではありません（T12 P4）。実データは `data/v2/rankings.json` + `data/v2/history/shard-NN.json`。

## 公開まわり

- リポジトリ: https://github.com/pachimi14/maplen-board
- 公開 URL: https://lulumi-tools.com/
- 手順・Actions・トラブル: [exp_ranking/DEPLOY.md](exp_ranking/DEPLOY.md)
- bot 設定: [exp_ranking/bot/README.md](exp_ranking/bot/README.md)

GitHub でリポジトリ名を `msu-exp-ranking` から `maplen-board` に変更したあと、**Settings → Pages** でサイト URL が新パスになっているか確認してください。

`ranking.db` の永続層は **GitHub Release `db-store`** です。復旧順は **actions cache → Release → v2 シャード → cold start**（詳細は [exp_ranking/DEPLOY.md](exp_ranking/DEPLOY.md)）。
