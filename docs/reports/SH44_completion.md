# SH-44 完了報告 — キューブ4種の重ね描き

対象: `docs/IMPL_PLAN_SH44.md`。作業ツリー `C:\Users\pachi\Desktop\msu ranking`(`main`)。

## (a)(b)(c) 選択と4本描画(実測)

- メイン(`CubeTypeSelector`、既存のまま)+ 追加0〜3種(新規 `CubeCompareSelector`)。
  初期状態は追加ゼロ(`useState([])`)。
- 実データ(Arcane Umbra Staff / itemId 1382265、CORS プロキシ
  `http://127.0.0.1:8787` 経由で `/sf-history/cube-prices`・`/sf-history/latest`
  を取得)で、main=RED + additional=[BLACK, ADDITIONAL, WHITE_ADDITIONAL]
  (4種全て)を実際にプロジェクトの純関数(`buildCubeSeries` →
  `sliceByPeriod` → `withChartColumns(withDeltas(...))` →
  `mergeExtraSeriesColumns`)に通して確認:
  - 30D 期間、マージ後 180 行、**全180行が4本ぶんの列
    (`confirmed`/`bridge`, `confirmed_BLACK`/`bridge_BLACK`,
    `confirmed_ADDITIONAL`/`bridge_ADDITIONAL`,
    `confirmed_WHITE_ADDITIONAL`/`bridge_WHITE_ADDITIONAL`)を持つ**
    (`rows missing any of the 4 lines' columns: 0`)。
  - `SfHistoryChart` はこの `data` 配列を1つの `<LineChart>` に渡し、main
    2本 + 追加最大6本(`confirmed_*`/`bridge_*` ペア × 3)を同時描画。
- (c) メインは `MAIN_CUBE_LINE_WIDTH = 2.5`、追加は
  `ADDITIONAL_CUBE_LINE_WIDTH = 1.5`(`CubePricesRoot.jsx`)。メイン
  > 追加が常に成立。

## (d)(e)(f) 凡例 / 4色の実測 / 意味色の非流用

- (d) `components/CubeLegend.jsx` を新規作成、チャート直上に表示。各キュー
  ブのスウォッチ(丸)+ 表示名。メインは太字 + 「メイン」バッジ付き。
- (e) 4色は `domain/cubeSeries.js#CUBE_TYPE_COLORS`(depth 分岐の固定色、
  `--sfh-color-current-ring` と同じ流儀)。**実測(`cubeSeries.test.js`
  内で自動検証、かつ手計算スクリプトで事前設計):**

  | cube | deep (暗背景向け) | 対 `#0f172a` コントラスト | light/standard (明背景向け) | 対 `#ffffff` コントラスト |
  |---|---|---|---|---|
  | RED | `#e0d452` | 11.65:1 | `#847a0b` | 4.40:1 |
  | BLACK | `#86e052` | 10.88:1 | `#37840b` | 4.70:1 |
  | ADDITIONAL | `#52d9e0` | 10.51:1 | `#0b7e84` | 4.85:1 |
  | WHITE_ADDITIONAL | `#e052d9` | 5.42:1 | `#840b7e` | 9.01:1 |

  全て WCAG 非テキスト最低基準(3:1)を上回る。4色間の色相差は同一branch
  内で最小 43.1°(RED-BLACK)、最大 155.2°。この画面のカード背景
  (`--theme-card-bg`)は **depth のみで決まり、4テーマ(色)では変わらな
  い**(`taskManager.css` を実測: `--theme-card-bg` は `html[data-theme-
  color="..."]` の4ブロックいずれにも定義されておらず、`html[data-theme-
  depth="..."]` の3ブロックにのみ存在)ため、depth 2分岐(deep / それ以外)
  で4テーマ×3段階(12通り)すべてをカバーする。
  - 自動テスト: `domain/cubeSeries.test.js` の
    `describe("CUBE_TYPE_COLORS / resolveCubeColor (e)/(f)")` が上記の
    コントラスト・色相差をレグレッションとして固定。
- (f) `--sfh-color-cheaper`(#3b82f6)/`--sfh-color-costlier`(#fb7185)は
  キューブ線に一切使用していない(4色いずれの hex とも不一致、色相差は
  最小でも 48.3°、テストで `>=20°` を強制)。`SfHistoryChart.jsx` は
  `mainColor`/`extraSeries[].color` を呼び出し側から受け取るだけで、
  cheaper/costlier のどちらの値も内部で参照しない。

## (g)(h) 破線 / White の欠損

- (g) `closed` フラグは `buildCubeSeries` が **同じ `points` エントリ**か
  ら全キューブ種別へ同一値をコピーする(価格インデックスのみ種別で異な
  る)ため、4種の「進行中の足」は常に同じ1点に揃う。実測(Arcane Umbra
  Staff, 30D): MAIN/BLACK/ADDITIONAL/WHITE_ADDITIONAL いずれも
  `openCount=1`(未終了足がちょうど1点、4本全てで破線化)。
- (h) White Cube: 実データの `points`(900件)のうち 2026-06-11 より前
  465件は **全て `expected === null`**、以降 435件は非 null 値を含む。
  重ね描き(`mergeExtraSeriesColumns`)後も `confirmed_WHITE_ADDITIONAL`/
  `bridge_WHITE_ADDITIONAL` は該当区間で `null` のまま(0 埋め・前値埋め
  は一切なし -- `expected === 0` の値は0件)。`domain/cubeSeries.test.js`
  の K2 テスト、`components/SfHistoryChart.test.js` の該当テストでも固定。

## (i) ヒートマップ・統計カードがメイン

- `SummaryCards`/`WeekdayHeatmap` への入力(`periodSeries`/`stats`/
  `percentile`/`currentExpected`)は全て `cubeType`(メイン)のみから計算
  (既存の `fullSeries`/`periodSeries`/`stats` ロジックは変更なし)。
  追加キューブの選択(`additionalCubeTypes`)はこれらの `useMemo` の依存
  配列に一切含まれない。
- 画面上の明示: `sfhistoryCube.statsScope`(新規i18nキー、6ロケール)を
  `SummaryCards` 直前に表示 -- 「下の統計とヒートマップは {{cube}} のみ
  が対象です」。

## (j) ★SF チャート不変の確認方法

- **`SfHistoryRoot.jsx` は本スライスで1バイトも変更していない**
  (`git diff -w -- exp_ranking/web/src/sfhistory/SfHistoryRoot.jsx` の
  出力は空)。呼び出し `<SfHistoryChart series={periodSeries}
  average={stats.average} filledBands={filledBands} />` は新しい3props
  (`mainColor`/`mainStrokeWidth`/`extraSeries`)を一切渡さない。
- `SfHistoryChart.jsx` 側は3propsとも
  デフォルト値(`mainColor="#22d3ee"`, `mainStrokeWidth=2`,
  `extraSeries=[]`)が **この関数がこれまで一貫してハードコードしてきた
  値そのもの**。`extraSeries=[]` のとき `mergeExtraSeriesColumns` は
  `mainRows` を**コピーすらせずそのまま返す**(`components/
  SfHistoryChart.test.js` の1件目のテストで固定: `toBe(mainRows)`)。
- `git diff -w` で確認した実差分(削除行)は「リテラル `"#22d3ee"`/`2` →
  同じデフォルト値を持つ変数」の置換のみで、JSX の構造(要素数・順序・
  他の属性)は一切変わっていない -- 追加の `<Line>` は
  `extraRowsList.map(...)` から生成され、`extraRowsList` が空配列のとき
  何もレンダリングしない。
- `npm run test` で `src/sfhistory/**` 342件(旧来の
  `chartColumns.test.js`/`series.test.js`/`viewModel.test.js`/
  `integrations/*.test.js` 含む)が全緑 -- これらは本スライスで一切変更
  していない `domain/chartColumns.js`/`domain/series.js`/`starforce.js`
  自体の回帰ガード。

## (k) メイン切り替え時の挙動と理由

- **選択(比較セット)を引き継ぐ**: `domain/cubeSeries.js#
  carryAdditionalCubeTypes` -- 切替前に画面上に表示されていた集合
  (`{旧メイン} ∪ 旧追加`)から新メインを除いたものを新しい追加集合とす
  る(旧メインは追加の空いた枠に回る)。
  - 例: main=RED, additional=[BLACK, ADDITIONAL] の状態で main を BLACK
    に切替 → additional=[RED, ADDITIONAL](表示集合 {RED,BLACK,
    ADDITIONAL} は不変、太さだけ入れ替わる)。
  - 理由: リセット(追加を毎回空に戻す)だと、せっかく組んだ3〜4種の比較
    が「どれを太字にするか」を選び直すだけの操作で毎回消えてしまい、より
    慎重な操作(比較を組む)の方が壊れやすくなる。引き継ぎなら「どれを
    太字にするか」を変えるだけで見えている集合は変わらない -- 表計算の
    「主軸を切り替える」に近い読み。ユーザーから見える唯一の変化は、旧
    メインが消えずに(細い)追加として残り続けること。
  - `domain/cubeSeries.test.js` の `describe("carryAdditionalCubeTypes
    (k)")` 5件でこの規則を固定(要素4種の全体集合ゆえ追加は常に3以下、
    という不変条件も含む)。

## (l) 375px

- 新規2コントロール(`CubeCompareSelector`/`CubeLegend`)はどちらも既存
  の `flex-wrap: wrap` を持つクラス(`.sfh-period-tabs`/新規
  `.sfh-cube-legend`)を使用。親の `<div className="flex flex-wrap
  items-end gap-6">` も既存のまま(3つ目の `.sfh-select-group` が増えた
  だけ)。横スクロールを発生させる `width`/`white-space: nowrap` 系の指
  定は追加していない。

## (m)(n) test / build / server 差分ゼロ / 6ロケール

- `python -m pytest tests/` -- 本スライスは `server/`・Python 側を一切
  変更していないため対象外(スコープ§5「触らないもの」)。
- `npm run test` -- **67 test files / 876 tests, 全緑**
  (`src/sfhistory/**` は 18 files / 342 tests)。
- `npm run build` -- 成功(`vite build`、既存のチャンクサイズ警告のみ、
  新規警告・エラーなし)。
- `git status --porcelain -- server/` -- 出力0行(差分ゼロ)。
- 6ロケール(`en`/`ja`/`es`/`th`/`vi`/`zh-TW`)に `sfhistoryCube.compare.
  label`/`sfhistoryCube.compare.mainBadge`/`sfhistoryCube.statsScope` を
  同一キー名で追加。`src/localeParity.test.js`(既存、変更なし)が
  「6ロケールのキー集合が完全一致」をテストしており、全緑。

## (o) ★回帰ゼロ

- SF History(`#/starforce`)/ New Equipment: 関連ファイル
  (`SfHistoryRoot.jsx`/`domain/series.js`/`domain/chartColumns.js`/
  `domain/weekdayStats.js`/`starforce.js`)への差分ゼロ(上記 (j) 参照)。
- `server/` への差分ゼロ(§5 遵守)。
- raffle 関連ファイルには一切触れていない。
