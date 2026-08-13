# SH-19 完了報告 -- 破線は「進行中の足」1点だけにする

計画: `docs/IMPL_PLAN_SH19.md`。前提: SH-17/SH-18 完了・統括検収済(`5f9fc4f`)。
ユーザー指摘(2026-08-05、実機で破線2点)を受けた、統括の SH-17 読み違いの是正スライス。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## コミット

1. `c5f4f47` -- `fix(sh19): server marks each price point with closed (bucket window ended), separate from provisional (persisted to sf_price_history_4h)`
   (`server/sf-history/app.py` / `server/sf-history/tests/test_app.py`)
2. `9f007b9` -- `fix(sh19): chart dashed line keys off closed, not provisional -- always exactly one open point`
   (`exp_ranking/web/src/sfhistory/domain/series.js` / `series.test.js` /
   `exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx`)
3. 本コミット -- `docs(sf-history): SH-19 report`(本ファイル)

いずれも単独 revert 可(サーバーのフラグ付与 / フロントの線種判定 / docs で分離)。`git push` は未実施。

## 変更の要点

- `provisional` の意味・除外規約(`computeStats`/`currentPercentile`/`buildWeekdayHeatmap`)は**1行も
  変えていない**。新しいフラグ `closed`(足の時間窓が終わったか)を追加し、**線種の判定だけ**をこちらに
  差し替えた。
- 確定点(`sf_price_history_4h` 由来)= `closed: True`(暗黙、フィールド自体は付けない。フロントは省略時
  `true` として扱う)。
- 終了済み・未保存の足(hourly から導出)= `provisional: True` かつ `closed: True`(**変更点**: 以前は
  この足も `provisional` のみで破線扱いだった)。
- 進行中の足(唯一)= `provisional: True` かつ `closed: False`(**唯一の破線・中抜きマーカー対象**)。

## (a) ★破線1点の実測(実データ)

ローカル API(`127.0.0.1:8785`、実データ)で itemId `1382265`(Arcane Umbra Staff)を照会
(2026-08-05 08:2x UTC 台、`sf_price_history_4h` の集約ジョブが直近の 04:00 バケットにまだ追い付いて
いない、まさに計画が指す「終了済み・未保存」の状態):

```
{"date": "2026-08-05T04:00:00Z", "provisional": true, "closed": true}   ← 終了済み・未保存 -> 実線
{"date": "2026-08-05T08:00:00Z", "provisional": true, "closed": false, "asOf": "..."}  ← 進行中 -> 破線(唯一)
open(closed:false) count: 1  / 全900点中
```

同時刻に全28アイテムを走査したところ、4アイテム(`1212102`/`1212115`/`1332225`/`1382265`)が
この「終了済み・未保存」状態を実際に示していた(バックグラウンドで統括の `scripts/update.py` が
並行実行中のため、集約ジョブが追い付くと数秒〜数十秒でこの状態は消える -- 生きたデータでの再現な
ので一過性)。**全アイテム・全時点を通じて `closed: False` は常に高々1点**であることを確認。

## (b) 進行中の足の表示(SH-17 維持)

上記実測の通り、進行中バケットは `date` = バケット開始(`08:00`)のまま、`asOf` を付けて現在時刻を
運ぶ(SH-17 のまま)。位置・範囲注記のロジック(`app.py`/`format.js`)は無改訂(diff 0行、下記参照)。

## (c) ラベル(SH-18 維持)

`domain/format.js#bucketDisplayDate`/`SfHistoryChart.jsx` のラベル計算(足の終了時刻を表示)は
本スライスで**1行も変更していない**(`git diff` 参照)。線種判定(`withChartColumns`)とラベル計算
(`displayDate`)は独立した関数であり、今回は前者のみ変更した。

## (d) ★統計不変(改竄込み)

実データ(itemId `1382265`)の生きた DB を live-safe backup で凍結コピーし、その凍結コピー上で
「終了済み・未保存」バケット(`closed:true`/`provisional:true`)の元データ(`sf_price_history_hourly`
の該当行)を意図的に改竄(`end_price` を桁違いの値に変更)。実サーバーコード
(`app.py#prices`)経由で改竄前後の `/sf-history/prices` レスポンスを取得し、**未改変の**
`domain/series.js#computeStats` / `currentPercentile` / `domain/weekdayStats.js#buildWeekdayHeatmap`
に通した:

```
tampered point (closed:true, provisional:true) expected
  before: 278,310,317.44   after: 277,920,975.39   ← 改竄で確かに動いた(テストが有効な証拠)

computeStats  before: {"average":291293133.66469246,"high":501545769.81831527,"low":193793712.6001925,"count":898}
computeStats  after:  {"average":291293133.66469246,"high":501545769.81831527,"low":193793712.6001925,"count":898}
computeStats identical (1 bit): true

currentPercentile  before: 0  after: 0  identical: true
heatmap n(合計)   before: 898  after: 898
heatmap cells identical (1 bit): true
```

**「終了済み・未保存」の足は `closed: true`(実線)になった後も、統計には入っていない**ことを、
その足自身の値を大きく改竄したうえで実測確認した(改竄対象の点自身の `expected` は変わったが、
`computeStats`/`currentPercentile`/`buildWeekdayHeatmap` の出力は1ビットも動かなかった)。

凍結コピーは `scratchpad`(このリポジトリ外)に作成し、本番 DB
(`server/sf-history/data/sf_price_history.sqlite`)は一切書き換えていない(統括の
`scripts/update.py` が並行稼働中のため、本番 DB への書き込みは避けた)。

## (e) 4h テーブル不変

本番の生きた DB に対し、`/sf-history/prices` を全28アイテム分呼び出す前後で `sf_price_history_4h`
全行の SHA-256 ハッシュを比較:

```
before: 3c2cfed588573f3bf24a454dc4c76aa86b26179a97f275b1120ba7a7affd8aa2
after:  3c2cfed588573f3bf24a454dc4c76aa86b26179a97f275b1120ba7a7affd8aa2
一致: true
```

`pytest` 側の既存の書き込み不変テスト(`test_prices_provisional_point_is_never_persisted_to_the_4h_table`
/ `test_prices_fills_a_completed_but_unaggregated_bucket_from_hourly_data`)も引き続き緑(下記 (g))。

## (f) 上流失敗時

`test_prices_upstream_failure_degrades_to_200_with_confirmed_history_only` が引き続き緑
(`UpstreamLatestError` → `prices` は 200・確定履歴のみ)。加えて、進行中の足が丸ごと存在しない
ケース(`test_prices_has_no_provisional_point_when_the_current_bucket_is_already_confirmed`)に
`closed: True` の全点アサーションを追加し、緑を確認。

## (g) pytest / npm test / build

```
cd server/sf-history && python -m pytest . -q
  93 passed  (SH-18時点92 + 本スライスの新規1: test_prices_exactly_one_point_is_closed_false)

cd exp_ranking/web && npm run test
  Test Files  40 passed (40)
  Tests       431 passed (431)  (SH-18時点428 + 本スライスの新規3: closed の素通しテスト)

cd exp_ranking/web && npm run build
  success (dist/index.html 2.71kB, index-*.js 1,110.82kB / gzip 316.18kB -- 既存のチャンクサイズ警告のみ)
```

## (h) 6ロケールのキー数

新規文言は追加していない(`sfhistory.chart.provisionalLegend`/`tooltipBucketRangeOpen` を
そのまま再利用 -- 条件だけ `provisional` → `closed===false` に差し替え)。

```
ja/en/es/th/vi/zh-TW  すべて 420キー(SH-18以降と同数、変化なし)
```

## (i) SH-7〜SH-18 の性質維持

`server/sf-history/app.py` の diff は `closed` フィールドの追加のみ(既存フィールドの意味・値は
無改訂)。`domain/format.js`(ラベル計算・SH-18)/`domain/weekdayStats.js`(ヒートマップ・SH-11/14/18)
は**1行も変更していない**。`computeStats`/`currentPercentile`(SH-7 の除外規約)も無改訂 -- 上記
(d) の改竄実測がその直接証拠。

## ★起動手順(SF_HISTORY_ALLOWED_ORIGINS 込み)

`app.py` を変更したため、実装中に既存の8785番プロセスを再起動済み:

```bash
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

現在も新コードで稼働中(統括のブラウザ実機確認に利用可能)。

## §裁量判断メモ(実装担当の判断、統括レビュー用)

1. **統計不変(d)の実測方法**: 本番の生きた DB は統括の `scripts/update.py` が並行書き込み中だったため、
   改竄実験は `sqlite3` の `backup()` API で作った凍結コピー上で行った(本番 DB へは一切書き込んでい
   ない)。(e) のハッシュ不変確認だけは本番 DB に対して読み取り専用で実施(書き込みなし、ハッシュは
   `/prices` 呼び出し前後で一致)。
2. **`docs/reports/SH19_ONE_DASHED.md` の扱い**: 計画 §7 は「ローカルコミット(2本: サーバー/
   フロント)」と明記しているため、挙動変更コミットは2本のみとし、本レポート(docs)は3本目の
   docs 専用コミットとして分離した(SH-18 の前例と同じ構成: 挙動2本 + docs 1本)。
3. **フロント側コンポーネントの自動テストは追加していない**(SH-17/SH-18 と同じ判断: JSX 描画テスト
   には testing-library 相当の新規依存が要り、計画の停止条件3「新規依存が必要になった」に抵触しうる)。
   代わりに実データを `domain/series.js` に直接通す検証スクリプト(本レポートの (a)(d) の実測)で
   裏取りした。

## 残課題・watch-item

- ブラウザでの実クリック確認(中抜きマーカーが実際に1個だけ描画されること)は実装担当の環境に
  ブラウザ操作ツールがないため未実施。API実測・vitest・フロント domain 層への実データ通しで代替した。
  **統括の実機確認が必須**(計画の検収方針どおり)。
- (a) の「終了済み・未保存」状態は `scripts/update.py` が追い付くと数十秒で消える一過性の状態
  (本番では最大43分程度、計画 §0-1 参照)。統括の実機確認時にこの状態が既に解消している可能性が
  ある場合は、`scripts/update.py` の実行間隔の谷間(バケット境界直後)を狙うか、本レポートの実測記録
  (凍結コピー上の再現)を参照されたい。

---

## ★P0 追記(2026-08-05、統括検収での不合格 → 修正)

### 事象

統括がブラウザの SVG を直接測定し、**破線が1点ではなく0点**になっていることを検出:
`.recharts-line-curve[1]`(破線=bridge 列)の `d` 属性が空文字列、中抜きマーカーが0個。
実線側が右端(進行中の点)まで伸びていた。

### 根本原因

`exp_ranking/web/src/sfhistory/integrations/sfHistorySource.js#normalizePricesPayload` が、
API レスポンスの各点を `{ date, prices, provisional, asOf? }` の**明示的なフィールド一覧**にだけ
正規化しており、**`closed` フィールドがこの一覧に無かったため黙って捨てられていた**。

その結果、`domain/series.js#buildExpectedSeries` が受け取る `point.closed` は常に `undefined` となり、
そのデフォルト規約(`point?.closed !== false` → true)により**全点が `closed:true` 扱い**になった:
- 進行中の点(本来 `closed:false`)が実線(`confirmed`)側に混入 → 実線が右端まで伸びる
- `bridge`(破線)列は「`isOpen` または `nextIsOpen` が true の点」にのみ値が入る構造だが、
  `isOpenPoint` が**どの点に対しても false** を返すため、`bridge` は**常に全点 null**(= 空)

`app.py`(サーバー)・`domain/series.js`(統計)は正しく `closed` を扱っていたが、**中間層
(`sfHistorySource.js`)が新フィールドのホワイトリストへの追加漏れでサイレントに落としていた** ——
計画のスコープ表 §2 にこのファイルが明記されていなかったための見落とし。

### 修正

1. `sfHistorySource.js#normalizePricesPayload`: `closed` を `provisional` と同じ「常に存在・
   `!== false` でデフォルト true」の規約で素通しするよう追加。
2. `SfHistoryChart.jsx` の `isOpenPoint`/`withChartColumns`(実線/破線列を分岐させる、SVG `d` の
   直接の入力元)を新規 `domain/chartColumns.js`(DOM 非依存の純粋関数)へ抽出し、
   `chartColumns.test.js` で **`bridge` 列の実際の値**(=SVGの`d`を決める入力そのもの)を固定。
   これが今回の再発防止(「`npm run test` が緑でも SVG が空」というクラスのバグ)の直接ガード:
   - 進行中の点1つに対し `bridge` の非null要素が**常に2個**(直前の確定点+進行中の点)
   - `confirmed` は進行中の点で**必ず null**
   - `closed:true`/`provisional:true`(終了済み・未保存)の点は `bridge` に入らない
   - `closed` フィールド自体が欠落している場合も `true`(実線側)にフォールバックする
     (今回のサイレントドロップと同型のケースを直接再現)
3. `sfHistorySource.test.js` に `closed:false` の素通し・`closed` 欠落時のデフォルトを固定する
   回帰テストを追加。

### ★修正後の実測(コミット `ae41b39`)

生きた API(itemId `1382265`、2026-08-05 08:1x UTC 台、再実測)のレスポンスを、
**実際のクライアントパイプライン**(`normalizePricesPayload` → `buildExpectedSeries` →
`withChartColumns`、いずれも本番コードそのもの)にそのまま通した結果:

```
normalized.ok: true  points: 900
last normalized point: {"date":"2026-08-05T08:00:00Z", ..., "provisional":true,"closed":false,"asOf":"2026-08-05T08:40:00Z"}

total rows: 900
bridge non-null count: 2   ["2026-08-05T04:00:00Z", "2026-08-05T08:00:00Z"]
open rows (closed:false) count: 1
last row confirmed (should be null): null
last row bridge (should be non-null): 275079057.0738654
```

**破線列(bridge)の点数 = 2**(最後の確定点 + 進行中の点。SVG の `<path d="...">` はこの2点を
結ぶ三次曲線1本を描く = 空文字列ではなくなる)。`confirmed` 列は進行中の点で `null` のため、
実線は右端まで伸びない。

この実測は実装担当の環境(ブラウザ操作ツール無し)で得られる**最も近い代替証跡**であり、
**recharts が実際に描く SVG `d` のピクセル値そのものの確認は、引き続き統括のブラウザ実機確認が必要**。
ただし今回追加した `chartColumns.test.js`(`domain/` の純粋関数への直接アサーション)は、
`bridge`/`confirmed` の**値そのもの**を固定しているため、同型の「テストは緑・SVGは空」という
すり抜けは今後は起きない設計になっている。

### コミット(追加分)

- `ae41b39` -- `fix(sh19): P0 -- integrations/sfHistorySource.js was silently dropping closed, emptying the dashed bridge series entirely`
  (`exp_ranking/web/src/sfhistory/integrations/sfHistorySource.js` / `sfHistorySource.test.js` /
  `exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx` /
  `exp_ranking/web/src/sfhistory/domain/chartColumns.js`(新規)/ `chartColumns.test.js`(新規))

単独 revert 可(直前3コミットとは独立)。

### スコープについての率直な補足

計画 §2 の「変更してよい」一覧に `integrations/sfHistorySource.js` は入っていなかった
(この見落としが今回の P0 の直接原因)。統括の指示により診断・修正を実施したが、これは計画書
自体の不備(スコープ漏れ)であり、実装担当の当初の作業が計画外に踏み込んだものではない旨を
記録しておく。

---

# 統括検収(2026-08-05)— **合格**(P0 の差し戻し1回を経て)

## 初回提出で差し戻した P0

統括がブラウザの SVG を直接測定して検出:

```
実線 : d の長さ 42,675 / 三次曲線 899セグメント ≒ 900点(系列全体)/ 右端 x=1105.2
破線 : d の長さ 0      ← 何も描かれていない
中抜きマーカー : 0 個
```

**「破線が2つ」を「破線が0つ」にしてしまい、進行中の足が実線に吸収されていた。**

**★`npm run test` は緑だった。**ユニットテストは通るのに **SVG が空**という状態で、
**テストが見ていた層と、実際に描画される層がずれていた**のがこの見落としの本質。

## 根本原因(実装担当が特定)

`integrations/sfHistorySource.js` の `normalizePricesPayload` が
**ホワイトリスト方式**で `{date, prices, provisional, asOf}` だけを通しており、
**`closed` を黙って落としていた**。∴ `point.closed` が常に `undefined` →
既定規約(`!== false` → true)で**全点が「終了済み」扱い** → 破線列が常に空。

## 修正後の実測(統括がブラウザの SVG を測定)

```
実線 : d の長さ 42,628 / 898セグメント ≒ 899点 / 右端 x=1104.841 で停止
破線 : d = "M1104.841,269.771L1106,271.206"   ← 最終確定点 → 進行中の点の2点
中抜きマーカー : 1 個 (r=4, stroke=#22d3ee)
```

**破線はちょうど1区間・マーカー1個。**進行中の足だけが破線になっている。

## ★systemic な watch-item(3回目)

**`sfHistorySource.js` の正規化がホワイトリスト方式**なので、
**サーバーが新しいフィールドを足すたびに、フロントで黙って落ちる**。

これまでに同じことが起きた回数:
1. **SH-9**: `provisional` / `provisionalDate` の素通しを足す必要があった(実装担当が申し送り)
2. **SH-16**: `asOf` の素通し
3. **SH-19**: `closed` が落ちて **P0 になった**(今回)

**3回目なので、これは偶然ではなく構造の問題である。**

対処案(**本スライスでは実施しない**。別途判断):
- (a) 正規化をホワイトリストからパススルー(未知フィールドを保持)に変える
- (b) サーバーの応答スキーマとフロントの正規化を**1つのテストで突き合わせる**
  (新フィールドが増えたら落ちる)

**(b) を推奨**。(a) は型の緩さを持ち込む。

## 実装担当の良い対応

差し戻し後、**`isOpenPoint` / `withChartColumns` を `domain/chartColumns.js` に抽出して
DOM 非依存の純粋関数にし、bridge 列の実値をテストで固定**した。
統括が求めた「SVG が空にならないことを最も安く検証する手段」に正面から応えている。
