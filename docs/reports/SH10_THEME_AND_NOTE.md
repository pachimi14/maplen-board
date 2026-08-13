
---

# 統括検収(2026-08-05)— **合格**

ブラウザ実機で統括が測定。

## (c) 初回遷移の上書き解消(本スライスの核)

`localStorage` に **ranking = blue/standard**、**dashboard = orange/light** を仕込み、
`#/starforce` へ**フルリロード**:

```
結果: data-theme-color=orange / data-theme-depth=light / --theme-focus=#fb923c
```

**ランキング側(blue/standard)に上書きされていない** = SH-9 の既知の限界が解消。

## (d) 巡回

| ルート | 実測 |
|---|---|
| `#/starforce` | orange / light / `#fb923c` |
| `#/` | **blue / standard / `#60a5fa`**(ランキング側) |
| `#/dashboard` | orange / light / `#fb923c` |
| `#/starforce`(再) | orange / light / `#fb923c` |

**各ルートが自分のテーマを保つ**。混線なし。

## (e) 注記の位置

alias `Chaos Pierre Hat`(代表 Chaos Von Bon Helmet)を選択して確認:

- DOM: `.sfh-group-shared-note` は `.sfh-select-group` の**直後の兄弟**(同一親内 index=1)
- テキスト順: 装備(154)→ **注記(165)** → プリセット(325) = **プリセットより前**
- 文言・表示条件は不変

## (a)(b)(f)(g)

- ランキング領域(`src/board/` `src/pages/` `src/components/` `bot/` `server/`)の差分 **ゼロ**
- `documentElement.dataset` への代入は **`App.jsx` の2行のみ**(単一所有)
- `npm run test` 384 passed / `npm run build` 成功
- SH-7〜SH-9 の性質は無改変(該当ロジックに差分なし)

**ユーザー条件「ランキングのデータに影響がなければ許可」は満たされている。**
