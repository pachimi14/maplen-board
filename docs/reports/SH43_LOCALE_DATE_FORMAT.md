# SH-43 完了報告 -- 日付・時刻表記を各地域の標準に合わせる

計画: `docs/IMPL_PLAN_SH43.md`。実施日: 2026-08-22。作業ツリー: `C:\Users\pachi\Desktop\msu ranking`
(`main`、`9c7d0d2` の直上)。ユーザー指示 2026-08-22 →統括が実測提示→「現地で正しいようにして」
と裁定(計画 §0)。

## コミット

`git add -A` は不使用。触った2ファイル(`format.js` / `format.test.js`)+本報告のみ個別 `git add`。
コミットは1本、単独 revert 可、**push なし**。

## 変更内容

`exp_ranking/web/src/sfhistory/domain/format.js` の**表示専用関数のみ**変更。
呼び出し側(`SfHistoryChart.jsx` / `SummaryCards.jsx` / `WeekdayHeatmap.jsx` /
`SfHistoryRoot.jsx` / `DiscoveryRoot.jsx` / `DiscoveryCubeTable.jsx` /
`DiscoveryPriceTable.jsx` / `DiscoveryRecentList.jsx`)は**1行も変更していない**
(すべて `formatXxx(iso, { locale })` を既存のまま呼ぶだけなので、`format.js` 側の
戻り値が変わるだけで自動的に反映される)。

### 変えた関数(3つ、いずれも「年月日の並び」を持つもの)

| 関数 | 用途 | 変更 |
|---|---|---|
| `formatAxisDate` | チャート X 軸ラベル | `${month}/${day} (${weekday})` の手組み → `Intl.DateTimeFormat(locale, {month,day,weekday:"short"})` に一任 |
| `formatTooltipDate` | ツールチップ UTC 行 / New Equipment・Cube Prices の観測時刻・形成範囲 / SH-37 のフォーム済み注記 | `${year}-${month}-${day} ${hour}:${minute} UTC (${weekday})` の手組み → `Intl` の年月日順+曜日位置に一任し、末尾に文字列 `" UTC"` を付与(従来どおり非翻訳) |
| `formatTooltipDateLocal` | チャートツールチップのローカル時刻行(2次表示) | 同上、ゾーンは `timeZone` 引数のまま、末尾は `formatTimeZoneLabel()` の戻り値(JST/KST/`UTC+9`等、SH-31 のまま無改変) |

いずれも `year`/`calendar`/`hour12` を明示指定していない -- **`Intl` が対応ロケールの
既定の暦・時制を選ぶ**(計画 §1「Intl に委ねる」)。これが `th` のタイ仏暦(2569)を
特別扱いなしで実現している理由。

### 変えなかった関数(3つ、いずれも裸の "HH:MM"/曜日単体)

| 関数 | 理由 |
|---|---|
| `formatClockTime` / `formatLocalClockTime` | ヒートマップの列見出し。**裸の時刻には年月日順の曖昧さが無い**(この計画が解決する実害は月日の並びの取り違えであり、時刻には該当しない)。加えてヒートマップは6列を `minmax(0,1fr)` の狭い枠に収めており(`sfhistory.css` `.sfh-heatmap-grid`)、`hour12` を有効にすると en は "AM"/"PM"、zh-TW は "上午"/"下午" が付いて幅がほぼ倍増する実測(下記)。SH-29 がチャート軸を UTC 単独に留めた判断と同種の、狭い表示領域での実装判断として維持した |
| `formatBucketRange` | チャートツールチップの「区間 04:00–08:00」注記。同じく裸の時刻で年月日順は無関係 |
| `weekdayShortLabel` | 元から `Intl.DateTimeFormat(locale, {weekday:"short",timeZone:"UTC"})` そのもの(SH-14 以前から無改変)。本計画で変える理由が無い |

いずれもコード上は1バイトも変更していない(`format.js` に SH-43 の追記コメントのみ
`docstring` として追加、実体は既存のまま)。

## (e)/(f) 集計・判定の不変性(★最重要)

- **`buildWeekdayHeatmap`(`weekdayStats.js`)には触っていない** -- `git diff` 対象外
- **`series.js` / `chartColumns.js` / `priceGapFill.js` には触っていない** -- `git diff` 対象外
- **`price_at` / API 応答 / `server/` 配下は1バイトも触っていない**:
  ```
  $ git diff -w --stat -- server/
  (差分なし)
  ```
- 変更した3関数はいずれも**表示文字列を組み立てる最終ステップのみ**を差し替えており、
  受け取る `isoDate`(元の ISO 文字列)・`timeZone`(常に `"UTC"` または呼び出し側が渡す
  ゾーン)はどちらも一切変更していない -- 内部で日付をキーや比較に使っている箇所は無い
  (この3関数はいずれも「文字列を返すだけ」で、戻り値を計算や比較に使っている呼び出し元は
  存在しない -- 全呼び出し元は JSX の表示にしか使っていないことを grep で確認済み)
- `npm run test`(下記)で `series.test.js` / `chartColumns.test.js` / `priceGapFill.test.js` /
  `weekdayStats` 関連テストを含む全857件が無改変のまま緑

## (a) ★6ロケールの実際の表示文字列(3種以上)

同一瞬間 `2026-08-18T04:55:00Z`(UTC 火曜)で実測(Node v22.21.0、`Intl` はブラウザの
ICU と同じ実装系列):

### ツールチップ(UTC行、`formatTooltipDate`)

| ロケール | 表示 |
|---|---|
| ja | `2026/08/18(火) 04:55 UTC` |
| en | `Tue, 08/18/2026, 04:55 AM UTC` |
| zh-TW | `2026/08/18（週二） 上午04:55 UTC` |
| th | `อ. 18/08/2569 04:55 UTC` |
| vi | `04:55 Th 3, 18/08/2026 UTC` |
| es | `mar, 18/08/2026, 04:55 UTC` |

### チャート X 軸(`formatAxisDate`、同瞬間・年なし)

| ロケール | 表示 |
|---|---|
| ja | `08/18(火)` |
| en | `Tue, 08/18` |
| zh-TW | `08/18（週二）` |
| th | `อ. 18/08` |
| vi | `Th 3, 18/08` |
| es | `mar, 18/08` |

### 観測時刻・ローカル行(`formatTooltipDateLocal`、`Asia/Tokyo` 指定)

`2026-08-04T11:00:00Z` → JST `20:00`:

| ロケール | 表示 |
|---|---|
| en | `Tue, 08/04/2026, 08:00 PM JST` |
| ja | `2026/08/04(火) 20:00 JST` |

いずれも `format.test.js` に**文字列そのものを固定するテスト**として追加済み
(`(a)(b)(c) all 6 shipped UI locales render their own standard order for the same instant`)。

## (b)(c) タイの仏暦 / en・es・vi の日月順

- **(b)** `th` = `อ. 18/08/2569` -- **2569(仏暦)のまま**。`calendar` オプションを一切
  指定していない(`Intl` が `th` ロケールの既定暦=仏暦を自動選択)。西暦への固定は
  一切していない(ユーザー裁定どおり)
- **(c)** `en` = `08/18/2026`(月/日/年)、`es` = `18/08/2026`(日/月/年)、
  `vi` = `18/08/2026`(日/月/年、時刻が先頭に来る点は `vi` ロケールの `Intl` 既定の並びで、
  本計画が「委ねる」とした対象そのもの)-- いずれも各地域の標準どおり

## (d) UTC の明示

- `formatTooltipDate` / `formatTooltipDateLocal` とも末尾に文字列 `" UTC"`(または
  ローカル行ならゾーンラベル `JST`/`UTC+9`等)を**リテラルとして必ず付与** -- SH-14/SH-29 の
  既存規約を無改変で維持。6ロケールすべての実測(上表)で確認済み

## (g) 12時間制/24時間制の扱い(実測)

`hour12` を明示指定せず `Intl` の既定に委ねた結果:

| ロケール | 実際の時制 |
|---|---|
| ja | 24時間制(`04:55`) |
| en | **12時間制 + AM/PM**(`04:55 AM`) |
| zh-TW | **12時間制 + 上午/下午**(`上午04:55`) |
| th | 24時間制(`04:55`) |
| vi | 24時間制(`04:55`) |
| es | 24時間制(`04:55`) |

en/zh-TW のみ 12時間制になる。UTC の技術的な文脈(ツールチップ末尾の `UTC`)と
"AM"/"PM" が同居する見た目にはなるが、これは**各ロケールで実際にそう表記するのが標準**
という計画の前提どおりの結果であり、`hour12` を強制していないことの直接の帰結。
最終判断(この組み合わせで良いか)は統括に委ねる。

## (h) 3画面の統一

SF / New Equipment / Cube Prices の3画面はいずれも同じ `formatTooltipDate` /
`formatFormingBandRanges` / `groupFilledBands` を経由しており(grep で確認済み、下記)、
`format.js` 側の変更が自動的に3画面すべてに同時反映される。個別の書式分岐は
どの画面にも無い。

```
formatTooltipDate の呼び出し元:
  SfHistoryRoot.jsx (SH-37 の埋め注記)
  discovery/DiscoveryRoot.jsx (観測時刻)
  discovery/components/DiscoveryCubeTable.jsx (settledRange の start/end)
  discovery/components/DiscoveryPriceTable.jsx (settledRange の start/end)
  discovery/components/DiscoveryRecentList.jsx (settledRange の start/end)
```

## (i)(j) test / build / server 差分ゼロ / 6ロケールキー数一致

```
$ npx vitest run
 Test Files  66 passed (66)
      Tests  857 passed (857)
   Duration  1.79s

$ npm run build
✓ 2417 modules transformed.
✓ built in 6.15s
（チャンクサイズ警告は本変更と無関係の既存事象）

$ git diff -w --stat -- server/
(差分なし)

$ git diff -w --stat -- exp_ranking/web/src/i18n/
(差分なし)

$ 各ロケールの leaf key 数(node で再帰カウント):
en/es/ja/th/vi/zh-TW すべて 587 (一致)
```

## (k) 375px での崩れ

**この環境にはブラウザ操作/スクリーンショット手段が無く**(computer-use・Chrome MCP
いずれも本セッションの利用可能ツールに含まれていない)、実ピクセルでの目視確認は
できなかった。代わりに以下の**静的根拠**で判断した:

1. **テーブル系(SF/Cube Prices の settledRange)** -- `DiscoveryCubeTable.jsx` /
   `DiscoveryPriceTable.jsx` はいずれも既に `overflow-x-auto` + `min-width` の
   横スクロールコンテナに包まれている(`DISCOVERY_TABLE_MIN_WIDTH_PX`)。文字列が
   多少長くなっても**表自体が横スクロールするだけで、ページレイアウトは崩れない**
   (この既存パターンがまさに「言語によって文字列が長くなる」ケース用に用意されている)
2. **SummaryCards の観測時刻スタンプ**(`.sfh-summary-stamp`)-- `white-space: nowrap`
   等の折り返し禁止指定が無い(`sfhistory.css` 実測済み)。カード自体も `min-width: 0`。
   長くなった分は折り返されるだけで、はみ出し/重なりは発生しない
3. **チャートツールチップ** -- `recharts` の `<Tooltip>` は内容に応じて自動サイズする
   フローティング要素で、固定幅制約が無い(`ChartTooltipContent` に `max-width` 指定なし)
4. **チャート X 軸ラベル** -- 文字数を新旧で比較した結果、**新しい方式はほぼ同等か
   短くなる**(例: en 旧 `"08/18 (Tue)"` 11字 → 新 `"Tue, 08/18"` 10字。
   th 旧(誤った月/日固定順)`"08/18 (อ.)"` → 新(正しい日/月順)`"อ. 18/08"` で
   同程度)。`minTickGap={24}` の挙動に悪影響を与える見込みは低い
5. **ヒートマップ列見出し** -- 本計画では意図的に無変更(上記「変えなかった関数」参照)。
   本計画による新規リスクは無い

**推奨**: 統括側で稼働中の dev サーバー(5184/5185/5186、同一ワークツリーの HMR)で
375px の実機目視を最終確認してください。コードは既に反映されています(私自身の
確認用サーバーは port 5211 で起動・検証後に停止済み、5184/5185/5186 には触れていません)。

## ★日付・時刻を出している箇所の洗い出し結果

`format.js` の関数を grep で全呼び出し元を確認した結果(重複除く):

| 関数 | 呼び出し元 | 表示内容 |
|---|---|---|
| `formatAxisDate` | `SfHistoryChart.jsx` | チャート X 軸目盛 |
| `formatTooltipDate` | `SfHistoryRoot.jsx`, `SfHistoryChart.jsx`, `discovery/DiscoveryRoot.jsx`, `discovery/components/DiscoveryCubeTable.jsx`, `discovery/components/DiscoveryPriceTable.jsx`, `discovery/components/DiscoveryRecentList.jsx` | ツールチップ UTC行、SH-37形成済み注記、New Equipment観測時刻、Cube/SF価格表のsettledRange |
| `formatTooltipDateLocal` | `SfHistoryChart.jsx` | ツールチップのローカル時刻行(2次表示) |
| `formatTimestamp`(=`formatTooltipDate`のエイリアス) | `SummaryCards.jsx` | 「現在値」カードの20分スタンプ |
| `formatBucketRange` | `SfHistoryChart.jsx` | ツールチップの区間 HH:MM–HH:MM 注記(変更なし) |
| `formatClockTime` / `formatLocalClockTime` | `WeekdayHeatmap.jsx` | ヒートマップ列見出し(変更なし) |
| `weekdayShortLabel` | `WeekdayHeatmap.jsx` | ヒートマップ行見出し(曜日、元々ロケール対応済み・変更なし) |
| `formatTimeZoneLabel` | `SfHistoryChart.jsx`(間接、`formatTooltipDateLocal`経由), `WeekdayHeatmap.jsx` | ゾーンラベル(SH-31のまま無改変) |

**見落としチェック**: `server/` 側の日時(API応答の生ISO文字列)は本計画のスコープ外
(触っていない)。`raffle` 関連・`App.jsx`/`board`/`pages`/`components`/`taskManager` 配下は
日付表示機能を持たず、grep でも該当ヒットなし。

## 停止条件チェック

1. **表示と計算の分離**: 3関数(`formatAxisDate`/`formatTooltipDate`/`formatTooltipDateLocal`)
   はいずれも「ISO文字列を受け取り、表示用文字列を返すだけ」の純関数で、戻り値を
   計算・比較・キーに使っている呼び出し元は存在しない(grep で確認)。分離不能な箇所は
   見つからなかった
2. **(e) の崩れ**: 発生していない(`buildWeekdayHeatmap`/`series.js`/`chartColumns.js`/
   `priceGapFill.js` はいずれも無改変、テスト857件も無改変のまま全緑)
3. **「触らないもの」への抵触**: なし。新規依存も追加していない

該当なし。実装は計画どおり完了。統括の裁定(hour12混在の可否、375px実機目視)待ち。
