# IMPL_PLAN_SH5 — 履歴チャート画面(`#/starforce`)

設計正典: `docs/DESIGN_SF_COST_HISTORY.md`(r2)§7.1 / §9.1 / §10.1〜10.3 / §11 / §12 / §15 U2。
前提: **SH-3 完了**(API)/ **SH-4 完了**(`src/sfhistory/starforce.js` が本家とビット一致)。

## 0. 目的

**ユーザーが装備と強化範囲を選ぶと、その費用の150日推移と、現在値が過去のどの水準かが分かる画面。**

## 1. スコープ

**新規**(すべて `exp_ranking/web/src/sfhistory/` 配下):
- `SfHistoryRoot.jsx` — 画面ルート
- `integrations/sfHistorySource.js` — API クライアント(**`raffle/integrations/raffleSource.js` と同型**。
  `DEFAULT_SF_HISTORY_API_BASE = "https://api.lulumi-tools.com"` + `VITE_SF_HISTORY_API_BASE` で上書き)
- `domain/series.js` — 純粋関数(Expected 系列の算出・期間切出し・統計・percentile)
- `domain/series.test.js` — vitest
- `components/*.jsx` — 装備セレクタ / 星レンジ + プリセット / 期間タブ / チャート / サマリー / 計算条件
- `sfhistory.css`(既存の流儀に合わせる)

**変更してよい既存ファイル(追加のみ・既存の分岐を書き換えない)**:
- `src/board/useHashRoute.js` — `#/starforce` の解釈を**追加**
- `src/App.jsx` — 新ルートの分岐を**追加**
- `src/i18n/locales/{ja,en,es,th,vi,zh-TW}.json` — **6ロケール全部に同時にキー追加**

**触らないもの**(1つでも触れたら停止):
- 上記以外の `src/` 既存ファイル / `exp_ranking/bot/` / `server/` / `.github/workflows/`
- `package.json` / `package-lock.json`(**新規依存はユーザー専権**。recharts は既にある)
- `docs/DESIGN_SF_COST_HISTORY.md` / `docs/DECISION_LOG.md`
- **`C:\Users\pachi\Desktop\msu ranking`(元ツリー)**

## 2. 画面仕様(設計 §11)

上から: タイトル / 装備選択 / 開始星・目標星 + プリセット / 期間 / 現在値サマリー / チャート / 統計カード / 計算条件。

- **装備選択**: 検索可能。**検索対象は `aliasItemIds` を含む全 itemId と装備名**(設計 §7)。
  取得・表示は代表 itemId
- **★目標星は `maxStar` を超える選択肢を出さない**(設計 §7.1)。
  6装備は☆20 が上限。**出すとチャートが全 null になり「壊れている」と映る**
- **プリセット**: 0→17 / 17→18 / 18→19 / 19→20 / 20→21 / 21→22 / 19→21 / 0→22。
  **`maxStar` を超えるプリセットは無効化する**(消すか disabled)
- **期間**: 7D / 30D / 90D / 150D。**足は常に4時間**
- **チャート**: recharts の LineChart。Expected のみ。期間平均の ReferenceLine + 高値/安値マーカー。
  縦軸は `950M` / `1.25B` 形式の省略表示。ツールチップは正確な数値 + 前回比 + 期間平均との差
- **サマリー**: Current(§4)/ Period Average / Period High / Period Low / Current Position(percentile)
- **計算条件**: スターキャッチON / チャンスタイムON / 破壊防止OFF / イベント補正なし / 指標=期待値 /
  足=4時間 / 履歴の最終更新 / 現在価格の取得時刻。**`policyVersion` も出す**
- **断定的な推薦をしない**(設計 §11)。「今強化すべき」は書かない。percentile などの客観指標のみ

## 3. 計算(設計 §8・SH-4 の成果を使う)

- `src/sfhistory/starforce.js` の **`expectedStarforceCostExact` を引数なし既定で呼ぶ**
  (スターキャッチON・チャンスタイムON・keep не数えない・破壊防止なし = 既定値そのもの)
- **Worker を使わない・キャンセルもキャッシュもしない**(設計 §8.3。実測 900点=32ms)
- **欠損**: `requiredPriceStars(from,to)` が返す星が1つでも `null` の時点は、その時点の Expected を `null` に。
  **補間しない**。チャートは線を切る
- **`starforce.js` を編集しない**(移植物。SH-4 の golden が守っている)

## 4. 現在価格(設計 §6)

- `/sf-history/latest?itemId=` を使う。**失敗したら「現在価格を取得できません」と明示**し、
  **履歴の最終足で代替しない**
- **統計(平均・高値・安値・percentile)は確定足のみで計算する。**現在値を混ぜない(設計 §6.1)
- 現在値の Expected も同じ `expectedStarforceCostExact` で計算する

## 5. API 呼び出しの制約(設計 §10.2)

**単純リクエストのみ。カスタムヘッダを付けない。**(preflight は 405 を返すため、付けると落ちる)

## 6. i18n

- **6ロケール全部**(`ja/en/es/th/vi/zh-TW`)に同時にキー追加。既存キーを1つも変更しない
- **ja と en を正**とする。**es/th/vi/zh-TW は暫定訳でよいが、完了報告に
  「ネイティブレビュー未実施」と明記**すること(黙って本番品質のふりをしない)

## 7. 受け入れ基準(数値・機械判定)

- **(a)** `npm run test` 全緑。**`src/sfhistory/domain/series.test.js` を含む**。
  最低限これらを固定する:
  - 欠損時点が `null` になる(`requiredPriceStars` の星が欠けたケース)
  - percentile の算出(既知の配列で手計算値と一致)
  - 期間切出し(150D/90D/30D/7D の点数)
  - **`maxStar` を超える目標星が選択肢に出ない**(星20装備で 21/22 が出ない)
- **(b)** `npm run build` 成功。**バンドルに recharts 以外の新規依存が入らない**
- **(c)** `git diff -w` で、**既存ファイルの変更が §1 に挙げた3種のみ**、かつ**追加のみ**
  (`useHashRoute.js` / `App.jsx` / 6ロケール)。差分行数を報告
- **(d)** **既存ルートの回帰なし**: `src/board/useHashRoute.test.js` が**無改変で緑**。
  `#/`(list)/`#/character/...`/`#/dashboard`/`#/tasks`/`#/schedule` が従来どおり解決すること
- **(e)** **900点の再計算 ≤ 200ms**(設計 §13)。装備・星を変えたときの実測値を報告
  (`performance.now()` で計測してコンソールに出す等。**計測コードは残さない**)
- **(f)** 6ロケール全部に同じキー集合が入っている(キー数を報告。**差があれば不合格**)
- **(g)** ローカル API(`VITE_SF_HISTORY_API_BASE`)に対して画面が動くことを、
  **起動手順つきで報告**する(統括がブラウザで検収する)

## 8. 停止条件

1. `useHashRoute.js` / `App.jsx` を**追加でなく書き換えないと**新ルートが入らない
2. (d) の既存ルート回帰が出る
3. 新規 npm 依存が必要になった(**recharts で描けない要求があった**)
4. (e) が **1秒**を超える
5. §1 の「触らないもの」に触る必要が生じた
6. 設計書の指定(§7.1 の `maxStar` 制限、§6.1 の統計に現在値を混ぜない、§12 の分位を出さない)を
   **満たせない**と判明した

## 9. コミット

- **ローカルコミットを行う**。3コミット推奨:
  ① API クライアント + domain(純粋関数)+ テスト ② ルート追加 + i18n ③ 画面コンポーネント
- **`git push` は行わない**。**`git add -A` 禁止**。

## 10. 完了報告テンプレ

```
## SH-5 完了報告
- コミット: <hash>(各1行要約)
- (a) npm run test: <n> passed(sfhistory の内訳)
- (b) npm run build: 結果 / 新規依存: 無し
- (c) 既存ファイルの変更: useHashRoute.js <n>行 / App.jsx <n>行 / 各ロケール <n>行(追加のみ)
- (d) useHashRoute.test.js 無改変で緑 / 既存ルートの解決確認
- (e) 900点再計算: <n> ms(装備・星の条件つき)
- (f) 6ロケールのキー数: ja=<n> en=<n> es=<n> th=<n> vi=<n> zh-TW=<n>
- (g) ローカル起動手順(統括がブラウザで検収するため)
- 暫定訳の言語と、ネイティブレビュー未実施である旨
- 停止条件に触れた事項(あれば)
- 設計書との矛盾(あれば。自分で設計書を直さずここに書く)
```
