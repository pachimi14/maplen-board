# IMPL_PLAN_T12 — ranking.db 永続層の刷新 + git 履歴整理(統合計画・一括完了)

> **本計画は分割しない。** 1計画書・1承認・**1つの最終完了条件**で T12 全体を管理する(ユーザー指示 2026-07-20)。
> 内部の安全な実装単位(フェーズ)への分割は可。ただし「一部フェーズだけ完了させ残りを後続タスクへ送る」ことは禁止。
> 承認者: ユーザー / 実装: implementer(統括が計画承認後に発注) / 統括が code-review+実測で検収。

## 0. 目的と背景

- **要件を一文で**: ranking.db の永続を「git 毎日コミット(履歴に永久堆積)」から「GitHub Releases 単一 Asset + v2シャード復旧」へ移し、**リポの出血を止め・既存 1.9GB を回収し・v1(62MB)を完全廃止**する。挙動(配信データ・UI)は不変。
- **北極星への寄与**: 直接の新機能ではない技術的負債返済だが、**リポ肥大(clone/CI/将来のモノレポ統合を圧迫)を解消**し、毎朝のデータ供給パイプラインの持続可能性を守る。
- **参照する決定**: LULU-009(T12 時限〜2026-10-06・force push はユーザー専権)/ LULU-015(v1 は復旧入力でもある・v2+シャード移行とセットで廃止)/ LULU-040(静的配信が正・VPS を配信経路に入れない)/ LULU-043(履歴書換は静穏窓)/ LULU-053(T12 は統合計画として実施・単一書き手誤認の訂正)。
- **実測(2026-07-19 時点)**: リモート 1.92GB・~64MB/日成長・**97% が db.gz**(履歴上62 blob=1.93GB)。回収後は 300MB 未満見込み。時限まで残り約2.5ヶ月。

## 1. スコープ(統合=以下すべてを本計画の完了条件に含む)

触るもの:
- `.github/workflows/maplen-board-pages.yml` / `maplen-board-navigator.yml` / `lulumi-ranking-retry.yml`(db.gz 依存の除去 + Release Asset の read/write 化)
- `exp_ranking/bot/`: 復旧経路(`main.py` の DB 復旧まわり・`config.py`・`sqlite_storage.py`)へ **v2シャード復旧の追加**、v1 復旧経路の撤去。**取得ロジック(fetch/リトライ/スキップ判定)は不触**(LULU-004)。
- Release Asset 運用(`db-store` タグ・単一 `ranking.db.gz`)を read/write するスクリプト/ステップ。
- ローカル bat(`run_fetch.bat` 等)の v2 対応(scope④)。
- v1 生成停止・配信停止(scope⑤⑥)+ 不要になった旧処理・旧ファイル撤去。
- git 履歴書き換え(db.gz blob 除去=既存 1.9GB 回収、scope=T12b 相当)。
- `docs/DECISION_LOG.md` 更新。

触らないもの:
- 取得ロジック本体(公式API fetch・リトライ・スキップ・レート制御)。
- web の UI/配信データ契約(rankings.json / v2シャードの**読み手が見る内容は不変**)。
- VPS(T7 img-proxy 等)。

## 2. 設計不変条件(6問レビューで確定・**逸脱禁止**)

| # | 不変条件 | 根拠 |
|---|---------|------|
| INV-1 | **本番 rankings.json の発行は pages workflow 単独**。Release Asset は DB ストアであって配信経路に入れない | 過去の navigator 上書き事故の修正(1b344cd db-only)を保持。LULU-040 |
| INV-2 | **Release への書込は必ず「現 Asset を download → additive-merge → `--clobber` upload」**。blind clobber 禁止 | 退行防止。Q1〜Q4 の回答 |
| INV-3 | **additive merge = `INSERT OR IGNORE`(既存行を上書き/退行させない)** を維持。書き手は pages・navigator の両方(単一書き手にしない) | `merge_ranking_databases` 現行意味論。LULU-053 |
| INV-4 | pages/navigator は `concurrency: group: maplen-board-pages` で**直列化**を維持 | 二重 clobber 防止 |
| INV-5 | v2シャードからの DB 再構成が「actions/cache evict かつ Release 欠落」でも**90日DB を復元できる**ことを実証してから v1 復旧を撤去 | LULU-015。撤去順序の安全性 |
| INV-6 | 履歴書き換え(force push)は**全 in-flight PR マージ済みの静穏窓**で、**CI(pages/navigator の main 直コミット)を一時停止**し、**全 worktree を再作成**してから実施。実行はユーザー専権 | LULU-043 / LULU-009 |

## 3. 実装フェーズ(内部分割・完了は全フェーズ達成をもって1回)

> フェーズは安全な実装順序。**各フェーズ単体で「T12完了」とはしない**。全フェーズ green + §5 全基準達成が唯一の完了条件。

- **P1(復旧の土台・挙動不変)**: v2シャード→DB 再構成(`import_snapshots_from_v2_shards` 等)を実装。既存の v1/git/cache 復旧と**並存**させ、INV-5 を満たすことをテストで実証(この時点では何も撤去しない)。
- **P2(耐久層の移行・挙動不変)**: Release Asset `db-store/ranking.db.gz` を新設・初回シード。pages/navigator の `commit-db` を「Release download→additive-merge→--clobber」へ置換(INV-2/3/4)。**git db.gz コミットは残す**(両系並行=安全網)。
  **P2→P3 完了ゲート(具体・全条件成立で初めて P3 を許可。曖昧な「数日」ではない)**:
  - **run 数**: pages が **snapshot をコミットする正常完了 ≥3 回**(=3 取得日をまたぐ)、かつ **navigator 正常完了 ≥1 回**(worldId 反映経路を検証)。
  - **各 run 後**、Release 版 DB と git db.gz 版 DB を両方復元し、**以下の全項目が一致**(不一致0):
    - (a) `ranking_snapshot`: 総行数 / `COUNT(DISTINCT snapshot_date)`(=snapshot_days) / `MAX(snapshot_date)`(最新日) / 最新日の行数
    - (b) `character_meta`: 総行数 / `world_id != ''` の件数(navigator の寄与)
    - (c) `app_meta`: `last_ranking_fetched_at` の値
    - (d) 強検証: `ranking_snapshot` を `(snapshot_date, rank)` 順に整列した内容ハッシュの一致
  - **1項目でも不一致なら P3 に進まず停止報告**(§6)。取得スキップ run(snapshot 追加なし)は両系が no-op で一致することのみ確認し、run 数にカウントしない。
- **P3(出血停止)**: git db.gz コミットを停止・除去。復旧の優先順を「cache → Release → v2シャード」へ。retry の db.gz 参照を Release/cache へ差し替え。
- **P4(v1 廃止・scope⑤⑥)**: INV-5(v2シャード復旧の最悪ケース復元)実証済みを前提に、v1 の生成・配信・復旧参照を撤去。**対象を実パス・参照元付きで確定**:
  - **廃止する v1 ファイル**: `exp_ranking/web/public/data/rankings.json`(生成元=pages workflow の `MVP_JSON_OUTPUT_PATH: ../web/public/data/rankings.json`。生成を停止)+ `exp_ranking/web/public/data/rankings.json.bak`。配信停止(Pages 成果物から除外)。※両者とも `.gitignore`(13–14行)=CI 生成物。
  - **現在 Web UI が読むランキングデータ**: `data/v2/rankings.json`(`exp_ranking/web/src/board/useRankingBoard.js:315` の唯一候補 `["data/v2/rankings.json"]`)+ `data/v2/history/shard-00.json`〜`shard-63.json`(`exp_ranking/web/src/historyData.js:5`、64分割)。**= UI は v1 を読まない**(QW/LULU-016 で v1 フォールバック撤去済み)。
  - **v2シャードのファイル**: `data/v2/rankings.json`(サマリ)+ `data/v2/history/shard-NN.json`(`HISTORY_SHARD_COUNT=64`、`mvp_export.py`)。`.gitignore`(15行)=CI 生成物。
  - **復旧専用として参照しているファイル**: v1 `https://lulumi-tools.com/data/rankings.json`(`MVP_PAGES_RANKINGS_URL` → `main.py` の `import_missing_snapshots_from_url`)。**P1 で v2シャード復旧へ置換**し、P4 で本参照を撤去。
  - **P4 後も残る公開データ**: `data/v2/rankings.json` + `data/v2/history/shard-*.json`(= UI が読む配信データ=**不変**)。
  - **P4 後に削除される公開データ**: `data/rankings.json`(v1)+ `rankings.json.bak`。
  - **「v1 を生成も配信もしない」と「UI/配信データ契約は不変」が矛盾しないことの明記**: 両者は**異なるファイルを指すため両立する**。UI の配信契約は `data/v2/*` のみで**不変**。v1 `data/rankings.json` は UI 非参照の**復旧専用**であり、その役割は P1 の v2シャード復旧が引き継ぐ。したがって v1 廃止は UI/配信契約を一切変えない。
- **P5(ローカル整合・scope④)**: ローカル bat の v2 対応。
- **P6(履歴書き換え・scope=1.9GB回収, INV-6)**: 静穏窓で CI 停止→`git filter-repo` 等で db.gz blob 除去→force push(**ユーザー専権**)→全 worktree 再作成→リポサイズ実測。
- **P7(整合・撤去の最終掃除)**: 3 workflow の整合確認、不要になった step/スクリプト/キャッシュキーの撤去、DECISION_LOG 更新。

## 4. 変わってよいもの・いけないもの

- **変わってよい**: DB の永続先(git→Release)・復旧の入力源・リポサイズ・workflow の内部ステップ・ローカル bat の手順。
- **変わってはいけない**: 配信データ(rankings.json / v2シャード)の**読み手が見る内容**・UI 挙動・公式API 取得ロジック・「navigator は本番を発行しない」不変条件・毎日のスナップショット取得の成否率。

## 5. 受け入れ基準(数値で・**全行達成が唯一の完了条件**)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | bot テスト | 全緑 | `cd exp_ranking/bot && python -m pytest` |
| 2 | web テスト+build | 全緑・成功 | `cd exp_ranking/web && npm run build`(+ 既存 vitest) |
| 3 | v2シャード復旧の実証 | cache無+Release無の合成条件で 90日DB を復元(snapshot_days=90 前後・行数≥閾値) | P1 の統合テスト(合成fixture) |
| 4 | Release additive-merge の退行なし | 古いDBで clobber しても現Asset行が保持(union 単調増加) | 合成テスト(fresh→stale の順で merge) |
| 5 | 出血停止 | P3後、main への db.gz コミットが0/日(数日観測) | git log 監視 |
| 6 | v1 完全廃止 | rankings.json(v1)を生成も配信もしない・参照0 | ネットワーク/ビルド生成物確認 |
| 7 | リポサイズ回収 | 書換後リポ < 400MB(1.92GB から) | `git count-objects -vH` / GitHub API size |
| 8 | 本番挙動不変 | lulumi-tools.com のランキング表示・数値が移行前後で一致 | 本番実機比較 |
| 9 | 復旧の実運用実証 | cache を意図的に外した run で Release/シャードから復旧し当日取得成功 | 手動 workflow_dispatch |

## 6. 停止条件

以下に該当したら**実装を止めて選択肢+推奨付きで統括へ報告**:
- INV-1〜INV-6 のいずれかを満たせない実装要求が生じた
- v2シャード復旧が INV-5(最悪ケース復元)を満たせない → v1 撤去(P4)へ進まず報告
- Release Asset の additive-merge で退行(基準4未達)が2試行で解消しない
- 履歴書き換え(P6)で web コード木のツリーハッシュが書換前後で不一致(db.gz 以外に影響)
- 取得ロジック(LULU-004 禁止領域)に触れる必要が生じた

## 7. コミット分割

各コミット単独 revert 可。**挙動不変(P1・P2)先行、撤去/停止(P3・P4)は並行系の安全確認後、破壊的な履歴書換(P6)は最後**。P6 のみ force push を伴い revert 不可のため INV-6 のゲートを課す。

## 8. 検証コマンド(コミットごと)

```
cd exp_ranking/bot && python -m pytest         # 全緑
cd exp_ranking/web && npm run build            # 成功
git diff -w -- <touched files>                 # 改行ノイズ排除・実質差分
# 復旧実証(P1/P9): 合成条件での workflow_dispatch と snapshot_days 検査
git count-objects -vH                          # P6 後のサイズ実測
```

## 9. ロールバック

- P1〜P5 は通常コミット=個別 revert 可(並行系を残すため各段で本番は生存)。
- **P6(履歴書換)は revert 不可**。事前に「書換前 refs のバックアップ(バンドル)」を取得し、force push はユーザー専権。書換後に web コード木ツリーハッシュ一致を検証(不一致なら中止・バックアップから復元)。

## 10. 完了報告テンプレ(T12 全体で1回)

- 実施コミット(全フェーズのハッシュ):
- 受け入れ基準の実測値(§5 全9行):
- INV-1〜INV-6 の遵守確認:
- 復旧実証(基準3・9)の出力:
- 履歴書換の before/after サイズ・ツリーハッシュ一致確認:
- v1 廃止・旧処理撤去の一覧:
- 残課題・watch-item:
