# SH-11 完了報告 -- ローカル時刻表示 + 曜日×時間帯ヒートマップ

計画: `docs/IMPL_PLAN_SH11.md`。前提: SH-10 完了・統括検収済(`e131e73`)。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## コミット

1. `c6fadcb` -- `feat(sh11): display page-wide local time with weekday + explicit timezone`
2. `c4ebc46` -- `feat(sh11): add weekday x time-of-day median heatmap`
3. 本コミット -- `docs(sh11): SH-11 plan + completion report`(本ファイル + 計画書)

変更ファイル:
- `exp_ranking/web/src/sfhistory/domain/format.js` -- `formatAxisDate`/`formatTooltipDate`/`formatTimestamp`
  が `{ locale, timeZone }` を受けローカル時刻+曜日を返すよう変更(`timeZone` 省略時は
  `localTimeZone()` = 実行環境のローカルゾーン)。新規 `localTimeZone` / `formatTimeZoneLabel` /
  `weekdayShortLabel` / `formatClockTime`
- `exp_ranking/web/src/sfhistory/domain/format.test.js` -- 上記の再テスト(TZ 固定でホスト非依存)
- `exp_ranking/web/src/sfhistory/domain/weekdayStats.js`(新規)-- 7曜日×6枠の集計純粋関数
- `exp_ranking/web/src/sfhistory/domain/weekdayStats.test.js`(新規)
- `exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx` -- 軸/ツールチップをローカル時刻化
- `exp_ranking/web/src/sfhistory/components/CalcConditions.jsx` -- 時刻行のローカル化 + タイムゾーン明示行
- `exp_ranking/web/src/sfhistory/components/WeekdayHeatmap.jsx`(新規)
- `exp_ranking/web/src/sfhistory/SfHistoryRoot.jsx` -- `fullSeries` を取り出し `WeekdayHeatmap` に配線
- `exp_ranking/web/src/sfhistory/sfhistory.css` -- ヒートマップの罫線・配色クラス
- `exp_ranking/web/src/i18n/locales/*.json` -- 6ロケール同時(`conditions.displayTimeZone` +
  `heatmap.*` 9キー)

**`server/` は1バイトも変更していない**(後述 (h))。

## (a) 時刻表示の実例(変更前 → 変更後)

サンプル instant: `2026-08-04T11:00:00Z`(実データの4hバケット開始時刻)。

| 箇所 | 変更前(SH-10 まで) | 変更後(本スライス、JST 環境の例) |
|---|---|---|
| チャート軸 | `08/04` | `08/04 (火)` |
| ツールチップ | `2026-08-04 11:00 UTC` | `2026-08-04 20:00 (火)` |
| 計算条件「履歴の最終更新」 | `2026-08-04 20:00 UTC` | ローカル時刻 + 曜日(同じ関数) |

データ(`date` の ISO 文字列)自体は一切変えていない -- `new Date(isoDate)` に渡す文字列は
SH-10 までと同一で、表示関数の `{ locale, timeZone }` オプションのみが新規。

## (b) ja/en/zh-TW の曜日名実測

同じ instant を3ロケールで(`Intl.DateTimeFormat` 経由、ハードコード表なし):

```
ja     axis(JST): 08/04 (火)      tooltip(JST): 2026-08-04 20:00 (火)
en     axis(JST): 08/04 (Tue)     tooltip(JST): 2026-08-04 20:00 (Tue)
zh-TW  axis(JST): 08/04 (週二)    tooltip(JST): 2026-08-04 20:00 (週二)
```

th/vi/es も含む6ロケール全曜日(`weekdayShortLabel(0..6, locale)`)は
`format.test.js`([weekdayShortLabel] describe ブロック)に固定 -- 42アサーション全緑:

```
ja     日 / 月 / 火 / 水 / 木 / 金 / 土
en     Sun / Mon / Tue / Wed / Thu / Fri / Sat
zh-TW  週日 / 週一 / 週二 / 週三 / 週四 / 週五 / 週六
th     อา. / จ. / อ. / พ. / พฤ. / ศ. / ส.
vi     CN / Th 2 / Th 3 / Th 4 / Th 5 / Th 6 / Th 7
es     dom / lun / mar / mié / jue / vie / sáb
```

6言語×7曜日を手で持つ表はコード中に存在しない(`weekdayShortLabel`/`weekdayShort` は
固定の基準日曜日1つを `Intl` に渡すだけ)。

## (c) タイムゾーン明示の文言

計算条件欄に新規1行:

```
ja: 表示時刻: お使いの端末のタイムゾーン(UTC+9)
en: Displayed time: your device's timezone (UTC+9)
```

`formatTimeZoneLabel` の実測(`Intl` の `shortOffset` を `GMT`→`UTC` に置換):

```
Asia/Tokyo        -> UTC+9
UTC               -> UTC
America/New_York  -> UTC-4  (夏時間, 2026-08-04時点)
```

## (d) 42セル / n の合計 = 確定点数

実データ(`Arcane Umbra Staff` itemId `1382265`、☆0→17、150日、`/sf-history/prices` 実測):

```
points.length        = 899 (確定898 + 暫定1)
buildExpectedSeries 後、expected != null かつ非暫定の件数 = 898
buildWeekdayHeatmap(series, "UTC").cells.length = 42  (7 x 6、常に固定)
totalHeatmapCount(cells) = 898  ← 確定点898件と完全一致(取りこぼしゼロ)
```

`weekdayStats.test.js` の "n across all 42 cells sums to exactly the confirmed, non-null point
count" が合成データで同じ性質を固定。

## (e) ★統括の実測との一致

UTC 基準(統括の測定と同じ基準)、実データ(`itemId=1382265`、☆0→17、150日、
`buildWeekdayHeatmap(series, "UTC")` の生成結果から曜日別に再集計):

| 曜日(UTC) | 統括の実測(§0) | 本実装での再現(現在時点のデータ) | 差 |
|---|---|---|---|
| 木 | 304.2M (+7.2%) | **304.2M (+7.2%)** | 完全一致 |
| 日 | 302.7M (+6.7%) | 301.9M (+6.4%) | 0.8M(データが数時間分進んだことによる自然なドリフト) |
| 水 | 267.0M (−5.9%) | **267.0M (−5.9%)** | 完全一致 |
| 火 | (−5.5%) | **268.1M (−5.5%)** | 完全一致 |

全体中央値: 統括 283.7M ≒ 本実装 283.7M(`283,660,707.6`)。

**曜日間の開き**: 最高(木 304.2M)と最低(水 267.0M)の差 37.2M /水 267.0M = **13.9%**
(統括の報告値と一致)。

**42セル間の開き**: 最低セル(水・UTC20:00枠、n=21、258.0M)と最高セル(木・UTC08:00枠、n=21、
324.1M)の差 66.1M / 258.0M = **25.6%**(統括の報告値と一致)。

日曜だけ 0.3pt ずれているのは、集計対象の150日ウィンドウがサーバーの生きているデータに対して
毎時間スライドしているため(統括の測定時点から数時間分、確定点の内容が進んでいる)。
木・水・火の3曜日が小数点まで完全一致していることから、**集計方法(UTC基準の曜日別中央値)は
統括の測定と同一である**と判断した(停止条件3には該当しない)。

### ローカル基準の値(参考、JST)

同じデータを `buildWeekdayHeatmap(series, "Asia/Tokyo")` で見た場合(表示上はこちらが画面に出る):

```
Sun 295.2M  Mon 287.6M  Tue 273.8M  Wed 270.8M  Thu 290.0M  Fri 298.4M  Sat 279.9M
列見出し(ローカル開始時刻、UTC 0/4/8/12/16/20 起点): 01:00 / 05:00 / 09:00 / 13:00 / 17:00 / 21:00
```

UTC 基準と数値が変わるのは当然(同じ4hバケットが指す曜日・時刻がタイムゾーン変換でずれるため)
-- 傾向(木・金あたりが高い、水が安い)自体は UTC 基準と大枠で整合している。

## (f) 暫定点を含めない確認

実データの暫定点(`itemId=1382265` の末尾点):

```
{ date: "2026-08-05T04:00:00Z", expected: 276,888,978.57, provisional: true }
→ (weekday=Wed(UTC), bucketSlot=1)
```

このセルを **除外した場合(正しい実装)**: `n=21, median=283,459,014.15`
**誤って含めた場合**: `n=22, median=280,173,996.36`(中央値が約1.2%変わる = 数値が変わることを確認)

`weekdayStats.test.js` の "excludes a provisional point from both n and the median" が
この性質を合成データで固定。

## (g) 再計算 <n> ms / 期間タブ非連動の確認

実データ(899点、150日)で `buildWeekdayHeatmap` を計測(Node, `performance.now()`):

```
初回呼び出し(Intl.DateTimeFormat 未キャッシュ、実運用でも最初の1回だけ発生): 19.8 ms
以降(フォーマッタキャッシュ後、200回平均):                                    5.5 ms
```

**200msの停止条件を大きく下回る**(初回でも約1/10)。当初の素朴な実装(`Intl.DateTimeFormat` を
ループ内で毎回 `new` していた)は44ms/回だったため、`weekdayStats.js` にタイムゾーンごとの
フォーマッタキャッシュを追加して最適化した(振る舞いは無変更、`weekdayStats.test.js` 14件は
最適化の前後で全緑)。

**期間タブ非連動の確認**: `SfHistoryRoot.jsx` は `WeekdayHeatmap` に `fullSeries`(150日分、
`buildScreenModel` が `sliceByPeriod` する前の系列)のみを渡し、`period`/`periodSeries` は
渡していない(コード上、`WeekdayHeatmap` は `period` を一切知らない)。期間タブを 7D/30D/90D に
切り替えても `fullSeries` は変化しないため、ヒートマップは構造的に再計算されない。

## (h) `npm run test` / `npm run build` / `server/` 差分ゼロ

```
cd exp_ranking/web && npm run test -- --run
  Test Files  40 passed (40)
  Tests       414 passed (414)   (SH-10 時点の 384 + 本スライスの新規30: format.test.js +16 + weekdayStats.test.js(新規) +14)

cd exp_ranking/web && npm run build
  success (dist/index.html 2.71kB, index-*.css 103.61kB, index-*.js 1,116.82kB / gzip 318.03kB
            -- 既存のチャンクサイズ警告のみ、新規警告なし)

git diff --stat -- server/
  (出力なし = 差分ゼロ)
```

## (i) 6ロケールのキー数

```
ja/en/zh-TW/th/vi/es  すべて 388キー(揃っている。localeParity.test.js が6件全緑)
```

`git diff -w -- exp_ranking/web/src/i18n/locales/` は各ファイル +12行のみ(`heatmap.*` 9キー +
`conditions.displayTimeZone` 1キー、既存行の書き換えなし)。当初 JSON 全体を Python で
再シリアライズする素朴な方法を試したところ、`ja.json` の無関係な既存キー
(`shareImage.goalHint`)のエスケープ表記(`\uXXXX` → リテラル文字)が意図せず変わる実質差分が
出たため、その版は破棄し、`Edit` による対象行のみのピンポイント挿入でやり直した
(`git diff -w` で無関係行の差分ゼロを確認済み)。改行コードは全ファイル CRLF で統一(混入なし、
`bare LF` バイトカウント全ファイル0を確認済み)。

## (j) SH-7〜SH-10 の性質維持

`npm run test` 414件全緑に、以下の既存テストがすべて含まれ、無改変で緑:

- SH-7: 暫定点は `computeStats`/`currentPercentile` から常に除外(`series.test.js`)
- SH-8: `asOf` の素通し・確定点には付かない(`series.test.js` / `sfHistorySource.test.js`)
- SH-9: エイリアス検索・装備グループ共通表示(`equipmentSearch.test.js`)
- SH-10: テーマ(4色×3深度)・共有ノート位置(`viewModel.test.js` 含む既存回帰)
- ナビ3リンク・alias 検索・maxStar ガードは `series.js`/`viewModel.js` を1行も変更していない
  (今回の変更はすべて表示層 `format.js`/コンポーネント/新規 `weekdayStats.js` に閉じている)

## ブラウザでの見え方(統括の実機確認用の再現手順)

**装備**: `Arcane Umbra Staff`(検索で "Arcane Umbra Staff"、または既定の武器系グループ）。
**期間**: 150D(既定)。**範囲**: ☆0→17(既定プリセット)。

1. `http://localhost:5183/#/starforce` を開く。
2. チャートの X 軸ラベルが `MM/DD (曜)` 形式になっている(ローカルタイムゾーンでの日付)。
3. チャート上の点にカーソルを合わせる -- ツールチップ1行目が `YYYY-MM-DD HH:MM (曜)` 形式。
4. 画面下部の「計算条件」に **「表示時刻: お使いの端末のタイムゾーン(UTC+9 等)」** の行がある
   (「履歴の最終更新」「現在価格の取得時刻」もローカル時刻+曜日になっている)。
5. チャートとタイムゾーン行の間に **「曜日 × 時間帯」ヒートマップ**が表示される:
   - 7行(曜日)× 6列(4時間枠)。列見出しは実際のローカル時刻(JST なら 01:00/05:00/09:00/13:00/
     17:00/21:00 のような非キリのよい値になりうる -- 丸めていない)
   - 各セルに中央値(compact 表記)と `n=` 件数
   - セルにカーソルを合わせると正確な値と件数がツールチップで出る
   - 最安セル・最高セルに枠線("最安"/"最高" の小バッジ付き)
   - サブタイトルに「過去150日全体の傾向(期間タブとは連動しません)」の注記
   - 下に「中央値とデータ件数(n)を示すものであり、特定の曜日・時間帯での強化を推奨するものでは
     ありません。」の断り書き
6. 期間タブ(7D/30D/90D)を切り替えても、上のチャートは変わるがヒートマップは**見た目が変わらない**
   ことを確認(§(g) の非連動)。
7. 言語ピッカーで ja/en/zh-TW などに切り替えると、軸・ツールチップ・ヒートマップの曜日名が
   それぞれの言語で表示される。

## ★起動手順(SF_HISTORY_ALLOWED_ORIGINS 込み)

```bash
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

```
# 開発サーバー(統括の確認時点ですでに起動中、HMR 有効。JS/JSX/CSS のみの変更のため再起動不要のはず):
# http://localhost:5183/#/starforce
```

## 残課題・watch-item

- ヒートマップの列見出し(ローカル時刻)は「その UTC バケット枠で観測された最新の点」1つから
  算出している。対象タイムゾーンが夏時間(DST)を採用している場合、150日ウィンドウの前半と後半で
  実際のオフセットが1時間変わりうるが、列見出しは常に「今」に近い側のオフセットを表示する
  (design/plan の「丸めない」の趣旨に沿うが、DST 圏では見出しが期間の一部の実測値と厳密には
  1時間ズレる余地がある。JST 等 DST のない地域では発生しない)。
- ブラウザでの実クリック確認(ヒートマップのホバー、言語切替の見た目)は、実装担当の環境に
  ブラウザ操作ツールがないため実施できていない。API 実データ・純粋関数のユニットテスト・Vite の
  トランスフォーム成功(構文/インポートエラーなし)で代替した。**統括の実機確認が必須**。
