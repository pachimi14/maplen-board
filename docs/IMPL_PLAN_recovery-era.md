# IMPL_PLAN_recovery-era — v2シャード復旧の era 対応(B')

> 1計画書=1縦切りテーマ(PR-001)。テーマ=**「災害復旧の era 正確性」**。前段の `IMPL_PLAN_exp-table-era.md`(出荷済み merge `79ef279`)の後続。
> 承認者: ユーザー(2026-07-27 着手承認・`sqlite_storage.py` へのスコープ拡大を含む) / 実装: implementer / 統括が code-review+実測で検収。
> 参照: DECISION_LOG LULU-054(保守的fallback・過大ゼロ)/ LULU-057 / LULU-060 / LULU-062(前段)。

## 0. 目的と背景

- **要件を一文で**: v2シャード災害復旧が **era(2026-07-23 の20%減)をリンク単位で正しく扱い**、`dailyGain` を過大復元しないようにする。
- **なぜ必要か**: 前段(gain の era 対応)を出荷した結果、**復旧側が単一テーブルで逆算するため不整合が発生**。統括の実測で **dailyGain の過大 27,372/359,271(7.62%)・最大3.07倍**(例 Benjapol 2026-07-20 真値 1,179,837,974,224 → 復元 2,038,875,777,215)。**T12 P1 が docstring で保証していた「dailyGain を過大復元しない」が破れている**。
- **現状の抑止**: 復旧ゲート `SNAPSHOT_IMPORT_FROM_V2_SHARDS` は**既定 OFF**、該当3テストは理由付き `xfail`(strict)。上位に**ロスレス3層**(actions cache / Release `db-store` / git db.gz)があるため実害は休眠中。
- **期限**: 境界(07-22)が90日窓から外れる **2026-10-20** で問題は自然消滅するが、それに頼らず閉じる。

### 実装前に証明済みの事実(統括が実施・read-only)
リンク単位の exp 算術で **373,022点を復元し、真DBと不一致 0・過大 0**(chain break=735 は既知の `gain=None` 点)。→ **B' は近似ではなく厳密**。証明スクリプト: `scratchpad/prove_bprime.py`(再利用可)。

## 1. スコープ

**触るもの**
- `exp_ranking/bot/v2_recovery_backward.py` — running progress アキュムレータを**リンク単位の exp 算術**へ置換 + ガード再設計
- `exp_ranking/bot/sqlite_storage.py` — **`~804` / `~844` / `~1153` の3箇所のみ**(単一 meta テーブルの強制をやめ、行/リンク単位で `exp_table_for(snapshot_date)` を使う。**`844` の percent→exp 経路も同じ era バグを持つ**)
- `exp_ranking/bot/level_exp.py` — `exp_table_for()` の**内部を (発効日, テーブル) の順序付きリストに一般化**(約10行。**意味論は一般化しない**)
- `exp_ranking/bot/test_v2_shard_recovery.py` — **3件の `xfail` を解除し本来の assertion に戻す**
- テスト追加

**触らないもの**
- `analysis.py` / `mvp_export.py`(前段で era 対応済み・**出力は不変**)
- 取得ロジック(`main.py` fetch=LULU-004)/ **v2 スキーマ**(形式変更なし。`snapshotDate` が era を決定するので per-point era 情報は**冗長=不採用**)/ DB / web
- **復旧ゲートは既定 OFF のまま**(挙動変更はフラグの内側に閉じる)

## 2. 設計(確定・逸脱禁止)

### 2.1 リンク単位の exp 算術(progress を持ち回らない)
```
exp_prev = exp_curr + Σ T_d[level_prev .. level_curr−1] − gain(d)
  T_d = exp_table_for(d)   ← d = 行き先日(= より新しい点)の snapshotDate
```
- **同レベルリンク**: Σ が空 → `exp_prev = exp_curr − gain`。**テーブルが式から消える**(era 判定すら不要)
- **レベルアップリンク**: 必要なのは **T_d のみ**。基底の掛け替えは発生しない
- **境界リンクも wake-up も厳密**: 公開 gain は「真の exp ペアに T_d 式を適用した値」として定義されているため、同じ式で反転すれば真の exp が返る(例: Lv252 exp=600B・gain=101B → 600B + 3,237B − 101B = **3,736B**=凍結値ズバリ)
- **チェーンで持ち回るのは `(level, exp)`**(raw・テーブル非依存)。progress は持ち回らない

### 2.2 ガードの再設計(**必須。ここが現行の穴**)
現行の `exp > 現行必要値 → None` は **wake-up の正解(3,736B > 新表3,237B)を拒否**してしまう。
→ **`0 ≤ exp_prev ≤ LEGACY[level_prev]`** に変更(**旧表は全 era を通じた厳密上界**。統括の実測で全382,749行が旧表を超えない=0件で裏付け済み)。違反時は従来どおり fallback。

### 2.3 fallback の era 対応
percent 反転は**その点の日付の era 表**で行う(pre-patch 点は旧表 / post-patch の overshoot 点は非クランプ percent>100 が新表とほぼ厳密に噛み合う)。**保守的(過大を出さない)性質は維持**。

### 2.4 era ルックアップの一般化(意味論は一般化しない)
`exp_table_for()` の内部を「(発効日, テーブル)の順序付きリスト」に。**ただしそこで止める** — 今回の式の正しさは実測された意味論(絶対exp保持・超過繰越・旧表=上界)に依存し、**必要値が「増える」改定では仮定が逆転する**。
→ **コメント+DECISION_LOG に明記**: 「新 era 追加時は不変条件(境界で exp 保持・旧表上界の0超過)を**実測で再検証**してからリストに追記する」。

### 2.5 安全弁とテレメトリ(安価・有効)
- `meta.expTableVersion`(**既存フィールド・形式変更不要**)を読み、**未知バージョンなら `logger.warning`**。
- `reconstruct_exp_backward` に **method census(exact / fallback / unrecoverable の件数)のログ出力**を追加 → 将来の実復旧が自身の健全性を自己申告する。
- `fallback="none"` モードは分析用に**温存**。

## 3. 受け入れ基準(スコープ付き・数値で)

> 統括の当初案「往復完全一致」は**強すぎて偽陽性で落ちる**(既知の `gain=None` 点で fallback に入り、その隣接 gain は公開値と一致しない=LULU-054 で受容済みの既存挙動)。以下に修正。

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | **exact 点の exp 完全一致** | 復元 exp = 真DB exp、**不一致 0**(参考実測: 373,022点) | 実DB突合(`prove_bprime.py` 相当) |
| 2 | **両端 exact リンクの往復一致** | 再エクスポート `dailyGain` = 公開 `dailyGain`、**不一致 0** | 往復ハーネス |
| 3 | **exp の過大復元** | **0件**(fallback 含む全点。T12 P1 保証の維持) | 全点突合 |
| 4 | **gain 過大の収束** | 現状 **27,372** → **fallback 隣接の少数**に収束(before/after を数値で報告) | 往復ハーネス |
| 5 | T12 P1 既存メトリクス | 表示文字列変化・gain-rank 変化を再測定し**悪化なし** | 既存手法 |
| 6 | **xfail 解除** | 3件の `xfail` を外し、**本来の assertion で緑** | `pytest` |
| 7 | bot テスト | **全緑**(xfail 0件) | `cd exp_ranking/bot && python -m pytest` |
| 8 | web | ビルド成功・既存テスト緑(**web は不触**) | `npm run build && npm run test` |
| 9 | 冪等性・additive | 2回実行で無変化・既存行を上書きしない(T12 P1 の保証維持) | 既存テスト |

## 4. 停止条件

- 基準1(exact 点の不一致0)が達成できない → 停止・報告(設計の穴の座標=落ちた点の (日付, level遷移, method))
- 基準3(exp 過大0)が破れる
- `sqlite_storage.py` の **3箇所を超える**変更が必要と判明した
- **v2 スキーマ変更**が必要と判明した(要事前承認)
- 取得ロジック(LULU-004)に触れる必要が生じた
- 復旧ゲートの既定を ON にしないと実装できない

## 5. コミット分割(単独 revert 可)

1. `level_exp.py`: `exp_table_for` の era リスト化(**追加のみ・挙動不変**)
2. `v2_recovery_backward.py`: リンク単位 exp 算術 + **ガードを旧表上界へ** + fallback の era 対応 + method census ログ
3. `sqlite_storage.py`: 3箇所(804/844/1153)を行/リンク単位の era 選択へ + `expTableVersion` 未知時の warning
4. `test_v2_shard_recovery.py`: **xfail 解除**+本来の assertion 復帰、基準1〜4の回帰テスト追加

## 6. 検証コマンド

```
cd exp_ranking/bot && python -m pytest              # 全緑・xfail 0
cd exp_ranking/web && npm run build && npm run test  # web 不触の確認
git diff -w -- <touched files>
# 実DB: prove_bprime.py / 往復ハーネスで基準1〜5 を実測
```

## 7. ロールバック

- 全コミット通常コミット=個別 revert 可。**DB・v2形式は不変**。
- 復旧ゲートが既定 OFF なので、revert しても本番挙動に影響なし(復旧は休眠中)。

## 8. 完了報告テンプレ

- 実施コミット(4分割のハッシュ):
- **基準1〜9 の実測値**(特に基準1の点数と不一致0、基準4の before/after):
- ガード再設計が wake-by 正解を通すことの実証:
- method census の出力例:
- `git diff -w` の要点・**未push/本番未反映の明示**:
- 残課題・watch-item:
