# IMPL_PLAN_SH10 — テーマ初回上書きの恒久修正 + 注記の配置

前提: SH-9 完了・統括検収済(`f286ee2`)。**ユーザー裁定 2026-08-05**:

| # | 裁定 |
|---|---|
| 1 | `App.jsx` のテーマ上書き修正 → **「ランキングのデータに影響がなければ許可」** |
| 2 | チャートの折れ線色 → **テーマ非追従(cyan 固定)のままでよい**。**本スライスでは触らない** |
| 3 | グループ共通の注記の配置 → **修正する** |

## 1. ① テーマ上書きの恒久修正

### 1-1 原因(統括が特定済み)

`src/App.jsx:45-54`:
```js
const isTaskManagerRoute = route.name === "dashboard" || route.name === "tasks" || route.name === "schedule";
const activeTheme = isTaskManagerRoute ? { dashboardStore の値 } : rankingTheme;
useEffect(() => {
  document.documentElement.dataset.themeColor = activeTheme.themeColor;
  document.documentElement.dataset.themeDepth = activeTheme.themeDepth;
}, [...]);
```
**`#/starforce` は `isTaskManagerRoute` に含まれないので `else` 側に落ち、
ランキング側のテーマが html に書き込まれる。** SF History 画面自身の適用と競合する。

### 1-2 直し方

**`route.name === "starforce"` を、テーマの出どころとして dashboardStore 側に寄せる**
(SF History のピッカーは SH-9 で `useDashboardStore` を使っている=**両者を一致させる**)。

- **`document.documentElement.dataset.themeColor/Depth` の書き込み主体を1箇所に保つ**。
  App.jsx と SfHistoryRoot の**両方が書く状態にしない**(正が2箇所に住まない)
- 変更は**この分岐の追加のみ**。`rankingTheme` の初期値・保存(`RANKING_THEME_STORAGE_KEY`)・
  `siteHeaderVariant` の算出は**変えない**

### 1-3 ★ユーザー条件 =「ランキングのデータに影響がない」

**触ってよいのは表示テーマの経路だけ。** 以下に一切手を入れないこと:

- `useBoard` / `useRankingBoard` / `BoardContext` / ランキングデータの取得・整形・描画
- `rankings.json` / v2シャード の読み込み経路
- `src/board/` `src/pages/` `src/components/`(SH-9 で触った `BoardHeader.jsx` も**本スライスでは触らない**)
- `exp_ranking/bot/` / `server/` 配下すべて

## 2. ③ 注記の配置

`.sfh-group-shared-note`(「強化費用はこのグループ共通です(代表: ○○)。」)が
**プリセット行より後ろ**に描画されている。**装備セレクタの直下**に移す。

- 文言・i18n キー・表示条件(alias 選択時のみ)は**変えない**。**位置だけ**
- 代表そのものを選んだときに出ない挙動も**不変**

## 3. スコープ

**変更してよい**: `src/App.jsx`(§1-2 の分岐のみ)/ `src/sfhistory/SfHistoryRoot.jsx` /
`src/sfhistory/components/EquipmentSelector.jsx` / `src/sfhistory/sfhistory.css` / 各 `*.test.js` /
`docs/reports/SH10_THEME_AND_NOTE.md`

**触らないもの**(1つでも触れたら停止): §1-3 の列挙すべて / `src/taskManager/` /
`src/i18n/`(**文言追加なし**)/ `src/sfhistory/starforce.js` / `domain/series.js` の統計・系列生成 /
`package.json` / **VPS** / **元ツリー**

## 4. 受け入れ基準

- **(a) ★ランキングに影響なし**: `#/` を開いて、ヘッダ・本文・既存の描画が従来どおり。
  **`useHashRoute.test.js` を含む既存テストが無改変で全緑**。
  `git diff -w` で `src/board/` `src/pages/` `src/components/` `exp_ranking/bot/` `server/` に**差分ゼロ**
- **(b) テーマの単一所有**: `document.documentElement.dataset.themeColor/Depth` に書き込む箇所が
  **コード全体で1箇所**であることを grep で示す
- **(c) 初回遷移で上書きされない**: **リロード直後に `#/starforce` を最初に開いても**、
  SF History で選んだテーマが保たれる(SH-9 の既知の限界が解消)。
  **手順と実測値(`data-theme-color` / `data-theme-depth` / `--theme-focus`)を報告**
- **(d) 往復で壊れない**: `#/starforce` → `#/` → `#/dashboard` → `#/starforce` と巡回して、
  **各ルートのテーマが従来どおり**(ランキングはランキングの、TM は TM の設定)
- **(e) 注記の位置**: `.sfh-group-shared-note` が**装備セレクタの直下**(プリセットより前)。
  DOM 順で機械確認して報告
- **(f)** `npm run test` 全緑 / `npm run build` 成功
- **(g)** SH-7〜SH-9 の性質維持: 暫定点1つ・統計に暫定点なし・`asOf` 表示・maxStar ガード・
  alias 検索・ナビ3リンク

## 5. 停止条件

1. **ランキングのデータ経路に触れないと直せない**(= ユーザー条件を満たせない)
2. `dataset` の書き込みを1箇所にできない
3. §3 の「触らないもの」に触る必要が生じた / 新規依存が必要になった
4. `src/taskManager/` の仕組みを**変更**しないと入らない

## 6. コミット

- **ローカルコミット**(2本推奨: ① テーマ ③ 注記)。**単独 revert 可**に。
- **`git push` は行わない**。**`git add -A` 禁止**。

## 7. 完了報告テンプレ

```
## SH-10 完了報告
- コミット: <hash>(各1行要約)
- (a) ランキング無影響の確認(差分ゼロの範囲 / 既存テスト)
- (b) dataset 書き込み箇所が1つであることの grep 結果
- (c) 初回遷移テストの手順と実測値
- (d) 巡回テストの結果(各ルートのテーマ)
- (e) 注記の DOM 位置
- (f) npm test / build
- (g) SH-7〜SH-9 の性質維持
- ★起動手順(SF_HISTORY_ALLOWED_ORIGINS 込み)
```
