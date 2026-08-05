# SH-21 完了報告 -- 下降(安くなった)の意味色を緑から青へ

計画: `docs/IMPL_PLAN_SH21.md`。前提: SH-20 完了・統括検収済(`df9d49d`)。
ユーザー指示 2026-08-05「チャート上で前回比 + なら赤になっているが、− なら青字にして」。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## (a) 採用した色(hex)と理由

`--sfh-color-cheaper` を `#10b981`(emerald-500)から **`#3b82f6`(blue-500)** に変更。
`--sfh-color-costlier`(`#fb7185` / rose-400、上昇=高くなった)は**変更なし**。

SH-12 の教訓(下降色がテーマの `--theme-focus` とビット同一になると、そのテーマでだけ
意味色とテーマ色の区別がつかなくなる)を踏まえ、下記 (b) を満たすことを確認した上で
計画書 §1 の推奨色 `#3b82f6` をそのまま採用した(裁量で別色にする必要はなかった)。

## (b) ★4テーマ × 上昇/下降/`--theme-focus` の値

`taskManager.css` の `--theme-focus` 定義(`.site-theme[data-theme="..."]`)と
`sfhistory.css` の `--sfh-color-*` は、いずれもテーマ切り替えで動的計算されない
リテラルなカスタムプロパティ値であり、`[data-theme]` セレクタでの単純な値差し替えのみが
起きる(JS による動的合成は無い)。ソース上のリテラル値を突き合わせて実測相当の比較を行った
(統括の実機ブラウザ検収で `getComputedStyle` による最終確認を想定)。

| テーマ | 上昇 `--sfh-color-costlier` | 下降 `--sfh-color-cheaper` | `--theme-focus` | 3値相異 |
|---|---|---|---|---|
| green(既定) | `#fb7185` = rgb(251,113,133) | `#3b82f6` = rgb(59,130,246) | `#34d399` = rgb(52,211,153) | 相異 |
| blue | `#fb7185` = rgb(251,113,133) | `#3b82f6` = rgb(59,130,246) | `#60a5fa` = rgb(96,165,250) | 相異 |
| purple | `#fb7185` = rgb(251,113,133) | `#3b82f6` = rgb(59,130,246) | `#a78bfa` = rgb(167,139,250) | 相異 |
| orange | `#fb7185` = rgb(251,113,133) | `#3b82f6` = rgb(59,130,246) | `#fb923c` = rgb(251,146,60) | 相異 |

`--theme-focus` の定義元: `exp_ranking/web/src/taskManager/taskManager.css:24-48`
(green は同ファイル既定値の `#34d399`、blue/purple/orange は各 `[data-theme="..."]` ブロック)。

ブルーテーマの `--theme-focus`(`#60a5fa` = rgb(96,165,250))と下降色
`#3b82f6`(rgb(59,130,246))は、どちらも「青」だが RGB 値としては別値であり、
G値(165 vs 130)・B値(250 vs 246)・R値(96 vs 59)いずれも異なる
(計画書 §1 の1点目の条件を満たす)。

## (c) 折れ線色との差

チャートの折れ線色は `SfHistoryChart.jsx` で `#22d3ee`(cyan-400)= rgb(34,211,238)。
下降色 `#3b82f6`(rgb(59,130,246))とは R/G/B いずれも異なり、明確に別色
(計画書 §1 の2点目の条件を満たす)。

## (d) ヒートマップへの追随

`sfhistory.css` の `.sfh-heatmap-cell-lowest`(最安セルの枠線)・
`.sfh-heatmap-cell-badge-low`(最安バッジ文字色)はいずれも `var(--sfh-color-cheaper)` を
参照している(`sfhistory.css:322-323`, `:339-340`)。変数の値のみを変えたため、
チャートの前回比・期間平均との差の色に加え、これらヒートマップの最安マーカーも
自動的に同じ青(`#3b82f6`)に追随した。**変数の複製・分岐は追加していない**
(コンポーネント側の変更は無し)。

## (e) npm test / build / server 差分ゼロ

```
npm run test    442 passed (42 files)
npm run build   成功(vite build, dist/ 生成、既存の chunk サイズ警告のみ・エラー無し)
git diff --stat -- server/     出力なし(差分ゼロ)
```

## (f) SH-7〜SH-20 の性質維持

`sfhistory.css` 以外の変更なし(`git status --porcelain` で確認)。
`SfHistoryChart.jsx` / `WeekdayHeatmap.jsx` はコメント含め**1行も変更していない**
(§2 の見立てどおり、変数を参照しているだけなのでコンポーネント側の変更は不要だった)。
破線1点・ラベル終了時刻・UTC・2桁表記・契約テストなど SH-7〜SH-20 の性質は無改訂。

## コミット

1. `<pending>` -- `style(sh21): change cheaper semantic color from emerald to blue`
   (`exp_ranking/web/src/sfhistory/sfhistory.css`(変数値のみ)/
   `docs/reports/SH21_CHEAPER_BLUE.md` 新規)

`git push` は未実施。`git add -A` は使用していない(対象2ファイルを個別 `git add`)。

---

# 統括検収(2026-08-05)— **合格**

ブラウザで4テーマを切り替えて `getComputedStyle` で実測:

| テーマ | 上昇(costlier) | 下降(cheaper) |
|---|---|---|
| green | `rgb(251,113,133)` | **`rgb(59,130,246)`** |
| blue | `rgb(251,113,133)` | **`rgb(59,130,246)`** |
| purple | `rgb(251,113,133)` | **`rgb(59,130,246)`** |
| orange | `rgb(251,113,133)` | **`rgb(59,130,246)`** |

**両色ともテーマに依存せず一定。**

衝突の確認:
```
下降色 #3b82f6 = rgb(59,130,246)
  vs --theme-focus: #34d399 / #60a5fa / #a78bfa / #fb923c  → 全て異なる
  vs 折れ線 #22d3ee (cyan-400)                            → 異なる
```

**ブルーテーマの `#60a5fa`(rgb 96,165,250)との衝突を避けている**のが本スライスの要点。
SH-12 でグリーンテーマの `#34d399` を避けた判断と同じ配慮が、青でも正しく効いている。

`SfHistoryChart.jsx` / `WeekdayHeatmap.jsx` は**1行も変更なし**。
SH-12 で `--sfh-color-cheaper` / `--sfh-color-costlier` に一本化した成果がそのまま効き、
**変数の値1つでチャートのツールチップとヒートマップの最安マーカーが揃って追随**した。
