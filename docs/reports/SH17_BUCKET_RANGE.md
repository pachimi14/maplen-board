# SH-17 完了報告 -- ツールチップに足の範囲を出す / 破線を1種類に戻す

計画: `docs/IMPL_PLAN_SH17.md`。前提: SH-16 完了・統括検収済(`56c2236`)。ユーザー裁定(2026-08-05)起点。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## コミット

1. `e323a2d` -- `fix(sh17): merge the in-progress bucket's two points back into one`
   (`server/sf-history/app.py` / `server/sf-history/tests/test_app.py` / `server/sf-history/README.md`)
2. `6d887f0`(本コミット、report 追記により hash 更新前の内容) --
   `fix(sh17): tooltip shows the bucket's range, dashes collapse to one kind`
   (`exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx` /
   `exp_ranking/web/src/sfhistory/domain/format.js` / `*.test.js` / 6ロケール + 本レポート)

いずれも単独 revert 可(サーバー側/フロント側で分離)。`git push` は未実施。

## (a) `current: true` の点が無いこと

実機(ローカル API `127.0.0.1:8785`、実データ、itemId `1003720`):

```
GET /sf-history/prices?itemId=1003720
  any current:true point -> False
  points with empty date -> 0
```

`grep -c '"current"'` 相当の確認としても、レスポンス全体を走査して `current` を持つ点はゼロ。

## (b) 未終了の足の `date` / `asOf`

```
points[899]: { date: "2026-08-05T04:00:00Z", provisional: true, asOf: "2026-08-05T07:00:00Z" }
provisionalDate: "2026-08-05T04:00:00Z"
```

`date` は足の開始時刻(`04:00`、位置=足の枠)、`asOf` は上流の現在時刻(`07:00`)。
単体テスト `test_prices_provisional_point_carries_asOf_from_latestUpdatedAt`(更新)・
`test_prices_provisional_point_omits_asOf_when_upstream_did_not_provide_one`(更新)で固定。

## (c) ★破線が1種類・中抜きマーカー数

サーバー側: 未終了の足は SH-16 の「hourly由来の暫定バケット点」+「`asOf` 位置の独立現在値点」の
2点構成をやめ、**1点に統合**した(`server/sf-history/app.py`)。値は `latest` キャッシュ優先、
上流失敗時のみ hourly にフォールバック(`test_prices_in_progress_bucket_merges_hourly_and_live_into_one_point`
/ `test_prices_in_progress_bucket_falls_back_to_hourly_when_upstream_fails` で固定)。

フロント側: `ProvisionalDot`/`withChartColumns` は無改変(既存の `point.provisional` フラグのみで
中抜き描画を判定)。実データでの確認:

```
total points: 900 (899 confirmed + 1 provisional)
中抜きマーカー数 = provisional 点の数 = 1
```

SH-16 時点(2点構成)では中抜きマーカーが2個だったのに対し、本スライスでは1個に減った
(2つの暫定点が1つに統合されたことの直接の帰結)。

## (d) ★時刻が全点で出る(時刻が空の点ゼロ)

`domain/series.js#buildExpectedSeries` → `domain/format.js#formatTooltipDate(point.asOf ?? point.date, ...)`
まで実データを通した検証スクリプト(`exp_ranking/web` から node で domain 層を直接 import):

```
points: 900
points with empty time label: 0 / 900
```

`ChartTooltipContent` の時刻計算を `point.date` 一択から `point.asOf ?? point.date` に変更した
(未終了の足のみ `asOf` を持つので、それ以外の全点は従来どおり `point.date` のまま -- SH-16 が直した
「時刻が出ない点」の性質は維持)。

## (e) 範囲表示の実例(通常 / 未終了 / 日付跨ぎ)

実データ末尾4点(`domain/format.js#formatBucketRange`):

```
{ date: "2026-08-04T16:00:00Z", provisional: false, range: { start: "16:00", end: "20:00" } }
{ date: "2026-08-04T20:00:00Z", provisional: false, range: { start: "20:00", end: "00:00" } }  ← 日付跨ぎ実例
{ date: "2026-08-05T00:00:00Z", provisional: false, range: { start: "00:00", end: "04:00" } }
{ date: "2026-08-05T04:00:00Z", provisional: true,  asOf: "2026-08-05T07:00:00Z",
  range: { start: "04:00", end: "08:00" } }                                                    ← 未終了
```

- 確定/完成済み: `sfhistory.chart.tooltipBucketRange` (`{{start}}–{{end}} の足`、ja の例)
- 未終了(`asOf` を持つ点): `sfhistory.chart.tooltipBucketRangeOpen`
  (`{{start}}–{{end}} の足（未終了）`)
- **日付をまたぐ `20:00–00:00` はテストで固定**:
  `format.test.js` の `formatBucketRange (IMPL_PLAN_SH17 §4-2)` >
  `"(e): a bucket crossing midnight UTC renders '20:00'-'00:00', not '20:00'-'24:00'"`
  (`formatBucketRange("2026-08-04T20:00:00Z")` → `{ start: "20:00", end: "00:00" }`)、
  上の実データでも同じ現象を確認済み(2026-08-04T20:00:00Z の確定点)。

`isOpenBucket = point.asOf != null` を唯一の判定源とした(未終了の足のみが `asOf` を持つ、という
app.py 側の契約に依存)。

## (f) 統計不変(改竄込み)

`domain/series.js`(`computeStats`/`currentPercentile`/`buildWeekdayHeatmap`)は1行も変更していない。
実データでの改竄比較:

```
stats baseline:  { average: 43867648.88, high: 105928688.53, low: 21850014.72, count: 899 }
stats tampered:  { average: 43867648.88, high: 105928688.53, low: 21850014.72, count: 899 }
  (未終了の足の expected を 999999999 に振っても完全一致)
stats identical: true
```

`series.test.js` の既存改竄テスト(SH-7由来)も無改変のまま緑(`series.js` を触っていないため)。

## (g) 4h テーブルのハッシュ

`server/sf-history/app.py` の変更はレスポンス辞書の組み立てのみ(`sf_price_history_4h` への
書き込み経路は存在しない)。実データ(本番と同じ `data/sf_price_history.sqlite`)で `/prices` を
3回連続で叩いた前後を比較:

```
before: rows=578396  hash=1d7bdba2c5fe65f3f9cbad2dec46ca1bb93a96a67560eb7acd02a88f1317653d
after:  rows=578396  hash=1d7bdba2c5fe65f3f9cbad2dec46ca1bb93a96a67560eb7acd02a88f1317653d
```

完全一致。加えて pytest 側の決定性テスト(`test_prices_provisional_point_is_never_persisted_to_the_4h_table`
= 無改変、新規2テストも同様に行数・ハッシュ比較を含む)がいずれも緑。

## (h) 上流失敗時

新規テスト `test_prices_in_progress_bucket_falls_back_to_hourly_when_upstream_fails` で固定:
`UpstreamLatestError` 発生時、hourly データが未終了バケットの窓内に既にあれば hourly 由来の値で
1点を出す(`asOf` は付けない -- 無い数字を発明しない)。`prices` は 200 のまま。
既存テスト `test_prices_upstream_failure_degrades_to_200_with_confirmed_history_only`(無改変、hourly
データも無いケース)も緑のまま -- この場合は未終了の足の点自体が出ない(`provisionalDate is None`)。

## (i) `pytest` / `npm run test` / `npm run build`

```
cd server/sf-history && python -m pytest tests/ -q
  92 passed  (SH-16時点91 + 本スライスの新規1 net: 2テストを書き換え+1テスト新規追加分の差分反映)

cd exp_ranking/web && npm run test
  Test Files  40 passed (40)
  Tests       421 passed (421)  (SH-16時点418 + 本スライスの新規3: formatBucketRange 3テスト)

cd exp_ranking/web && npm run build
  success (dist/index.html 2.71kB, index-*.js 1,110.44kB / gzip 316.07kB
            -- SH-16時点と同水準、既存のチャンクサイズ警告のみ)
```

## (j) 6ロケールのキー数

`tooltipBucketNote`/`tooltipProvisional` の2キーを `tooltipBucketRange`/`tooltipBucketRangeOpen`
の2キーに置き換えた(キー数は変化なし):

```
ja/en/es/th/vi/zh-TW  すべて 377キー(SH-16と同数、変化なし)
```

## (k) SH-7〜SH-16 の性質維持

```
git diff -w -- server/sf-history/aggregate.py server/sf-history/schema.sql \
              server/sf-history/scripts server/sf-history/db.py server/sf-history/fetch_latest.py \
              exp_ranking/web/src/sfhistory/starforce.js \
              exp_ranking/web/src/App.jsx exp_ranking/web/src/board exp_ranking/web/src/pages \
              exp_ranking/web/src/components exp_ranking/web/src/taskManager \
              exp_ranking/web/package.json \
              exp_ranking/web/src/sfhistory/domain/series.js \
              exp_ranking/web/src/sfhistory/domain/weekdayStats.js \
              exp_ranking/web/src/sfhistory/integrations
  -> 0 行
```

UTC統一(SH-14)・意味色(SH-12)・2桁表記(SH-12)・プリセット3種(SH-13)・パーセンタイル文言(SH-15)・
20分スタンプ(SH-15)・maxStarガード(design §7.1)・alias検索(SH-9)・ナビ・テーマ・ヒートマップ起点、
いずれも上記の「触らないもの」に含まれるファイルを1行も変更していないため構造的に不変。

## §裁量判断メモ(実装担当の判断、統括レビュー用)

1. **`tooltipProvisional`(暫定値・区間未終了)キーを削除し、範囲注記に一本化した**。旧実装では
   「完成済みだが未保存」の暫定点(実際にはもう終わっている)にも「区間未終了」という文言が出ており、
   計画 §1 の3行モデル(確定/暫定完成済み/未終了で範囲注記の内容が異なる)を実現するには、
   `point.provisional` ではなく `point.asOf` の有無で分岐先を変える必要があった。これは計画 §4-2 の
   要求(「未終了には(未終了)が付く」「完成済み未保存はプレーンな範囲のみ」)を満たすための必然的な
   帰結であり、「既存の tooltipBucketNote を置き換える」という計画文言の範囲内と判断した。
2. **未終了バケットの hourly フォールバック**(`in_progress_prices`/`in_progress_has_data`)は
   SH-16 で追加された計算をそのまま流用し、「別の点として出す」から「`latest` が使えないときの
   フォールバック値」へ役割を変えただけ -- 新しい計算式は発明していない。
3. **フロント側コンポーネントの自動テストは追加していない**(SH-16 と同じ判断: `SfHistoryChart.jsx`
   の JSX 描画テストには testing-library 相当の新規依存が要り、計画の停止条件3「新規依存が必要に
   なった」に抵触しうる)。代わりに実データを `domain/series.js`/`domain/format.js` に直接通す検証
   スクリプトで (c)/(d)/(e)/(f) を裏取りした(コミットには含めていない一時スクリプト、
   `scratchpad/sh17_check.mjs`)。

## ブラウザでの見え方(統括の実機確認用の再現手順)

**装備**: `Chaos Von Bon Helmet`(itemId `1003720`)。**期間**: 150D(既定)。

1. `http://localhost:5183/#/starforce` を開く(dev サーバーは既に起動中、HMR で本スライスの
   フロント変更が反映されているはず)。
2. チャート右端 -- 実線が確定点の終端、そこから破線が**1区間だけ**続く(中抜きマーカーは1個のみ、
   SH-16 時点の2個から減っている)。
3. 破線区間の点(未終了の足)にカーソルを合わせ、以下を確認:
   - **時刻の行**が現在時刻付近(`asOf`)になっている
   - **範囲注記の行**が `HH:MM–HH:MM の足（未終了）` になっている(琥珀色)
4. 実線区間の適当な点(確定点)にカーソルを合わせ、範囲注記が `HH:MM–HH:MM の足`
   (「未終了」なし、グレー)になっていることを確認。
5. 日付をまたぐ足(例: `20:00` 始まりの点、UTC 20時台)があれば、範囲注記が
   `20:00–00:00 の足` と正しく出ることを確認(`24:00` にならないこと)。

## ★起動手順(SF_HISTORY_ALLOWED_ORIGINS 込み)

API は本スライスのコードで**既に再起動済み**(実装担当が `app.py` 変更後、環境変数付きで再起動し、
上記(a)(b)(c)(d)(g)の実測をこのプロセスに対して行った):

```bash
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

```
# 開発サーバー(HMR 有効、既に起動中):
# http://localhost:5183/#/starforce
```

**再起動が要る場合は必ず上記の環境変数付きで行うこと**(環境変数なしで起動すると CORS で弾かれ、
画面は「装備一覧を取得できませんでした」しか出ない)。

## 残課題・watch-item

- ブラウザでの実クリック確認(ツールチップのホバー)は、実装担当の環境にブラウザ操作ツールがない
  ため未実施。API実測・pytest・フロント domain 層への実データ通し・コードパス追跡で代替した。
  **統括の実機確認が必須**(上記「ブラウザでの見え方」手順)。
- `tooltipProvisional`/`tooltipBucketNote` の2キーは6ロケールとも削除した。他画面・他コンポーネントで
  この2キーを参照している箇所がないことは `grep` で確認済み(`SfHistoryChart.jsx` とロケール定義
  以外に使用箇所なし)。
