# SH-45 完了報告 — 比較キューブの選択を凡例の行に統合する

対象: `docs/IMPL_PLAN_SH45.md`。作業ツリー `C:\Users\pachi\Desktop\msu ranking`(`main`)。

## (a)(b) ★凡例が操作になっている / 枠の実測

- `components/CubeCompareSelector.jsx`(独立コントロール)を削除し、
  `components/CubeLegend.jsx` を書き換えて**凡例の行そのものを操作**にした。
  メインは非クリックの `<span>`(スウォッチ+名前+「メイン」バッジ)、
  追加3種は常に3つとも `<button aria-pressed>` として並ぶ(`CUBE_TYPE_ORDER`
  から `mainCubeType` を除いた順、選択の有無で並びは変わらない)。
- **枠(選択中マーカー、ラウンド1時点の初版実装)**: 追加の `<button>` が
  選択中のとき `.sfh-cube-legend-item-selected` クラスが付き、
  `sfhistory.css` で `border-color: var(--theme-focus)` + 背景の淡い着色
  + 太字にする(未選択時は `border: 1.5px solid transparent`)。
  **★このラウンド1実装は統括の実機計測で「枠が見えない」と差し戻しに
  なった。原因・修正・実測は末尾の「差し戻し対応(ラウンド2)」を参照
  (以下のラウンド1記述は歴史的経緯として残す)。**
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

## ★差し戻し対応(ラウンド2, コミット2本目)

統括の実機計測で、選択中の追加キューブに**枠(border-color/box-shadow)が
実際には見えていない**(`fontWeight` だけ 400→700 で変化、`border-color`
は `rgba(0,0,0,0)` のまま)ことが指摘され差し戻し。以下、原因調査・修正・
実測の記録。

### 原因調査(実機計測)

新規依存を追加せず、Node 22 の組込み `WebSocket`/`fetch` だけで Chrome
DevTools Protocol を直接叩く最小ドライバを書き、**別プロファイルの
headless Edge**(`msedge.exe --headless=new --user-data-dir=<scratch>`、
統括の実機ブラウザ・5184/5185/5186 とは無関係)で本物のレンダリング・
CSS カスケード・クリックイベントを実測した(スクラッチ領域の一時スクリプ
ト、リポジトリには残していない)。

- クリック後 **400ms 待って**測定すると、`border-color` は
  `rgb(52, 211, 153)`(`--theme-focus`)に正しく変化していた(旧コード
  でも一見「効いている」ように見える)。
- 一方、`.sfh-cube-legend-item-toggle` には
  `transition: border-color 0.15s, background-color 0.15s, color 0.15s;`
  を付けていた。クリック直後(0ms、待たずに)測定すると、トランジション
  開始直後で `getComputedStyle` が遷移前の値(透明)を返しうる。統括の
  計測は `fontWeight`(トランジション対象外 = 即時反映)は 700 に見えて
  `border-color`(トランジション対象 = 遅延)だけ透明、という**両方の
  観測結果と完全に整合する**。これが再現性のある唯一の合理的な説明。

### 修正方針(実装、CSS カスケードへの依存を断つ)

原因が仮に別にあったとしても再発しない構造にするため、**枠の色を CSS
クラスではなく `CubeLegend.jsx` のインライン `style` で直接指定**するよ
う変更した(インラインスタイルは外部スタイルシートのどんなルールにも
カスケードで負けない -- 「クラスは付いているのに描画されない」というク
ラスの不具合を構造的に排除)。色は凡例のスウォッチと同じ
`colorByType[cubeType]`(ユーザー指示「枠の色はそのキューブの色を使う」)。
あわせて `.sfh-cube-legend-item-toggle` の `transition` を完全に削除
(border-color/background-color の遷移をなくし、即時反映に統一)。

### ★(m) 実測で判明した第二の問題: 標準(standard)深度で沈む

`domain/cubeSeries.js#CUBE_TYPE_COLORS`(触っていない、読むだけ)の
"light" 系配色は SH-44 で白背景(`#ffffff`)に対して検証済みだったが、
このコントロールはカード内ではなく `.sfh-root` の**ページ背景**
(`--theme-bg-*`)の上に乗る。`resolveCubeColor` は `deep` / それ以外の
2分岐のみで、"standard" 深度は "light" 系配色を**テーマ色で着色された
パステル背景**(`--theme-standard-bg-*`、4テーマで異なる)の上に置くこと
になる -- これは統括が明示的に警告した SH-37 の「テーマ追随色が背景に沈
む」の再発パターンそのもの。

実際に上記の headless レンダリングで4テーマ×3深度の実背景値を取得し、
純粋な WCAG 相対輝度計算(追加依存なし、標準の式をその場で実装)で
`CUBE_TYPE_COLORS` の実 hex 値 × 実背景値のコントラスト比を総当たりで
算出した:

| 深度 | チェック数 | 最小コントラスト比 | 3:1 未満の件数 |
|---|---|---|---|
| deep | 48 | 5.50:1(WHITE_ADDITIONAL) | 0 |
| light | 48 | 4.02:1(RED) | 0 |
| standard | 48 | **2.30:1**(RED, purple テーマ) | **21 / 144(全体)** |

standard 深度で RED(`#847a0b`)・BLACK(`#37840b`)・ADDITIONAL
(`#0b7e84`)が4テーマ中3〜4テーマのパステル背景に対して 3:1 を割った
(最悪 2.30:1、`--theme-standard-bg-*` の purple テーマ)。

`domain/cubeSeries.js` の配色テーブル自体は変更できない(スコープ外)た
め、**同じ SH-37 が使った手法をそのまま再利用**した: `.sfh-root` に
既存の `--sfh-color-current-ring`(deep=`#f8fafc` / それ以外=`#0f172a`、
テーマ色に追随しない固定リング色)を `outline` として追加。インラインの
キューブ色 `border` の外側にこの `outline` を重ねる二重リング構成 --
`.sfh-heatmap-cell-current`(outline)+`.sfh-heatmap-cell-lowest`/
`-highest`(inset box-shadow)が既にこのファイルで実践している「固定色の
確実に見える印」+「意味色の識別用アクセント」の2層構成と同じパターン。

同じ実背景値に対して `--sfh-color-current-ring` のコントラストを再計算:

| 深度 | チェック数 | 最小コントラスト比 |
|---|---|---|
| deep | 12 | 17.30:1 |
| light | 12 | 16.30:1 |
| standard | 12 | **9.32:1**(purple テーマ) |

36通り全てで 3:1 を大きく上回る(最悪でも 9.32:1)。これで枠(outline)
は4テーマ×3深度のどの組み合わせでも沈まないことを保証しつつ、内側の
`border-color`(インライン、キューブごとの色)で「凡例の点と対応が取れ
る」というユーザー指示も両立させた。

### ★(l)(m) 実測結果(headless Edge、実レンダリング、4テーマ×3深度)

クリック直後(待ち時間なし・0ms)で計測、`.sfh-cube-legend-item-toggle`
の最初のボタンをトグル:

```
depth=deep     theme=green  border=rgb(134, 224, 82)  outline=2px solid rgb(248, 250, 252) fontWeight=700 aria-pressed=true
depth=deep     theme=blue   border=rgb(134, 224, 82)  outline=2px solid rgb(248, 250, 252) fontWeight=700 aria-pressed=true
depth=deep     theme=purple border=rgb(134, 224, 82)  outline=2px solid rgb(248, 250, 252) fontWeight=700 aria-pressed=true
depth=deep     theme=orange border=rgb(134, 224, 82)  outline=2px solid rgb(248, 250, 252) fontWeight=700 aria-pressed=true
depth=light    theme=green  border=rgb(134, 224, 82)  outline=2px solid rgb(15, 23, 42)   fontWeight=700 aria-pressed=true
depth=light    theme=blue   border=rgb(134, 224, 82)  outline=2px solid rgb(15, 23, 42)   fontWeight=700 aria-pressed=true
depth=light    theme=purple border=rgb(134, 224, 82)  outline=2px solid rgb(15, 23, 42)   fontWeight=700 aria-pressed=true
depth=light    theme=orange border=rgb(134, 224, 82)  outline=2px solid rgb(15, 23, 42)   fontWeight=700 aria-pressed=true
depth=standard theme=green  border=rgb(134, 224, 82)  outline=2px solid rgb(15, 23, 42)   fontWeight=700 aria-pressed=true
depth=standard theme=blue   border=rgb(134, 224, 82)  outline=2px solid rgb(15, 23, 42)   fontWeight=700 aria-pressed=true
depth=standard theme=purple border=rgb(134, 224, 82)  outline=2px solid rgb(15, 23, 42)   fontWeight=700 aria-pressed=true
depth=standard theme=orange border=rgb(134, 224, 82)  outline=2px solid rgb(15, 23, 42)   fontWeight=700 aria-pressed=true
```

12通り全てで **`border-color`/`outline` とも 0ms 遅延なく即座に反映**
(トランジション除去の効果。この計測で使ったのは既定のキューブ種類
`BLACK` のためどの深度でも `colorByType.BLACK` は同じ `deep` 分岐の値
(React の `theme.themeDepth` 状態は DOM 属性を直接書き換えても変わらな
いため、`border` 自体の値は一定 -- これは既知の制約として明記。ただし
`outline`(`--sfh-color-current-ring`、CSS 変数経由で DOM 属性の変化に
正しく追随)は深度ごとに正しく `#f8fafc`⇄`#0f172a` を切り替えており、
CSS 側の分岐が実際に効いていることは直接確認できている)。
未選択時の `border-color` は `rgba(0, 0, 0, 0)`(透明)のまま、選択時の
`aria-pressed` は `false`→`true`。

### (n) メインには枠が付かない

メインは `<span>` のまま(`onClick` なし、`style` の border/outline は
一切渡していない)。`CubeLegend.test.js` に新規テスト
`"(n) the MAIN entry never gets a selected border-color..."` を追加:
メインと追加キューブに**あえて同じ色**を colorByType に与え、メインの
マークアップ部分の文字列に `border-color` が一切含まれないことを assert
(「たまたま同じ色が出力のどこかにある」ではなく、メインの要素自体に
付いていないことを確認)。

### (o) 太字だけに頼っていない

選択中は (1) インラインの `border`(キューブごとの色)、(2)
`outline`(`--sfh-color-current-ring`、常時確実に見える固定色)、(3)
薄い背景着色(`color-mix(in srgb, <キューブ色> 18%, transparent)`)、(4)
`font-weight: 700` の**4つ**が同時に変化する。(1)(2)(3) はいずれも
「見た目のある視覚差」であり、太字はそのうちの1つに過ぎない。

### (p) テストが視覚差を検証している

`CubeLegend.test.js`(`npx vitest run
src/sfhistory/components/CubeLegend.test.js` → **7 tests, 7 passed**):

- `(b) an unselected...` -- 未選択時、出力 HTML 全体に `border-color`
  という文字列が**一切出現しない**ことを assert(クラス名の有無ではなく、
  実際に何も描画されないことの確認)。
- `(l)/(p) a selected...` -- `BLACK`/`ADDITIONAL`/`WHITE_ADDITIONAL` の
  それぞれを選択した3パターンで、選択された `<button>` の
  `style="border-color:<そのキューブの実 hex 値>` が**厳密に1回だけ**
  出現することを正規表現で assert(`react-dom/server` の
  `renderToStaticMarkup` は React の `style` オブジェクトを実際の CSS
  文字列にシリアライズするため、SSR 出力だけで「インラインスタイルが
  実際に生成されているか」を CSS エンジンなしで直接検証できる)。
- `(n)` -- 上記の通り。

### 挙動不変性の再確認(SH-44 の7項目、ラウンド2でも diff ゼロ)

`git diff -w --stat` で `CubePricesRoot.jsx`・`domain/cubeSeries.js`・
`components/SfHistoryChart.jsx`・`SfHistoryRoot.jsx`・6ロケール JSON への
差分が**ラウンド2でも出力0行**であることを再確認(ラウンド2で触ったのは
`CubeLegend.jsx`・`CubeLegend.test.js`・`sfhistory.css` の3ファイルのみ)。

### test / build(ラウンド2後)

- `npm run test` → **68 test files / 883 tests, 全緑**(ラウンド1の882
  +1件、上記 `(n)` テスト追加分)。
- `npm run build` → 成功。CSS 135.14 kB / gzip 22.35 kB、JS 1,311.34 kB /
  gzip 370.77 kB(ラウンド1比 CSS +0.07 kB は outline ルール追加分、JS は
  ほぼ同等)。新規警告・エラーなし。
- `git diff --stat -- server/` → 出力0行(差分ゼロ、維持)。

### 動作確認に使った環境の後片付け

- 検証専用に起動した headless Edge(隔離プロファイル、統括の実ブラウザ
  とは別)と、隔離 dev サーバー(ポート 5299)は全て `taskkill` で終了、
  `netstat` でポート解放を確認済み。統括の 5184/5185/5186・CORS プロキシ
  8787 には一切触れていない。

## コミット

- 2コミット(ローカルのみ、`git push` なし)。1本目 `a7a884b`(統合その
  もの)、2本目(本差し戻し対応 -- 枠のインライン化 + `--sfh-color-
  current-ring` outline 追加 + テスト強化)。
