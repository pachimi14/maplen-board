# MSU Ranking（自分用メモ）

ローカル: `C:\Users\pachi\Desktop\msu ranking`  
取引 bot は別フォルダ: `C:\Users\pachi\Desktop\msu trade`（この Git には含めない）

```
exp_ranking/
├── bot/   … API 取得 → SQLite（35日）→ rankings.json
└── web/   … React / Vite
```

## よく使う

| 用途 | 操作 |
|------|------|
| **本番と同じ JSON**（推奨） | `run_sync_rankings_from_pages.bat` |
| API から再取得（CI と同設定） | `run_exp_ranking_fetch.bat` |
| UI 開発 | `run_exp_ranking_web.bat` → http://localhost:5173/ |
| ダミー増加量（UI テストのみ） | `run_inject_dummy_gains.bat` |

### スナップショット履歴のシード（本番復旧用）

`exp_ranking/bot/data/seed/rankings_seed.json` は **Git に含めます**（公開して問題ないランキングデータ）。CI が DB に無い日付（例: `2026-06-02`）だけを補完します。DB が揃ったらファイルと workflow の `IMPORT_SNAPSHOTS_JSON` を削除してよいです。

### ローカルと GitHub Pages でデータが違うとき

`exp_ranking/web/public/data/rankings.json` は Git に含めません（日次生成物）。ローカルに古い JSON（例: Lv235・949人）や `run_inject_dummy_gains.bat` 適用後のダミーが残っていると、本番と表示がずれます。

1. **本番と揃える** … `run_sync_rankings_from_pages.bat`（Pages の `rankings.json` をそのままコピー）
2. **API から作り直す** … `run_exp_ranking_fetch.bat`（Actions と同じ Lv225+・35日設定）
3. ダミーを戻す … `rankings.json.bak` があれば復元、または上記 1

## 公開まわり

- リポジトリ: https://github.com/pachimi14/msu-exp-ranking （public）
- Pages: https://pachimi14.github.io/msu-exp-ranking/
- 手順・Actions・トラブル: [exp_ranking/DEPLOY.md](exp_ranking/DEPLOY.md)
- bot 設定: [exp_ranking/bot/README.md](exp_ranking/bot/README.md)
