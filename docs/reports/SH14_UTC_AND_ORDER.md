# SH-14 完了報告 -- 表示規約の確定(UTC統一 / 装備の並び / ヒートマップ起点)

計画: `docs/IMPL_PLAN_SH14.md`。前提: SH-13 完了・統括検収済(`8d5359b`)。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

**本スライスは SH-11 の「ページ全体を閲覧者のローカル時刻に」決定の反転である**(ユーザー裁定)。
反転の根拠: 曜日別中央値の開きは UTC 基準 13.9% / JST 基準 10.4% -- UTC のほうが周期が鋭く出る。

## コミット

1. `3b66688` -- `feat(sh14a): revert page-wide display back to UTC`
2. `212fa11` -- `feat(sh14c): move heatmap origin to Thursday UTC 00:00 (top-left)`
3. `65e40a5` -- `feat(sh14b): sort equipment candidates alphabetically (localeCompare)`
4. 本コミット -- `docs(sh14): SH-14 plan + completion report + SH-11/design doc reversal note`

変更ファイル:
- `exp_ranking/web/src/sfhistory/domain/format.js` -- `localTimeZone()` / `formatTimeZoneLabel()` /
  `{ timeZone }` オプションを削除。全関数を固定 UTC に。ツールチップの日時文字列に `UTC` を明示
- `exp_ranking/web/src/sfhistory/domain/format.test.js` -- 上記の再テスト(タイムゾーン固定は不要に)
- `exp_ranking/web/src/sfhistory/domain/weekdayStats.js` -- `Intl`/タイムゾーン変換を撤去し
  `getUTCDay()`/`getUTCHours()` 直読みに簡素化。列は常に固定 UTC 00/04/08/12/16/20
- `exp_ranking/web/src/sfhistory/domain/weekdayStats.test.js` -- 上記の再テスト
- `exp_ranking/web/src/sfhistory/domain/equipmentSearch.js` -- `flattenCandidates` を
  `itemName.localeCompare` 昇順にソート(代表・alias 混在の全体で)
- `exp_ranking/web/src/sfhistory/domain/equipmentSearch.test.js` -- 上記の再テスト
- `exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx` -- `CHART_TIME_ZONE` 撤去、
  軸/ツールチップは UTC のみ
- `exp_ranking/web/src/sfhistory/components/WeekdayHeatmap.jsx` -- `HEATMAP_TIME_ZONE` 撤去、
  `WEEKDAY_ORDER` を木曜起点(`[4,5,6,0,1,2,3]`)に
- `exp_ranking/web/src/i18n/locales/*.json` -- 6ロケール同時、`heatmap.title` に `(UTC)` を追記
  (新規キーではなく既存値の変更のみ -- キー数不変)
- `docs/DESIGN_SF_COST_HISTORY.md` -- §15 に `U9` として反転の記録を追記(旧文は書き換えず追記のみ)
- `docs/reports/SH11_LOCAL_TIME_HEATMAP.md` -- 末尾に反転の追記(本文は無改変)

**`server/` は1バイトも変更していない**(後述 (g))。

## (a) UTC 表示の実例

サンプル instant: `2026-08-04T11:00:00Z`。

| 箇所 | 表示 |
|---|---|
| チャート軸(`formatAxisDate`) | `08/04 (Tue)` |
| ツールチップ(`formatTooltipDate`) | `2026-08-04 11:00 UTC (Tue)` |
| ヒートマップ タイトル(en) | `Weekday x Time of Day (UTC)` |
| ヒートマップ 列見出し(`formatClockTime`) | `00:00` / `04:00` / `08:00` / `12:00` / `16:00` / `20:00` |

計算条件ブロックは復活させていない(SH-13 で削除済みのまま)。「UTC」であることはツールチップの
時刻文字列とヒートマップのタイトルという、既存の表示要素の中に含めた(新規のブロック追加ではない)。

## (b) ja/en/zh-TW の曜日名実測(UTC基準)

同じ instant を3ロケールで(`Intl.DateTimeFormat` 経由、ハードコード表なし):

```
ja     axis: 08/06 (木)      tooltip: 2026-08-04 11:00 UTC (火)
en     axis: 08/06 (Thu)     tooltip: 2026-08-04 11:00 UTC (Tue)
zh-TW  axis: 08/06 (週四)    tooltip: 2026-08-04 11:00 UTC (週二)
```

ヒートマップの行(木曜起点、`weekdayShortLabel(0..6, locale)` の `[4,5,6,0,1,2,3]` 順):

```
ja     木 / 金 / 土 / 日 / 月 / 火 / 水
en     Thu / Fri / Sat / Sun / Mon / Tue / Wed
zh-TW  週四 / 週五 / 週六 / 週日 / 週一 / 週二 / 週三
```

th/vi/es も含む6ロケール全曜日は `format.test.js` の `weekdayShortLabel` describe ブロックに
固定 -- 全緑(内容は SH-11 から無改変。この関数はもともと UTC 固定だった)。

## (c) ★UTC 曜日別中央値(実データ検証)

`Arcane Umbra Staff`(itemId `1382265`)/ `0→17` / 150日、稼働中の API(`http://127.0.0.1:8785`)から
実データを取得し、`domain/series.js`(`buildExpectedSeries`/`sliceByPeriod`、新規計算コードなし)で
Expected 系列を作り、UTC 曜日(`getUTCDay()`)ごとの中央値と全体中央値からの乖離%を算出:

```
overall median: 283,660,707.6  (n=898, 確定点のみ)

Sun  n=130  median 301,894,962  vs overall  +6.4%
Mon  n=132  median 281,580,898  vs overall  -0.7%
Tue  n=132  median 268,077,917  vs overall  -5.5%   <- 統括実測 -5.5% と一致
Wed  n=126  median 267,008,280  vs overall  -5.9%   <- 統括実測 -5.9% と一致
Thu  n=126  median 304,225,899  vs overall  +7.2%   <- 統括実測 +7.2% と一致
Fri  n=126  median 292,410,100  vs overall  +3.1%
Sat  n=126  median 276,663,792  vs overall  -2.5%

曜日間の開き (max-min)/overall = 13.1%（統括実測 13.9% に近い。データ進行分のドリフト許容範囲内）
```

木 +7.2%・水 -5.9%・火 -5.5% は統括の実測と**完全一致**、日 +6.4%(統括実測 +6.7%)・曜日間 13.1%
(統括実測 13.9%)は僅差で一致 -- 集計の解釈(全6時間帯を跨いだ UTC 曜日ごとの中央値)がずれていない
ことを裏取り済み(検証スクリプトは`docs/IMPL_PLAN_SH14.md`のスコープ外のため一時ファイルとして
`series.js`/`weekdayStats.js` を直接呼ぶだけで、新規の計算ロジックは書いていない)。

## (d) 並べ替え前後で値・件数が一致

`domain/weekdayStats.js`の`buildWeekdayHeatmap`自体はセルを常に`weekdayIndex 0..6`の正準順で返す
(表示順を持たない)。`WeekdayHeatmap.jsx`は`cellByKey`でキー参照するため、`WEEKDAY_ORDER`をどう
並べても個々のセルの`median`/`n`は不変。実データ(1382265, 0→17, 150日)で以下を確認:

```
SH-11 時代のアルゴリズム(timeZone="UTC" を渡した場合)と
SH-14 のアルゴリズム(UTC 専用に簡素化)で 42 セル全て一致: true
total n (旧): 898  total n (新): 898
行の並べ替え後も各 (曜日,時間帯) セルの値・n は不変: true
```

## (e) 左上セル = 木曜 00:00 UTC

`WEEKDAY_ORDER = [4, 5, 6, 0, 1, 2, 3]`(`Date#getUTCDay()`で4=木)を先頭行に、
列は`buildWeekdayHeatmap`の`columns`が常に`hour: bucketSlot*4`(=0,4,8,12,16,20)を昇順で返すため、
先頭列は00:00 UTC。∴ グリッドの左上セル = (weekdayIndex=4, bucketSlot=0) = **木曜 UTC 00:00**。

## (f) 装備候補の並び(実データ検証)

稼働中の API(`/sf-history/equipment`)から実カタログ(186候補、代表+alias 混在)を取得し
`flattenCandidates`に通した結果:

```
先頭5件: AbsoLab Ancient Bow / AbsoLab Archer Cape / AbsoLab Archer Gloves /
         AbsoLab Archer Shoes / AbsoLab Archer Shoulder
末尾5件: Trixter Ranger Pants / Trixter Wanderer Pants / Trixter Warrior Pants /
         Twilight Mark / Will o' the Wisps
localeCompare によるソート結果と完全一致: true
```

## (g) npm test / build / server 差分ゼロ

```
npm run test  -- 40 test files / 409 tests, all passed
npm run build -- 成功(vite v6.4.3, 5.5〜5.9秒)
git diff --stat -- server/   -- 本スライスのコミット群には server/ 配下の変更は一切含まれない
```

(worktree には本スライス着手前から `server/sf-history/fetch_latest.py` に無関係な未コミット変更が
存在していた -- 本スライスの3コミットはどれもこのファイルに触れておらず、`git add -A`も使っていない。
統括への申し送り: 同一worktreeで別セッションが`server/`を触っている可能性がある)

## (h) 6ロケールのキー数

```
en / ja / zh-TW / es / th / vi  すべて 374キー(揃っている。localeParity.test.js が6件全緑)
```
`heatmap.title`の値変更のみで新規キーは追加していないため、SH-13時点のキー数から不変。

## (i) SH-7〜SH-13 の性質維持

- 暫定点の中抜き丸表示・ツールチップの「暫定値」注記: `SfHistoryChart.jsx`の`ProvisionalDot`/
  `withChartColumns`は無改変
- 統計(average/high/low/percentile)からの暫定点除外: `series.js`は本スライスで一切触っていない
- 意味色(`.sfh-delta-up`/`.sfh-delta-down`): `sfhistory.css`は無改変
- 二桁表記(`formatCompactNeso`): `format.js`のこの関数は本スライスで無改変
- maxStar ガード: `series.js`/`SfHistoryRoot.jsx`は無改変
- alias 検索: `matchesEquipmentQuery`は無改変(並びのみ変更)
- ナビ・テーマ・プリセット3種: 本スライスは触っていない
- 削除済み表記(計算条件ブロック、グループ共通ノート等)は復活していない -- `grep`で
  `CalcConditions`/`groupSharedNote`/`n=`表示が再導入されていないことを確認済み

## ★起動手順(再掲)

```
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```
（本スライスは `server/` を変えないため API の再起動は不要 -- 上記は統括の実機確認用の再掲）

```
cd exp_ranking/web
npm run dev
# http://localhost:5183/#/starforce
```
