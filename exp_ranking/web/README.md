# MapleN Board — web

`../bot` が `public/data/rankings.json` を出す。ここはそれを読むだけ。

## ローカル開発（push 前）

リポジトリ直下のバッチを使います（`exp_ranking/web` からではなく **ルート** で実行）。

| 目的 | コマンド | URL |
|------|----------|-----|
| **開発中**（ホットリロード） | `run_local_dev.bat` | http://localhost:5173/ |
| **push 前**（本番ビルド） | `run_local_preview.bat` | http://localhost:4173/ |
| **API 再取得** | `run_fetch.bat` | — |

```bat
run_local_dev.bat
run_local_dev.bat --no-sync
run_local_preview.bat
```

### 作業の流れ

1. `run_local_dev.bat`
2. `src/` を編集 → ブラウザで即確認
3. `run_local_preview.bat` で最終確認（任意）
4. `git push`（Web のみなら `[web-only]`）

旧バッチは `scripts/archive/bat/` にあります。
