# SH-45 完了報告 — 比較キューブの選択を凡例の行に統合する

対象: `docs/IMPL_PLAN_SH45.md`。作業ツリー `C:\Users\pachi\Desktop\msu ranking`(`main`)。

## (a)(b) ★凡例が操作になっている / 枠の実測

- `components/CubeCompareSelector.jsx`(独立コントロール)を削除し、
  `components/CubeLegend.jsx` を書き換えて**凡例の行そのものを操作**にした。
  メインは非クリックの `<span>`(スウォッチ+名前+「メイン」バッジ)、
  追加3種は常に3つとも `<button aria-pressed>` として並ぶ(`CUBE_TYPE_ORDER`
  から `mainCubeType` を除いた順、選択の有無で並びは変わらない)。
- **枠(選択中マーカー)**: 追加の `<button>` が選択中のとき
  `.sfh-cube-legend-item-selected` クラスが付き、`sfhistory.css` で
  `border-color: var(--theme-focus)` + 背景の淡い着色 + 太字にする
  (未選択時は `border: 1.5px solid transparent`)。
- **実測**(新規 `components/CubeLegend.test.js`、`react-dom/server` の
  `renderToStaticMarkup` で実際にコンポーネントを描画し、出力 HTML 文字列
  を assert -- 新規依存追加なし。react/react-dom は既存の project
  dependency):
  - `npx vitest run src/sfhistory/components/CubeLegend.test.js` →
    **6 tests, 6 passed**
  - 未選択(`additionalCubeTypes=[]`)時: `sfh-cube-legend-item-selected`
    クラスは出力に**0回**出現、`aria-pressed="false"` が3回、
    `aria-pressed="true"` は0回。
  - 1種選択(`additionalCubeTypes=["BLACK"]`)時: `sfh-cube-legend-item-
    selected` が出力に出現、`aria-pressed="true"` が**ちょうど1回**、
    `aria-pressed="false"` が**ちょうど2回**(選択とそれ以外で確実に区別
    できる)。
  - スウォッチ(`sfh-cube-swatch`)は選択状態に関わらず**常に4個**
    (メイン1+追加3)出力される -- 「色の点は選択に関わらず出す」を実測で
    固定。

## (c)(d)(e) メインは消せない / 旧コントロール廃止 / チャート直前

- (c) メインの凡例エントリは `<span>` のまま(`onClick` を持たない)。
  実測: `CubeLegend.test.js` の `"(c) the MAIN entry is never a <button>"`
  で、出力 HTML 中メインのマークアップより前に `<button` が一切現れない
  ことを assert。加えて全4種を `mainCubeType` に順に指定するテストで、
  どのキューブがメインでも**追加ボタンは常に3個**(=メイン自身が追加
  候補に混ざらない)ことを固定。
- (d) `components/CubeCompareSelector.jsx` を削除。`grep -rn
  "CubeCompareSelector" src/` の結果は、削除後に残るコメント3箇所のみ
  (`CubeLegend.jsx` の新ヘッダーコメント内の経緯説明、`sfhistory.css` の
  更新済みコメント、`domain/cubeSeries.js` 内の**未編集の**古い言及1箇所
  -- この最後の1つは §3 のスコープ外ファイルのため触っていない。コード上
  の import/JSX 呼び出しはゼロ)。
- (e) `CubePricesRoot.jsx` で `<CubeLegend .../>` は
  `<div className="sfh-summary-card">`(チャートの直前の要素)の直前行に
  ある(旧来からこの位置。今回は凡例と旧「比較するキューブ」コントロール
  の間の距離を無くしたのが変更点)。

## (f) ★SH-44 の7項目の維持(実測)

`CubePricesRoot.jsx`・`domain/cubeSeries.js`・`components/SfHistoryChart.jsx`
の**ロジック側は本スライスで1バイトも変えていない**(下記 diff 実測)。

1. **初期は追加ゼロ**: `const [additionalCubeTypes, setAdditionalCubeTypes]
   = useState([]);`(CubePricesRoot.jsx)-- 今回の diff に含まれない行、
   変更なし。
2. **メインを追加として選べる重複を作らない**: `CubeLegend.jsx` の
   `additionalOptions = CUBE_TYPE_ORDER.filter((t) => t !== mainCubeType)`
   -- 実測(上記(c)のテスト)で4種いずれがメインでも常に3ボタン。
3. **メイン切り替え時は追加を引き継ぐ**: `handleCubeTypeChange` →
   `carryAdditionalCubeTypes(cubeType, previousAdditional, newCubeType)`
   (`domain/cubeSeries.js`、**diff ゼロ**)-- 呼び出し箇所
   (`CubePricesRoot.jsx`)も今回の diff に含まれない。
4. **統計カードとヒートマップはメインのみ + 注記**: `SummaryCards`/
   `WeekdayHeatmap` への props (`periodSeries`/`stats`/`percentile`/
   `currentExpected`)、および直前の
   `t("sfhistoryCube.statsScope", { cube: ... })` 注記 -- いずれも今回の
   diff に含まれない。
5. **メイン 2.5px / 追加 1.5px**: `MAIN_CUBE_LINE_WIDTH = 2.5` /
   `ADDITIONAL_CUBE_LINE_WIDTH = 1.5`(`CubePricesRoot.jsx`)-- 実測:
   `grep -n "MAIN_CUBE_LINE_WIDTH\|ADDITIONAL_CUBE_LINE_WIDTH\s*="` の
   結果、値・行とも変更なし。
6. **4色は固定色、`cheaper`/`costlier` を流用しない**:
   `domain/cubeSeries.js#CUBE_TYPE_COLORS`/`resolveCubeColor` -- **diff
   ゼロ**(`git diff -w --stat -- .../domain/cubeSeries.js` の出力は空)。
7. **未終了足の破線が4本すべてに効く**: `buildCubeSeries` の `closed`
   コピー処理(`domain/cubeSeries.js`)と `SfHistoryChart.jsx` の破線描画
   -- 両ファイルとも **diff ゼロ**(`git diff -w --stat -- .../
   components/SfHistoryChart.jsx` の出力も空)。

## (g) 未使用の残骸ゼロ

- `components/CubeCompareSelector.jsx` を削除(`git status --short` で
  `D` 表示)。
- ロケールキー: `sfhistoryCube.compare.label` は**削除せず**、
  `CubeLegend.jsx` の凡例グループ全体の `aria-label` として再利用(旧
  スタンドアロン見出しの文言をアクセシブルネームへ転用)。
  `sfhistoryCube.compare.mainBadge` は従来通り「メイン」バッジに使用。
  **6ロケールとも locale JSON は無編集**(未使用キーが生じていない = 削除
  対象ゼロ)。

## (h) 375px

- `.sfh-cube-legend` は既存の `flex-wrap: wrap` を維持(今回の CSS 追加
  はボタンの見た目(border/背景/color)のみで、`flex`/`flex-wrap` 系
  プロパティは触っていない)。新規 `.sfh-cube-legend-item-toggle` にも
  `width`/`white-space: nowrap` の類は追加していないため、4種が収まらな
  い幅では折り返し、横スクロールは発生しない(同じ仕組みを使う
  `CubeTypeSelector`/`PeriodTabs` の既存 375px 耐性と同一)。

## (i)(j) test / build / server 差分ゼロ / 6ロケール

- `npm run test` → **68 test files / 882 tests, 全緑**(既存876 +
  新規 `CubeLegend.test.js` 6件)。
- `npm run build` → 成功。`git stash` で本スライスの変更(SH-44 完了時点
  `7745d60`)を退避してビルドしたベースラインと実測比較:

  | | ベースライン(7745d60) | SH-45 適用後 |
  |---|---|---|
  | モジュール数 | 2419 | 2418(`CubeCompareSelector.jsx` 削除分 -1) |
  | CSS | 134.76 kB / gzip 22.28 kB | 135.26 kB / gzip 22.37 kB |
  | JS | 1,311.66 kB / gzip 370.76 kB | 1,311.25 kB / gzip 370.73 kB |

  CSS が +0.50 kB(gzip +0.09 kB)増えたのは追加した `.sfh-cube-legend-
  item-toggle`/`-selected` の2ルール分。JS はほぼ同等(旧
  `CubeCompareSelector.jsx` の削除と `CubeLegend.jsx` のロジック追加が
  相殺、gzip -0.03 kB)。新規の警告・エラーは無し(既存のチャンクサイズ
  警告のみ、ベースラインと同一)。
- `git status --short -- server/` / `git diff --stat -- server/` →
  出力0行(差分ゼロ)。
- 6ロケール(`en`/`es`/`ja`/`th`/`vi`/`zh-TW`)は**無編集**、リーフキー数
  は各590で完全一致(既存 `localeParity` 相当のテストも全緑)。

## (k) ★回帰ゼロ

- SF History(`#/starforce`)/ New Equipment 関連ファイルへの差分ゼロ:
  `git diff -w --stat -- .../SfHistoryRoot.jsx` の出力は空。
- `domain/cubeSeries.js`・`components/SfHistoryChart.jsx` への diff ゼロ
  (上記(f)参照)。
- `server/` 配下・raffle 関連ファイルへは一切触れていない。
- `npm run test` 全882件(sfhistory 配下の既存342+新規6件含む)が全緑。

## 動作確認(dev サーバー)

- 統括起動中のポート(5184/5185/5186)は未使用のまま、**別ポート 5299**
  で `VITE_SF_HISTORY_API_BASE=http://127.0.0.1:8787 npx vite --port 5299
  --strictPort` を実行し、`CubePricesRoot.jsx`/`CubeLegend.jsx` が Vite の
  esbuild 変換を通ってエラーなく配信される(HTTP 200、サーバーログに
  エラーなし)ことを確認。確認後、起動した dev サーバー(PID)のみを
  `taskkill` で終了、ポート解放を `netstat` で確認済み。
- ブラウザ自動操作ツールが本セッションで使用できないため、実クリック→
  枠の色変化のスクリーンショット確認は行っていない(**上記(a)(b)(c)は
  コンポーネント出力 HTML の自動テストによる実測で代替**)。
  実機での目視確認は統括/ユーザー側での追加確認を推奨。

## コミット

- 1コミット(ローカルのみ、`git push` なし)。
