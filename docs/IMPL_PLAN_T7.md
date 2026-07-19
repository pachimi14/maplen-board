# T7: キャラ詳細の共有画像生成・X共有機能 実装前調査計画

作成日: 2026-07-15

この文書は事前調査成果物です。本番機能の実装、`package.json` への依存追加、App配線、bot/workflow変更、push/PR/main merge は行っていません。

## 1. 目的

キャラクター詳細ページから、Xで見栄えよく共有できる専用レイアウトの画像をブラウザ内で生成し、PNG保存・画像コピー・Web Share API・X投稿文準備につなげるための技術選定と最小実装範囲を確定する。

前提は GitHub Pages の静的SPAであり、バックエンドサーバーは追加しない。T3派生統計、T4マイキャラ機能、既存キャラ詳細URLを再利用し、bot/workflow/データ契約は変更しない。

## 2. ユーザー体験

想定導線:

1. キャラ詳細ページで `共有画像を作成` を押す。
2. 設定モーダルで共有項目、期間、レイアウトを確認する。
3. 1600x900 のプレビューを表示する。
4. PNG保存、画像コピー、スマホ共有、PC向け投稿文コピー/X投稿画面を選べる。

初版では横長 1600x900 のみを推奨する。縦長 1200x1600、テンプレート複数、複数枚分割は将来拡張に回す。

## 3. 調査結果

### 3.1 既存コードとデータの正の所在

| 項目 | 正の所在 | 再利用可能な純粋関数 | 再利用可能なReact部品 | 共有カードへそのまま流用 | 共有用別レイアウト | 二重実装リスク |
|---|---|---|---|---|---|---|
| キャラ基本情報 | `exp_ranking/web/src/CharacterDetail.jsx` 434-710、`rankingUtils.js` | `formatJobName`, `levelExpPercent`, `formatLevelExp`, `formatExpExact`, `currentLevelExp` | `CharacterDetail` header | 不可。画面用の余白・ボタン込み | 必要 | 中。表示モデル化で回避 |
| キャラ画像 | `character.imageUrl`, `CharacterDetail.jsx` 634-640 | なし | 既存 `<img>` 表示 | 不可。CORSリスクあり | 必要。placeholder前提 | 高。CORS確認なしで組み込むとPNG失敗 |
| Daily/Weekly/Monthly増加量 | `CharacterDetail.jsx` 454-456 | `getGainAmount`, `formatExp`, `formatExpRecord` | `GainStatCard` | 部分流用は非推奨 | 必要 | 低 |
| 各増加量順位 | `CharacterDetail.jsx` 458-460、`useRankingBoard.js` 437 | `computeGainRankMaps`, `getGainRank` | `GainStatCard` | 部分流用は非推奨 | 必要 | 低 |
| 7日・30日平均 | `CharacterPlannerTools.jsx` 73-140 | `computeGainAverages`, `averageDailyGainFromHistory` | `GainAveragesSection` | レイアウト直流用は不可 | 必要 | 中 |
| レベルプランナー | `CharacterPlannerTools.jsx` 142-256 | `parseExpInputBillions`, `estimateDaysToLevelWithGain`, `arrivalDatePartsFromSnapshot` | `DaysToLevelSection` | 不可。入力UI込み | 必要 | 中 |
| 保存済み目標 | `ProfileContext.jsx`, `profile/profile.js`, `MyCharacterCard.jsx` 358-361 | `getGoal` はContext経由 | `GoalModal`, `MyCharacterPinButton` | 不可 | 必要 | 中 |
| 目標進捗 | `myCharacterUtils.js` 184-229、`stats/goalProgress.js` | `buildGoalDisplayModel`, `computeGoalProgress` | `GoalSection` | 不可。カードUI専用 | 必要 | 高。必ず既存関数を使う |
| デイリーEXPグラフ | `CharacterDetail.jsx` 478-484 と `HistoryChartRow` | `lastHistoryPoints`, `historyPointsInPeriod` | Recharts構成 | 画面用DOM直撮りは非推奨 | 必要 | 中 |
| 日間増加ランキング推移 | `CharacterDetail.jsx` 486-520 | `buildWeekDailyRankSeries`, `enrichRankSeries`, `buildRankChartScale` | Recharts構成 | 画面用DOM直撮りは非推奨 | 必要 | 中 |
| レベル推移 | `CharacterDetail.jsx` 500-513 | 明示専用関数なし。現在は `chartGainSeries` から派生 | Recharts構成 | 不可 | `buildLevelProgressSeries` 抽出推奨 | 高。実装時に純粋関数化 |
| 自己ベスト | `MyCharacterCard.jsx` 158-164 | `computeDailyGainSelfRank`, `findBestDailyGain` | `HistoryDependentStatsSection` | 不可 | 必要 | 低 |
| 連続記録 | `MyCharacterCard.jsx` 158-164、`myCharacterUtils.js` 250-259 | `computePositiveGainStreak`, `pickBestRankStreak`, `computeDailyRankStreak` | `HistoryDependentStatsSection` | 不可 | 必要 | 低 |
| 職業内順位 | JSON row fields、`MyCharacterCard.jsx` 377-380 | `calculateTopPercent` | `RankRow` | 不可 | 必要 | 低 |
| サーバー内順位 | JSON row fields、`MyCharacterCard.jsx` 377-380 | `calculateTopPercent` | `RankRow` | 不可 | 必要 | 低 |
| 抜いた/抜かれた | `MyCharacterCard.jsx` 368-375 | `computePassedAndOvertaken`, `limitWithOthers` | `MovementList` | 不可 | 必要 | 中 |
| i18n文言 | `src/i18n/locales/*.json` | `t()` | 既存キーあり。`share`はリンクコピーのみ | 新規キー追加が必要 | 必要 | 高。6言語同時追加 |
| 現在選択中の期間 | `CharacterDetail.jsx` 466-469 | なし | `CharacterDetail`内state | 共有ボタンへ渡せない | 状態持ち上げ、または初期値のみ連携 | 中 |

### 3.2 ルーティングと差し込み口

- キャラ詳細URLは `#/character/:historyKey`。`useHashRoute.js` 150-190 がparse/buildを担当する。
- `navigateToCharacter(historyKey)` は現在のqueryを維持する実装。共有投稿URLは詳細に直接飛ばすため、初版は `window.location.origin + window.location.pathname + "#/character/" + encodeURIComponent(historyKey)` を推奨し、検索/ページqueryは含めない。
- `CharacterDetail.jsx` 447 に `shareControls` prop があり、`CharacterDetailView.jsx` 156 で既存 `ShareLinkButton` を渡している。T7のボタンはここへ追加するのが最小侵襲。

### 3.3 履歴ロード

- v2 summaryは `data/v2/rankings.json` から読み込む。ローカル実測では `exp_ranking/web/public/data/v2/rankings.json` は 8,369,441 bytes。
- 履歴shardは `useRankingBoard.js` 366-390 の `ensureHistories()` が `loadCharacterHistories()` 経由で取得する。
- 詳細表示キャラは `useRankingBoard.js` 510-514 で履歴ロードされる。共有画像生成時は、履歴依存の任意項目を選んだ場合に `historyReady` を確認し、未ロードなら生成前に待つUIが必要。

## 4. 技術選定

### 4.1 候補比較

| 方式 | Recharts SVG | 外部キャラ画像/CORS | CSS対応 | 多言語/フォント | 解像度/品質 | 静的SPA相性 | モバイル | 実装コスト | 評価 |
|---|---|---|---|---|---|---|---|---|---|
| `html-to-image` | 良い。DOM/SVGをforeignObject経由で画像化 | CORS失敗時は `imagePlaceholder` あり。ただし画像は欠落/代替 | 比較的良い | webfont埋め込み、`fontEmbedCSS`あり | `canvasWidth/Height`, `pixelRatio` | 良い | Safariは要実機検証 | 中 | 推奨候補 |
| `html2canvas` | DOM再構築方式。SVG/CSS再現に差が出やすい | `useCORS`, `proxy`, `allowTaint`。プロキシなしでは制約あり | 対応CSSに限界 | 文字は描画されるが差異あり | `scale`あり | 良い | 対応範囲広いが再現差 | 中 | 第2候補 |
| `dom-to-image-more` | 良い。html-to-image同系 | `requestInterceptor`, `imagePlaceholder`, `corsImg`系が強い | 良い | font/resource処理あり | 良い | 良い | 要検証 | 中 | CORS fallback重視なら候補 |
| Canvas API直接描画 | Recharts流用不可。グラフ自前描画 | fetch不可なら同じくNG | CSS流用不可 | 自前フォント/折返し実装 | 制御最高 | 良い | 実装重い | 高 | 初版非推奨 |
| SVG生成後PNG化 | グラフ/文字をSVGで統一可能 | 外部画像は同じCORS課題 | CSS制限あり | SVG text中心なら制御可 | 良い | 良い | Safari要検証 | 高 | OG共用には有望、初版は重い |
| ブラウザ標準APIのみ | DOM→PNGの標準APIはない | 解決不可 | 手作り必要 | 手作り必要 | 手作り次第 | 依存なし | 手作り | 高 | 非推奨 |

### 4.2 推奨

推奨初版は `html-to-image` を dependency として追加する案。ただし依存追加はユーザー承認後に限る。

理由:

- 既存React/Tailwind/Recharts DOMを共有専用コンポーネントとして組み立て、`toBlob()` / `toPng()` でPNG化する導線が短い。
- `imagePlaceholder`, `pixelRatio`, `fontEmbedCSS`, `canvasWidth/Height` が初版要件に合う。
- npm調査結果: `html-to-image@1.11.13`, MIT, unpacked size 315,082 bytes, runtime dependenciesなし。

代替:

- `dom-to-image-more@3.10.2`, MIT, unpacked size 976,999 bytes。resource fallbackが強いが、初版にはやや大きい。
- `html2canvas@1.4.1`, MIT, unpacked size 3,379,055 bytes、依存 `css-line-break`, `text-segmentation`。CSS/SVG再現差とサイズが気になる。

一次情報:

- `html-to-image` README: https://github.com/bubkoo/html-to-image
  - DOM nodeから `toPng`, `toBlob`, `toSvg` などを返し、`imagePlaceholder`, `pixelRatio`, `fontEmbedCSS` を持つ。ブラウザは Promise と SVG `foreignObject` が必要。
- `html2canvas` README: https://github.com/niklasvh/html2canvas
  - 実スクリーンショットではなくDOM/CSSからcanvasを再構築する。CORS制約は迂回せず、cross-origin contentにはproxyが必要。
- `html2canvas` options: https://html2canvas.hertzen.com/configuration
  - `useCORS`, `proxy`, `scale`, `foreignObjectRendering`, `ignoreElements` がある。
- `dom-to-image-more` README: https://github.com/IDisposable/dom-to-image-more
  - `requestInterceptor` と `imagePlaceholder` によるresource fallbackを確認。
- Web Share API: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- `navigator.canShare`: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare
- ClipboardItem: https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem
- X API overview: https://docs.x.com/overview

## 5. CORS検証結果

### 5.1 画像配信元

現在のキャラ画像URLは `https://market-static.msu.io/msu/platform/charimages/transient/...png`。

ローカル `data/v2/rankings.json` 先頭3キャラで確認:

| キャラ | HTTP | Content-Type | Content-Length | Server | CORS |
|---|---:|---|---:|---|---|
| Benjapol | 200 | image/png | 5431 | AmazonS3 / CloudFront | `Access-Control-Allow-Origin` なし、`Vary: Origin` あり |
| Chisei | 200 | image/png | 5076 | AmazonS3 / CloudFront | `Access-Control-Allow-Origin` なし、`Vary: Origin` あり |
| JJShade | 200 | image/png | 2830 | AmazonS3 / CloudFront | `Access-Control-Allow-Origin` なし、`Vary: Origin` あり |

また `x-amz-expiration` は `TTL-90days-msu/platform/charimages/transient` を示しており、長期的な画像URL安定性にも注意が必要。

### 5.2 判定

HTTPヘッダ上は `<img>` 表示は可能だが、`crossOrigin="anonymous"` や `fetch -> Blob -> data URL` でcanvasへ安全に取り込める見込みは低い。実ブラウザでのCanvas taint検証は、ローカル環境でPlaywright Chromiumが未導入、Edge headless起動も制約があり完了していない。

初版では次を前提にする:

- キャラ画像は「可能なら表示」ではなく、PNG生成成功を優先して placeholder / シルエット / 画像なしにfallbackする。
- 実装前にブラウザで `fetch(imageUrl, { mode: "cors" })` と canvas `getImageData()` の実測を行う。
- `html-to-image` の `imagePlaceholder` を用意し、外部画像失敗で画像生成全体が失敗しないようにする。

採用しない案:

- サーバープロキシ: バックエンド追加になるため対象外。
- bot/CIで画像キャッシュ: データ契約・workflow変更になるため初版対象外。
- `allowTaint` 的な回避: PNG読み出し不能になるため共有画像用途では不可。

## 6. Recharts画像化スパイク結果

本番UIへの配線なし、依存追加なしで最小スパイクを実施した。

結果:

- `react-dom/server` + Recharts固定サイズ `BarChart width={520} height={260}` は静的HTML内に `<svg>` を生成した。
- `ResponsiveContainer` はSSRでは `<svg>` を生成せず、wrapperのみになった。
- したがって共有カード用グラフは `ResponsiveContainer` を避け、固定 `width` / `height` のRecharts構成を使う。
- `isAnimationActive={false}` を明示し、Tooltipやhover UIは共有カードに入れない。

未完了:

- `html-to-image` 未導入のため、実ブラウザでの 1600x900 PNG出力、文字にじみ、メモリ、連続生成リークは未検証。
- Playwrightブラウザ実行がこの環境では成立しなかったため、Safari/Chrome/Edge実機確認は実装直前の必須watch-item。

## 7. 初版スコープ

推奨初版は案B。ただしCORS未解決のため、キャラ画像はplaceholder fallback込みで実装する。

含める:

- 1600x900 横長1種類。
- 基本情報固定: 名前、職業、サーバー、Lv、EXP%、レベル順位、Daily/Weekly/Monthly増加量と順位、Lulumi Tools、`lulumi-tools.com`。
- 任意項目: 増加量平均、保存済み目標進捗、自己ベスト/連続記録、職業/サーバー内順位、抜いた/抜かれた。
- グラフ最大2つ: デイリーEXPグラフ、日間増加ランキング推移、またはレベル推移から選択。
- 期間: 7日、30日、90日、現在画面で選択中の期間。ただし初版は「現在画面の期間」を初期値にし、モーダル内で変更可能にする。
- プレビュー、PNG保存、画像コピー、スマホWeb Share、PC投稿文コピー、X Web Intent起動。

## 8. 除外範囲

- X APIによる完全自動投稿。
- サーバー、プロキシ、OG画像生成サーバー。
- bot/workflow/データ契約変更。
- キャラ画像のCIキャッシュ。
- 縦長レイアウト、複数テンプレート、複数枚分割。
- 共有画像からのインタラクティブ操作。

## 9. コンポーネント構成

推奨構造:

```text
src/share/
├─ ShareImageButton.jsx
├─ ShareImageModal.jsx
├─ ShareImagePreview.jsx
├─ ShareImageBuilder.jsx
├─ shareImageModel.js
├─ shareImageExport.js
├─ shareText.js
└─ safeFilename.js

ShareImageBuilder
├─ ShareImageHeader
├─ CharacterOverview
├─ GainSummary
├─ RankingSummary
├─ OptionalStatsGrid
├─ GoalProgressSection
├─ PlannerSection
├─ DailyGainChart
├─ DailyRankChart
├─ LevelProgressChart
└─ BrandFooter
```

方針:

- 既存詳細DOMを撮らない。共有専用コンポーネントを作る。
- 計算は `shareImageModel.js` で既存純粋関数を呼んでview model化する。
- JSXはview modelを配置するだけにし、T3/T4計算をコピーしない。
- グラフは固定サイズRecharts。`ResponsiveContainer` は使わない。

## 10. 状態管理

状態は `ShareImageModal` 内に閉じる。

- `open`
- `layout: "xWide"`
- `period: "7" | "30" | "90" | "current" | "custom"`
- `selectedItems`
- `maxGraphs: 2`
- `isGenerating`
- `errorCode`
- `previewBlobUrl`
- `generatedBlob`

現在選択中期間の扱い:

- `CharacterDetail` 内stateのままだと外部から読めない。
- 実装案は2つ。
  - 最小: 共有ボタン押下時の初期値は常に7日。モーダルで変更可能。
  - 推奨: `CharacterDetail` の `chartPeriod/customStartDate/customEndDate` を内部stateのまま維持しつつ、`shareControls` へ render prop で現在値を渡す小変更を行う。
- 後者はCharacterDetailの責務を少し広げるため、Claude実装時に差分を小さく確認する。

## 11. 画像生成フロー

1. ユーザーが生成ボタンを押す。
2. 履歴依存項目があれば履歴ロード済みか確認する。
3. `buildShareImageModel()` で既存関数から表示モデルを作る。
4. hidden/offscreenではなく、画面外の固定サイズDOMに `ShareImageBuilder` を描画する。
5. `document.fonts.ready` を待つ。
6. 外部画像が使えない場合はplaceholderを使う。
7. `html-to-image.toBlob(node, { width: 1600, height: 900, canvasWidth: 1600, canvasHeight: 900, backgroundColor: "#020617", pixelRatio: 1 })` で生成する。
8. object URLを作りプレビューする。
9. 保存/コピー/共有後に object URL revoke とDOM cleanupを行う。

高DPIは初版では `1600x900` 実寸 `pixelRatio: 1` を推奨する。`pixelRatio: 2` はメモリとモバイルクラッシュリスクが上がるため、実機検証後に検討する。

## 12. X共有フロー

### スマホ

- `navigator.canShare({ files: [pngFile] })` がtrueなら `navigator.share({ files, title, text, url })`。
- MDN上、Web Share APIはHTTPS・user activationが必要で、file share非対応なら `canShare` がfalseになる。
- iOS Safari / Android Chrome / Xアプリへの渡り方は実機検証必須。text+url+files がすべて反映されるとは決め打ちしない。

### PC

- ローカル生成画像をX Web Intentに自動添付することはできない。
- 推奨順:
  1. PNG保存
  2. 投稿文コピー
  3. `https://twitter.com/intent/tweet?text=...&url=...` または `https://x.com/intent/tweet?...` を開く
  4. ユーザーが保存済み画像を手動添付
- ポップアップブロック対策として、X Intentはユーザーのクリックイベント内で開く。

### X API

初版では採用しない。X公式ドキュメント上、API利用にはDeveloper Console、認証、APIキー管理、pay-per-use/Enterpriseの検討が必要。静的SPAだけでは秘密情報を安全に保持できず、サーバー追加が必要になる。

## 13. エラー・fallback

| 状況 | 表示/処理 |
|---|---|
| 画像CORS失敗 | placeholderで続行。画像なしで生成 |
| 履歴未ロード | 生成ボタンをloadingにして待つ。失敗時は該当項目を外す提案 |
| グラフ0件 | グラフ枠に「データなし」 |
| 生成失敗 | 既存リンクコピー機能と同様に短いエラー文、再試行 |
| Clipboard画像コピー非対応 | PNG保存へ誘導 |
| Web Share file非対応 | PNG保存 + 投稿文コピー + X Intent |
| キャンセル | エラー扱いにしない |
| 連打 | `isGenerating` で二重実行防止 |
| 項目過多 | グラフ最大2、任意項目数上限、超過時はdisabled |

## 14. 6言語

追加キーは `src/i18n/locales/{ja,en,zh-TW,es,vi,th}.json` すべてに追加する。

候補:

- `shareImage.create`
- `shareImage.modalTitle`
- `shareImage.preview`
- `shareImage.downloadPng`
- `shareImage.copyImage`
- `shareImage.shareNative`
- `shareImage.openX`
- `shareImage.copyPostText`
- `shareImage.generating`
- `shareImage.failed`
- `shareImage.imageFallback`
- `shareImage.option.*`
- `shareImage.period.*`

既存 `share.copyLink`, `share.copied`, `share.copyFailed` はリンクコピー専用として残す。

## 15. セキュリティ・負荷

- 外部画像をdata URL化できない可能性が高いため、無理にcanvasへ混ぜない。
- 共有専用DOMにはinput、ボタン、hidden情報、localStorage中身を入れない。
- キャラ名など外部由来文字列はReactテキストとして描画し、`dangerouslySetInnerHTML` は使わない。
- 1600x900固定、グラフ最大2、生成中1回だけでメモリを抑える。
- object URLは生成物差し替え時とunmount時にrevokeする。
- 利用者データは外部サーバーへ送らない。
- CDN依存は追加しない。npm dependencyのみ。
- GA4が導入される場合のイベント候補: `share_image_open`, `share_image_generate_success`, `share_image_generate_failed`, `share_image_download`, `share_image_copy`, `share_image_native_share`, `share_image_x_intent`。現状GA4配線がなければ実装しない。
- CSPを導入している場合は `blob:` / `data:` の扱いを確認する。現状はGitHub Pages静的配信で明示CSPは見当たらない前提。

## 16. T6/OGとの境界

T7先行時の方針:

- React共有カードの「表示モデル」は将来のOG生成にも流用できるよう、`shareImageModel.js` をDOM/API非依存にする。
- レンダラーはブラウザT7用と将来OG用で分けてよい。
- `html-to-image` はブラウザDOM前提なので、CI/Node OG生成にはそのまま使いにくい。
- T6/OGで全キャラ画像を生成するなら Playwright/Puppeteer、またはSVG/Canvasの別レンダラーが必要。
- 初版からOG共用を狙いすぎると過剰設計になる。共用境界は「view model」と「色/文言/数値formatter」までに留める。

T6で作り直しを防ぐ境界:

- `buildShareImageModel(character, allCharacters, expTable, profileGoal, options)` を純粋関数化。
- `ShareImageBuilder` はpropsだけで描画。
- 画像生成API、Web Share、Clipboardは `shareImageExport.js` に隔離。

## 17. 作成・変更ファイル

初版実装時の想定:

```text
exp_ranking/web/src/share/ShareImageButton.jsx
exp_ranking/web/src/share/ShareImageModal.jsx
exp_ranking/web/src/share/ShareImagePreview.jsx
exp_ranking/web/src/share/ShareImageBuilder.jsx
exp_ranking/web/src/share/shareImageModel.js
exp_ranking/web/src/share/shareImageExport.js
exp_ranking/web/src/share/shareText.js
exp_ranking/web/src/share/safeFilename.js
exp_ranking/web/src/share/shareImageModel.test.js
exp_ranking/web/src/share/safeFilename.test.js
exp_ranking/web/src/pages/CharacterDetailView.jsx
exp_ranking/web/src/CharacterDetail.jsx
exp_ranking/web/src/i18n/locales/*.json
exp_ranking/web/package.json
exp_ranking/web/package-lock.json
```

ただし `package.json` 変更はユーザー承認後。

この調査で作成したファイル:

```text
docs/IMPL_PLAN_T7.md
```

スパイク用ファイルは残していない。

## 18. 新規依存

推奨:

```text
html-to-image@^1.11.13
```

- 種別: `dependencies`
- 理由: 本番ブラウザでユーザー操作時に実行するため。
- ライセンス: MIT
- runtime dependencies: npm view上はなし
- unpacked size: 315,082 bytes
- バンドル影響: 実装時に dynamic import (`await import("html-to-image")`) を使い、通常表示の初期bundleへ載せないことを推奨。

比較:

- `dom-to-image-more@3.10.2`: MIT, 976,999 bytes。fallback機構は強いが初版には大きめ。
- `html2canvas@1.4.1`: MIT, 3,379,055 bytes, `css-line-break`, `text-segmentation` 依存。Recharts/SVG再現差とサイズが懸念。

## 19. コミット分割

Claude実装時の推奨:

1. `docs: add T7 implementation plan`
2. `feat(web): add share image model and tests`
3. `feat(web): add share image preview layout`
4. `feat(web): add png export and copy/share actions`
5. `feat(web): wire share image action into character detail`
6. `test(web): add share image regression coverage`

この調査段階ではcommit/pushしない。commit/pushは必ずユーザー判断を求める。

## 20. テスト計画

単体:

- `buildShareImageModel()` が既存T3/T4関数を呼び、期待フィールドを返す。
- 履歴なし/履歴不足/0 gain時のfallback。
- 保存済み目標あり/なし。
- グラフ項目が最大2に制限される。
- `safeFilename()` が危険文字、空文字、長すぎる名前を正規化する。
- 投稿文生成が詳細URLを含む。

結合:

- 詳細ページでモーダルを開ける。
- 生成中の二重クリックができない。
- placeholder画像でPNG生成が成功する。
- グラフなし/1つ/2つで1600x900に収まる。
- 6言語でラベル欠落がない。

ブラウザ実測:

- Chrome / Edge / Safari / iOS Safari / Android Chrome。
- `navigator.canShare({ files })` の可否。
- `ClipboardItem` PNG書き込み可否。
- XアプリへのWeb Share挙動。

## 21. 実機検証項目

- 1600x900 PNGの寸法とファイルサイズ。
- 生成時間: 目標 1-3秒程度。5秒超ならUIに明確なloading。
- 連続5回生成してメモリ増加が残らない。
- 日本語、英語、繁体字、スペイン語、ベトナム語、タイ語が欠けない。
- 長いキャラ名・長い職業名が折り返して破綻しない。
- Recharts軸、線、バー、ラベルが欠けない。
- Tooltipやボタンなど不要UIが写らない。
- キャラ画像CORS失敗時に生成全体が失敗しない。
- スマホでクラッシュしない。
- X Web Intentの本文とURLが期待通り入る。

## 22. 受け入れ条件

- キャラ詳細から共有画像作成モーダルを開ける。
- 1600x900 PNGを生成できる。
- キャラ画像が取得できなくてもplaceholderで成功する。
- 基本情報、ブランド名、`lulumi-tools.com`、詳細URL用投稿文が含まれる。
- 任意項目と期間を選べる。
- グラフ最大2つでレイアウトが崩れない。
- PNG保存ができる。
- 対応ブラウザでは画像コピーができる。非対応ではfallbackを出す。
- 対応スマホではWeb Share APIが使える。非対応ではfallbackを出す。
- PCでは投稿文コピーとX投稿画面起動ができる。
- 6言語でキー欠落がない。
- bot/workflow/データ契約を変更しない。

## 23. watch-item

実装前に必ず確認:

- 実ブラウザでキャラ画像がcanvasをtaintしないか。現時点のHTTPヘッダでは不可寄り。
- `html-to-image` の実PNG生成がRecharts固定SVGで安定するか。
- Safariで `foreignObject` 経由の描画が破綻しないか。
- iOS SafariでWeb Share fileがXアプリへ期待通り渡るか。
- `document.fonts.ready` 待機で多言語フォント表示が安定するか。
- `current screen period` を共有モーダル初期値にするための `CharacterDetail` 小変更が本当に最小で済むか。
- T6/OGで共有したいview modelにDOM依存が混ざらないか。

停止条件:

- placeholderでもPNG生成が不安定。
- グラフがPNGで欠ける。
- 1600x900に基本情報 + グラフ2つが現実的に収まらない。
- 新規依存追加が承認されない。
- CORS対策のためにサーバー/bot/workflow変更が必要になる。

## 24. push前提示物

実装担当はpush前に以下を提示する。

- `npm run build` 結果。
- share関連テスト結果。
- 生成PNGサンプル 1枚以上。
- 日本語 + タイ語または繁体字のスクリーンショット。
- Chrome/EdgeでのPNG保存結果。
- 可能ならスマホWeb Share実機結果。
- キャラ画像CORSが失敗した場合のplaceholder生成結果。
- 追加依存とbundle影響。
- 変更ファイル一覧。

## 初版候補比較

| 案 | 内容 | 実装日数 | リスク | ユーザー価値 | 宣伝効果 | T6再利用 | 検証コスト |
|---|---|---:|---|---|---|---|---|
| 案A 最小版 | PNG保存のみ、基本情報固定、グラフ最大1 | 2-3日 | 低 | 中 | 中 | 中 | 低 |
| 案B 推奨初版 | チェック項目、グラフ最大2、プレビュー、保存/コピー/Web Share/X Intent | 4-6日 | 中 | 高 | 高 | 中 | 中-高 |
| 案C 拡張版 | 横長/縦長、複数画像、Discord、テーマ | 8日以上 | 高 | 高 | 高 | 高 | 高 |

推奨は案B。ただし、キャラ画像はCORS解決を初版成功条件にせず、placeholder fallbackを正式仕様に含める。

## 結論

T7は実装可能性が高いが、外部キャラ画像CORSと実ブラウザPNG生成は未解決リスク。最小の堅い境界は「共有専用Reactレイアウト + `html-to-image` + placeholder fallback + 固定サイズRecharts + 純粋view model」。T3/T4計算は既存関数を呼び、UIへコピーしない。


