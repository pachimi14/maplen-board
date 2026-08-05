# IMPL_PLAN_SH12 — 増減の意味色を戻す + 金額表記を 000.00M / 000.00B に

前提: SH-11 完了・統括検収済(`c10a9ab`)。**ユーザー実機レビュー起点の2件**。

## 0. 指摘と原因

### ① 前回比がマイナスのとき文字色が変わらない

**統括がブラウザで切り分けた事実**(これを出発点にしてよい):

```
.sfh-root の内側に text-emerald-400 の要素を挿す → color = rgb(251,146,60)  ← テーマアクセント
document.body の直下に同じものを挿す           → color = oklch(0.765 ... )   ← 正しい emerald
text-rose-400 は内側でも外側でも正常
どのスタイルシートにも "emerald" を含むセレクタが存在しない
```

**つまり SH-9 のテーマ化で、意味色(安くなった=緑)がテーマアクセントに飲まれている。**
化けた先は `--theme-focus` で、**Expected 値の行と同じ色**になるため、
マイナス時に「色が変わっていない」ように見える。

**既定のグリーンテーマでは `--theme-focus` が `#34d399` ≒ emerald なので、
テーマを変えるまで誰も気づけなかった。**

### ② 金額表記

`formatCompactNeso`(`domain/format.js:10-25`)が
`toFixed(scaled >= 100 ? 0 : 2)` としており、100以上で小数が落ちる(`380M` / `2.63B`)。
**ユーザー要望: 常に小数2桁(`000.00M` / `000.00B`)**。

## 1. スコープ

**変更してよい**:
- `exp_ranking/web/src/sfhistory/domain/format.js`(+ `format.test.js`)
- `exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx`
- `exp_ranking/web/src/sfhistory/components/SummaryCards.jsx` / `WeekdayHeatmap.jsx`(表示のみ)
- `exp_ranking/web/src/sfhistory/sfhistory.css`
- `docs/reports/SH12_SEMANTIC_COLORS_AND_FORMAT.md`

**触らないもの**(1つでも触れたら停止):
- **`server/` 配下すべて**(表示のみの変更)
- `src/sfhistory/starforce.js` / `domain/series.js` / `domain/weekdayStats.js` の**計算ロジック**
  (**丸めは表示層だけ**。集計や統計の値を丸めないこと)
- `src/App.jsx` / `src/board/` / `src/pages/` / `src/components/` / `src/taskManager/`
- `src/i18n/`(**文言追加なし**の想定。必要になったら6ロケール同時)
- `package.json` / **VPS** / **元ツリー**

## 2. ① 意味色の直し方

**Tailwind のユーティリティに頼らない。** 上の調査どおり `text-emerald-400` は
`.sfh-root` 内で期待どおりに効かない(そもそも生成されていない疑いもある)。

- **`sfhistory.css` に専用のクラスを定義する**(例 `.sfh-delta-up` / `.sfh-delta-down`)
- **色はテーマ変数から取らない。**固定の意味色にする
  (上昇=赤系 / 下降=緑系。既存の見た目 `#fb7185`(rose-400)/`#34d399`(emerald-400)相当でよい)
- `SfHistoryChart.jsx` の**前回比**と**期間平均との差**の2箇所を、このクラスに置き換える
- **ヒートマップの最安/最高マーカーも同じ意味色に揃える**(現在 `sfhistory.css:265` 付近が
  「emerald/rose のペアと同じ」と書いているが、同じ問題を抱えていないか確認し、
  抱えていれば同じクラスに寄せる)

**★意味色とテーマ色を混ぜない**という原則を `sfhistory.css` にコメントで残すこと。
**同じ理由の再発を止める**のが本スライスの価値。

## 3. ② 表記

`formatCompactNeso` を **常に小数2桁**にする:

| 値 | 変更前 | 変更後 |
|---|---|---|
| 380,120,000 | `380M` | **`380.12M`** |
| 2,630,105,337 | `2.63B` | **`2.63B`**(変わらず) |
| 1,250,000,000 | `1.25B` | **`1.25B`**(変わらず) |
| 12,431,992,384 | `12.4B` | **`12.43B`** |

- **K の扱いも同じ規則に揃える**(桁で分岐しない)
- `formatSignedCompactNeso` は符号付与だけなので**自動的に追随する**
- **`formatExactNeso`(ツールチップの正確値)は変えない**(こちらは全桁表示)
- **丸めは表示層だけ**。`weekdayStats` の中央値や `computeStats` の値を丸めないこと

## 4. 受け入れ基準

- **(a) ★意味色**: `.sfh-root` の内側で、**前回比マイナスの行の色が Expected 値の行と異なる**こと。
  **4テーマ(green/blue/purple/orange)すべてで**、上昇色と下降色が
  **互いに異なり、かつ `--theme-focus` とも異なる**ことを計算済みスタイルで実測して報告
- **(b)** 期間平均との差、ヒートマップの最安/最高も同じ意味色で一貫
- **(c) 表記**: `380.12M` `12.43B` の形になる。**単体テストで境界値を固定**
  (100未満/以上、K/M/B の境界、負値、0)
- **(d)** 計算値が丸められていないこと: `weekdayStats` / `computeStats` の**出力が変わらない**
  (SH-11 の検収値 = 日曜行 `380M 363M 440M 430M 435M 419M` が
  `380.xxM 363.xxM ...` と**同じ数値の別表記**になるだけ)
- **(e)** `npm run test` 全緑 / `npm run build` 成功 / **`server/` の差分ゼロ**
- **(f)** SH-7〜SH-11 の性質維持

## 5. 停止条件

1. **(a) を満たすのに `src/taskManager/` のテーマ CSS を変更する必要がある**
2. 意味色が4テーマのいずれかでテーマ色と衝突して見分けられない
3. §1 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 6. コミット

- **ローカルコミット**(2本: ① 意味色 ② 表記)。**単独 revert 可**。
- **`git push` は行わない**。**`git add -A` 禁止**。

## 7. 完了報告テンプレ

```
## SH-12 完了報告
- コミット: <hash>(各1行要約)
- (a) ★4テーマでの上昇色/下降色/--theme-focus の実測値(計算済みスタイル)
- (b) 期間平均との差・ヒートマップの一貫性
- (c) 表記の境界値テスト
- (d) 計算値が不変であることの確認
- (e) npm test / build / server 差分ゼロ
- (f) SH-7〜SH-11 の性質維持
- ★起動手順(SF_HISTORY_ALLOWED_ORIGINS 込み)
```
