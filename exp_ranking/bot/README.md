# MapleN Board Bot

MSU のランキング API から **指定レベル以上**のキャラを全件取得し、SQLite に保存して **v2**（`data/v2/rankings.json` + `data/v2/history/shard-NN.json`）を出力します。

## 取得条件（既定・テスト）

| 設定 | 既定 | 説明 |
|------|------|------|
| `RANKING_MIN_LEVEL` | **225** | このレベル以上のキャラのみ保存 |
| `RANKING_MAX_PAGES` | 800 | 安全のための最大ページ数 |

API は総合順位順です。ページを進めるとレベルが下がるため、**そのページの最大レベルが `RANKING_MIN_LEVEL` 未満になった時点で取得を終了**します。

目安（2026-06 時点）:

| 最小レベル | おおよその人数 | ページ数 |
|------------|----------------|----------|
| 235+ | 約 950 人 | 約 95 ページ |
| 225+（既定） | 約 5500 人 | 約 550 ページ |

235+ のみにする場合は `.env` で `RANKING_MIN_LEVEL=235` に変更してください。

## データ保持

月間増加用に DB は直近 **90 ランキング日**のみ（`SNAPSHOT_RETENTION_DAYS`）。それより古い行は削除します。  
`ranking.db` は CI が **GitHub Release `db-store`** に日次保存します（**Git への日次コミットは廃止**。T12 P3）。ローカル開発は `run_local_dev.bat`（公開 v2 を同期）を使ってください。

公式の経験値は **UTC 0:00（JST 9:00）** で更新されます。取得したスナップショットのランキング日ラベルは **その前の UTC 暦日**（例: UTC 6/5 に取得 → `2026-06-04` の増加量）です。スケジューラは **毎日 9:20 JST 以降** に 1 回実行を推奨します。

## Run

```powershell
cd exp_ranking\bot
pip install -r requirements.txt
copy .env.example .env
python main.py
```

| 用途 | bat |
|------|-----|
| データ取得 | ルートの `run_fetch.bat` |
| ローカル UI | ルートの `run_local_dev.bat` |

## サーバー（worldId）

ランキング API の `characterAssetKey` から Navigator API で `Ain` / `Errai` / `Fang` を取得し、`character_meta` テーブルにキャッシュします。初回は未登録分を一括取得し、以降は **サーバー名ローテ**（Fang → Errai → Ain、1日1サーバー）で再確認します。`worldId` 未設定のキャラは毎日取得対象です。

**CI**: 毎日の経験値取得（`MapleN Board Pages`）と Navigator 同期（`MapleN Board Navigator`）は **別ワークフロー** です。経験値を先に公開し、約20分後にサーバー名を反映します。

- 環境変数: `NAVIGATOR_FETCH_ENABLED`（既定 `true`）、`NAVIGATOR_REQUEST_DELAY_SEC`（既定 `0.35`）
- CI 専用: `NAVIGATOR_ONLY=true`（ランキング API をスキップして Navigator のみ）
- ローテ: `NAVIGATOR_ROTATION_ENABLED`（既定 `true`）、`NAVIGATOR_ROTATION_EPOCH`（既定 `2026-06-12`）
