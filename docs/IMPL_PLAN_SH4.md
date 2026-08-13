# IMPL_PLAN_SH4 — Expected 計算式の vendor + 越境 golden テスト

設計正典: `docs/DESIGN_SF_COST_HISTORY.md`(r2・承認済)§8。本スライスは §13 の SH-4。
**公式 API・SQLite・VPS のいずれにも依存しない。** SH-2/SH-3 と独立。

## 0. 目的と背景

ブラウザで Expected 費用を計算するために、**maplenEnhancebot の
`packages/engine/src/starforce.ts` を JavaScript として持ち込む**。

**★このファイルは移植物であって正ではない。** 正は maplenEnhancebot 側。
∴ **持ち込むと同時に、コピーであることを機械検証する golden テストをセットで作る**
(設計 §8: 「検証なき同期面は却下」)。

## 1. スコープ

**作るもの**(すべて新規):
- `exp_ranking/web/src/sfhistory/starforce.js` — 移植本体
- `exp_ranking/web/src/sfhistory/__fixtures__/sf_expected.json` — 越境 golden データ
- `exp_ranking/web/src/sfhistory/starforce.test.js` — vitest
- `exp_ranking/web/src/sfhistory/scripts/sync_sf_fixtures.mjs` — fixture 抽出スクリプト(再生成用)
- `docs/reports/SH4_PORT.md` — 結果報告書

**触らないもの**(1つでも触れたら停止):
- `exp_ranking/web/src/` の**既存**ファイル(board / stats / profile / raffle / taskManager / i18n / App)
- `exp_ranking/bot/` / `.github/workflows/` / `server/` 配下すべて
- `docs/DECISION_LOG.md` / `docs/DESIGN_SF_COST_HISTORY.md`(更新は統括)
- **`C:\Users\pachi\Desktop\maplenEnhancebot` は読み取り専用**(fixture と .ts を読むが**1バイトも書かない**)
- **`package.json` を変更しない**(新規依存の追加はユーザー専権。vitest は既に入っている)

## 2. 移植のやり方(ここを外さない)

`packages/engine/src/starforce.ts` から **型注釈だけを除去**する。**ロジックを1行も変えない。**

- `export type` / `export interface` / `: Type` / `as Type` / `<T>` を落とす
- `??` `?.` はそのまま(既存 web も同水準の構文を使っている)
- **数式・演算順序・ループ順序・ピボット選択・比較演算子を一切変えない**
  (Gaussian elimination は Python の pivot/elimination 順序を意図的に再現している。
  「きれいに書き直す」と浮動小数の結果が変わる)
- **持ち込む関数**: `STAR_PROBABILITIES` / `effectiveProbabilities` / `applyStarCatchInverse` /
  `applySafeguard` / `minReachableStar` / `requiredPriceStars` / `spanHasDropOrBoom` /
  `expectedStarforceCostExact` とその内部ヘルパ
- **持ち込まない**: `analyticStarforceCostPercentiles` / `starforceCost`
  (**分位は本ツールで出さない**=設計 §12。持ち込むと「使える数字がある」と誤解を生む)

ファイル冒頭に必ず書く:
```js
// 移植物。正は maplenEnhancebot packages/engine/src/starforce.ts (commit <hash>)。
// このファイルを直接編集しない。修正は向こうを直してから再移植する。
// 一致は starforce.test.js が maplenEnhancebot の parity fixture と照合して保証する。
```

## 3. 越境 golden

`sync_sf_fixtures.mjs` が maplenEnhancebot の
`tools/parity/sf_fixtures/{itemId}.prices.json` と `{itemId}.percentiles.json` を読み、
`__fixtures__/sf_expected.json` を生成する:

```json
{ "sourceRepo": "maplenEnhancebot", "sourceCommit": "<hash>", "generatedAt": "...",
  "items": [ { "itemId": 1382265,
               "prices": { "0": 486151.895524, ... },
               "spans": [ { "from": 0, "to": 12, "expected": 3170306.872188205 }, ... ] } ] }
```

`percentiles.json` からは **`expected` だけ**を取る(p50/p70/p90 は取り込まない=設計 §12)。

## 4. 受け入れ基準(数値・機械判定)

- **(a)** fixture が **14装備**そろっている(maplenEnhancebot の `sf_fixtures` にある装備数と一致)
- **(b)** span 総数が **2,000 以上**(1装備あたり約176 span × 14)。実数を報告する
- **(c)** **全 span で `|ours - expected| / |expected| ≤ 1e-12`**。
  1件でも超えたら **停止条件**(丸めて通そうとしない)
- **(d)** 参考値として、**ビット一致した span の割合**(`Object.is(ours, expected)`)を報告する
  (1e-12 は合格線だが、実際にはビット一致が期待される。乖離があるなら移植で何かが変わっている)
- **(e)** `requiredPriceStars` の移植確認: `(19,21)` が **10..20** を返すこと、
  `(0,22)` が **0..21** を返すことをテストで固定(設計 §9.1 の欠損判定がこれに依存する)
- **(f)** `cd exp_ranking/web && npm run test` **全緑**、`npm run build` **成功**
- **(g)** `git diff -w` で **既存ファイルの差分が0件**(新規追加のみ)
- **(h)** `package.json` / `package-lock.json` に差分が無い

## 5. 停止条件(該当したら止めて選択肢+推奨付きで統括に報告)

1. **(c) を満たせない** — 相対誤差が 1e-12 を超える span がある。
   **許容値を緩めて通す判断は統括のもの**。数値と該当 span を添えて報告すること
2. 型注釈の除去だけでは動かず、**ロジックの書き換えが必要**になった
3. `starforce.ts` の中身が設計書 §8.2 の記述(既定引数の表)と違う
4. fixture の形式が §3 の想定と違う
5. §1 の「触らないもの」に触る必要が生じた
6. 新規 npm 依存が必要になった

## 6. 検証コマンド

```
cd exp_ranking/web && npm run test
cd exp_ranking/web && npm run build
git diff -w
git status --short
```

## 7. ロールバック

新規ファイルの追加のみ。revert すれば `src/sfhistory/` が消えるだけで、既存 SPA に影響しない。

## 8. コミット

- **ローカルコミットを行う**。2コミット推奨: ① fixture 抽出スクリプト + fixture ② 移植本体 + テスト
- **`git push` は行わない**(ユーザー専権)。**`git add -A` 禁止**。

## 9. 完了報告テンプレ

```
## SH-4 完了報告
- コミット: <hash>(各1行要約)
- (a) fixture 装備数: <n>
- (b) span 総数: <n>
- (c) 最大相対誤差: <実数>(≤1e-12 であること)/ 超過 span: <n>件
- (d) ビット一致 span: <n>/<n>(<n>%)
- (e) requiredPriceStars(19,21) / (0,22) の実測値
- (f) npm run test: <n> passed / npm run build: 結果
- (g) 既存ファイルの差分: 0件であることの確認方法と結果
- (h) package.json / package-lock.json の差分: 0
- 移植元コミットハッシュ:
- 停止条件に触れた事項(あれば)
- 気づいたが本スライスでは扱わなかったこと:
```
