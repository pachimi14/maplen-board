# IMPL_PLAN_SH8 — 暫定点のツールチップに「取得時刻」を出す

設計正典: `docs/DESIGN_SF_COST_HISTORY.md` §8(ラベル規約)/ §9.3(暫定点)/ §6(現在価格)。
前提: SH-7 完了・統括検収済(`3615e77`)。**小さな1点の修正**。

## 0. 背景と裁定

暫定点のツールチップが **`2026-08-05 00:00 UTC`**(= 4時間足バケットの**開始時刻**)を出している。
しかしその点の値は**バケットの開始でも終了でもなく「取得できた最新の価格」**なので、
バケット境界の時刻を出すと**古い点に見える**(実際の値は 01:40 時点のもの)。

**ユーザー裁定 2026-08-05**: **暫定点の時刻表示は、足の境界ではなく「データの取得時刻」にする。**

## 1. スコープ

**変更してよい**:
- `server/sf-history/app.py` — 暫定点に取得時刻を載せる
- `exp_ranking/web/src/sfhistory/integrations/sfHistorySource.js` — 新フィールドの素通し
- `exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx` — ツールチップの時刻表示
- `exp_ranking/web/src/sfhistory/domain/format.js`(必要なら)
- `exp_ranking/web/src/i18n/locales/*.json` — **6ロケール同時**(文言追加が要る場合のみ)
- 各 `*.test.js` / `server/sf-history/tests/`
- `docs/reports/SH8_PROVISIONAL_TIME.md`(報告書)

**触らないもの**(1つでも触れたら停止):
- `server/sf-history/aggregate.py` / `schema.sql` / `scripts/*`(**4h テーブルと生成規約は不変**)
- `exp_ranking/web/src/sfhistory/starforce.js`
- `exp_ranking/web/src/sfhistory/domain/series.js` の**統計・系列生成ロジック**
  (表示用フィールドの素通しのみ可。**統計に暫定点を混ぜない**規約は不変)
- `sfhistory` 以外の既存 `src/` / `package.json` / VPS

## 2. 実装

### 2-1 サーバー

暫定点に**取得時刻**を持たせる。**出どころは `latest` の `latestUpdatedAt`**
(= 公式 API 自身の as-of 時刻。我々がフェッチした時刻ではなく、**価格がいつ時点のものか**)。

```json
{ "date": "2026-08-05T00:00:00Z", "prices": [...], "provisional": true,
  "asOf": "2026-08-05T01:40:00Z" }
```

- **`date` は変えない**(バケット位置=描画位置として必要)
- 確定点には `asOf` を**付けない**
- 既存の `provisionalDate` も**そのまま残す**(意味を変えない)
- **`latestUpdatedAt` が取れないときは `asOf` を付けない**(無い数字を発明しない)

### 2-2 フロント

**暫定点のツールチップの1行目を `asOf` にする**(確定点は従来どおり `date`)。

- `asOf` があるとき: その時刻を表示
- `asOf` が無いとき: **時刻行を出さない**(バケット時刻にフォールバックしない
  — それをすると「古い点」に見えるという今回の問題がそのまま戻る)
- 「暫定値(区間未終了)」の行は**そのまま残す**
- 計算条件の「現在価格の取得時刻」と**同じ値になる**こと(画面内で2つの時刻が食い違わない)

## 3. 受け入れ基準

- **(a)** 暫定点の応答に `asOf` が入り、値が `/sf-history/latest` の `latestUpdatedAt` と**一致**する
- **(b)** 確定点に `asOf` が**付かない**(0件)
- **(c)** `date` / `endDate` / `provisionalDate` / `points` の件数が **SH-7 と同じ**(既存の意味を変えていない)
- **(d)** 上流失敗時: 暫定点自体が出ない(SH-7 の挙動が不変)。`prices` は **200**
- **(e)** ブラウザで、暫定点のツールチップの時刻が **`latestUpdatedAt` と一致**し、
  かつ**計算条件の「現在価格の取得時刻」と同じ値**であること
- **(f) 統計不変**: 暫定点の値を極端に振っても平均・高値・安値・パーセンタイルが動かない
  (SH-7 の基準を**再実行**して維持を確認)
- **(g) 4h テーブル不変**: 行数・ハッシュが変わらない
- **(h)** `pytest` 全緑・`npm run test` 全緑・`npm run build` 成功
- **(i)** 6ロケールのキー数が一致(文言を足した場合)
- **(j)** `git diff -w` で §1 の「触らないもの」に差分ゼロ

## 4. 停止条件

1. `date` を変えないと実装できない(描画位置が壊れる)
2. 統計・系列生成ロジックに手を入れないと入らない
3. §1 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 5. コミット

- **ローカルコミット**(1〜2本)。**`git push` は行わない**。**`git add -A` 禁止**。

## 6. 完了報告テンプレ

```
## SH-8 完了報告
- コミット: <hash>
- (a) asOf の値 / latest の latestUpdatedAt との一致
- (b) 確定点の asOf: 0件
- (c) date / endDate / provisionalDate / points 件数(SH-7 と同じであること)
- (d) 上流失敗時の挙動
- (f) 統計不変の再確認
- (g) 4h テーブルの行数・ハッシュ
- (h) pytest / npm test / build
- (i) 6ロケールのキー数
- (j) 触らない領域の差分ゼロ
- ★ローカル起動手順(**SF_HISTORY_ALLOWED_ORIGINS を必ず含めること**)
```
