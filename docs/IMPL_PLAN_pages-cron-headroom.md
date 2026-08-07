# IMPL_PLAN_pages-cron-headroom — Pages の先行起動バッファを 65分 → 245分 に拡げ、cron ドロップに冗長化で備える（①-b）

> 1計画書=1縦切りテーマ(PR-001)。
> 承認者: ユーザー（cron 変更＝ユーザー専権事項）/ 実装: implementer / 統括が code-review + 実測で検収。
> **これは ①-b（暫定）**。concurrency 占有の増大を解消する **①-c（待機役と実行役の分離）は別計画書**で後続。

## 0. 目的と背景

- **北極星への寄与**: 「毎朝の習慣」が成立するために、**公式更新（JST 9:00）の直後にサイトが更新されている**状態を安定させる。今朝はサイト更新が約1時間半遅れた。
- **参照する決定**: DECISION_LOG **LULU-066**（concurrency 共有・静かな異常のクラス）。本件は同クラスの続き。

### 不具合の実体（実測で確定）

設計は「**JST 8:00 に先行起動 → ランナー上で JST 9:05 まで待機（`jst_schedule.wait_until_jst_fetch_window`, `MAX_WAIT_SEC=6h`）→ 45秒間隔で公式更新を検知（`RANKING_UPDATE_POLL_*`）→ 即取得**」。**設計上のバッファは 8:00→9:05 = 65分**。

GitHub のスケジューラ遅延がこのバッファを食い潰している:

| workflow | cron | n | 中央値 | 最大 |
|---|---|---|---|---|
| Pages | `0 23`（JST 8:00） | 30 | **+58分** | **+161分**（2026-08-07） |
| Navigator | `0 1`（JST 10:00） | 30 | **+189分** | **+223分** |

- **平常日の実測**（run `31058163404`）: キュー JST 8:58:37 → 準備23秒 → `Fetch` 開始 8:59:00 → 9:05 まで待機 → 9:29 完了。**設計どおり動くが残余マージンは6分**（バッファ消費率 91%）。
- **2026-08-04 は +68分**で、**すでにバッファを3分超過**していた（誰も気づいていない）。
- **2026-08-07 は +161分** → JST 10:40 到着 = 取得窓の**95分後**。待機・ポーリング機構は完全に空振り。データ正確性は無傷（ベースライン比較方式のため遅れても正しく取れる）だが、**速度＝北極星が失われた**。

### cron は「遅れる」だけでなく「ドロップする」（実証済み）

`lulumi-ranking-retry.yml` は cron 3本（`40 0` / `20 1,2`）に対し **毎日2本しか発火していない**。schedule run 20本の conclusion は**全て success で cancelled が1本もない**ため、**concurrency の eviction ではなく GitHub 側の真のドロップ**。発火間隔の実測（30〜43分 ≈ cron の40分間隔）から、落ちているのは常に **`20 2`**。先行 run がキューに滞留している間に来た cron が捨てられている挙動。

→ **単一 cron をどれだけ早めてもドロップ日は無防備。冗長化が必要。**

## 1. スコープ

**触るファイル（1つだけ）**
- `.github/workflows/maplen-board-pages.yml` — `on.schedule.cron` と `jobs.build.timeout-minutes`

**触らないもの**
- `exp_ranking/bot/**` 一切（`jst_schedule.py` / `main.py` / `config.py` を含む）。**待機・ポーリング機構は正しく動いており変更不要**
- `concurrency` ブロック（group / cancel-in-progress）— ①-c で扱う
- 他ワークフロー（`maplen-board-navigator.yml` / `lulumi-ranking-retry.yml`）— Retry 前倒しは別件（②）
- web / DB / v2 スキーマ / Release / guard

## 2. 変わってよいもの・いけないもの

**変わってよい**
- schedule run のキュー時刻（JST 8:00 → **5:00 と 7:00 の2本**）
- 1日の Pages schedule run 本数（1本 → 最大2本。**2本目は当日取得済みのため約20秒でスキップする no-op**）
- **build ジョブの実行時間が最大 約4.5時間になる**（待機が長くなるため）
- **`maplen-board-pages` concurrency group の占有時間が 約30分 → 約3.5〜4時間**（JST 約5:58〜9:30）。**①-b が意図的に払うコスト**で、①-c で回収する

**変わってはいけない**
- **取得内容・件数・`snapshot_date` ラベル・v2 出力形式**（データ契約は完全不変）
- `jst_schedule` の待機ロジック、`wait_for_ranking_update` のポーリング、当日スキップ判定、guard、Release 永続化
- push / workflow_dispatch トリガーの挙動
- **JST 9:05 より前に取得を開始しないこと**（早く起動しても待機で吸収されること）

## 3. 設計

### 3.1 cron（現行1本を2本に置換）

```yaml
  schedule:
    # 公式更新は JST 9:00、取得窓は JST 9:05（jst_schedule.JST_FETCH_*）。
    # GitHub のスケジューラ遅延は実測で中央値 +58分・最大 +223分(同リポ Navigator)。
    # 遅れて到着しても待機で吸収できるよう、取得窓に対して十分な余裕を取る。
    - cron: "0 20 * * *"   # JST 5:00 — 余裕 245分（実測最大 +223分をカバー）
    - cron: "0 22 * * *"   # JST 7:00 — 余裕 125分（0 20 がドロップした日の保険）
```

**`0 23`（現行）は削除する。** 根拠:
1. 余裕65分＝**今朝破綻した設定そのもの**。`0 22`（125分）が完全に上位互換で残す意味がない
2. `0 23` は **JST 8:00** 発火。その時刻に `0 20` が待機中・`0 22` が pending だと、**ユーザーが朝 push した run が `0 23` に evict される**（`cancel-in-progress: false` でも pending は1本しか保持されない）。削除でこの窓が消える

**残余リスク**: `0 20` と `0 22` が両方ドロップした日は取得が Retry 梯子（現状 JST 12:33）まで落ちる。**これは現状の最悪ケースと同じで悪化しない**。②（Retry 前倒し）と ①-c で別途潰す。

### 3.2 `timeout-minutes` の明示

待機が最大4時間になるため、既定の 360分に暗黙依存させない。`jobs.build` に **`timeout-minutes: 330`** を明示する（待機 最大4時間5分 + 取得・エクスポート実測約30分 に対し十分、かつ6時間の GitHub 上限より内側で異常時に早く落ちる）。

`jst_schedule.MAX_WAIT_SEC = 6h` は変更しない（JST 5:00 起動でも待機は最大4時間5分なので抵触しない）。

## 4. 受け入れ基準（数値で）

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | YAML 構文 | 正常にパース | `python -c "import yaml;yaml.safe_load(open('.github/workflows/maplen-board-pages.yml',encoding='utf-8'))"` |
| 2 | cron の本数と値 | **`0 20 * * *` と `0 22 * * *` の2本のみ**（`0 23` が存在しない） | `python -c "import yaml;print([c['cron'] for c in yaml.safe_load(open('.github/workflows/maplen-board-pages.yml',encoding='utf-8'))[True]['schedule']])"` |
| 3 | `timeout-minutes` | `jobs.build` に **330** | `grep -n 'timeout-minutes' .github/workflows/maplen-board-pages.yml` |
| 4 | **差分の局所性** | 変更は `on.schedule` と `jobs.build.timeout-minutes` **のみ**。**bot/web/DB/concurrency/permissions/env に差分0** | `git diff -w -- .github/workflows/maplen-board-pages.yml` を目視 + `git diff -w --stat`（**1ファイルのみ**） |
| 5 | bot テスト | 全緑（**現状 175 passed** から減らない） | `cd exp_ranking/bot && python -m pytest` |
| 6 | web ビルド | 成功 | `cd exp_ranking/web && npm run build` |

### 4.1 本番反映後の観測基準（統括が検証。実装担当の完了条件には含めない）

| # | 基準 | 目標値 |
|---|------|--------|
| 7 | 翌朝の schedule run のキュー時刻 | `0 20` 由来の run が **JST 9:05 より前**にキューされている |
| 8 | **取得窓に対するマージン** | `Fetch` ステップ開始 → JST 9:05 が **60分以上** |
| 9 | 取得開始時刻 | ログに `JST fetch window open` が出て、**取得は JST 9:05 以降**（前倒し取得が起きていない） |
| 10 | データ | `latestSnapshotDate` が前日・`characterCount` が前日比で妥当（±100以内の増減）・cap 警告0件 |
| 11 | サイト更新時刻 | 公開 v2 の `updatedAt` が **JST 9:40 以前** |
| 12 | 2本目の cron | `0 22` 由来の run が存在する場合、**当日スキップで約20秒**で終了（二重取得していない） |

## 5. 停止条件

以下に該当したら**実装を止めて選択肢+推奨付きで統括に報告**する:

- YAML の `on.schedule` 以外に手を入れないと基準を満たせない
- `timeout-minutes` の追加が既存ジョブ定義と衝突する（既に設定済み等）
- **cron を変えるだけでは JST 9:05 前の到着が保証できないと判明した**（例: `MAX_WAIT_SEC` や他の時刻定数に抵触する）
- bot テストが赤になる（本計画は bot を触らないので、赤は前提崩れ）
- スコープ外のファイルを触る必要が生じた

## 6. コミット分割

**1コミットのみ**（cron と timeout は同一の意図＝「先行起動バッファの確保」であり、分けると片方だけ revert された中途半端な状態が生まれる）。

1. `ci(pages): 先行起動を JST 5:00/7:00 の2本にしてバッファを245分へ拡張 + timeout-minutes を明示`

## 7. 検証コマンド

```
python -c "import yaml;d=yaml.safe_load(open('.github/workflows/maplen-board-pages.yml',encoding='utf-8'));print([c['cron'] for c in d[True]['schedule']]);print('timeout',d['jobs']['build'].get('timeout-minutes'))"
cd exp_ranking/bot && python -m pytest
cd exp_ranking/web && npm run build
git diff -w -- .github/workflows/maplen-board-pages.yml
git diff -w --stat
```

**改行コードノイズ混入禁止**: `git add -A` は使わず、`.github/workflows/maplen-board-pages.yml` のみ個別 add。

## 8. ロールバック

- 1コミットの単独 revert で完全に旧状態（`0 23` 1本・timeout 既定）へ戻る。
- **データ破壊の経路が存在しない**: 取得ロジック・DB・v2・Release に差分0。cron を戻せば挙動も戻る。
- 緊急時は revert を待たずに **`workflow_dispatch`（`force_fetch=true`）で即時取得**できる（今朝実証済み）。

## 9. 完了報告テンプレ

- 実施コミット（ハッシュ）:
- 受け入れ基準 §4 の実測値（1〜6 の全行）:
- `git diff -w` の全文（差分が `on.schedule` と `timeout-minutes` に限定されている証明）:
- bot pytest の passed 件数:
- **未push・本番未反映の明示**:
- 残課題・watch-item:
