# IMPL_PLAN_SH47 — スターフォース価格をメインPCで1日1回取得し、増分だけVPSへ流す

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー / 実装: implementer(実装担当)

## 0. 目的と背景

- **北極星への寄与(一文)**: 公式403でスターフォース価格履歴が 2026-11-18 から止まっている状態を終わらせ、毎日 JST 17時頃に最新24時間が積み上がる状態に戻す。
- 参照する決定: DECISION_LOG **LULU-153**(実測の根拠)/ **LULU-150・LULU-151**(PC主系という既存の形)/ `docs/REPLY_LT_SF_DAILY_FETCH.md`
- 依頼元: `maplenEnhancebot` ブランチ `claude/sharp-carson-ihn4a8` の `docs/HANDOVER_LT_SF_DAILY_FETCH.md`

### 0.1 この計画が「小さい」理由(既存資産の再利用)

既存コードを**1行も変えずに**取得が成立することを実コードで確認した。新規コードは2本のスクリプトだけ。

| 必要なこと | 既存で足りるか | 根拠(実コード) |
|---|---|---|
| ローカルDBの用意 | **コード変更ゼロ** | `scripts/update.py` の `run_update` が `db.apply_schema(conn)` を呼ぶ。空ファイルを `--db` に渡せばスキーマから作られる |
| 1日1回でも取りこぼさない | **コード変更ゼロ** | `_window_start` = その combo の `MAX(price_at)` − 8h。窓は `fetch_history_page` が1リクエストで取り切る(ページングなし)ので、**間隔を空けるほど窓が伸びるだけでリクエスト数は増えない** |
| 2026-11-18 以降の欠測(7日)を埋める | **コード変更ゼロ** | `scripts/backfill.py` の `WINDOW_DAYS = 160.0`。1 combo = 1リクエストで保持期間全体を取る。**初回に1度走らせればローカルDBが完成し、同時に欠測も消える**(VPSから900MBを落とす必要はない) |
| 取得の失敗からの復帰 | **コード変更ゼロ** | run が途中で死んでも、未処理 combo の `MAX(price_at)` は進まないので**翌日の窓が自動的にその分伸びる**。恒久的な欠測にはならない(上流保持150日の範囲内) |
| 日次スケジュール | 既存の写し | `exp_ranking/bot/ops/`(LulumiDailyFetch)が確立済みのひな型。`.bat` + タスクXML + 日次ログ + デスクトップ失敗マーカー |
| VPSへの転送の検証 | 既存の作法 | SH-6 の受け入れ基準と同じ `PRAGMA integrity_check` + 行数照合 |

**新規に書くのはこの2本だけ**: `scripts/export_increment.py`(ローカルDB → gzip JSONL)/ `scripts/ingest_increment.py`(VPS側で gzip JSONL → `INSERT OR IGNORE` + 4h再導出)。

### 0.2 今回やらないこと(意図的に外す。理由つき)

| 外すもの | 理由 |
|---|---|
| `fetcher.py` の接続例外(`ConnectionError`)耐性 | **自己修復するため緊急ではない**(上の表の4行目)。失敗した run の翌日の窓が自動で伸びるので、欠測ではなく1日の遅れになるだけ。ログが traceback になる読みづらさは残るので**バックログへ**(DECISION_LOG §7) |
| 軽い口 `/sf-history/latest-costs` の追加 | **最適化であって前提ではない**。既存 `prices`/`cube-prices` で今日から読める(1装備 228,868 B)。足す価値はあるが、依頼元が実際のフィールドを確定してからの方が契約を一度で決められる |
| 現在値カード・画面文言 | **別の関心事**(表示の挙動変更)。`IMPL_PLAN_SH48` に分離。PR-001「挙動不変先行・挙動変更は最後」 |
| VPS の `sf-history-update.timer` 停止 | **取得スケジュールの変更=ユーザー専権**。§9 に推奨として記載し、実装担当は触らない |

## 1. スコープ

**触るファイル(新規)**
- `server/sf-history/scripts/export_increment.py`
- `server/sf-history/scripts/ingest_increment.py`
- `server/sf-history/tests/test_export_increment.py`
- `server/sf-history/tests/test_ingest_increment.py`
- `server/sf-history/ops/sf_daily_fetch.py`(ドライバ: update → export → 転送 → 結果判定 → ログ/マーカー)
- `server/sf-history/ops/sf_daily_fetch.bat`
- `server/sf-history/ops/LulumiSfDailyFetch.xml`
- `server/sf-history/ops/README.md`
- `server/sf-history/deploy/sf-history-ingest.service.example`(VPS側 oneshot。**配備はしない**、ファイルを置くだけ)

**触るファイル(既存・追記のみ)**
- `server/sf-history/README.md`(「PC主系の日次取得」節を追加)
- `server/sf-history/data/.gitignore`(`*.sqlite*` は既に除外。**確認のみ**、変更が要るなら停止して報告)

**触らないもの(明示)**
- `fetcher.py` / `db.py` / `aggregate.py` / `cube.py` / `cube_aggregate.py` / `app.py` / `discovery.py` / `fetch_latest.py`
- `scripts/update.py` / `scripts/backfill.py` / `scripts/cube_backfill.py` / `scripts/rebuild_4h.py`
- 取得URL・params・`period=2`・`MIN_INTERVAL_SEC=1.0`・`derive_max_requests`・429の停止レール
- `contract/response_fields.json` と両側の契約テスト(応答は1バイトも変えない)
- `exp_ranking/` 配下すべて / `.github/workflows/` すべて / 既存の `LulumiDailyFetch` タスク
- `maplenEnhancebot` リポジトリ(読み取りすらしない)

## 2. 変わってよいもの・いけないもの

**変わってよい**
- VPS の `sf_price_history_hourly` / `sf_cube_price_history_hourly` に**行が増える**(増えるだけ。既存行の更新・削除はしない)
- `sf_price_history_4h` / `sf_cube_price_history_4h` の、**増えた hourly 行が属するバケットのみ**再導出される
- `/sf-history/prices` の `points` が伸びる・`priceVersion` が進む
- PC のローカルディスク消費が約 1.0 GiB 増える

**変わってはいけない**
- **応答のキー集合**(`contract/response_fields.json` に1行も触らない)
- 既存の hourly 行の `end_price` / `price_at` / `sum_enhance_count`(`INSERT OR IGNORE`。**`OR REPLACE` は禁止**)
- `sf-history.service` の可用性(ingest 中も 200 を返し続ける)
- VPS の available memory が 300 MiB を割らないこと(SH-6 の停止条件)
- 他サービス(caddy / img-proxy / raffle-api / vps-trigger)の状態
- 上流への1秒間隔・リクエスト予算・429レール

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | 既存テスト全緑 | 全パス、0 failed | `cd server/sf-history && python -m pytest .` |
| 2 | 新規2本のテスト | 各3ケース以上が緑(正常 / 空 / 二重取り込み) | 同上 |
| 3 | 初回 backfill のローカル行数 | hourly **≥ 4,298,287**(VPS現在値)、cube hourly **≥ 686,834** | `sqlite3 <local> "SELECT COUNT(*) FROM sf_price_history_hourly"` |
| 4 | 初回 backfill のリクエスト数 | SF **748**、CUBE **136**(±0。予算 798/186 を超えない) | 標準エラー出力の `requests=` 行 |
| 5 | 初回 backfill の所要時間 | **≤ 40分** | ログの開始/終了時刻 |
| 6 | 欠測の消滅 | `2026-11-18T15:00:00Z` 〜 初回実行時刻 の各 UTC 時刻で、(item,upgrade) 748 組の欠けが **0 件** | 時刻×combo のクロス集計SQL(§6に記載) |
| 7 | 日次 run のリクエスト数と時間 | SF 748 / CUBE 136、**≤ 25分** | ドライバのログ |
| 8 | 増分 export のサイズ | 直近3日 ≈ **62,784行**、gzip **≤ 1.0 MiB** | `export_increment.py` の出力 + `ls -l` |
| 9 | **取り込みの冪等性** | 同じ増分ファイルを2回流して、**2回目の挿入行数 = 0**、`sf_price_history_4h` の行数と全 `end_price` が1回目の後と完全一致 | ingest の戻り値JSON + 前後のチェックサムSQL |
| 10 | DB健全性 | `PRAGMA integrity_check` = `ok`(取り込み前・後の両方) | `sqlite3 <vps db> "PRAGMA integrity_check"` |
| 11 | 鮮度 | 取り込み後 `MAX(price_at)` が**当日 JST 17:00 の UTC 表現 − 2h 以降** | `sqlite3` + `/sf-history/prices?itemId=1003720` の最終点 |
| 12 | 既存が無傷 | `sf-history.service` active / `/sf-history/health` = 200 / `systemctl --failed` が取り込み起因で増えない / listen ポートがベースラインと同一 | §6 の VPS 確認コマンド |
| 13 | VPS メモリ | 取り込み中の available **≥ 300 MiB**、ingest プロセスの RSS **≤ 150 MB** | `free -m` / `ps -o rss` |
| 14 | 転送経路が公開口を増やさない | 新しい listen ポートが **0 個**。ssh(22) のみを使う | 取り込み前後の `ss -lntp` 差分 |
| 15 | タスク登録 | `State : Ready` かつ `NextRunTime` が翌 JST 17:00 | `Get-ScheduledTask` / `Get-ScheduledTaskInfo` |
| 16 | 改行ノイズゼロ | `git diff -w` の実質差分が意図した行のみ | `git diff -w -- <touched files>` |

## 4. 停止条件

以下に該当したら**実装を止めて選択肢+推奨付きで統括に報告**する(停止報告は歓迎される):

1. **PC からの取得が 403 / メンテHTMLを返した**(= PC も遮断された)。この計画の前提が崩れるので、1リクエストでも 403 を見たら止める
2. 取り込み前後の `PRAGMA integrity_check` が `ok` 以外 → **直ちに §7 のスナップショットへ差し替えて報告**
3. VPS の available memory が 300 MiB を割った、または swap が増え始めた(OPS-1 の再発)
4. 受け入れ基準の未達が2回の試行で解消しない
5. 既存の 900 MiB DB に対して `UPDATE` / `DELETE` / `REPLACE` / `VACUUM` が必要だと判断した(**追記以外は一切しない**のがこの計画の前提)
6. `scripts/update.py` や `fetcher.py` を変更する必要が出た(§1「触らないもの」。設計の見直しが必要なサイン)
7. 転送のために**新しい listen ポート・新しい公開エンドポイント・root での自動実行**が必要だと判断した
8. 基準 #6(欠測の消滅)が満たせず、上流が該当期間を返さないことが分かった(保持期間切れ)

## 5. コミット分割

各コミット単独 revert 可。挙動不変ステップ先行。

1. **`feat(sf-history): add export_increment.py + tests`** — ローカルDBから増分を gzip JSONL に出すだけ。既存の挙動に一切影響しない(読み取り専用)
2. **`feat(sf-history): add ingest_increment.py + tests`** — gzip JSONL を `INSERT OR IGNORE` で取り込み、触れたバケットだけ4h再導出。まだ誰も呼ばない
3. **`ops(sf-history): add the home-PC daily driver and scheduled task`** — `ops/` 一式(ドライバ・.bat・XML・README)。登録は**しない**(手順のみ)
4. **`docs(sf-history): document the PC-primary daily fetch`** — `server/sf-history/README.md` 追記 + `deploy/sf-history-ingest.service.example`

> 1〜2 は純追加なので、3 の前に単体で検証できる。3 を revert すれば自動実行は消え、1〜2 は誰も呼ばない死蔵コードとして無害に残る。

## 6. 検証コマンド(コミットごと)

```bash
# 全コミット共通
cd server/sf-history && python -m pytest .
cd ../../exp_ranking/web && npm run build          # 無関係の破壊がないことの確認
git diff -w -- <touched files>

# コミット1〜2(ローカル、ネットワーク不要。fixture で完結)
cd server/sf-history
python -m pytest tests/test_export_increment.py tests/test_ingest_increment.py -q

# 初回 backfill(1度だけ。実ネットワーク)
python scripts/backfill.py       --db data/sf_price_history.sqlite
python scripts/cube_backfill.py  --db data/sf_price_history.sqlite
sqlite3 data/sf_price_history.sqlite "PRAGMA integrity_check;"
sqlite3 data/sf_price_history.sqlite "SELECT COUNT(*) FROM sf_price_history_hourly;"

# 基準6(欠測ゼロ)の判定SQL — 期待値は 0 行
sqlite3 data/sf_price_history.sqlite "
  SELECT price_at, COUNT(*) AS combos FROM sf_price_history_hourly
  WHERE price_at >= '2026-11-18T15:00:00Z'
  GROUP BY price_at HAVING combos <> 748;"

# 日次(ドライバ経由。リハーサルは転送しない)
python ops/sf_daily_fetch.py --dry-run     # 取得も転送もしない。経路と設定だけ確認
python ops/sf_daily_fetch.py --no-deliver  # 取得と export まで。転送しない

# 取り込みの冪等性(基準9)— 同じファイルを2回流す
# 1回目の inserted > 0、2回目の inserted == 0 であること
<deliver コマンド> < increment.jsonl.gz
<deliver コマンド> < increment.jsonl.gz

# VPS 側の確認(基準10〜14)
ssh -i <key> root@163.44.118.206 '
  systemctl is-active sf-history.service;
  curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8785/sf-history/health;
  free -m | head -2;
  ss -lntp | wc -l;
  sudo -u botuser sqlite3 /home/botuser/apps/lulumi-tools-sf-history/data/sf_price_history.sqlite "PRAGMA integrity_check;"'
```

## 7. ロールバック

| 層 | 戻し方 | revert しても壊れない根拠 |
|---|---|---|
| VPS のデータ | 取り込みの**直前に必ず** `sqlite3 <db> ".backup <db>.pre-ingest-<ts>"` を取る。異常時はこれに差し替えて `systemctl restart sf-history.service` | 取り込みは `INSERT OR IGNORE` の追記のみ。既存行は一切変更しないので、スナップショットは常に「取り込み前の正しい状態」 |
| VPS のコード | `ingest_increment.py` を削除するだけ。サービス本体(`app.py`)は無変更 | ingest は oneshot。常駐しない |
| PC の自動実行 | `schtasks /delete /tn LulumiSfDailyFetch /f` | ローカルDBが残るだけ。VPS には何も起きない |
| リポジトリ | 4コミットを個別に revert 可。1〜2 を残して 3 だけ revert すれば「コードはあるが自動実行はしない」状態になる | 1〜2 は誰からも呼ばれない純追加 |
| 取得の体制 | VPS の `sf-history-update.timer` を**止めない**ので、公式403が解けた日に PC タスクを消すだけで元の4時間ごと体制に戻る | 既存ユニットに触らない(§1) |

## 8. 完了報告テンプレ

- 実施コミット(ハッシュ、4本):
- 受け入れ基準の実測値(**表の16行すべて**。未達は未達と書く):
- 初回 backfill の実測(リクエスト数 / 所要時間 / 行数 / 基準6の判定SQLの出力):
- 冪等性の実測(1回目と2回目の `inserted`、4h テーブルの一致確認):
- VPS のベースライン前後比較(available MB / listen ポート / `systemctl --failed`):
- `git diff -w` の実質差分行数:
- 残課題・watch-item:

## 9. ユーザー専権事項(実装担当は手を出さない)

この計画には、実装担当が実行してはいけない操作が4つある。**該当箇所に来たら手順を提示して停止し、ユーザーの明示指示を待つ**。

1. **転送用の SSH 鍵の作成と設置**。PC から VPS へ流す経路には、`botuser` の `authorized_keys` に **forced command 付き**(`command="…/ingest_increment.sh",restrict`)で登録した**専用鍵**を使う。公開鍵しかできることが無い形にするため。**秘密鍵の値は、この文書・チャット・ログ・リポジトリのいずれにも書かない**(`server/vps-trigger/README.md` の PAT と同じ扱い)。既存の root 鍵を自動タスクから使うことは**しない**
2. **Windows タスク `LulumiSfDailyFetch` の登録**。XML は用意するが登録コマンドの実行はユーザー。XML に `<?xml ... encoding="UTF-8"?>` を**書かない**(LULU-151: Task Scheduler は UTF-16 を期待し `The task XML is malformed. (1,40)` で失敗する)
3. **VPS 側への `ingest_increment.py` の配置とサービス定義の有効化**(本番機への操作。SH-6 の前例どおり、必要ならユーザーまたは統括が実施)
4. **VPS の `sf-history-update.timer` の停止**。取得スケジュールの変更=専権事項。
   **統括の推奨: 止める。** 根拠: 403環境では4時間ごとに必ず失敗し(実測: 最後の成功 2026-11-19 01:59:45 JST)、`systemctl --failed` が常に汚れるため**本物の異常が埋もれる**。止めても `enable --now` 一発で戻る。ただし**ユーザーの指示があるまで実装担当も統括も触らない**

## 10. 残るリスク(この計画では解消しない。明示して残す)

- **PC が単一障害点**。PC が落ちた日は取得されず、**静かに失敗する**(検出手段が無い)。DECISION_LOG §6-1 に既に挙がっている同じ穴で、ランキング側と共通。検出(朝の未更新通知)は別テーマ
- **接続例外で run が traceback で死ぬ**(§0.2)。欠測にはならないが、失敗が読みづらい
- **公式 OpenAPI 復帰後の扱い**。`fetch_latest.py` は `MSU_OPEN_API_KEY` があれば公式 OpenAPI を使う経路を既に持つ(SH-23)。現在価格はキー配備で復活しうるが、**履歴**は依然このレガシー経路しかない
