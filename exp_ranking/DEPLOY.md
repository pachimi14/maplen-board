# MapleN Board — GitHub Pages で一般公開する手順

Discord 通知は今後の予定です。現状は **ランキング取得 → サイト更新** を GitHub Actions で自動化します。

## リポジトリ名を変更するとき（`msu-exp-ranking` → `maplen-board`）

1. GitHub → リポジトリ **Settings** → **General** → **Repository name** を `maplen-board` に変更して保存
2. ローカルで `git remote set-url origin https://github.com/<ユーザー名>/maplen-board.git`
3. **Settings → Pages** でサイトが `https://<ユーザー名>.github.io/maplen-board/` になっているか確認
4. 旧 URL（`/msu-exp-ranking/`）のブックマークは新 URL に更新

## 前提

- GitHub アカウント
- リポジトリを GitHub に push できる環境
- 公開 URL: **https://lulumi-tools.com/**

## 1. リポジトリを GitHub に作成

1. GitHub で新規リポジトリを作成（例: `maplen-board`）
2. このプロジェクトを push（`main` ブランチ）

```powershell
cd C:\Users\pachi\Desktop\msu_trade_bot
git init
git add .
git commit -m "Add MapleN Board bot and web"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

`.env` は `.gitignore` 済みです。**秘密情報は push しないでください。**  
`ranking.db` は **Git に毎日コミット**します（Actions が `[skip ci]` 付きで push。DB のみの変更ではワークフローは再実行されません）。  
起動時に **本番 `rankings.json` から DB に無い日付だけ取り込み**ます（`SNAPSHOT_IMPORT_FROM_PAGES=true`）。JSON→DB の復旧用です。

## 2. GitHub Pages を有効化

1. リポジトリ → **Settings** → **Pages**
2. **Build and deployment** → **Source**: `GitHub Actions`
3. 初回はワークフロー実行後に URL が表示されます

## 2b. カスタムドメイン（`lulumi-tools.com`）

公開 URL は **https://lulumi-tools.com/** です（リポジトリ直下にデプロイ、`base` は `/`）。

### DNS（ドメイン管理画面）

`lulumi-tools.com`（apex）向けに GitHub Pages の A レコードを設定します。

| タイプ | 名前 | 値 |
|--------|------|-----|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

`www` も使う場合は CNAME: `www` → `pachimi14.github.io`（任意）。

### GitHub 側

1. **Settings → Pages → Custom domain** に `lulumi-tools.com` を入力して保存
2. **Enforce HTTPS** をオン（DNS 反映後に有効化できる）
3. Actions で **Run workflow** して再デプロイ（`public/CNAME` が `dist/` に含まれる）

反映まで **数分〜最大 24 時間** かかることがあります。

## 3. Actions の権限（初回のみ）

1. **Settings** → **Actions** → **General**
2. **Workflow permissions**: **Read and write permissions** を選ぶ（または Pages 用にデフォルトの `GITHUB_TOKEN` で足りる場合あり）
3. **Settings** → **Actions** → **General** 下部の **Fork pull request workflows** は必要に応じて

ワークフロー: [`.github/workflows/maplen-board-pages.yml`](../.github/workflows/maplen-board-pages.yml)

| トリガー | 内容 |
|----------|------|
| 毎日 4 回（9時台・遅延想定） | 取得を試行。当日済みなら全体スキップ |
| `main` への push（`exp_ranking/` 変更時） | 同上 |
| **Actions** タブの **Run workflow** | 手動実行 |

初回公開時は **Actions** で `MapleN Board Pages` を **Run workflow** すると早いです。

## 4. データベース・サイトの自動更新（すでに有効）

push 済みのワークフロー [`.github/workflows/maplen-board-pages.yml`](../.github/workflows/maplen-board-pages.yml) が、**GitHub 上で毎日**次を自動実行します。

| 順番 | 処理 |
|------|------|
| 1 | 公式ランキング API から取得（既定: Lv225+） |
| 2 | **SQLite**（`ranking.db`）に追記・35日より古い行を削除 |
| 3 | `rankings.json` を生成 |
| 4 | Web をビルドして **GitHub Pages** を更新 |

**スケジュール**（リセット **JST 9:00**。**キューは JST 8:00 のみ**。実行時は **9:20 まで待機**してから取得・スキップ判定）:

| cron (UTC) | キュー (JST) | 想定 |
|------------|--------------|------|
| `0 23 * * *` | **8:00** | 空きが多いと遅延（例: 9〜10時台）→ 9:20 まで待機後に取得 |

**当日のスナップショットが既に 1000 行以上ある場合**（**9:20 待機のあと**）: ランキング API・Navigator は常にスキップ（**push 含む**）。  
**定期 / Run workflow** はデプロイもスキップ（約20秒）。**push** は DB から JSON を再出力し **Pages はビルド・デプロイ**（429 を避けつつフロント変更を反映）。  
再取得したいときは `FORCE_RANKING_FETCH=true` を指定してください。

**注意**: リセット前（9:00 より前）に起動したジョブで「前日分は取得済み」と判断して即終了すると、当日分が取れません。旧設定の早朝キューはこの原因になります。

**手動更新**: [Actions](https://github.com/pachimi14/maplen-board/actions) → **MapleN Board Pages** → **Run workflow**

**DB の保存場所**: `exp_ranking/bot/data/ranking.db` を **main に毎日コミット**します。Actions キャッシュは補助（`character_meta` など）。履歴は Git が正本です。

## 画面が真っ白なとき

リポジトリ名変更直後は、古いビルドが `/msu-exp-ranking/assets/...` を参照していることがあります（JS が 404）。

1. **Actions** で **MapleN Board Pages** を **Run workflow**（再デプロイ）
2. ブラウザで **https://lulumi-tools.com/** を開く
3. 開発者ツール → **Network** で `assets/index-*.js` が 200 か確認

**確認方法**

1. [Actions タブ](https://github.com/pachimi14/maplen-board/actions) で緑の ✓ が付いているか  
2. 成功ログの **Fetch ranking and export JSON** に `sqlite_saved=...` があるか  
3. サイトの「最新 ○○-○○-○○」日付が変わるか（翌日以降）

GitHub の schedule は数分〜数時間遅れることがあります。**8:00 JST** に 1 回キューし、起動後は **9:20 まで待機**してから取得します。成功ログは **10 分前後**（取得あり）。**20 秒程度**で終わる場合は「当日スキップ」です。遅延が極端な日は **Run workflow** で手動実行してください。

### 取得条件や時刻を変えたいとき

リポジトリの `.github/workflows/maplen-board-pages.yml` を編集して `main` に push します。

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
| 本番 | `https://lulumi-tools.com/` |

Pages 用ビルドは `GITHUB_PAGES=true`・`PAGES_BASE_PATH=/` でサイトルートに出力します。

## 7. トラブルシュート（公開・更新）

| 症状 | 対処 |
|------|------|
| 真っ白 / 404 | Pages の Source が **GitHub Actions** か確認。workflow が成功しているか確認。カスタムドメイン設定後は再デプロイ |
| `github.io` から旧ドメインへ飛ぶ | ブラウザの 301 キャッシュを削除するかシークレットで開く。Settings で Custom domain を確認 |
| データがありません | Actions の **Fetch ranking** ログを確認（API エラー・レート制限） |
| 初回だけ時間がかかる | Lv225+ で約 550 ページ取得のため 10〜20 分かかることがあります |
| 履歴が1日だけ | DB キャッシュが効くまで日数は増えます（Actions キャッシュで DB を保持） |

## 8. 今後（Discord）

- ユーザーごとのお気に入り通知 → Bot + DB が必要（Pages だけでは不可）
- チャンネル1本への日次サマリー → 同じ workflow に Webhook ステップを追加可能
