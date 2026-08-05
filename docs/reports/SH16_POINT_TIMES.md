# SH-16 完了報告 -- 足の点は足の時刻 / 現在値は自分の時刻に独立して置く

計画: `docs/IMPL_PLAN_SH16.md`。前提: SH-15 完了・統括検収済(`8a994c1`)。ユーザー実機レビュー起点。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## コミット

1. `dfaef8d` -- `fix(sh16): the point is either the bucket's own time or the live current-value time, never a mix`
   (`server/sf-history/app.py` / `server/sf-history/tests/test_app.py` / `server/sf-history/README.md`)
2. `e77e027` -- `fix(sh16): chart tooltip always shows the point's own time, no asOf branch`
   (`exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx`)
3. 本コミット -- `docs(sf-history): SH-16 plan + review`(本ファイル + 計画書)

いずれも単独 revert 可(サーバー側/フロント側/docsで分離)。`git push` は未実施。

## (a) `/prices` 末尾4点の `date` / `provisional` / `current`

実機(ローカル API `127.0.0.1:8785`、実データ、itemId `1003720`、2026-08-05 07:00 UTC 台):

```
GET /sf-history/prices?itemId=1003720
  points[897]: { date: "2026-08-04T20:00:00Z" }                                            confirmed
  points[898]: { date: "2026-08-05T00:00:00Z" }                                            confirmed
  points[899]: { date: "2026-08-05T04:00:00Z", provisional: true }                          in-progress bucket(hourly由来)
  points[900]: { date: "2026-08-05T06:40:00Z", provisional: true, current: true,
                 asOf: "2026-08-05T06:40:00Z" }                                             live current-value
  provisionalDate: "2026-08-05T06:40:00Z"
  endDate:         "2026-08-05T00:00:00Z"   (最終確定足。SH-3 以来不変)
  points.length:   901
```

ちょうど1件だけ `current: true`(単体テスト
`test_prices_in_progress_bucket_with_hourly_data_is_its_own_provisional_point` で固定)。

チケットの例「`20:00`(実線)→`00:00`→`04:00`→`06:20`」の並びを実データで再現できた(この時点の実測では
2巡目の 4h 集計ジョブが `00:00` バケットまで既に確定済みだったため、`00:00` は暫定ではなく確定点になって
いる -- これは正しい挙動で、SH-16 の変更対象ではない。実線区間が1つ伸びているだけで、4点の並び自体は
チケットの想定どおり)。

## (b) 現在値の点の `date == asOf`

上記実機データで `points[900].date === points[900].asOf === "2026-08-05T06:40:00Z"`。
`test_prices_provisional_point_carries_asOf_from_latestUpdatedAt`(更新済み)と
`test_prices_in_progress_bucket_with_hourly_data_is_its_own_provisional_point`(新規)で固定。

`asOf` が無い(上流が `latestUpdatedAt` を返さない)場合は `date` を進行中バケットの開始時刻へフォールバック
させる(`asOf` 自体は発明しない -- SH-8 §2-1 の "無い数字を発明しない" を継承)。
`test_prices_provisional_point_omits_asOf_when_upstream_did_not_provide_one`(更新済み)で固定。

## (c) ★時刻が全点で出る(「時間無し」の点がゼロ)

**確認方法**: サーバーの `/prices` を実際に叩き、フロントの `domain/series.js#buildExpectedSeries` →
`domain/format.js#formatTooltipDate` まで実データを通し、901点すべてで空文字("" = 表示不能)にならないか
を確認するスクリプトを実行(`exp_ranking/web` から `node` で直接、Vite なしで domain 層を import)。

```
points: 901
points with no time label: 0 / 901
```

**原因の確認**: `SfHistoryChart.jsx` の `ChartTooltipContent` から `provisional && !asOf` で `null` を返す
分岐(旧コード)を完全に削除し、常に `formatTooltipDate(point.date, ...)` を呼ぶだけにした
(`point.date` は SH-16 のサーバー側変更により全点で必ず実時刻を持つ -- 確定点はバケット開始、暫定バケッ
トはバケット開始、進行中バケット点もバケット開始、現在値の点は `asOf` そのもの)。

SH-13 が導入した「完成済みだが未保存」の暫定点(`asOf` を持たない)がこの旧分岐で時刻を失っていたバグは、
分岐そのものを消したことで構造的に再発しえない。

## (d) ★位置と時刻の一致(軸の扱い)

`SfHistoryChart.jsx` の `XAxis` は `dataKey="date"` のまま変更していない(recharts のカテゴリ軸、
`data` 配列の並び順で描画位置が決まる、実測どおりの文字列を評価しない)。現在値の点の `date` が
`asOf`(ISO文字列、他の点と書式は同じ)になっても、カテゴリ軸としては「配列内でもう1つのカテゴリが増える」
だけで、軸の型を変える必要は生じなかった(**停止条件1には該当しなかった**)。`points.extend(...)` の
追加順(バケット由来の暫定点 → 進行中バケット点 → 現在値の点)がそのまま配列順=描画順になるため、
時系列順も保たれる。

ツールチップの時刻ラベルは `formatTooltipDate(point.date, ...)` を直接読むので、現在値の点は
`asOf`(= 自分の `date`)がそのまま表示される -- 位置(x軸のカテゴリ)と時刻表示が同じ1つの値から
導出されるため、構造的に食い違いえない。

## (e) 統計不変(改竄テスト込み)

`domain/series.js` の `computeStats` / `currentPercentile` / `buildWeekdayHeatmap`
(`domain/weekdayStats.js`)は1行も変更していない -- いずれも既存の `point.provisional` フィルタのみで
除外しており、現在値の点(`provisional: true`)は改修後も自動的にそのフィルタに掛かる。

サーバー側 pytest(`test_prices_in_progress_bucket_with_hourly_data_is_its_own_provisional_point`)で
4h テーブルの行数・ハッシュ不変を確認。フロント側は実データで改竄比較を実施:

```
stats baseline:  { average: 43867648.88, high: 105928688.53, low: 21850014.72, count: 899 }
stats tampered:  { average: 43867648.88, high: 105928688.53, low: 21850014.72, count: 899 }
  (在進行中バケット点・現在値点の expected を 999999999 / 1 に振っても完全一致)
stats identical: true
currentPercentile: 12.57 (改竄後も不変。count が899のまま = 確定点のみ)
```

`series.test.js` 側の既存の改竄テスト(SH-7由来、`provisional: true` を極端値に振っても
`computeStats`/`currentPercentile` が不変)も無改変のまま緑(本スライスは `series.js` を1行も
変更していないため)。

## (f) 4h テーブル不変

**本スライスの `server/sf-history/app.py` の変更はレスポンス辞書の組み立てのみ**(`sf_price_history_4h`
への書き込みは一切なし、`db.replace_4h_rows`/`db.upsert_hourly_rows` を呼ぶ経路自体が存在しない)。

計画書に記載の基準値(`577792 / 707de4ad3f05de93`、SH-15 検収時点のスナップショット)は、統括が並行して
走らせていた `scripts/update.py`(実データの継続取得+差分4h集計)によって、本スライスの作業中に既に
先へ進んでいる(想定どおりの正当な成長 -- 本スライスの範囲外)。そのため絶対値としては一致しないが、
**本スライスのコード実行の前後**で不変であることを直接ブラケットして確認した:

```
before: rows=578396  hash=1d7bdba2c5fe65f3f9cbad2dec46ca1bb93a96a67560eb7acd02a88f1317653d
  (itemId 1003720/1003797/1012757/1022232/1022277/1032241 の /prices を計6回叩く)
after:  rows=578396  hash=1d7bdba2c5fe65f3f9cbad2dec46ca1bb93a96a67560eb7acd02a88f1317653d
```

**完全一致**。加えて既存の決定性テスト `test_prices_provisional_point_is_never_persisted_to_the_4h_table`
(無改変)と、新規テストの後処理での行数・ハッシュ比較(`test_prices_in_progress_bucket_with_hourly_data_is_its_own_provisional_point`)がどちらも緑。

## (g) 上流失敗時の挙動

`test_prices_upstream_failure_degrades_to_200_with_confirmed_history_only`(無改変)が緑のまま --
`prices` は 200、`provisionalDate is None`、`provisional` な点は0個(当然 `current: true` の点も0個)。
SH-7/SH-13 の劣化方向は不変。

## (h) `pytest` / `npm run test` / `npm run build`

```
cd server/sf-history && python -m pytest tests/ -q
  91 passed  (SH-15 時点の 88 + 本スライスの新規3: 変更2テストの再構成 + 新規1テスト)

cd exp_ranking/web && npm run test -- --run
  Test Files  40 passed (40)
  Tests       418 passed (418)   (フロントの新規テストは追加していない -- §6注記参照)

cd exp_ranking/web && npm run build
  success (dist/index.html 2.71kB, index-*.js 1,110.26kB / gzip 316.03kB
            -- SH-15 時点と同水準、既存のチャンクサイズ警告のみ)
```

## (i) 6ロケールのキー数

新規文言は追加していない(「現在値であることが分かる表示」は計画 §4 で明示的に**任意**とされており、
本スライスでは追加しない選択をした -- §6の判断メモ参照)。

```
ja/en/es/th/vi/zh-TW  すべて 377キー(SH-15 と同数、変化なし)
```

## (j) SH-7〜SH-15 の性質維持

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
20分スタンプ(SH-15)・maxStarガード(design §7.1)・alias検索(SH-9)・ナビ・テーマ、いずれも上記の
「触らないもの」に含まれるファイルを1行も変更していないため構造的に不変。既存テストも全て無改変のまま
緑(§h参照)。

## §6 判断メモ(実装担当の裁量で行った選択、統括レビュー用)

1. **進行中バケットの「自前の暫定点」**: 計画 §3「進行中バケットに hourly があれば暫定バケットとして出す」
   は、`aggregate.compute_buckets`(触らないもの指定)が経過未了バケットを常に除外する仕様のため、
   `aggregate.py` を経由せず `app.py` 側に**同じ「窓内で最後の `price_at` が勝つ」ルールを elapse ゲート
   抜きで**複製する形で実装した(新規計算ロジックだが、既存 `compute_buckets` の選択ロジックの写しであり、
   新しい計算式を発明したものではない)。DB書き込みには一切関与しない(§(f)参照)。
2. **`current: true` のフロント側消費は見送った**(計画 §4「任意」)。`exp_ranking/web/src/sfhistory/
   integrations/sfHistorySource.js` は §2 の「変わってよい」に明記されておらず、ここを触ると6ロケール
   文言追加も連動しかねない。ダッシュ線/中抜きマーカーは既存の `provisional` フラグだけで正しく効くため
   (現在値の点も `provisional: true`)、視覚的な区別は「暫定値(区間未終了)」の注記のまま出る
   (現在値の点にとってはやや不正確な文言だが、既存挙動から変えておらずスコープ最小)。**ユーザー実機
   レビューでこの文言が気になるようなら、`current: true` 専用の文言追加(6ロケール同時)を別スライスで
   検討可能**。
3. **フロント側コンポーネントの自動テストは追加していない**: `SfHistoryChart.jsx`(JSX描画)を検証する
   ユニットテストには `jsdom`/testing-library 相当の新規依存が要る(計画 §6-3 の停止条件「新規依存が
   必要になった」に抵触する)。この判断は SH-8 と同じ前例(「統括の実機確認が必須」)を踏襲した。代わりに
   本スライスでは実データを `domain/series.js`/`domain/format.js` に直接通す検証スクリプトで(c)/(e)を
   自動的に裏取りした(上記参照、コミットには含めていない一時スクリプト)。

## ブラウザでの見え方(統括の実機確認用の再現手順)

**装備**: `Chaos Von Bon Helmet`(itemId `1003720`)。**期間**: 150D(既定)。**範囲**: 既定(☆0→17など任意)。

1. `http://localhost:5183/#/starforce` を開く。
2. チャート右端 -- 実線が確定点の終端(直近は `2026-08-05 00:00 UTC` 前後、集計ジョブの進み具合で動く)、
   そこから破線で暫定点が続く。破線区間の途中(進行中バケットの暫定点、`04:00` 相当)にカーソルを合わせ、
   **時刻が表示されることを確認**(旧コードではここが空欄になりうるケースがあった)。
3. **チャート最右端の点**(現在値、中抜きマーカー)にカーソルを合わせ、**時刻が `asOf` そのもの
   (例: `06:40 UTC` 相当、バケット開始の `04:00`/`08:00` ではない)であることを確認**。
4. 画面下部の「Current」カード(SH-15 の20分スタンプ表示)の時刻と、上記③の時刻が**一致すること**を確認
   (両者とも同じ共有 `LatestPriceCache` エントリから読んでいるため、TTL内であれば一致する -- SH-8 §(e)
   の要求を継承)。
5. どの点にホバーしても**時刻の行が空欄になる点が無い**ことを一通り確認(特に破線区間、旧SH-13の
   「完成済みだが未保存」バケット相当)。

## ★ローカル起動手順(SF_HISTORY_ALLOWED_ORIGINS を必ず含める)

API は本スライスのコードで**既に再起動済み**(実装担当が `app.py` 変更後、環境変数付きで再起動し、
上記(a)〜(f)の実測をこのプロセスに対して行った):

```bash
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

```
# 開発サーバー(HMR 有効。JSX変更のみのため再起動不要のはず):
# http://localhost:5183/#/starforce
```

**再起動が要る場合は必ず上記の環境変数付きで行うこと**(環境変数なしで起動すると CORS で弾かれ、
画面は「装備一覧を取得できませんでした」しか出ない)。

## 残課題・watch-item

- §6-2 のとおり、`current: true` のフロント側消費(専用ラベル)は見送っている。ユーザー実機レビューで
  「現在値」であることを文言で示したいという要望が出れば、6ロケール同時の追加スライスで対応可能。
- ブラウザでの実クリック確認(ツールチップのホバー)は、実装担当の環境にブラウザ操作ツールがないため
  未実施。API実測・pytest・フロント domain 層への実データ通し・コードパス追跡で代替した。
  **統括の実機確認が必須**(上記「ブラウザでの見え方」手順)。
- `docs/reports/SH16_POINT_TIMES.md`(f)の基準値は統括の並行 `scripts/update.py` 実行により
  SH-15 検収時点の `577792/707de4ad3f05de93` から動いている(想定どおりの正当な成長、本スライスの
  範囲外)。今後このハッシュを基準に使う場合は都度再取得が必要。

---

# 統括検収(2026-08-05)— **合格**

## (a)(b)(c) 点の構造 — ユーザーの要望どおり

```
endDate         : 2026-08-05T00:00:00Z
provisionalDate : 2026-08-05T06:40:00Z

末尾4点:
  2026-08-04T20:00:00Z  確定
  2026-08-05T00:00:00Z  確定
  2026-08-05T04:00:00Z  暫定(足)
  2026-08-05T06:40:00Z  暫定 + current=true / asOf=2026-08-05T06:40:00Z

★date == asOf : True     ← 位置と時刻が一致
★date が無い点: 0        ← 「時間無し」の点が消えた
current の点  : ちょうど1
```

ユーザーの要望「`8/4 20:00` → `8/5 00:00` → `8/5 04:00` → 破線で `8/5 06:40`」を満たす。

## ブラウザ実機

```
実線1本 + 破線 5 4 / 中抜きマーカー 2個(= 暫定2点と一致)
現在値      : 302.30M   2026-08-05 06:40 UTC (水) 時点
現在の位置  : この期間の80%より安い
ヒートマップ: 最上段 木 = 373.38M
```

## (e) 統計不変 — 統括が別実行で確認

```
points 901 / confirmed 899
computeStats 一致 : true
heatmap 一致      : true
暫定・現在値を 999,999,999 に改竄しても一致 : true
count = 899(確定点のみ)
```

**現在値の点は `provisional: true` を持つので、統計の除外規約に自動的に乗る**
= 新しい除外ロジックを足していない。これが正しい設計。

## (f) 4h テーブル不変

`/prices` を6装備分叩いた前後で **578,396行 / `9c166fa7edee760f`** が一致。

> 行数が SH-15 検収時(577,792)から増えているのは、**統括が並行して走らせた
> `scripts/update.py`(616/616・429ゼロ・7,853行追加)が新しい足を materialize したため**であり、
> SH-16 のコードによるものではない。

## SH-8 との関係(反転ではなく精緻化)

SH-8 は「暫定点が足の境界時刻を出して**古く見える**」ことを嫌い、`asOf` を出す決定をした。
本スライスは**現在値を本当の時刻の位置に置く**ので、
- 足の点は足の時刻を出す(SH-8 が消していた時刻が戻る)
- 現在値は自分の時刻に立つ(SH-8 の意図がより正確に達成される)

∴ **SH-8 の決定を精緻化したものとして記録する**(反転ではない)。

## 実装担当の裁量判断(統括が確認・妥当)

- 進行中バケットの暫定点を、`aggregate.compute_buckets`(触らない対象)を経由せず
  **同じ「窓内最終 `price_at` 勝ち」ルールを `app.py` 側に複製**(DB 書き込みなし)。
  **触らない領域を守りつつ実現する手段として妥当**。ただし**同じ規則が2箇所に書かれた**ので、
  将来 4h の集約規約を変えるときは**両方**直す必要がある — **watch-item として記録**
- `current: true` 専用の文言は計画 §4 で「任意」としていたため見送り。**足の時刻が出るようになった今、
  追加の説明なしでも読める**と判断。妥当
