# IMPL_PLAN_SH48 — 画面に「1日1回更新」と最終更新時刻を出し、現在値カードを隠す

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー / 実装: implementer(実装担当)
> **前提**: `IMPL_PLAN_SH47`(PC日次取得)が先に入っていること。PR-001「挙動不変先行・挙動変更は最後」により本書が後。

## 0. 目的と背景

- **北極星への寄与(一文)**: 「現在価格を取得できません」という**障害の顔**を、「1日1回更新、最終更新は○時」という**仕様の顔**に変え、見た人が壊れていると誤解しないようにする。
- 参照する決定: DECISION_LOG **LULU-153** / 依頼文 `HANDOVER_LT_SF_DAILY_FETCH.md` §2(3)(4)
- 現状(実測): `/sf-history/latest` は **503**、`/sf-history/prices` は 200 で `provisionalDate: null`。画面は `summary.currentUnavailable`(「現在価格を取得できません」/ 琥珀色)と `currentPosition` の `--` を表示している。**つまり壊れてはいないが、障害に見える**。

### 0.1 要決定(ユーザー) — 現在値カードの扱い

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A(推奨)** | 「現在値」と「現在の位置」の2カードを**隠す**。代わりに「1日1回(JST 17時頃)更新 / 最終更新 {{時刻}}」を出す | 表示だけの変更でデータ経路に触らない。既存の決定「履歴の最終値で代用はしません」(SH-17「無い数字を発明しない」)を**変えずに済む**。最新値は折れ線の最終点として既に見えている | 「現在の位置」(パーセンタイル)という機能が公式復帰まで消える |
| B | 最終確定値を「最終確定値({{時刻}} 時点)」として出し、パーセンタイルもその値で計算する | パーセンタイル機能が残る | **既存の明示的決定の反転**になる(architecture-review Step 9「原則の変更は明示的な決定に昇格」)。データ経路の変更を伴い、SH-48 が表示だけの変更でなくなる |

**推奨は A**。根拠: ①B が足す情報(高々24時間前の値)は**折れ線の最終点として既に画面に出ている**ので、情報量はほとんど増えない ②B は `SummaryCards` の入力の出どころを変えるため、`SfHistoryRoot`/`CubePricesRoot` の両方とそのテストに波及する ③ユーザーの依頼文 §2(3) は「現在価格を隠す」であり、A がその文字どおり。

> **この決定が B になった場合、本計画書は書き直しが必要**(スコープが表示層を越える)。実装担当は A を前提に進め、B の指示が出たら停止して報告する。

## 1. スコープ(A案を前提)

**触るファイル**
- `exp_ranking/web/src/sfhistory/components/SummaryCards.jsx`(2カードの条件付き非表示 + 更新頻度の注記)
- `exp_ranking/web/src/sfhistory/SfHistoryRoot.jsx` / `CubePricesRoot.jsx`(`pageDescription` の文言差し替えに伴う箇所のみ。構造は変えない)
- `exp_ranking/web/src/i18n/locales/{ja,en,es,th,vi,zh-TW}.json` — **6ファイル同時**(規約)
- `exp_ranking/web/src/sfhistory/components/*.test.js`(既存テストの期待値更新 + 新規1ケース)

**触らないもの(明示)**
- `server/` 配下すべて(API の応答は1バイトも変えない。`contract/response_fields.json` も不変)
- `fetch_latest.py` / `/sf-history/latest` 経路(**消さない**。公式復帰時にそのまま戻すため)
- チャート本体(`SfHistoryChart.jsx`)・ヒートマップ・期間タブ・装備セレクタ・`starforce.js` 等のドメイン純関数
- `sfhistoryDiscovery` / `sfhistoryTabs` の文言
- localStorage キー(`maplen-board-*`)

## 2. 変わってよいもの・いけないもの

**変わってよい**
- 「現在値」「現在の位置」カードが**表示されなくなる**(DOM から消える。空カードを残さない)
- `sfhistory.pageDescription` / `sfhistoryCube.pageDescription` の文言(「現在値が過去のどの水準かを確認できます」という**果たせない約束を外す**)
- サマリ領域に1行の注記が増える

**変わってはいけない**
- **6ロケールのキー集合が完全一致**していること(`src/localeParity.test.js` が機械判定する)
- 折れ線・ヒートマップ・期間・装備選択の挙動と数値
- `/sf-history/*` への**リクエスト数と内容**(カードを隠すだけで、`latest` の呼び出し自体は変えない。公式復帰時に自動で復活する形を保つ)
- 公式復帰後に `currentStatus === "ready"` になったら、**A案の非表示が自動で解除され元の2カードが戻る**こと(=「隠す」は `currentStatus` を見た条件分岐で、コードの削除ではない)

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | ビルド成功 | exit 0、警告増加なし | `cd exp_ranking/web && npm run build` |
| 2 | テスト全緑 | 全パス、0 failed | `cd exp_ranking/web && npm test` |
| 3 | **ロケール整合** | 6ファイルのキー集合が完全一致(差分 0 キー) | `npm test`(`src/localeParity.test.js`)|
| 4 | 新規キー数 | 追加キーが**6ファイルすべてに同数**、日本語以外も**実際に翻訳されている**(日本語のコピペ 0 件) | 6ファイルの該当キーを目視 + `git diff -w` |
| 5 | 非表示の確認 | `currentStatus !== "ready"` のとき、「現在値」「現在の位置」のラベル文字列が DOM に **0 回**出現 | 新規テスト(`SummaryCards.test.js`)|
| 6 | **自動復帰の確認** | `currentStatus === "ready"` を渡すと2カードが**両方出る**(従来どおりの表示) | 同上(この2ケースが対になっていることが本質) |
| 7 | 注記の表示 | `currentStatus !== "ready"` のとき、更新頻度の注記と最終更新時刻が各 **1 回**出る | 同上 |
| 8 | 新規 npm 依存 | **0 件**(`package.json` 無変更) | `git diff -w -- exp_ranking/web/package.json` が空 |
| 9 | 改行ノイズゼロ | 実質差分が意図した行のみ | `git diff -w -- <touched files>` |
| 10 | 既存の約束との一致 | `pageDescription` が、画面に実際に出ているものだけを約束している | レビュー項目(code-review P0-1「約束と請求の一致」)|

## 4. 停止条件

1. §0.1 の決定が **B** になった(本計画書の書き直しが必要)
2. 「現在値」を隠すと `SummaryCards` の他のカード(期間平均・高値・安値)のレイアウトが崩れ、CSS の構造変更が必要になった(スコープ外)
3. `localeParity.test.js` が緑にならない原因が、今回の追加キー以外にある
4. 翻訳に確信が持てない言語がある(**推測で埋めない**。該当言語を挙げて報告する)
5. 受け入れ基準の未達が2回の試行で解消しない

## 5. コミット分割

1. **`feat(i18n): add the daily-cadence and last-updated strings in 6 locales`** — キー追加のみ。まだ誰も参照しないので画面は1ピクセルも変わらない(**挙動不変**)
2. **`feat(sfhistory): show the update cadence instead of the current-value cards`** — `SummaryCards.jsx` の条件分岐 + テスト(**挙動変更本体**)
3. **`feat(i18n): revise both pageDescription strings to match what the page shows`** — 約束の修正(6ロケール)

> 1 を入れて 2 を revert すれば「文言はあるが画面は従来どおり」に戻る。

## 6. 検証コマンド(コミットごと)

```bash
cd exp_ranking/web
npm run build
npm test
npm test -- src/localeParity.test.js
npm test -- src/sfhistory/components/SummaryCards.test.js
git diff -w -- src/sfhistory src/i18n/locales

# ローカル目視(現在価格が 503 の今の状態がそのまま再現する)
cd ../.. && run_local_dev.bat
```

## 7. ロールバック

- 3コミットすべて単独 revert 可。2 だけ revert すれば表示は完全に従来へ戻る(1 の未使用キーが残るだけで無害)
- `/sf-history/latest` の呼び出しを消さないので、**公式復帰時はコード変更なしで元の表示に戻る**(基準 #6 がそれを保証する)
- サーバ側に一切触らないので、web のロールバックだけで完結する

## 8. 完了報告テンプレ

- 実施コミット(ハッシュ、3本):
- 受け入れ基準の実測値(**表の10行すべて**):
- 6ロケールに追加したキー名と、各言語の実際の文言:
- `npm run build` / `npm test` の出力要点:
- 基準 #6(公式復帰時の自動復帰)をどのテストで保証したか:
- 残課題・watch-item:
