# SH-18 完了報告 -- 足のラベルを区間終了時刻にする

計画: `docs/IMPL_PLAN_SH18.md`。前提: SH-17 完了・統括検収済。ユーザー裁定(2026-08-05)起点。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

**これは決定の反転**(設計 §9「ラベルは区間開始時刻」を反転)。サーバー・DB・API は無改訂。

## コミット

1. `22e2329` -- `fix(sh18): chart label shows the bucket's end instant, not its start`
   (`exp_ranking/web/src/sfhistory/domain/format.js` / `format.test.js` /
   `exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx`)
2. `7b6ed25` -- `fix(sh18): heatmap groups by bucket end, not start (1-slot shift)`
   (`exp_ranking/web/src/sfhistory/domain/weekdayStats.js` / `weekdayStats.test.js` /
   `exp_ranking/web/src/sfhistory/components/WeekdayHeatmap.jsx`)
3. 本コミット -- `docs(sf-history): SH-18 plan + design §9 reversal addendum + review`
   (`docs/DESIGN_SF_COST_HISTORY.md` / `docs/IMPL_PLAN_SH18.md` / 本ファイル)

いずれも単独 revert 可(チャート表示 / ヒートマップ割り当て / docs で分離)。`git push` は未実施。

## 実装の要点

- **サーバー・DB は1バイトも変えていない**(`server/` 配下の diff = 0行、下記 (h) 参照)。保存・API は
  `price_at` = バケット開始のまま、`labelIs: "bucketStart"` の意味も不変。
- 新規関数 `domain/format.js#bucketDisplayDate(point, { now })`:
  - `point.asOf` があれば `asOf` をそのまま返す(SH-17 の「未終了」規約を無改変で維持)。
  - 無ければ `point.date + 4h`(バケット終了)を返す。
  - **ただし** `date + 4h` が `now` より未来なら(＝実はまだ終了していないバケットに `asOf` が無い、
    上流 `latest` 失敗時のフォールバック状態)、**未来を返さず** `point.date`(バケット開始)にフォール
    バックする -- 計画の §3 表には明記されていない縁のケースだが、「未来の時刻を表示しない」という
    停止条件1の趣旨を最優先し、client 側で明示的にガードした。
- `SfHistoryChart.jsx`: `withChartColumns` が各行に `displayDate: bucketDisplayDate(row)` を追加し、
  `XAxis` の `dataKey` を `date` → `displayDate` に変更(位置=配列順は不変、ラベルのみ変わる)。ツール
  チップの `timeLabel` も `point.asOf ?? point.date` → `bucketDisplayDate(point)` に変更。**範囲注記
  (`formatBucketRange(point.date)`)は無改変**(引き続きバケット開始から算出、(c) の要求どおり)。
- `domain/weekdayStats.js#buildWeekdayHeatmap`: グルーピングキーを `point.date` の曜日/時刻から
  `point.date + 4h` の曜日/時刻に変更。ここに来る点は既に `!provisional` でフィルタ済み(=必ず確定
  バケット)なので、未来時刻のガードは不要(確定バケットの終了は必ず過去)。列(00/04/08/12/16/20)・
  行順(`WeekdayHeatmap.jsx` の `WEEKDAY_ORDER`、木→水)は無改変。

## (a) 表示の実例(API の date → 画面の時刻)

実機(ローカル API `127.0.0.1:8785`、実データ、itemId `1003720`、2026-08-05 07:20 UTC 台、
`domain/series.js#buildExpectedSeries` → `domain/format.js` まで実データを通したスクリプトで確認):

```
確定点: date="2026-08-04T20:00:00Z" -> displayDate="2026-08-05T00:00:00.000Z"
        axis="08/05 (水)"  tooltip="2026-08-05 00:00 UTC (水)"
確定点: date="2026-08-05T00:00:00Z" -> displayDate="2026-08-05T04:00:00.000Z"
        axis="08/05 (水)"  tooltip="2026-08-05 04:00 UTC (水)"
```

**計画 §6(a) の自例そのもの**: 「API の `2026-08-05T00:00:00Z` の点が `04:00` と表示される」を実測で確認
(`format.test.js` にも同じ主張を固定テストとして追加済み)。

## (b) 未終了の足の表示

```
末尾点(進行中バケット): date="2026-08-05T04:00:00Z", asOf="2026-08-05T07:20:00Z"
  -> displayDate="2026-08-05T07:20:00Z"  (= asOf そのもの、SH-17 のまま)
  axis="08/05 (水)"  tooltip="2026-08-05 07:20 UTC (水)"
```

未来の時刻(`08:00`)は一切出ていない。`asOf` が無い(上流失敗フォールバック)ケースは実データでは
再現できなかった(要 upstream 障害)ため、`format.test.js` の単体テストで
「バケット未終了 + `asOf` 無し」を固定し、`point.date`(過去)にフォールバックして未来を返さないことを
機械確認した。

## (c) 範囲の注記

```
確定点: date="2026-08-05T00:00:00Z" -> range { start: "00:00", end: "04:00" }
進行中: date="2026-08-05T04:00:00Z" -> range { start: "04:00", end: "08:00" }(未終了・琥珀色)
```

`formatBucketRange(point.date)` は無改変のまま呼ばれており、開始–終了の表記(SH-17)は維持。新しい
時刻ラベル(`04:00`)と範囲注記(`00:00–04:00 の足`)は矛盾しない(ラベル=区間の代表時刻、注記=区間
そのもの)。

## (d) ★1枠ずれの機械確認

実データ(itemId `1003720`、150日分、確定点899件)に対し、**post-SH18 の `buildWeekdayHeatmap`** と
**pre-SH18 のアルゴリズム(バケット開始で分類・本レポート用に一時再現)** を同一入力に対して走らせて
突き合わせ:

```
old [Wed][20:00] : n=21  median=33,147,997.146441564
new [Thu][00:00] : n=21  median=33,147,997.146441564
一致: true
```

`weekdayStats.test.js` にも同じ突き合わせを固定テストとして追加(`oldBuildWeekdayHeatmap` を
テストファイル内にのみ再現、本番コードからは未参照)。**旧の値は `SH14_UTC_AND_ORDER.md` 時点のアルゴ
リズムと同一**(SH-14 以降ヒートマップの分類ロジックは変更されていない)。

## (e) 左上セル

`WeekdayHeatmap.jsx` の `WEEKDAY_ORDER = [4,5,6,0,1,2,3]`(木→水、SH-14 のまま)は無改変。列0は
`bucketSlot=0`(`00:00`)も無改変。∴ **左上セル = 木曜行 × `00:00`列**で構造上不変 -- ただし中身は
(d) の1枠ずれにより「水20:00–木00:00 の足」のデータになった(意図した変更)。

## (f) ★統計不変

実データで stats を計算 → 「表示にのみ使う `date`/`asOf`」を末尾点だけ改竄(`1999-01-01T00:00:00Z` に
差し替え)→ 再計算して完全一致を確認(`computeStats` は `expected`/`provisional` のみ見るため、`date`/
`asOf` の改竄は影響しないはずという仮説の直接検証):

```
stats baseline:  { average: 43867648.88243628, high: 105928688.53346875, low: 21850014.719807934, count: 899 }
stats tampered:  { average: 43867648.88243628, high: 105928688.53346875, low: 21850014.719807934, count: 899 }
stats identical: true
currentPercentile: 11.79...(改竄前後で同一呼び出し、count=899 が確定点のみである証跡)
```

`domain/series.js`(`computeStats`/`currentPercentile`)は **1行も変更していない**(§5 のスコープ外、
diff 0行 -- 下記 (h))。`bucketDisplayDate`/ヒートマップのグルーピング変更は `expected` 配列にも
`provisional` フラグにも触れていないため、統計が動く経路が構造的に存在しない。

## (g) n の合計

```
series (0->17, 900点中): confirmed かつ expected != null = 899
heatmap totalHeatmapCount = 899
一致: true(暫定点・欠損点はどちらも0/900に含まれず、899件のみがどこかのセルに入る)
```

## (h) npm test / build / server 差分ゼロ

```
cd exp_ranking/web && npm run test -- --run
  Test Files  40 passed (40)
  Tests       428 passed (428)   (SH-17時点421 + 本スライスの新規7: bucketDisplayDate 6件 +
                                   ヒートマップ1枠ずれ機械確認1件。既存の weekdayStats テスト6件は
                                   件数を変えず、新セマンティクス(グルーピング=バケット終了)に
                                   合わせてアサーションのみ更新)

cd exp_ranking/web && npm run build
  success (dist/index.html 2.71kB, index-*.js 1,110.80kB / gzip 316.16kB
            -- SH-17時点と同水準、既存のチャンクサイズ警告のみ)

cd server/sf-history && python -m pytest tests/ -q
  92 passed  (SH-17時点と同数・無改変)

git diff -w --stat -- server/ \
  exp_ranking/web/src/sfhistory/starforce.js exp_ranking/web/src/sfhistory/domain/series.js \
  exp_ranking/web/src/App.jsx exp_ranking/web/src/board exp_ranking/web/src/pages \
  exp_ranking/web/src/components exp_ranking/web/src/taskManager \
  exp_ranking/web/package.json exp_ranking/web/src/sfhistory/integrations \
  exp_ranking/web/src/i18n/locales
  -> (空、0行)
```

## (i) 6ロケールのキー数

新規文言は追加していない(範囲注記のテンプレートは無改変で足りた -- 表示するのは既存の
`formatAxisDate`/`formatTooltipDate` が返す UTC 文字列で、新しい i18n テンプレートは不要だった)。

```
ja/en/es/th/vi/zh-TW  すべて 377キー(SH-17と同数、変化なし)
```

## (j) SH-7〜SH-17 の性質維持

上記 (h) の `git diff -w --stat` が対象ファイル群(UTC統一=SH-14、意味色/2桁表記=SH-12、プリセット3種
=SH-13、パーセンタイル文言=SH-15、20分スタンプ=SH-15、破線1種=SH-17、maxStarガード=design §7.1 等が
実装されているファイル)に対して0行であることから、構造的に不変。`server/` 配下も0行(4h テーブル・
`price_at`・`labelIs` の意味は無改訂)。

## ★起動手順(SF_HISTORY_ALLOWED_ORIGINS 込み)

本スライスは `server/` を一切変更していないため、既存プロセスの再起動は不要(計画書どおり)。参考のため
起動コマンドを再掲:

```bash
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

```
# 開発サーバー(HMR 有効。JSX/JS変更のみのため再起動不要のはず):
# http://localhost:5183/#/starforce
```

## §裁量判断メモ(実装担当の判断、統括レビュー用)

1. **設計書の参照節ズレ**: 計画 §5/§1 は「設計 §8 に反転を追記」と書いているが、「ラベルは区間開始
   時刻」の実文は設計書 **§9**(§8 は「Expected 計算式をどう持ち込むか」で無関係)にある。CLAUDE.md の
   「計画書の行番号はドリフトしうるので grep で貼り直す」を節番号にも適用し、実際に文が存在する §9 に
   追記した(§8 には何も追記していない)。軽微な参照ミスと判断し、報告のみで停止はしていない。
2. **未終了バケット・`asOf` 無しの未来時刻ガード**: 計画 §3 の表は「未終了の足 → 現在時刻(asOf)
   ← SH-17 のまま」とのみ書いており、`asOf` が無い(上流 `latest` 失敗時のフォールバック、
   `app.py` の `in_progress_prices`)場合の扱いを明記していない。この状態は provisional かつ `asOf`
   無しという点で「暫定の足(完成済み未保存)」と区別が付かない一方、**バケットが実際にはまだ終了して
   いない**ため、単純に「`asOf` 無し→ `T+4h`」ルールを適用すると未来時刻を表示しうる(停止条件1が
   明示的に禁じている挙動)。これを避けるため `bucketDisplayDate` に `now` との比較ガードを追加した
   (バケット終了が `now` 以前なら `T+4h`、そうでなければバケット開始にフォールバック)。新しい計算式
   ではなく既存の「バケット境界」概念(`formatBucketRange` と同じ `BUCKET_HOURS=4`)を再利用した比較
   のみで、実データでは再現できなかったため単体テストで固定した(上記 (b) 参照)。
3. **フロント側コンポーネントの自動テストは追加していない**(SH-16/SH-17 と同じ判断: `SfHistoryChart.jsx`
   の JSX 描画テストには testing-library 相当の新規依存が要り、計画の停止条件4「新規依存が必要になった」
   に抵触しうる)。代わりに実データを `domain/format.js`/`domain/weekdayStats.js`/`domain/series.js` に
   直接通す検証スクリプトで (a)〜(g) を裏取りした(コミットには含めていない一時スクリプト、
   `scratchpad/sh18_check.mjs`)。

## 残課題・watch-item

- ブラウザでの実クリック確認(ツールチップのホバー・軸ラベルの見た目)は、実装担当の環境にブラウザ
  操作ツールがないため未実施。API実測・vitest・フロント domain 層への実データ通しで代替した。
  **統括の実機確認が必須**。特に「チャート右端の破線区間(未終了)のラベルが未来にならないこと」と
  「ヒートマップ左上セルの中身が水20:00–木00:00相当に変わって見えること」を重点確認いただきたい。
- 上記§裁量判断メモ(2)の「未終了・`asOf`無し」フォールバック経路は実データで再現できず、単体テスト
  のみでの担保。upstream `latest` 障害時に実機で挙動が変わる可能性はゼロではない(ただし理論上は
  現行のガードで未来時刻を出さない設計)。

---

# 統括検収(2026-08-05)— **合格**

## (a) ラベル

API の `date=2026-08-05T00:00:00Z` の点が **`2026-08-05 04:00 UTC (水)`** と表示される(+4h)。

## (d) ★1枠ずれ — 統括が別実装で突き合わせ

統括が旧規約(開始で括る)と新規約(終了で括る)を独立に実装して比較:

```
旧 [水][20:00] : n=21  median=322,847,594.13247555
新 [木][00:00] : n=21  median=322,847,594.13247555   ← 完全一致
実装の [weekdayIndex=4(木)][bucketSlot=0(00:00)] : n=21  median=322,847,594.13247555
画面の左上セル : 木 / 322.85M
```

**3者が一致。**1枠ずれが意図どおり実現され、画面まで届いている。

## (f) ★統計不変 — 時刻依存がないことを直接証明

```
元          : {"average":401770793.92052245,"high":979788183.195659,"low":210557860.95223638,"count":898}
全点の時刻を +12時間ずらす → 同一
★統計は時刻に依存しない: true
```

ラベル規約を変えても平均・高値・安値・件数は動かない。

## (g)(h)

n 合計 **898** = 確定点数 / **42セル** / `server/` の差分**ゼロ**。

## ★検収中に見つけた一過性の不整合 — **ユーザー裁定により現状維持**

進行中の足だけ**現在時刻**(SH-17)、他の足は**終了時刻**(SH-18)を表示するため、
**2つの意味が同じ軸に並ぶ**。上流スタンプが足の境界に追いつくまでの間、ラベルが逆行しうる:

```
04:00  (足 00:00–04:00 の終了)
08:00  (足 04:00–08:00 の終了)
07:40  (進行中の足 08:00–12:00 → 現在時刻)   ← 前の点より前の時刻
```

統括が提示した選択肢:
- (A) 進行中も終了時刻でラベル(`12:00 の足(未終了)`)→ **未来の時刻を表示する**別の違和感
- (B) 進行中は「現在(HH:MM 時点)」と明示 → 時系列の点として読ませない
- (C) 現状維持

**ユーザー裁定 = (C) 現状維持。**
実際のツールチップ(`2026-08-05 07:20 UTC (水)` + `04:00–08:00 の足(未終了)`)は
**ヘッドラインが範囲内に収まっていて整合している**ため、通常の見え方に問題はない。
**逆行は足の境界直後〜スタンプ追随までの約20分だけの一過性**であり、許容する。

> **記録の意味**: 将来この見え方が問題になったら、**(A)(B) の選択肢は既に整理済み**である。
> 同じ検討を最初からやり直さないこと。
