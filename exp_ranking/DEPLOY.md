# GitHub Pages で一般公開する手順

Discord 通知は今後の予定です。現状は **ランキング取得 → サイト更新** を GitHub Actions で自動化します。

## 前提

- GitHub アカウント
- リポジトリを GitHub に push できる環境
- 公開 URL の例: `https://<ユーザー名>.github.io/<リポジトリ名>/`

## 1. リポジトリを GitHub に作成

1. GitHub で新規リポジトリを作成（例: `msu-exp-ranking`）
2. このプロジェクトを push（`main` ブランチ）

```powershell
cd C:\Users\pachi\Desktop\msu_trade_bot
git init
git add .
git commit -m "Add EXP ranking bot and web"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

`.env` や `ranking.db` は `.gitignore` 済みです。**秘密情報は push しないでください。**

## 2. GitHub Pages を有効化

1. リポジトリ → **Settings** → **Pages**
2. **Build and deployment** → **Source**: `GitHub Actions`
3. 初回はワークフロー実行後に URL が表示されます

## 3. Actions の権限（初回のみ）

1. **Settings** → **Actions** → **General**
2. **Workflow permissions**: **Read and write permissions** を選ぶ（または Pages 用にデフォルトの `GITHUB_TOKEN` で足りる場合あり）
3. **Settings** → **Actions** → **General** 下部の **Fork pull request workflows** は必要に応じて

ワークフロー: [`.github/workflows/exp-ranking-pages.yml`](../.github/workflows/exp-ranking-pages.yml)

| トリガー | 内容 |
|----------|------|
| 毎日 4 回（9時台・遅延想定） | 取得を試行。当日済みなら全体スキップ |
| `main` への push（`exp_ranking/` 変更時） | 同上 |
| **Actions** タブの **Run workflow** | 手動実行 |

初回公開時は **Actions** で `EXP Ranking Pages` を **Run workflow** すると早いです。

## 4. データベース・サイトの自動更新（すでに有効）

push 済みのワークフロー [`.github/workflows/exp-ranking-pages.yml`](../.github/workflows/exp-ranking-pages.yml) が、**GitHub 上で毎日**次を自動実行します。

| 順番 | 処理 |
|------|------|
| 1 | 公式ランキング API から取得（既定: Lv225+） |
| 2 | **SQLite**（`ranking.db`）に追記・35日より古い行を削除 |
| 3 | `rankings.json` を生成 |
| 4 | Web をビルドして **GitHub Pages** を更新 |

**スケジュール**（**キューは JST 4:20 / 5:20 / 6:20 / 9:20**。リセット JST 9:00。遅延 ~5h 想定）:

| cron (UTC) | キュー (JST) | 遅延 ~5h 時の実開始 (JST) | 役割 |
|------------|--------------|---------------------------|------|
| `20 19 * * *` | **4:20** | **~9:20** | リセット前にキュー。即時起動なら前日分でスキップ |
| `20 20 * * *` | **5:20** | **~10:20** | 同上 |
| `20 21 * * *` | **6:20** | **~11:20** | 同上 |
| `20 0 * * *` | **9:20** | **9:20** | 遅延なし用（必要なら 9:20 まで待機） |

**当日のスナップショットが既に 1000 行以上ある場合**（`schedule` のみ）: API 取得・ビルド・デプロイをすべてスキップ。  
`push` / 手動実行ではスキップしません。

**手動更新**: [Actions](https://github.com/pachimi14/msu-exp-ranking/actions) → **EXP Ranking Pages** → **Run workflow**

**DB の保存場所**: リポジトリにはコミットしません。Actions の **キャッシュ**に `ranking.db` を保持し、日をまたいで履歴（週間・月間など）が増えていきます。

**確認方法**

1. [Actions タブ](https://github.com/pachimi14/msu-exp-ranking/actions) で緑の ✓ が付いているか  
2. 成功ログの **Fetch ranking and export JSON** に `sqlite_saved=...` があるか  
3. サイトの「最新 ○○-○○-○○」日付が変わるか（翌日以降）

GitHub の schedule は数分〜数時間遅れることがあります（本リポジトリではおおよそ **5 時間**）。**9 時台の 4 枠**のうち、遅れて走った最初の 1 回だけ取得し、以降はスキップします。それでも足りない場合は **Run workflow** で手動実行してください。

### 取得条件や時刻を変えたいとき

リポジトリの `.github/workflows/exp-ranking-pages.yml` を編集して `main` に push します。

| 変更したいこと | 編集箇所 |
|----------------|----------|
| 最低レベル（既定: 225+） | `RANKING_MIN_LEVEL: "225"` |
| 実行時刻 | `cron: "15 0 * * *"`（UTC。JST 9:15 ≒ `15 0 * * *`） |
| 履歴保持日数 | `SNAPSHOT_RETENTION_DAYS` / `MVP_HISTORY_DAYS` |

cron 例: JST 10:00 ≒ UTC 01:00 → `cron: "0 1 * * *"`

---

## 5. 動作確認

- Actions が緑（成功）になること
- Pages の URL を開き、ランキング一覧が表示されること
- お気に入り（☆）は **各利用者のブラウザ** に保存（GitHub とは無関係）

Secrets は現状不要です（Discord Webhook 追加時に `DISCORD_WEBHOOK_URL` 等を追加予定）。

## 6. ローカル開発との違い

| 環境 | URL |
|------|-----|
| `npm run dev` | `http://localhost:5173/` |
| GitHub Pages | `https://<user>.github.io/<repo>/` |

Pages 用ビルドは `GITHUB_PAGES=true` で `base` パスを自動設定します。

## 7. トラブルシュート（公開・更新）

| 症状 | 対処 |
|------|------|
| 真っ白 / 404 | Pages の Source が **GitHub Actions** か確認。workflow が成功しているか確認 |
| データがありません | Actions の **Fetch ranking** ログを確認（API エラー・レート制限） |
| 初回だけ時間がかかる | Lv225+ で約 550 ページ取得のため 10〜20 分かかることがあります |
| 履歴が1日だけ | DB キャッシュが効くまで日数は増えます（Actions キャッシュで DB を保持） |

## 8. 今後（Discord）

- ユーザーごとのお気に入り通知 → Bot + DB が必要（Pages だけでは不可）
- チャンネル1本への日次サマリー → 同じ workflow に Webhook ステップを追加可能
