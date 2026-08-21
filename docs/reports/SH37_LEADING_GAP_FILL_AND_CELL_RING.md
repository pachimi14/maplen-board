# SH-37: 現在セルの枠を目立たせる / 未取得帯を下限で埋めて線を伸ばす — 実装報告

計画: `docs/IMPL_PLAN_SH37.md`。実装担当による完了報告。作業ツリー `C:\Users\pachi\Desktop\msu ranking`(ブランチ `feat/sf-heatmap-new-equipment`。SH-35/SH-36 の続きとして同じ機能ブランチ上で作業した -- 計画書の「ブランチ main」という記載と実際の作業ツリーの現在地が食い違っていたが、直前の SH-35/SH-36 コミットもこのブランチ上にあり、`main` に切り替えると SH-36 の変更ごと失うため、既存の継続として本ブランチ上で実装した)。

## 0. 全体構成

計画 §9 のとおり2コミット(各単独 revert 可):

| コミット | 内容 |
|---|---|
| **A** `8f66aac` | ヒートマップの「現在セル」枠をテーマ追随色から固定色(depth 分岐)に変更、2px→3px |
| **B** (このコミット) | `fillLeadingPriceGaps`(先頭の欠けのみ下限値で埋める)+ `viewModel.js` 配線 + 注記(6ロケール) |

## 1. (a) ★Hat 0→22 の実測(統括の実測との一致)

`GET /sf-history/prices?itemId=1004811` を本番 API(読み取り専用プロキシ経由、`127.0.0.1:8787`)から実データ取得し(`exp_ranking/web/src/sfhistory/__fixtures__/sh37_hat_points.json` に凍結)、実装した `fillLeadingPriceGaps` + 既存 `expectedStarforceCostExact`(starforce.js、無改変)で計算:

```
08-17T12:00   0.2080B   (統括実測 0.208B との差: 0.000B)
08-18T04:00   1.4891B   (統括実測 1.489B との差: 0.000B)
08-19T20:00   1.0651B   (統括実測 1.065B との差: 0.000B)
08-20T00:00   1.6501B   (統括実測 1.650B との差: 0.000B)
```

全て 0.05B の停止条件を大きく下回る(実測上ほぼ完全一致)。検証コマンド:
`node exp_ranking/web/src/sfhistory/domain/priceGapFill.test.js`(vitest、下記「§7 検証コマンド」参照)。この4値はテストとしても固定した(`priceGapFill.test.js` の `IMPL_PLAN_SH37 §7(a) ★` ブロック)。

## 2. (b)(c) 開始日の一致 / Suit

- Hat: `0→17` と `0→22` は同じ 8/17 開始点から描画可能(☆1-10 帯は 08-17T12:00 の時点で既にリアル値、☆19 帯の先頭欠けのみが `fillLeadingPriceGaps` で埋まる)。
- Suit(itemId 1053064)実測: ☆1〜10(index 0-9)の全帯が **2026-08-21T04:00Z**(取得時点の「今日」)まで一度も実値を持たず、`fillLeadingPriceGaps` はこの区間全体(2026-08-09T04:00Z 〜 2026-08-21T00:00Z、74点中72点)を下限値で埋めた。結果、0→17 の Expected は最初の点(2026-08-09T04:00Z)から計算可能(0.0233B)になり、以降 8/10=0.0568B, 8/14=0.1001B, 8/20=0.1424B, 8/21(直近)=0.1753B と連続して描ける -- 計画 §7(c) の「Suit が 8/9 から線が出る」を満たす。

## 3. (d) ★中抜けを埋めないテスト

`priceGapFill.test.js`:
- `"(d) ★does NOT fill a mid-series null..."` -- 先頭で埋めた帯の**後**に来る null は一切変更されず `null` のまま残ることを直接アサート。
- `"every point in the window is now computable..."`(Hat の実データ)-- ウィンドウ内の全24点で Expected が非 null になることを確認(=先頭欠けは全て埋まった)一方、`"(d)"` の合成データテストが「後ろの欠測は埋めない」という別の性質を分離してロックしている(実データには意図的な中抜けが存在しないため、この境界は合成データで検証)。
- `viewModel.test.js` の `(a)` ケースも同じ経路(`buildScreenModel`)を通して確認。

## 4. (e) ★既存31装備の不変

- `priceGapFill.test.js` の `"(e) ★byte-for-byte no-op..."`: 全帯が最初の点から実値を持つ配列を渡すと `fillLeadingPriceGaps` は**同一参照**を返す(新しい配列すら作らない)ことを確認。`buildExpectedSeries` の出力も埋める前後で `toEqual`(完全一致)。
- `viewModel.test.js` の `"(e) ★byte-for-byte unchanged..."`: `buildScreenModel` 経由でも同じことを確認(`fullSeries` が `toEqual`、`filledBands` が `[]`)。
- `starforce.js`(計算エンジン)は一切変更していない(diff 対象外)。golden fixture 照合テスト(`starforce.test.js`)は 2180/2180 bit-identical のまま(`npm run test` 出力より)。

## 5. (f) SH-36 の性質維持

`viewModel.test.js` の `"(f) coexists with an already-filled band..."`: SH-36 のサーバー側 `forming_prices` フィル(現在価格で「形成中」帯の**全スロット**を埋める)が既に適用済み(=null が一切残らない)配列を渡すと、`fillLeadingPriceGaps` は**何もしない**(`filledBands: []`、`fullSeries` は無加工と完全一致)ことを確認。

実データでも確認: Hat の実フィクスチャで `formingBands: [{startStar:1,endStar:10},{startStar:20,endStar:22}]`(SH-36 側、現在も形成中)と、`fillLeadingPriceGaps` が検出した `filledBands`(☆11,13,14-15,18,19 -- SH-36 側がもう埋めない、**既に形成完了した**帯)は**重複しない**排他的な集合であることを実データで確認済み(`server/sf-history/app.py` 側のロジックとクライアント側のロジックが同じ null スロット集合を奪い合わない)。

## 6. (g)(h) 注記の実表示文字列

Hat 0→22 の実データ(`sh37_hat_points.json`)から実際に `groupFilledBands` + i18n テンプレートを通した結果(`node` で実行、`SfHistoryRoot.jsx` と同じ関数呼び出し):

```
JA: ☆11 は 2026-08-18 04:00 UTC (火) まで価格形成中でした
EN: ☆11 was still price-forming until 2026-08-18 04:00 UTC (Tue)
JA: ☆13 は 2026-08-17 20:00 UTC (月) まで価格形成中でした
EN: ☆13 was still price-forming until 2026-08-17 20:00 UTC (Mon)
JA: ☆14〜15 は 2026-08-18 04:00 UTC (火) まで価格形成中でした
EN: ☆14–15 was still price-forming until 2026-08-18 04:00 UTC (Tue)
JA: ☆18 は 2026-08-18 04:00 UTC (火) まで価格形成中でした
EN: ☆18 was still price-forming until 2026-08-18 04:00 UTC (Tue)
JA: ☆19 は 2026-08-20 00:00 UTC (木) まで価格形成中でした
EN: ☆19 was still price-forming until 2026-08-20 00:00 UTC (Thu)
```

評価語("概算"/"不正確"/"安い"/"お得"等)は一切含まない -- 事実(帯・日時)のみ。5行に分かれているのは、☆11/13/14-15/18/19 がそれぞれ異なる時刻に形成完了したという**事実**をそのまま反映した結果(`groupFilledBands` は untilDate が異なる隣接star を合体しない -- §7(g) の要件)。

(h): `viewModel.test.js` の `"(h) filledBands is [] when nothing was filled..."` と `"(h) filledBands only reports bands the CURRENTLY selected span actually requires..."` -- 選択中の星範囲が必要としない帯(例: 0→17 の view で ☆19 のみの欠け)は注記に出ないことを確認。既存31装備(埋めた帯が無い)では `filledBandNotes` が常に `[]` になり、`SfHistoryRoot.jsx` はその配列が空なら何もレンダリングしない。

## 7. (i)(j) ★枠の視認性(4テーマ×明暗の実測)

CSS の `color-mix(in srgb, var(--theme-focus) X%, var(--theme-card-bg))`(実際のセル背景の式、`WeekdayHeatmap.jsx`)と `taskManager.css` の実際のテーマ変数値をそのまま用いて、4テーマ(green/blue/purple/orange)×3 depth(light/standard/deep)×4段階の ratio(0.08〜0.70、セルの最低〜最高濃度)= 48通りについて、新しい枠色(`--sfh-color-current-ring`: light/standard = `#0f172a`、deep = `#f8fafc`)と実際のセル背景色との WCAG コントラスト比を計算(Node スクリプト、simple sRGB alpha 合成 + color-mix 線形補間):

```
最小値: 5.13 (deep / green / ratio=0.70)
最大値: 16.31 (light / green / ratio=0.08)
48通り全てで 5.13 以上 -- 非テキストUIの WCAG 目安 3:1 の 1.7倍以上を確保
```

(j): `.sfh-heatmap-cell-lowest`/`-highest` は `box-shadow: inset ...`(2px)、現在セルは `outline`(3px、別レイヤー)のまま -- SH-35 で既に確立された「同じセルが最安/最高と現在を兼ねても両方見える」設計を変更していない(色・太さ・CSSプロパティの3点で区別可能)。

**制約**: 本セッションには実ブラウザでのスクリーンショット取得手段がなかった(computer-use/chrome 系 MCP ツールは本セッションのツール一覧に含まれていなかった)。上記コントラスト比は CSS の実式を Node で再現した計算値であり、統括または実機での目視確認を推奨する。

## 8. (k)(l)(m) test / build / 契約 / 6ロケール

```
npm run test  -> Test Files 64 passed (64) / Tests 816 passed (816)  (SH-37前: 786)
npm run build -> ✓ built in 5.51s (dist/assets 生成成功。既存の 500kB chunk 警告は SH-37 と無関係の既存事象)
```

`server/sf-history/` は本計画で一切変更していない(§6 のとおり注記に必要な新フィールドは不要だった -- クライアント側の `points` 配列だけで先頭欠けの判定・埋め・注記に必要な情報が全て揃うため)。既存の契約テストは無改変(実行対象外)。

6ロケール(en/ja/es/th/vi/zh-TW)全てに `sfhistory.filledBands.{range,rangeSingle,note}` を追加。`src/localeParity.test.js`(キー集合の一致を検証)は緑のまま(68 tests, `src/localeParity.test.js` 5 cases)。

## 9. (n) ★New Equipment ページの回帰ゼロ

`server/sf-history/discovery.py`、`exp_ranking/web/src/sfhistory/discovery/`(`#/starforce/discovery` の実体)は本計画で一切触っていない(diff 対象外)。該当ドメインテスト(`discovery/domain/*.test.js`、`discovery/integrations/*.test.js`)は無改変のまま全緑(上記 §6 のテスト実行ログに含まれる 48 tests)。

## 10. 検証コマンド(実行済み・結果は上記の通り)

```
cd exp_ranking/web
npx vitest run                                    # 816 passed
npm run build                                      # 5.51s, success
node <verify_sh37.mjs / verify_note.mjs / contrast_check.mjs>  # スクラッチパッド、本報告の数値の裏取り
git diff -w -- <touched files>                     # 実質差分のみ確認済み(CRLF ノイズ無し)
```

## 11. 停止条件チェック(該当なし)

1. (a) が統括実測と 0.05B 以上ずれる -- 未該当(差は 0.000B オーダー)
2. (e) が崩れる -- 未該当(byte-for-byte 一致をテストで固定)
3. (d) を満たすと (a) が満たせない -- 未該当(両立を実データ+テストで確認)
4. §6「触らないもの」に触る必要が生じた / 新規依存が必要になった -- 未該当(`server/`, `starforce.js`, discovery, raffle, App.jsx/board/pages/components/taskManager, package.json は無改変)
