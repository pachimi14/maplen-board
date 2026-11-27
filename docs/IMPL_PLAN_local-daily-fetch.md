# IMPL_PLAN_local-daily-fetch — 自宅PCから毎朝ランキングを取得し、Release に書いて公開まで自動で走らせる

> 1計画書=1縦切りテーマ(PR-001)。本テンプレの全セクションは必須(PR-002)。
> 承認者: ユーザー(未承認) / 実装: implementer / 検収: 統括
> 関連: LULU-145(公式メンテ)・LULU-150(Cloudflare による CI/VPS 403 と 2026-11-21 の救出)・LULU-139(取り逃がしは約24時間だけ救出可能)・`docs/IMPL_PLAN_vps-trigger.md`(公式更新の着地実測・dispatch 入力)

## 0. 目的と背景

- **北極星への寄与**: 「毎朝サイトを見ると前日分が入っている」を**ユーザーが何も覚えていなくても**成り立たせる。いま取得できる唯一の経路は自宅PCなので、PCを主系にする。
- **参照する決定**: DECISION_LOG LULU-150 / LULU-145 / LULU-139 / LULU-004(取得ロジック変更禁止)/ T12 P3(Release が唯一の永続ストア)

### 前提(実測済み・2026-11-22〜23)

| 経路 | 公式 ranking API | 根拠 |
|---|---|---|
| 自宅PC(この回線) | **200** | 2026-11-23 01:52〜02:13 に 1,062ページ全取得成功 |
| GitHub Actions runner | 403 | Cloudflare interstitial |
| VPS | 403(`-4` / `--http1.1` いずれも) | 同上 |
| Anthropic 基盤 | 403 | 同上 |

→ **クラウドからは取得できない。PCから取得して、公開だけ GitHub に任せる**のが唯一の構成。

### 時間的制約(今日のうちに効く)

ranking_day `2026-11-22` は **JST 2026-11-23 09:05〜2026-11-24 09:00 の間に取得しないと永久に失われる**(LULU-139)。本計画が 09:05 に間に合わない場合は、暫定で救出スクリプト相当の手動実行で `2026-11-22` を確保する(§4 の停止時フォールバック)。

### 公開経路の事実確認(今回調べ直した)

- `maplen-board-pages.yml` に **`git commit` は1つも無い**。v2シャードはリポジトリに入らず、ワークフローが `main.py` で出力 → `npm run build` に同梱 → Pages artifact として配信される。
- つまり**公開に push は不要**。PCは git を一切触らない。
- 唯一の永続ストアは Release タグ `db-store` の `ranking.db.gz`(T12 P3)。`release_store.sync_db_to_release()` は **現資産をダウンロードしてマージしてから**上げるので非破壊。

## 1. スコープ

**触るもの(すべて新規ファイル)**

- `exp_ranking/bot/production.env` — 本番取得の環境変数(値の唯一の住所。秘密情報は入れない)
- `exp_ranking/bot/daily_fetch.py` — 事前点検 → Release取得 → `main.py` → Release書込 → dispatch → 公開確認 を1本で回す driver(**Python**。理由は §2.10。配置は既存の job スクリプト `gdrive_backup_job.py` と同じ bot/ 直下)
- `exp_ranking/bot/ops/daily_fetch.bat` — タスク スケジューラから呼ばれる１行ラッパー(root の `run_fetch.bat` と同じ作り。ExecutionPolicy の問題が生じない)
- `exp_ranking/bot/test_daily_fetch.py` — driver のゲート(§2.4)の単体テスト
- `exp_ranking/bot/test_production_env_parity.py` — CI の env と `production.env` の**機械照合**(§2.3)
- `exp_ranking/bot/ops/LulumiDailyFetch.xml` — Windows タスク スケジューラ定義(**登録はユーザー作業**)
- `exp_ranking/bot/ops/README.md` — 登録/解除コマンド・ログの場所・失敗時の手順
- `docs/DECISION_LOG.md` — 本計画の決定を追記(統括が実施)

**触らないもの(明示)**

- `main.py` / `fetch_ranking_min_level` / リトライ / `validate_ranking_freshness` / スキップ判定 — **LULU-004 変更禁止**
- `release_store.py` / `snapshot_guard.py` / `mvp_export.py` / `sqlite_storage.py` / `config.py`
- `.github/workflows/*.yml` — **1行も変更しない**(cron の静音化は §2.6 の別決定・別PR)
- `exp_ranking/bot/.env`(ユーザーの開発用設定。読むだけ、書き換えない)
- `exp_ranking/web/**` / UI / 公開データ契約(meta キー・シャード形式)
- リポジトリ root の `run_fetch.bat`(開発用の既定値 `RANKING_MAX_PAGES=800` / `SNAPSHOT_RETENTION_DAYS=35` のまま温存。**本番には絶対に流用しない**)

## 2. 設計

### 2.1 役割分担 — PCは「取ってRelease に置く」まで。公開は既存ワークフローのまま

```
[PC 09:05]
  1. 事前点検(§2.3)
  2. 公開済みチェック: サイト rankings.json の先頭512バイトを Range GET
     → meta.latestSnapshotDate == 当日の ranking_day なら即 exit 0(ダウンロードもAPIも叩かない)
  3. Release db-store から ranking.db.gz をダウンロード → data/ranking.db に展開
  4. python main.py (CI と同一 env。公式更新の着地をポーリングで待ってから全件取得)
  5. 取得後ゲート(§2.4)を通ったら release_store.sync_db_to_release() で Release にマージ書込
  6. gh workflow run maplen-board-pages.yml -f force_fetch=false -f wait_for_update=false
  7. run の conclusion を待つ → サイト meta.latestSnapshotDate が当日分になるまで確認(§2.5)
```

**2026-11-23 01:50〜02:30 に 3〜7 を人手で通し、本番で成功している**(run 45049534823 / Release 173日 1,454,086行 / サイト 10,601件)。本計画はその手順をスクリプトに落とすだけで、**新しい計算も新しいデータ形式も作らない**。

### 2.2 正(source of truth)の所在 — 増やさない

| 対象 | 正 | 本計画での扱い |
|---|---|---|
| スナップショットの本体 | Release `db-store` の `ranking.db.gz` | **毎回ダウンロードし直す**。PCの `data/ranking.db` はキャッシュ扱いで、正にしない |
| 取得パラメータの値 | `production.env`(新規) | CI の env は**同じ値を持つ複製**。§2.3 で機械照合し、乖離したら走らせない |
| 公開済みかどうか | サイトが配信している `data/v2/rankings.json` の `meta.latestSnapshotDate` | ローカルに「公開済みフラグ」を持たない(正を2箇所に置かない) |
| ranking_day の決め方 | `main.py` / `ranking_day.py` | driver は**同じ関数をそのまま import して呼ぶ**。日付計算を再実装しない |

### 2.3 事前点検ゲート(同期面の機械検証。検証なき同期面は却下)

`production.env` は CI の env の複製なので、**乖離を検出できないなら作ってはいけない**。
`test_production_env_parity.py` は次の2つを検証し、`daily_fetch.py` は**fetch の前にこのテストを実行して exit≠0 なら中止**する(CI では pytest が走らないため、PC実行時のゲートが実質的な検証面)。

1. **CI ↔ production.env パリティ**: `maplen-board-pages.yml` の `Fetch ranking and export JSON` ステップの `env:` ブロックを行パーサで抽出し、`production.env` と**同じキーは同じ値**であることを検証。
   - 除外キー(理由付きで明示列挙): `GH_TOKEN`(実行時に `gh auth token`)・`GH_REPO`・`SKIP_MSU_RANKING_FETCH`(コミットメッセージ駆動)・`FORCE_RANKING_FETCH`・`ENFORCE_JST_FETCH_WINDOW`・`SKIP_DEPLOY_IF_DAY_CAPTURED`・`SNAPSHOT_GUARD_*`・`${{ }}` 式を値に持つキー
   - CI 側に**除外リストに無い新しいキーが増えた**ら失敗(= 片方だけ更新できない)
   - env ブロックを特定できなかった場合も**失敗**(fail-closed)
   - **PyYAML 等の新規依存は使わない**(requirements.txt は `requests` のみ)
2. **`.env` との競合検出**: `config.load_env_file()` は `os.environ` を**上書きする**。`exp_ranking/bot/.env` に `production.env` と**同じキーで違う値**があれば失敗(現状 `MVP_EXPORT_TOP_N=0` は両方同じ値なので通る)。
   - 調査済み: `.env` の `MVP_JSON_OUTPUT_PATH` は **死キー**(v1 エクスポートは廃止。`config.py:132` のコメントと `*.py` 全文検索で読み出しが無いことを確認)なので、本番実行に影響しない。**`.env` は読むだけで書き換えない**。

その他の点検(すべて失敗したら fetch 前に中止):
- `gh auth status` が成功し、スコープに `repo` と `workflow` がある
- `python -c "import requests"` が通る
- ドライブ空き ≥ 5GB(実測: DB 770MB + gz 182MB + 出力)

### 2.4 Release に書く前のゲート(fail-closed)

`sync_db_to_release()` を呼ぶのは、**次のすべてを満たしたときだけ**。1つでも欠けたら書かずに失敗終了する。

| # | 条件 | 値 | タイミング |
|---|---|---|---|
| G1 | `main.py` の exit code | 0 | 書き込み前 |
| G2 | DB の最新 ranking_day | 当日の期待値と一致 | 書き込み前 |
| G3 | 当日の行数 | ≥ 10,000(人口 10,601 に対し `SKIP_RUN_MIN_SNAPSHOT_ROWS=1000` より厳しく取る) | 書き込み前 |
| G4a | DB の snapshot 日数 | ≥ 85 | 書き込み前 |
| G4b | sync 後の DB の snapshot 日数 | ≥ sync 前に Release が持っていた日数 / `downloaded` なら `merged_rows > 0` | **書き込み後** |

G2〜G4 は `sqlite3` への読み取りクエリのみ。`snapshot_guard` は `main.py` 内で既に fail-closed に働いており、本ゲートはその**後段の二重化**。

**G4 の訂正(2026-11-23、検収で発見。当初の記述は統括の誤り)**: 当初「DB の snapshot 日数が実行前より減っていないこと」と書いたが、これは**本番で100%失敗する**。`sync_db_to_release()` は Release 側の行をローカルに `INSERT OR IGNORE` する union なので、ダウンロード直後のローカルDB は Release の**全履歴(実測 173日)**を持つが、`main.py` は `SNAPSHOT_RETENTION_DAYS=90` の保持削除を実行して**87〜88日に縮むのが正常**(2026-11-23 未明の実走ログで確認)。つまり 90日保持の公開データと、全履歴を持つ Release ストアを混同していた。
正しい不変条件は「**Release が日を失わない**」であり、union なので構造上縮まない。よって書き込み前には「DB が壊れていない」を見る(G4a、閾値 85)、書き込み後に「Release が持っていた日数以上になった」を検証する(G4b)の2段に分ける。

### 2.5 二重起動と公開の取りこぼしを両方つぶす

- **1日3回起動(JST 09:05 / 13:00 / 20:00)**。取り逃がしても同じ日のうちに拾える(LULU-139 の24時間窓の内側)。
- 2回目以降は §2.1 の手順2で**サイトが当日分を配信していれば即 exit 0**(ダウンロードもAPIも叩かない。1〜2秒)。
- 配信がまだ当日分でないが Release には入っている場合 = **取得は済んだが公開が落ちた**状態。このときスクリプトは**取得をスキップして dispatch と公開確認だけやり直す**(`main.py` は `SKIP_RUN_IF_RANKING_DAY_EXISTS=true` + `SKIP_DEPLOY_IF_DAY_CAPTURED=true` で丸ごと no-op になるため、API は叩かれない)。
  - これが「書いた本人が読めるか」の確認。**Release に書けたことを公開できたことと同一視しない**。
- dispatch した run が `cancelled` / `failure` で終わったら、**最大2回まで再 dispatch**(間隔60秒)。既存 cron と `concurrency: maplen-board-pages` を共有しており、保留中の run は後続の dispatch に差し替えられてキャンセルされ得るため(§2.6)。

### 2.6 既存トリガとの競合(ユーザー決定が必要・本計画のスコープ外)

| トリガ | 現状の挙動(403環境) | PC経路への影響 |
|---|---|---|
| `maplen-board-pages.yml` の cron 4本(JST 5:07〜8:07) | DB復元 → **JST 09:05 まで待機** → ポーリング → 403 で失敗。この間ずっと concurrency group を占有 | PCの dispatch(約 09:35)が**キューで待たされる / 後続 dispatch に差し替えられてキャンセルされる** |
| `lulumi-ranking-retry.yml` の cron 5本 | DBパスが git に無いため**常に `force_fetch=true` で dispatch** → 403 で失敗 | 同上。`force_fetch=true` は取得を強制するので必ず失敗する |
| VPS の timer(JST 9:06, `wait_for_update=true`) | 403 で失敗 | 同上 |

**統括の推奨: Pages の cron 4本と Retry の cron 5本を止め、VPS timer も止める**(公式が復旧したら戻す)。理由は美観ではなく、**PCが取ったデータの公開が最大1時間遅れる/キャンセルされる**実害があるため。
ただし**GitHub Actions の取得スケジュール変更はユーザー専権事項**なので、本計画では**ワークフローを1行も触らない**。§2.5 の再 dispatch で競合しても最終的に公開できるようにしてある。静音化は承認後に別PR(3行の削除)で出す。

### 2.7 失敗の可視化

PCが寝ていた・回線が落ちた・公式が403 — どれも**静かに失敗する**のが最悪。

- 失敗時: `%USERPROFILE%\Desktop\LULUMI_FETCH_FAILED_<ranking_day>.txt` を作成(1行の理由 + ログのパス)。成功時は同名ファイルを削除。
- 全実行のログ: `exp_ranking/bot/logs/daily_fetch_<yyyy-MM-dd>.log`(既存 `logs/` を使う)。
- タスク スケジューラ側も最終実行結果を保持するので、二重に残る。
- **新規依存を入れないため、トースト通知は採用しない**(BurntToast 等は pip/npm 外だが依存は依存)。

### 2.8 作らないリスト判定

| 作らないもの | 理由 |
|---|---|
| 生JSONを受け渡す新しい取り込み経路 | 取得ロジック(変更禁止領域)に手が入る。Release マージで足りている |
| self-hosted runner | **リポジトリが public** → fork PR のコードが自宅PCで走る。却下 |
| PCからの git push / 独自デプロイ | 公開に push は不要(§0)。ユーザー専権の操作を自動化しない |
| 取得の並列化・高速化 | 公式への負荷。`RANKING_REQUEST_DELAY_SEC=0.8` は CI と同一に保つ |
| Claude のスケジュール実行 | アプリ起動が前提 + 利用量を消費。Windows タスクなら無料で独立 |
| 公式が復旧したら消える問題への投資(403 回避・プロキシ) | 回避行為であり不安定。復旧すれば CI に戻せる |

### 2.9 代替案比較

| 案 | 内容 | 利点 | 欠点 | 判定 |
|---|---|---|---|---|
| **A(推奨)** | PCで取得 → Release へマージ書込 → 既存ワークフローを dispatch して公開 | 2026-11-23 に本番で通した手順そのまま。botコード・ワークフロー無変更。push 不要 | PCの稼働に依存。env の複製が1面増える(§2.3 で機械検証) | **採用** |
| B | PCで取得・エクスポートし、PCから git push して Pages を更新 | GitHub Actions に依存しない | ユーザー専権の push を自動化。公開経路が二重化し、v1/v2 の配信契約を壊す恐れ | 却下 |
| C | PCで取得した生JSONをリポジトリに置き、ワークフローが取り込む | PCは軽い | 取得ロジック=変更禁止領域に新経路を足す。未検証コードが増える | 却下 |
| D | 毎朝ユーザーが手動実行 | 実装ゼロ | **忘れたら永久欠損**。北極星(習慣)に反する | 却下 |
| E | VPS/クラウドの egress を変える(WARP・住宅プロキシ) | CI構成のまま | 回避行為・第三者経路・不安定。LULU-150 の方針外 | 却下 |

### 2.10 driver の言語 = Python(PowerShell ではない)

- この PC に **PowerShell 7(`pwsh`)は入っていない**(Windows PowerShell 5.1.26100 のみ)。5.1 は `&&` / `||` / 三項演算子 / `??` が使えず、スクリプト実行は ExecutionPolicy にも左右される。
- driver の仕事は **ranking_day の算出・SQLite 読み取り・Release のダウンロード/マージ・HTTP Range GET・`gh` 呼び出し** で、どれも bot がすでに Python で持っている。
  - `ranking_day.snapshot_date_ranking()` / `release_store.download_current_asset()` / `release_store.sync_db_to_release()` を**そのまま呼ぶ**。日付計算を別言語で再実装しない(= 正を増やさない)。
  - 標準ライブラリ + 既存の `requests` だけ。**新規依存なし**。
  - ゲート(§2.4)を pytest で単体テストできる(PowerShell ではできない)。
- 実行は `python ops/daily_fetch.py`。タスク スケジューラからは `ops/daily_fetch.bat` 経由で呼ぶ。

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|---|---|---|
| 1 | 既存テスト | 全緑 / failed 0 | `cd exp_ranking/bot && python -m pytest -q` |
| 2 | パリティテスト | exit 0 / 競合キー 0件 | `cd exp_ranking/bot && python -m pytest test_production_env_parity.py -q` |
| 3 | パリティテストの検出力 | CI の env を1キー書き換えた一時コピーで **failed 1**(テスト内で合成して確認) | 同上(テストに negative ケースを含める) |
| 4 | web ビルド | exit 0 | `cd exp_ranking/web && npm run build` |
| 5 | 新規依存 | pip 0件 / npm 0件 | `git diff -- exp_ranking/bot/requirements.txt exp_ranking/web/package.json` が空 |
| 6 | `--dry-run` 実行 | exit 0 / 公式APIリクエスト 0 / Release 書込 0 / dispatch 0 | `python daily_fetch.py --dry-run` のログ |
| 7 | 本番初回(JST 2026-11-23 09:05) | Release の snapshot 日数 173 → 174 / ranking_day `2026-11-22` が入る | 実行ログ + `release_store` の出力 |
| 8 | 公開完了 | サイト `meta.latestSnapshotDate == 2026-11-22` が **JST 10:00 まで**に成立(実測値を報告に記載) | `curl -s https://lulumi-tools.com/data/v2/rankings.json -r 0-511` |
| 9 | 取得規模 | 件数 ≥ 10,000 / `snapshotDays` ≥ 87 | 同 meta |
| 10 | 当日2回目(13:00) | API 0リクエスト / Release 書込 0 / exit 0 / 所要 ≤ 60秒 | ログ |
| 11 | 失敗の可視化 | パリティを故意に壊した実行で、終了から5秒以内に Desktop にマーカー生成 / exit ≠ 0 | 手動で1回再現 |
| 12 | 既存ワークフロー | 差分 0行 | `git diff -- .github/workflows/` が空 |

**詰める責任の分担(重要)**

- **実装担当が詰める: #1〜#6, #11, #12**。これらはすべてローカルで完結する(公式 API を叩かず、Release にも書かず、dispatch もしない)。
- **#7〜#10 は実装担当が検証しない**。本番の Release 書込と Pages 公開は**ユーザー専権事項**であり、初回本番実行(JST 09:05)の結果を**統括が検収**する。実装担当は `--dry-run` より先を**自分で走らせない**。
- タスクの登録も**ユーザーが実行**する(実装担当はコマンド1行を README に置くまで)。

## 4. 停止条件

以下に該当したら**実装を止めて、選択肢+推奨付きで統括に報告**する(停止報告は歓迎される):

- `main.py` / `release_store.py` / `snapshot_guard.py` / `config.py` / `.github/workflows/**` に変更が必要になった
- 新規の pip / npm 依存が必要になった(PyYAML を含む)
- `.env` を書き換えないとパリティが通らない
- `production.env` と CI の env の差が、§2.3 の除外リストで説明できない
- タスク スケジューラへの登録を実装担当が実行する必要がある(= **ユーザー作業。実装担当は登録しない**)
- 公式 API が PC からも 403/メンテで取得できない(= 今日の取得自体が不可能。報告のみ)
- 受け入れ基準の未達が2回の試行で解消しない
- **09:05 の本番初回に間に合わない見込みになった** → ただちに報告する。統括が暫定で手動取得に切り替える(`2026-11-22` の欠損を避けるため)

## 5. コミット分割

各コミット単独 revert 可。挙動不変ステップ先行(PR-001)。**既存の実行経路には最後まで一切影響しない**(全て新規ファイル)。

1. `production.env` + `test_production_env_parity.py`(データ+検証のみ。実行経路なし)
2. `daily_fetch.py` + `test_daily_fetch.py`(`--dry-run` まで動く状態。本番実行はまだしない)
3. `ops/daily_fetch.bat` + `ops/LulumiDailyFetch.xml` + `ops/README.md`(登録手順。登録はユーザー)

## 6. 検証コマンド(コミットごと)

```
cd exp_ranking/bot && python -m pytest -q                      # 1,2,3 共通: 全緑
cd exp_ranking/bot && python -m pytest test_production_env_parity.py -q
cd exp_ranking/web && npm run build                            # 2,3: ビルド成功
cd exp_ranking/bot && python daily_fetch.py --dry-run          # 2,3: 事前点検のみ通す
git diff -w -- exp_ranking/bot/daily_fetch.py exp_ranking/bot/production.env exp_ranking/bot/test_daily_fetch.py exp_ranking/bot/test_production_env_parity.py exp_ranking/bot/ops
git diff -- .github/workflows/                                  # 空であること
```

`git add -A` 禁止。触ったファイルのみ個別 add。

## 7. ロールバック

- 全成果物が**新規ファイル**なので `git revert <commit>` で完全に戻る。既存の取得・公開経路(cron → ワークフロー)には手を入れていないため、revert 後の挙動は現状と同一。
- タスクの解除はユーザー作業: `schtasks /delete /tn LulumiDailyFetch /f`
- Release を誤って壊す経路は無い(`sync_db_to_release` は download→merge→upload の非破壊。§2.4 のゲートが前段)。万一のときは T12 P5.5 の Google Drive 世代バックアップから復元。

## 8. 完了報告テンプレ

- 実施コミット(ハッシュ):
- 受け入れ基準の実測値(表の全12行):
- 検証コマンド出力の要点:
- `--dry-run` のログ全文(事前点検の各項目の結果):
- タスク登録コマンド(ユーザーが実行する1行):
- 残課題・watch-item:
