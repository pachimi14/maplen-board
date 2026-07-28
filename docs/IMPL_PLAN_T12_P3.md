# IMPL_PLAN_T12_P3 — 出血停止(git db.gz 日次コミットの停止 / Release を永続の正へ)

> `docs/IMPL_PLAN_T12.md` の **P3**。1計画書=1縦切りテーマ(PR-001)。
> 承認者: ユーザー / 実装: implementer / 統括が code-review+実測で検収。
> 前提: **P2 の観測ゲートは通過済み**(LULU-060 / 新規6日捕捉・3状態で8項目全一致・persist 7/7 成功)。

## 0. 目的と背景

- **要件を一文で**: `ranking.db.gz` の git 日次コミットを止め、**Release `db-store` を永続層の正**にして、リポジトリの増加を止める。
- **緊急度(実測)**: リモートリポは **3,512,299 KB(約3.51GB)**。1週間前の実測 1.92GB から **約200MB/日で増加中**(db.gz 約39MB × 1日3〜4コミット)。この推移だと**1週間程度で 5GB 域**に入る。**T12 の時限(2026-10-06)より前に実務上の限界が来る**。
- **参照**: LULU-009(T12 時限)/ LULU-060(P2 着地・ゲート条件)/ LULU-062(era 対応・B' により v2シャード復旧は厳密になった)。

## 1. スコープ

**触るもの**
- `.github/workflows/maplen-board-pages.yml` — 復元元を Release へ / **db.gz の git コミットを削除** / ガード追加
- `.github/workflows/maplen-board-navigator.yml` — 同上
- `.github/workflows/lulumi-ranking-retry.yml` — 復元元を Release へ
- `exp_ranking/bot/release_store.py` — 復元ヘルパの追加(必要なら)
- `exp_ranking/bot/merge_db_for_commit.py` — 参照ゼロになるなら削除
- ガード実装(bot 側の小スクリプト or workflow ステップ)+ テスト

**触らないもの**
- 取得ロジック(`main.py` の fetch/リトライ/スキップ=**LULU-004**)
- **v2 スキーマ**・web・`analysis.py`/`mvp_export.py`(era 対応済み)
- **`exp_ranking/bot/data/ranking.db.gz` ファイル自体は残す(凍結)**。履歴からの除去=サイズ回収は **P6**。P3 後は誰も読まないので stale データ事故は起きない
- v1 の廃止(= **P4**)。P3 の時点では `SNAPSHOT_IMPORT_FROM_PAGES` は現状維持

## 2. 設計(確定)

### 2.1 復元元の差し替え
3 workflow の「Preserve/Restore ranking database **from git**」を **Release からの取得**へ置換(`release_store.download_current_asset` を使用。**fail-closed の判定はそのまま活かす**)。取得後の additive-merge の意味論は現行どおり維持。

### 2.2 永続化を Release 単独へ
`commit-db` ジョブから **db.gz の git add / commit / push を削除**。**P2 で追加した Release persist ステップを唯一の永続化経路**にする。あわせて `continue-on-error: true` を**外す**(唯一の永続経路になるため、失敗は run を失敗させて可視化する)。

### 2.3 復旧の優先順(P3 の到達点)
```
① actions cache → ② Release db-store → ③ v1 Pages(P4で廃止) → ④ v2シャード → cold start
```
**`SNAPSHOT_IMPORT_FROM_V2_SHARDS=true` を workflow で明示的に有効化**する。根拠: B'(LULU-062②)で **全 374,121点ビット完全一致・過大0** を実証済み。git 層を外す代わりに**最後尾の層を有効化**して層数を維持する。

### 2.4 【必須・新規】切り詰め公開を防ぐガード(**仕様確定・実装裁量なし**)
**現状 git db.gz が「復元失敗時の最後の砦」であり、外すと「復元に失敗したまま部分DBで公開する」経路が生まれる**(既存の `SKIP_RUN_MIN_SNAPSHOT_ROWS` は当日行数の話でありこれを防げない)。

**実行位置(確定)**
- **cache・Release・v1・v2 による復元がすべて完了した後**に実行する。
- **ランキングAPI取得・Pages export・Release persist より前**に実行する。
- 発火時は **Pages を更新しない・Release を上書きしない**(run を fail させる)。

**期待下限の取得元(確定・優先順)**
1. **第一基準 = 現在公開中の v2 メタデータの `snapshotDays`**(`https://lulumi-tools.com/data/v2/rankings.json` の `meta.snapshotDays`)
2. **利用可能なら、直近の正常 Release DB の `snapshot_days` も照合**(両方取れたら**大きい方**を基準にする)
3. **絶対最低ライン = 30日**(上記が 30 未満を示しても 30 を下回る復元は許さない)
4. **信頼できる基準値がどれも取得できない場合は fail-closed**(=run を失敗させる。「基準が無いから通す」は禁止)

**判定内容(確定)**
- **`snapshot_days`**: 復元後の値が `max(第一基準, 直近正常Release, 30) − 2` を下回ったら発火(−2 は保持期間境界による正常な増減の許容)。
- **総行数**: **固定値で判定しない**。**直近正常値に対する割合**(例: 90% 未満で発火)**または日別分布**(直近 N 日の1日あたり行数が既知分布から外れる)で判定する。閾値の根拠を実装コメントに残す。

**ログ(確定・すべて出力)**
- **ガード発火理由**(どの判定で落ちたか)
- **復元方法**(cache / Release / v1 / v2 のどれで復元されたか=method)
- **実測値**(復元後の `snapshot_days`・総行数・日別分布の要点)
- **期待下限**(採用した基準値とその出所)

**補足**: Release 側の保護は既に存在(`download_current_asset` の fail-closed により、取得不明失敗時は persist が例外で止まり Release を上書きしない)。本ガードは **Pages 公開の切り詰め**を防ぐためのもの。

### 2.5 不要物の整理
`merge_db_for_commit.py` が参照ゼロになるなら削除。workflow 内の dead step(git-db-source のログ等)も除去。

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | **db.gz コミットの停止** | P3 後の run で db.gz コミット **0件**(数日観測) | `git log -- exp_ranking/bot/data/ranking.db.gz` |
| 2 | Release からの復元 | ログで復元成功が確認でき、**snapshot_days が前日+1で連続**(欠落0) | run ログ + DB 検査 |
| 3 | 公開データの無切り詰め | 公開 v2 の `snapshotCount`/`snapshotDays` が **DB と一致** | 本番 v2 と Release DB の突合 |
| 4 | **ガードの実証** | Release 不達 + cache miss を模した条件で **run が fail**、かつ **Pages 未更新・Release 未上書き** | 合成条件での dispatch もしくは単体テスト |
| 5 | retry workflow | Release 経路で正常動作 | run 成功 |
| 6 | bot テスト | 全緑 | `cd exp_ranking/bot && python -m pytest` |
| 7 | **リポ増加の停止** | 数日後のリモートサイズが**基準 3,512,299 KB から実質増えない**(db.gz 由来の増分0) | `gh api repos/... --jq .size` |
| 8 | v2シャード層の有効化 | `SNAPSHOT_IMPORT_FROM_V2_SHARDS=true` が効き、**通常運用では発火しない**(cache/Release で足りるため) | run ログの census |

### 3.1 必須の復旧シナリオ検証(ユーザー指定・全件)

| # | シナリオ | 期待 |
|---|----------|------|
| S1 | **通常時** | cache **または** Release で復元され、**v2 import が発火しない**(census で確認) |
| S2 | **cache miss + Release 成功** | Release から復元・正常完了 |
| S3 | **cache miss + Release 不達 + v2 成功** | v2シャードから復元・正常完了(B' の厳密復元) |
| S4 | **cache miss + Release 不達 + v2 不完全** | **ガード発火**(§2.4)で run が fail |
| S5 | ガード発火時 | **Pages 未更新** |
| S6 | ガード発火時 | **Release 未上書き** |
| S7 | db.gz | **git コミットが 0件** |
| S8 | retry workflow | **Release 経路で成功** |
| S9 | ローカル bat | **影響を受けない**(`run_fetch.bat` / `run_local_dev.bat` / `run_local_preview.bat` が db.gz 非依存であることを再確認) |
| S10 | `SNAPSHOT_IMPORT_FROM_PAGES` | **P3 では現状維持**(v1 廃止は P4) |
| S11 | 不変領域 | **取得ロジック・v2形式・web・DBスキーマに触れない**(`git diff` で0) |

## 4. 停止条件

- Release からの復元が**安定して成功しない**(P3 の前提が崩れる)
- ガード(§2.4)を実装しても「切り詰め公開」を防げない経路が残る
- **db.gz コミットを止めると他に壊れる箇所が見つかった**(ローカル bat は db.gz 非依存を確認済みだが、他に発見したら報告)
- 取得ロジック(LULU-004)に触れる必要が生じた
- v2 シャードゲートを有効化すると通常運用で予期せぬ import が走る

## 5. コミット分割(**確定順序・各段階で単独 revert 可**)

> **原則: 復旧層を先に増やしてから git 層を外す**(ユーザー指示 2026-07-27)。

| # | 内容 | 性質 |
|---|------|------|
| 1 | **切り詰め公開防止ガードの追加**(§2.4)+ テスト | 挙動不変(安全網の先行投入) |
| 2 | **復元元を Release へ差し替え**(3 workflow)。**この段階では db.gz の git コミットも継続** | 両系並行=安全 |
| 3 | **v2シャードゲートを有効化**(`SNAPSHOT_IMPORT_FROM_V2_SHARDS=true`) | 復旧層を1つ増やす |
| 4 | **cache miss・Release不達時の fallback を実証**(検証専用。テスト/合成条件の追加) | 検証のみ |
| 5 | **db.gz の git コミットを停止** | **出血停止本体**(ここで初めて git 層を外す) |
| 6 | **persist の `continue-on-error` を除去** | 唯一の永続経路の失敗を可視化 |
| 7 | 不要物整理(`merge_db_for_commit.py`・dead step) | クリーンアップ |

**各コミットの後に検証を回し、単独 revert 可能であることを確認する**(特に 5 を revert すれば git コミットが即再開すること)。

## 6. 検証コマンド

```
cd exp_ranking/bot && python -m pytest
# workflow の構文: python -c "import yaml,sys; yaml.safe_load(open(...))"
git diff -w -- .github/workflows/ exp_ranking/bot/
git log --oneline -- exp_ranking/bot/data/ranking.db.gz   # P3 後に増えないこと
gh api repos/pachimi14/maplen-board --jq '.size'          # 基準 3512299 KB
```

## 7. ロールバック

- 各コミット単独 revert 可。**workflow を revert すれば db.gz の git コミットが再開**する(=出血は戻るがデータは安全)。
- **DB・v2 形式・公開データの契約は不変**。Release アセットは additive-merge のみで退行しない。

## 8. 完了報告テンプレ

- 実施コミット(4分割のハッシュ):
- 受け入れ基準の実測値(§3 全8行):
- **ガード発火の実証**(条件・run の失敗・Pages/Release が変更されないこと):
- run ログの要点(Release 復元・method census・db.gz コミットなし):
- `git diff -w` の要点・**未push/本番未反映の明示**:
- 残課題・watch-item(P4/P5/P6 への申し送り):
