# IMPL_PLAN_RAFFLE_TAX_SEMANTICS — Tax の入力値を「払う割合」として計算する(現状は「残る割合」になっている)

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー / 実装: 実装担当(implementer)
> 決定: DECISION_LOG **LULU-164**(ユーザー報告・裁定 2026-11-27)

## 0. 目的と背景

- ユーザー報告: 3人PTで2人に Tax 40% を入れたら配分は 60% / 20% / 20% になるはずだが、今は Tax 60% と入れないとその結果にならない。
- 統括が実関数で再現(`resolveDistributionRules(["A","B","C"], {B:"40",C:"40"})`):
  - Tax 40 → A=73.3333% / B=13.3333% / C=13.3333%(期待は 60 / 20 / 20)
  - Tax 60 → A=60% / B=20% / C=20%
- 原因: `exp_ranking/web/src/raffle/domain/distributionRules.js` が Tax 設定者の配分率を **`tax ÷ PT人数`** で計算している。入力値が「自分に残る割合」として扱われ、ラベル「Tax(払う割合)」と逆。画面の説明文 `raffle.distributionRuleHelp` も同じ誤った式を書いている。この式は `14a15ba` で入り、DECISION_LOG に記録の無い仕様だった(LULU-116 と同じ「未記録の仕様」クラス)。
- 正しい式: Tax 設定者の配分率 = **`(100 − Tax率) ÷ PT人数`**。残りは従来どおり Tax 未設定者の傾斜率または均等割り。

## 1. スコープ

触るファイル:
- `exp_ranking/web/src/raffle/domain/distributionRules.js`(Tax 由来の配分率の式のみ)
- `exp_ranking/web/src/raffle/domain/distributionRules.test.js`(新規または追記)
- Tax を含む既存テストの期待値(`settlement.test.js` / `shareImage.test.js` / `manualClear.test.js` / `partyShare.test.js` / `raffleStorage.test.js` のうち、計算結果を検証しているもの。**入力値の保存・往復だけを見ているテストは変えない**)
- `exp_ranking/web/src/i18n/locales/{ja,en,es,th,vi,zh-TW}.json` の `raffle.distributionRuleHelp` の式の部分だけ(6ロケール同時)

触らないもの: 保存形式・共有リンク形式(`raffleStorage.js`・`partyShare.js`)/ `settlement.js` / UI の JSX / `server/` / `package.json`

## 2. 仕様

- Tax の入力範囲は従来どおり 0 より大きく 100 以下(0 は不可、小数6桁まで)。
- Tax 設定者の配分率 `units = (HUNDRED − tax.units) / partySize`(BigInt 単位、切り捨ては従来と同じ扱い)。Tax 100 → 配分 0%。
- それ以外(傾斜、自動均等割り、合計100%チェック、`no_distribution_receiver`、端数配分、`materializeAutomaticShares`)は**ロジック不変**。
- **保存済みの Tax 値は変換しない**(ユーザー裁定「そのまま」)。同じ数値を新しい意味で計算する。移行処理・通知は入れない。
- 説明文(ja): 「全員が当選額を100%プールへ入れます。Tax設定者の配分率は「(100 − Tax率) ÷ PT人数」で自動決定し、残りをTax未設定者の傾斜率または均等割りで配分します。」他5言語も式の部分だけ同じ意味に直す。

## 3. 変わってよいもの・いけないもの

- 変わってよい: Tax を1人以上に設定したときの配分率・精算結果・共有画像の金額 / 説明文の式。
- 変わってはいけない: Tax 未設定(傾斜のみ・均等割り)のすべての結果 / 入力検証とエラーコード / 保存・共有リンクの形式と値 / Tax の表示テキスト(「Tax 40%」は入力値のまま表示)。

## 4. 受け入れ基準(数値)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | ユーザー報告の例 | 3人・B,C に Tax 40 → A=60% / B=20% / C=20%(`shareText`)、合計 100% | `distributionRules.test.js` |
| 2 | 精算の例 | 上記+プール 3,000,000 → `assignedShare` A=1,800,000 / B=600,000 / C=600,000 | `settlement.test.js` |
| 3 | 境界 | Tax 100 → 配分 0%、残り全額が未設定者へ / 6人で1人 Tax 10 → 15% / 残り5人 17% ずつ | テスト |
| 4 | 傾斜との併用 | 3人・B に Tax 40(→20%)、A 傾斜 50 → C 自動 30%、合計 100% | テスト |
| 5 | 不変 | Tax 未設定のケースの既存テストは**期待値無修正**で緑 | `npx vitest run src/raffle` |
| 6 | 全体 | 失敗は既知の `src/sfhistory/domain/format.test.js` の5件以外0(main 取込後に件数が変わっていれば、着手前の失敗一覧と同一であること) | `npx vitest run` |
| 7 | ビルド | 成功 | `npm run build` |
| 8 | i18n | 6ロケールの `distributionRuleHelp` が新しい式。キー集合は不変 | localeParity テスト |
| 9 | 範囲外 | `raffleStorage.js`・`partyShare.js`・`settlement.js`・`server/`・`package.json` の差分0行 | `git diff --stat` |

## 5. 停止条件

- 期待値を書き換える必要があるテストが、Tax を含むケース以外に出た
- 計画と実コードの構造差、または基準未達が2回の試行で解消しない
- スコープ外ファイルを触る必要が生じた

## 6. コミット分割

1. `fix(raffle): treat Tax as the share a member pays, not keeps`(domain・テスト・6ロケールの説明文)

挙動変更1件のみのため1コミット。書き換えた既存テストの期待値はコミットメッセージ本文に列挙する。

## 7. 検証コマンド

```
cd exp_ranking/web && npx vitest run src/raffle && npx vitest run && npm run build
git diff -w -- <touched files>
```

## 8. ロールバック

コミットを revert すれば旧式に戻る。保存形式は変えていないので、データの巻き戻しは不要。

## 9. 完了報告テンプレ

- コミットハッシュ:
- 受け入れ基準 1〜9 の実測値:
- 書き換えた既存テスト(名前・旧期待値→新期待値):
- 残課題:
