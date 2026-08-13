# IMPL_PLAN — Raffle Calculator マージ準備(main統合・差分整理・決定ID再採番)

> 状態: 統括承認済み(ユーザーのNO-GO判定「差分整理→main統合と競合解消→決定ID再採番→…」の順序指示起点)
> ブランチ: `codex/raffle-calculator`(**未push・ローカルのみ**を統括が確認済み。履歴書き換え・force pushは不要)
> 方式: **追加コミットのみ**(LULU-035の先例に従い、rebase・履歴書き換えをしない)

## 0. 統括が確認済みの事実

- `HEAD` は `origin/main` に対し behind 109 / ahead 1(`43d012b feat: add raffle calculator` のみ)
- `git merge-tree` 実測で競合は **4ファイル**: `exp_ranking/web/src/App.jsx` / `src/board/useHashRoute.js` / `src/components/BoardHeader.jsx` / `vitest.config.js`(6ロケール・DECISION_LOGは自動マージされるが、DECISION_LOGは意味的に再採番が必要)
- `origin/main` には**別内容の LULU-064〜066**(Enhance History 等、2026-08-06/07)が存在。ブランチ側 raffle 節の LULU-064 以降(24エントリ)と ID 衝突
- `43d012b` に T7 スパイクの残骸が混入: `docs/t7-spike-samples/*.png`(5枚)と `exp_ranking/web/tools/t7-spike/`(README/index.html/main.jsx)。**`.gitignore` の変更は raffle 正当分(sqlite キャッシュ+`.claude/`)なので維持**
- 未コミット: raffle 実装差分(settlement.js/test 等)+ UIポリッシュ(LULU-084〜086相当)+ SPEC/DECISION_LOG 更新
- 未追跡のうち **コミットしてよいもの**: `docs/IMPL_PLAN_RAFFLE_UI_POLISH.md` / `src/raffle/uiText.js` / `uiText.test.js` / 本計画書。**コミット禁止**: `exp_ranking/web/.env.review.local`(ローカル検証用)/ `docs/IMPL_PLAN_ranking-cap.md`(別件)

## 1. 作業手順(この順で。各ステップ=1コミット、単独revert可)

### S1. 未コミット分の整理コミット(2〜3コミット)

1. `feat(raffle)`: ドメイン・機能差分(`src/raffle/domain/settlement.js`・`settlement.test.js`、`RaffleCalculatorRoot.jsx` の機能部分が分離困難なら UI と同一コミットでよい)
2. `style(raffle)`: UIポリッシュ(`SettlementResult.jsx` / `raffle.css` / `uiText.js` / `uiText.test.js` / 6ロケール)
3. `docs(raffle)`: `SPEC_RAFFLE_CALCULATOR.md` / `DECISION_LOG.md` / `IMPL_PLAN_RAFFLE_UI_POLISH.md` / 本計画書

**個別 add のみ(`git add -A` 禁止)**。`.env.review.local` と `IMPL_PLAN_ranking-cap.md` は絶対に add しない。

### S2. DECISION_LOG の raffle 決定IDを再採番(S1の docs コミット内で実施してよい)

- raffle 節の全エントリ(現 LULU-064 以降、実数を enumerate して確認)を **LULU-067 から連番**へ +3 シフト(ユーザー指定: 067〜090)
- **本文中の相互参照も追随**(例: 「LULU-074およびLULU-077の…を置き換える」等)。ただし **raffle 節より前の既存ID(LULU-063 以前、PR-xxx、TM-066)は変更しない**
- 節見出しの重複にも注意: main 側にも `## 8.` 節があるため、raffle 節の見出し番号を main と衝突しない形(例: `## 9. Raffle Calculator`)へ調整

### S3. `git merge origin/main`(1マージコミット)

競合解消の方針:

| ファイル | 方針 |
|---|---|
| `App.jsx` / `useHashRoute.js` / `BoardHeader.jsx` | **main 側の新実装を正**とし、raffle が追加した要素(`#/raffle` ルート、ナビ項目、`RaffleCalculatorRoot` の遅延/直接 import)だけを再追加。raffle 側の古い main 由来コードを残さない |
| `vitest.config.js` | 両側の test include/設定を合算 |
| 6ロケール | キーの和集合(双方の追加キーを全部残す)。JSON 構文と6ファイルパリティを保証 |
| `DECISION_LOG.md` | main 版全文を正とし、S2 で再採番済みの raffle 節を末尾に追記する形へ |
| その他 | raffle 専用ファイルは branch 側、それ以外は main 側 |

### S4. T7 スパイク残骸の除去(1コミット)

- `git rm docs/t7-spike-samples/*.png exp_ranking/web/tools/t7-spike/ -r`
- コミットメッセージに「T7スパイクの誤混入除去(43d012b 由来)」と明記
- `.gitignore` は触らない(raffle 正当分)

### S5. 統合後検証(コミットなし)

```
cd exp_ranking/web && npm run test      # 全緑(main側+raffle側の合算件数を報告)
cd exp_ranking/web && npm run build     # 成功
cd server/raffle-api && python -m pytest -q   # 48件全緑
cd exp_ranking/bot && python -m pytest -q     # 全緑(mainの状態を壊していない確認)
git diff origin/main...HEAD --name-only | grep -Ei "t7|env.review|ranking-cap"  # 0件であること
```

## 2. 変わってよい/いけない

- 変わってよい: ブランチのコミット構成(追加のみ)、競合解消の結果、DECISION_LOG の raffle 節ID
- 変わってはいけない: main 側 109 コミットの実装内容(競合解消で raffle 側の古いコードに巻き戻さない)、raffle の計算ロジック、`.env.review.local` 等の非コミット方針、**push はしない**(ユーザー専権)

## 3. 受け入れ基準(数値)

1. `git merge-tree --write-tree HEAD origin/main` 相当の再確認で競合 0(= merge 済み)
2. `git diff origin/main...HEAD` に t7 spike / `.env.review.local` / `IMPL_PLAN_ranking-cap.md` が **0件**
3. DECISION_LOG: `LULU-064〜066` は main 側の内容のみ、raffle 節は `LULU-067` 起点の連番で重複ID 0件、raffle 節内の相互参照の不整合 0件
4. web テスト全緑・build 成功・raffle-api 48全緑・bot 全緑
5. 6ロケールのキーパリティ欠落 0
6. 作業ツリーに意図しない変更が残らない(`git status --short` は非コミット対象の未追跡のみ)

## 4. 停止条件

- 競合解消で main 側実装の意図が判断できない箇所が出た場合(該当ファイル・行を挙げて停止)
- マージ後にテストが赤で、原因が「raffle追加要素の再結線ミス」以外に見える場合(mainの挙動を変えないと直らない等)

## 5. ロールバック

追加コミットのみのため `git reset --hard 43d012b` で全戻し可(実行は統括判断)。マージ中断は `git merge --abort`。

## 6. 完了報告テンプレ

- コミット一覧(hash+要旨)
- 競合解消の要点(ファイルごとに「mainを正+raffle再追加した要素」)
- 再採番の対応表(旧ID→新ID)
- S5 の検証結果(件数)
- 受け入れ基準1〜6の充足
