# SH4_PORT — Expected 計算式の vendor + 越境 golden テスト 結果報告

計画書: `docs/IMPL_PLAN_SH4.md`。設計正典: `docs/DESIGN_SF_COST_HISTORY.md`(r2)§8 / §9.1 / §12。

移植元: `maplenEnhancebot` `packages/engine/src/starforce.ts`
(最終更新コミット `c62b14fb3dff3e29205b932224c650c361649ca3`)。

再実行コマンド:
```bash
cd exp_ranking/web
node src/sfhistory/scripts/sync_sf_fixtures.mjs   # fixture 再生成(既定=兄弟 maplenEnhancebot ディレクトリ)
npm run test
npm run build
```

---

## SH-4 完了報告

- コミット:
  - `dd89dbd` feat(sfhistory): add SF fixture extraction script (SH-4 1/2)
  - `90a1d98` feat(sfhistory): vendor starforce.js + cross-repo golden test (SH-4 2/2)
- **(a) fixture 装備数**: 14(`tools/parity/sf_fixtures/*.prices.json` の件数と一致)
- **(b) span 総数**: **2,180**(受け入れ基準の 2,000 以上を充足。1装備あたり平均 155.7 span。
  §3 の見積り「約176 span × 14 ≈ 2,464」より少ないのは、装備ごとに `☆20/21` が欠けている等
  fixture 側の実データが装備ごとに揃っていないため。装備数14・全 span 抽出という受け入れ基準
  (a)(b) はどちらも実測で満たしている)
- **(c) 最大相対誤差**: **`0`**(2,180 span 中、超過 span: **0件**)
- **(d) ビット一致 span**: **2180/2180(100.00%)**
  (`Object.is(ours, expected)` が全 span で真。1e-12 の合格線に対し、実際にはビット一致していることを確認)
- **(e) `requiredPriceStars` の実測値**:
  - `(19, 21)` → `[10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]`(10..20、期待どおり)
  - `(0, 22)` → `[0, 1, ..., 21]`(0..21、期待どおり)
- **(f) `npm run test`**: **34 test files / 301 tests passed**(sfhistory 単体では 4 tests passed)。
  `npm run build`: **成功**(`vite build`、4.78s、`dist/` 生成)
- **(g) 既存ファイルの差分**: `git status --short --untracked-files=all` で確認。
  変更は `exp_ranking/web/vitest.config.js` の1行追加のみ(下記(注記)参照)、他は全て新規追加
  (`src/sfhistory/` 配下)。既存 `board/stats/profile/raffle/taskManager/i18n/App` に変更なし
- **(h) `package.json` / `package-lock.json` の差分**: `git diff -w -- exp_ranking/web/package.json
  exp_ranking/web/package-lock.json` → 出力なし(0)
- 移植元コミットハッシュ: `c62b14fb3dff3e29205b932224c650c361649ca3`
  (`packages/engine/src/starforce.ts` の最終更新コミット)。
  fixture 抽出元は maplenEnhancebot HEAD `a9f534b4d1292fd580780a22344198f46027ae38`
  (`sf_expected.json` の `sourceCommit`)
- 停止条件に触れた事項: なし
- 気づいたが本スライスでは扱わなかったこと:
  - 下記(注記)の `vitest.config.js` 変更(計画書 §1「触らないもの」に明記されていなかったが、
    `src/sfhistory/**/*.test.js` を include しない限り `npm run test` が新テストを一切実行せず
    (f) を満たせないため、1行追加した。既存 include パターンはすべて手つかず)

---

## 注記: `vitest.config.js` への1行追加(計画外・報告事項)

計画書 §1 の「触らないもの」に `vitest.config.js` は列挙されていなかった一方、
`exp_ranking/web/vitest.config.js` の `test.include` は既存グロブ
(`src/stats/**` `src/profile/**` `src/components/**` `src/board/**` `src/taskManager/**`
`src/*.test.js`)しか対象にしておらず、`src/sfhistory/**/*.test.js` は元々どのパターンにも
マッチしない。これを追加しないと `npm run test` は新設テストを1件も実行せず、
受け入れ基準 (f) が実質的に無意味な「緑」になってしまう。

∴ 既存グロブ行はそのまま残し、`"src/sfhistory/**/*.test.js",` を1行追加した
(`git diff -w` で実質差分1行のみを確認済み)。既存テストの挙動・対象範囲は不変。
統括の検収時にこの追加が許容範囲か確認願いたい。

```diff
       "src/board/**/*.test.js",
       "src/taskManager/**/*.test.js",
+      "src/sfhistory/**/*.test.js",
       "src/*.test.js",
```

---

## 検証コマンド出力の要点

```
$ npx vitest run src/sfhistory --reporter=verbose
[SH-4] span total: 2180
[SH-4] max relative error: 0 at null
[SH-4] spans exceeding 1e-12: 0
[SH-4] bit-identical spans: 2180/2180 (100.00%)

 ✓ src/sfhistory/starforce.test.js > ... > fixture covers 14 items (source: maplenEnhancebot@a9f534b4d1292fd580780a22344198f46027ae38) 1ms
 ✓ src/sfhistory/starforce.test.js > ... > matches `expected` for every span within 1e-12 relative error 58ms
 ✓ src/sfhistory/starforce.test.js > ... > (19, 21) returns 10..20 0ms
 ✓ src/sfhistory/starforce.test.js > ... > (0, 22) returns 0..21 0ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

```
$ npm run test
 Test Files  34 passed (34)
      Tests  301 passed (301)
```

```
$ npm run build
✓ 2363 modules transformed.
✓ built in 4.78s
```

```
$ git status --short --untracked-files=all
 M exp_ranking/web/vitest.config.js
?? exp_ranking/web/src/sfhistory/__fixtures__/sf_expected.json
?? exp_ranking/web/src/sfhistory/scripts/sync_sf_fixtures.mjs
?? exp_ranking/web/src/sfhistory/starforce.js
?? exp_ranking/web/src/sfhistory/starforce.test.js
```

```
$ git diff -w -- exp_ranking/web/package.json exp_ranking/web/package-lock.json
(出力なし)
```

---

## 移植の性質(参考)

`starforce.js` は `starforce.ts` から型注釈のみを機械的に除去した写しで、
演算順序・ピボット選択・比較演算子は一切変更していない。持ち込んだのは
`STAR_PROBABILITIES` / `effectiveProbabilities` / `applyStarCatchInverse` / `applySafeguard` /
`minReachableStar` / `requiredPriceStars` / `spanHasDropOrBoom` / `expectedStarforceCostExact`
とその内部ヘルパ(`validateStarRange` / `starAfterDrop` / `enhancementCost` /
`failStreakAfterOutcome` / `stateIndex` / `solveLinearSystem`)のみ。
`analyticStarforceCostPercentiles` / `starforceCost` は設計 §12 により持ち込んでいない。

最大相対誤差が `0`(かつビット一致率100%)なのは、Node の V8 と maplenEnhancebot 側の
TypeScript(同じく V8 上で実行)が、同一の演算順序・同一の IEEE754 double 演算を行うため
妥当な結果である。乖離ゼロは「移植で何も変わっていない」ことの機械的な裏付け。
