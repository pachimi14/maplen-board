# IMPL_PLAN_cron-redundancy — cron のドロップ耐性を上げる(Pages 4本化 + Retry を24時間へ分散)

> 1計画書=1縦切りテーマ(PR-001)。**進行中のデータ欠損リスクへの対処**のため優先。
> 承認者: ユーザー(2026-08-28 承認。cron 変更=ユーザー専権事項)/ 実装: implementer / 統括が検収。
> 関連: LULU-109(①-b の効果測定と cron ドロップの発見)。**①-c(待機役と実行役の分離)は本計画に含めない**(後続)。

## 0. 目的と背景

- **要件を一文で**: **GitHub のスケジューラが cron を落としても、その日の取得が必ずどこかで成立するようにする。**

### 何が起きたか(実測)

①-b(LULU-109、`7 20`/`7 22` の2本化)は**当初きわめて良好に機能していた**が、**2026-08-26 を境に GitHub 側が急激に悪化**した:

| 日 | Pages schedule の発火 |
|---|---|
| 08-21〜08-25 | **2本とも発火**・遅延 +23〜31分(予算238分の**13%**) |
| 08-26 | **1本のみ**(+68分) |
| 08-27 | **1本のみ**(+298分) |
| **08-28** | **0本**(`7 20` が +310分、`7 22` が +190分 経過して未発火。キューも空) |

**3日連続で悪化し、当日はゼロ**。統括が手動 dispatch して `2026-08-27` を救出した(8,804件・`snapshotDays` 89→90)。**放置すれば 2026-08-29 09:00 JST を過ぎた時点で永久欠測**だった。

### 安全網も効いていなかった(実測)

Retry の cron 3本のうち **`40 0`(JST 9:40)は過去50本で発火0件**。LULU-109 で「落ちているのは `20 2`」と推定したのは**誤りで、実際は先頭の `40 0`** だった。平常時に走るのは2本だけ:

| cron(意図) | 実際の発火 |
|---|---|
| `40 0`(JST 9:40) | **発火せず** |
| `20 1`(JST 10:20) | 02:05〜02:11Z = JST 11:05〜11:11 |
| `20 2`(JST 11:20) | 02:32〜02:40Z = JST 11:32〜11:40 |

→ **「JST 9:40 の防衛線」は実在せず、最初の安全網は JST 11:05**。しかもそれは Pages を dispatch するだけで、実取得はさらに後。

### ★本計画の中核となる発見

**Retry の判定は「UTC の前日」を対象にしており、UTC 日中いつ走っても正しく機能する**(`lulumi-ranking-retry.yml` の `target_day = utcnow().date() - 1day`、`row_count < 1000` で dispatch)。

つまり **1日分の取得には実質24時間の猶予がある**のに、**現在の試行は全部が最初の2.5時間(00:40〜02:20Z)に集中している**。ここが最大の設計上の穴。

## 1. スコープ

**触るファイル(2つだけ)**
- `.github/workflows/maplen-board-pages.yml` — `on.schedule.cron`
- `.github/workflows/lulumi-ranking-retry.yml` — `on.schedule.cron`

**触らないもの**
- **bot コード一切**(`jst_schedule.py` の `MAX_WAIT_SEC` / `main.py` の取得・リトライ・スキップ判定 = LULU-004)
- `timeout-minutes`(現行 330 のまま。§2.1 の安全域内に収める)
- `concurrency` ブロック(①-c で扱う)
- Retry の判定ロジック本体(`target_day` / `MIN_SNAPSHOT_ROWS` / dispatch 部)
- web / DB / v2 スキーマ / Release / guard / backup-gdrive

## 2. 設計

### 2.1 Pages: 2本 → 4本(**既存の安全域内でのみ増やす**)

```yaml
  schedule:
    - cron: "7 20 * * *"   # JST 5:07 — 取得窓まで 238 分
    - cron: "7 21 * * *"   # JST 6:07 — 178 分   ← 追加
    - cron: "7 22 * * *"   # JST 7:07 — 118 分
    - cron: "7 23 * * *"   # JST 8:07 —  58 分   ← 追加
```

**なぜ 20:07Z より前に増やさないか(実測で確定した制約)**:

| cron | 待機時間 | `MAX_WAIT_SEC`=360分 | `timeout-minutes`=330(+取得25分) |
|---|---|---|---|
| `7 18` | 358分 | OK | **NG(超過)** |
| `7 19` | 298分 | OK | OK(余裕7分・危険) |
| **`7 20`** | 238分 | OK | OK |
| **`7 21`** | 178分 | OK | OK |
| **`7 22`** | 118分 | OK | OK |
| **`7 23`** | 58分 | OK | OK |

さらに **`MAX_WAIT_SEC` を超えると `wait_until_jst_fetch_window` は「警告して取得へ進む」**実装なので、**取得窓の前に取りに行き、`validate_ranking_freshness` が stale として run を失敗させる**。よって早すぎる cron は**害**になる。bot を触らずに増やせるのは **20:07Z 以降だけ**。

### 2.2 Retry: 3本 → 5本(**24時間に分散**。これが本命)

```yaml
  schedule:
    # 朝の防衛線(実測: 01:20 は JST 11:05 頃、02:20 は JST 11:35 頃に発火)
    - cron: "20 1 * * *"
    - cron: "20 2 * * *"
    # 日中〜夜の最終防衛線(追加)。target_day は「UTCの前日」なので
    # UTC 日中いつ走っても同じ日を救済できる。取得の締切は翌 UTC 00:00。
    - cron: "0 6 * * *"    # JST 15:00  ← 追加
    - cron: "0 12 * * *"   # JST 21:00  ← 追加
    - cron: "0 18 * * *"   # JST 翌 3:00 ← 追加
```

**`40 0`(JST 9:40)は削除する**。過去50本で発火0件=存在しない防衛線であり、**あると「9:40 に守られている」という誤った安心を生む**(実際に統括がその誤解のもとで LULU-109 を書いた)。

**追加分が安全な理由**: Retry は「DB に当日分が1000行未満なら Pages を dispatch」するだけ。既に取得済みなら**ログを出して終わる no-op**。Pages 側も当日取得済みならスキップするため、**二重取得は構造的に起こらない**。

### 2.3 本計画で解決しないこと(明記)

- **遅延そのものは減らない**。増やしているのは「当たりくじの本数」であり、GitHub のスケジューラ挙動は変えられない
- **全 cron が同時にドロップする日**は依然として救えない → その場合の根本解は**外部トリガ(cron-job.org 等から `workflow_dispatch`)**。PAT 管理という新しい故障クラスを買うため本計画には含めず、**本計画の観測結果を見てから判断する**

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | workflow YAML | 3本とも構文正常 | `yaml.safe_load` |
| 2 | **Pages の cron** | **`7 20`/`7 21`/`7 22`/`7 23` の4本ちょうど** | YAML パースして一覧 |
| 3 | **Retry の cron** | **`20 1`/`20 2`/`0 6`/`0 12`/`0 18` の5本ちょうど**(`40 0` が存在しない) | 同上 |
| 4 | **待機時間の安全域** | Pages の全 cron で **待機 ≤ 238分**(< `MAX_WAIT_SEC` 360、かつ +取得25分 < `timeout-minutes` 330) | 計算して確認 |
| 5 | **差分の局所性** | 変更は 2 workflow の `on.schedule` **のみ**。bot/web/DB/concurrency/permissions/env/timeout に**差分0** | `git diff -w --stat`(**2ファイルのみ**)+ 目視 |
| 6 | bot テスト | 全緑(**現状 233 passed, 1 skipped** から減らない) | `cd exp_ranking/bot && python -m pytest` |
| 7 | web ビルド | 成功 | `cd exp_ranking/web && npm run build` |

### 3.1 本番反映後の観測基準(統括が実測。実装担当の完了条件には含めない)

| # | 基準 | 目標値 |
|---|------|--------|
| 8 | **取得の成立** | 7日間、**毎日 `snapshotDays` が1ずつ増える**(欠測0)。これが唯一の本質的基準 |
| 9 | Pages cron の発火本数 | 1日あたり **1本以上**(4本中)。0本の日が出たら §2.3 の外部トリガを再検討する数値トリガ |
| 10 | 早朝取得の維持 | 平常日は `updatedAt` が **JST 10:00 以前**(4本中いちばん早いものが拾えている) |
| 11 | **追加 Retry の無害性** | 日中の Retry が発火した際、当日取得済みなら **dispatch せず終了**(ログに `No retry needed`)。二重取得0 |
| 12 | 待機超過の非発生 | ログに `Stopped waiting for JST fetch window` の警告が **0件** |

## 4. 停止条件

- YAML の `on.schedule` 以外に手を入れないと基準を満たせない
- **`timeout-minutes` や `MAX_WAIT_SEC` を変えないと成立しない cron 構成**になった(=安全域を出ている。設計をやり直す)
- Retry の判定ロジックに手を入れる必要が生じた
- bot テストが赤になる(本計画は bot を触らないので、赤は前提崩れ)
- スコープ外のファイルを触る必要が生じた

## 5. コミット分割

**1コミット**(Pages と Retry の cron は「ドロップ耐性を上げる」という同一の意図であり、片方だけ revert された状態に意味が無い)。

1. `ci: cron のドロップ耐性を上げる(Pages 4本化 + Retry を24時間へ分散)`

## 6. 検証コマンド

```
python -c "import yaml;d=yaml.safe_load(open('.github/workflows/maplen-board-pages.yml',encoding='utf-8'));print('pages:',[c['cron'] for c in d[True]['schedule']]);print('timeout:',d['jobs']['build'].get('timeout-minutes'))"
python -c "import yaml;d=yaml.safe_load(open('.github/workflows/lulumi-ranking-retry.yml',encoding='utf-8'));print('retry:',[c['cron'] for c in d[True]['schedule']])"
cd exp_ranking/bot && python -m pytest
cd ../web && npm run build
git diff -w -- .github/workflows/
git diff -w --stat
```

**改行コードノイズ混入禁止**: `git add -A` は使わず、触った2ファイルのみ個別 add。

## 7. ロールバック

- 1コミットの単独 revert で完全に旧状態に戻る。
- **データ破壊の経路が存在しない**: 取得ロジック・DB・v2・Release に差分0。cron を戻せば挙動も戻る。
- 緊急時は revert を待たず **`workflow_dispatch`(`force_fetch=true`)で即時取得**できる(2026-08-28 に実証済み)。

## 8. 完了報告テンプレ

- 実施コミット(ハッシュ):
- 受け入れ基準 §3 の実測値(1〜7 の全行):
- `git diff -w` の全文(差分が 2 workflow の `on.schedule` に限定されている証明):
- bot pytest の passed 件数:
- **未push・本番未反映の明示**:
- 残課題・watch-item:
