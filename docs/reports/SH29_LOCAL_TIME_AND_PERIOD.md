# SH-29 完了報告 -- ローカル時刻の併記 / 14日の追加 / ヒートマップを期間に連動

計画: `docs/IMPL_PLAN_SH29.md`。前提: SH-28 完了・統括検収済。実施日: 2026-08-06。
ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。ユーザー指示 2026-08-06(身内フィードバック起点)。

**本スライスは D において SH-11 §3-2「ヒートマップは期間タブに連動しない」を反転する**(ユーザー裁定)。
理由: 「先週はどうだったかという直近の生データが見たい。150日が見たいなら150日を選べばいい」。
性能は理由にならない(統括実測 0.5ms)。

## コミット

1. `8935b7b` -- `feat(sh29a): chart tooltip shows UTC + local time (dual display)`
2. `7fce6fa` -- `feat(sh29b): heatmap column headers show local time, UTC kept below`
3. `a588b44` -- `feat(sh29cd): add 14D period tab; link heatmap to the period tab`
4. 本コミット -- `docs(sh29): SH-29 completion report`

いずれも `git add -A` は不使用。各コミットは触ったファイルのみ個別 `git add`。

## (a) ツールチップの2重表示(実例)

サンプル instant: `2026-08-04T11:00:00Z`(実行機のローカルゾーンは Asia/Tokyo)。

```
formatTooltipDate(UTC, 主)       -> "2026-08-04 11:00 UTC (Tue)"
formatTooltipDateLocal(ローカル, 従) -> "2026-08-04 20:00 UTC+9 (Tue)"
```

`ChartTooltipContent`(`SfHistoryChart.jsx`)は UTC 行の直下に、より小さいフォント
(`text-[11px] text-slate-500`)でローカル行を追加表示。ゾーンは `formatTimeZoneLabel`
(`Intl`の`shortOffset`、"GMT+9"を"UTC+9"に置換)で必ず明示 -- ラベルなしのローカル時刻は出さない。

**軸ラベルは UTC のみのまま**(判断: 計画§1が許容する裁量。軸は`minTickGap={24}`で既に間引かれており、
2段表示にすると重なるか間引きがさらに強まるため、UTC単独を維持。判断はコード上のコメントにも明記)。

足のラベルは終了時刻のまま(SH-18)・進行中の足は現在時刻(`asOf`)のまま(SH-17) -- `bucketDisplayDate`
は本スライスで無改変、`formatTooltipDateLocal`もそれが返した同じ instant を読むだけ。

## (b) ★ヒートマップ列のローカル表示(JST での左上)

```
formatLocalClockTime(0, 0)  -> "09:00"   (実行機ゾーン Asia/Tokyo で自動解決)
formatLocalClockTime(4, 0)  -> "13:00"
formatLocalClockTime(8, 0)  -> "17:00"
formatLocalClockTime(12, 0) -> "21:00"
formatLocalClockTime(16, 0) -> "01:00"
formatLocalClockTime(20, 0) -> "05:00"
```

`WeekdayHeatmap.jsx`の列見出し(左端=`bucketSlot 0`=UTC 00:00の列)がJSTで**09:00**を表示する
-- ユーザーの言葉「JSTなら9:00を左上のUTC0:00のところに表示する」どおり。

## (c) ★セルの中身が不変であることの確認方法と結果

**方法1: 差分の機械確認。** `git diff` で `domain/weekdayStats.js` の `buildWeekdayHeatmap` 関数
本体に **1行も変更がない**ことを確認(コミット2で追加したのは`heatmapSampleRange`という新規の
別関数のみ、コミット3+4でも`buildWeekdayHeatmap`は無改変)。既存の全42セルの割り当てテスト
(`weekdayStats.test.js`の"UTC-basis grouping"/"1枠ずれ"describe群)は**1行も書き換えていない**
(新規テストは末尾に追加のみ)。

**方法2: 実データでの直接確認。** 実運用API(`http://127.0.0.1:8785`)から
`Arcane Umbra Staff`(itemId `1382265`)/ 0→22 / 150日の実データを取得し、
`series.js`/`weekdayStats.js`(本番と同一の経路、新規計算コードなし)で
`[木][先頭列(UTC 00:00)]`セルを算出:

```
cell [weekdayIndex=4(木)][bucketSlot=0]: { n: 21, median: 2,251,528,084.11 }
このセルの列見出し -- UTC表示:   "00:00"
このセルの列見出し -- ローカル表示: "09:00"（JST）
```

**列見出しの文字列が変わっても、`n`と`median`は完全に同一のセルオブジェクトから読んでおり、
1ビットも変わっていない**(`formatClockTime`/`formatLocalClockTime`はどちらも表示専用の純関数で、
`buildWeekdayHeatmap`の出力にもセル参照(`cellByKey`によるキー検索)にも影響しない)。

∴ 「`[木][先頭列]`が『UTC 木曜 00:00 の足』を集めたセルのまま」であることを実データで確認済み。

## (d) UTC の併記

列見出しは2段: **ローカル時刻(主・大)の直下に固定UTC時刻(従・小、末尾に"UTC"付き)**
(例: `09:00` の下に `00:00 UTC`)。加えてグリッド上部に軸注記(`heatmap.axisNote`)を新設し、
「行=UTCの曜日、列=ローカル時刻({{zone}}。UTCは列見出しの下に併記)」を明示 -- ローカルだけを
出してUTCを消す表示にはしていない。行(曜日)ラベルはUTC基準のまま(SH-14/SH-18 無改変)。

## (e) 期間タブ 5種 / 既定 30日

`PERIOD_KEYS = ["7D", "14D", "30D", "90D", "150D"]`、`PERIOD_DAYS["14D"] = 14`。
`DEFAULT_PERIOD`は`"30D"`のまま(SH-27から不変)。`series.test.js`に14Dのスライス件数
(`14*6=84`)と`PERIOD_KEYS`/`PERIOD_DAYS`の一致を機械確認するテストを追加。

## (f) ★期間ごとの n(統括実測との一致)

`SfHistoryRoot.jsx`が`WeekdayHeatmap`へ渡す`series`を`fullSeries`→`periodSeries`に変更した後、
同じ実データ(itemId 1382265, 0→22)を`series.js`→`weekdayStats.js`の本番経路にそのまま通した結果:

```
期間     確定点   1セルのn      空セル
7D        41    0-1          1個
14D       83    1-2          0
30D      179    4-5          0
90D      539   12-13         0
150D     898   21-22         0
```

**統括の実測値と完全一致**(件数・n範囲・空セル数すべて)。検証スクリプトは`series.js`/
`weekdayStats.js`の既存関数(`buildExpectedSeries`/`sliceByPeriod`/`buildWeekdayHeatmap`/
`totalHeatmapCount`/`heatmapSampleRange`)をそのまま呼ぶだけで、新規の計算コードは書いていない
(検証専用の一時スクリプトはリポジトリ外の scratchpad に置き、コミットに含めていない)。

## (g) 標本数の注記(期間ごとの文言)

`heatmapSampleRange(cells)`は`Math.floor`/`Math.ceil`(総n / 42セル)で`{ low, high }`を返す
-- 統括の表の`low`/`high`と完全一致する式(上表で実証済み)。`WeekdayHeatmap.jsx`はこれを
「選択中の期間の集計です(1セルあたり約{{sampleRange}}点)」(ja)として1行表示
(en: "Aggregated over the selected period -- about {{sampleRange}} points per cell")。

- **42個の`n=`は復活させていない**(セル単体には従来どおり`n<5`の弱色化のみで数値は出さない)
- 旧注記「過去150日全体の傾向(期間タブとは連動しません)」は上記に**書き換え済み**
  (もう真実ではなくなったため -- D の反転を受けて実態に合わせた)
- 空セル(n=0)は既存の`heatmap.noData`("--"/"No data")表示のまま(無改変)

## (h) npm test / build / server 差分ゼロ

```
npm run test  -- 43 test files / 470 tests, all passed
npm run build -- 成功(vite v6.4.3, 約6.2〜6.7秒)
git diff --stat -- server/   -- 0行(本スライスの3コミットとも server/ 配下は一切触っていない)
```

## (i) 6ロケールのキー数

```
en / ja / es / th / vi / zh-TW  すべて 422キー(揃っている)
```
新規キー: `period.d14`(6ロケール共通)、`heatmap.axisNote`(6ロケール共通)。
`heatmap.title`から`(UTC)`を削除、`heatmap.periodNote`の値を書き換え(いずれもキー数不変の
値変更/1キー追加×2)。

## (j) SH-7〜SH-28 の性質維持

- 暫定点の中抜き丸表示・ツールチップの暫定注記(`ProvisionalDot`/`withChartColumns`/
  `tooltipBucketRange*`): `chartColumns.js`は本スライスで無改変。`SfHistoryChart.jsx`は
  ツールチップにローカル行を追加した以外は無改変
- 破線1点(暫定足)・意味色(`.sfh-delta-up`/`.sfh-delta-down`)・2桁表記(`formatCompactNeso`)・
  ID非表示(SH-28)・初期装備(`DEFAULT_INITIAL_ITEM_ID`, SH-26): いずれも本スライスで無改変
- `computeStats`/`currentPercentile`の算出式(`series.js`)は本スライスで**1行も変更していない**
  -- 期間連動は従来どおり(元々`periodSeries`を経由しており、D はヒートマップ側の入力だけを揃えた)
- `buildWeekdayHeatmap`(セル割り当て規則: UTC基準・木曜起点・終了時刻ラベル)は(c)で示した通り無改変
- `starforce.js` / 4hテーブル / `server/`配下: 一切触っていない

## 起動手順(参考、無変更)

```
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```
(本スライスは`server/`を変えないため API の再起動は不要)

```
cd exp_ranking/web
npm run dev
# http://localhost:5183/#/starforce
```

## 実装担当としての申し送り

- **(a)の軸は裁量によりUTC単独のまま**とした(判断根拠はコード内コメントとこの報告の両方に明記)。
  統括が2重軸を希望する場合は追加の軽微なスライスで対応可能
- コミット2(B)・コミット3+4(C+D)は、同じファイル(`WeekdayHeatmap.jsx`・6ロケールJSON)を
  段階的に触っているため、**それぞれのコミット単独の diff は意味のある部分集合**になるよう
  手動で切り分けた(`git add -p`の代わりに、各段階の完成形を個別にステージして順にコミット)。
  各コミット時点で`npm run test`/`npm run build`が単独で通ることを確認済み
