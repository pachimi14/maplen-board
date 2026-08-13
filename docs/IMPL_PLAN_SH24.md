# IMPL_PLAN_SH24 — VPS 版でナビの他リンクを本体へ向ける(ビルド時フラグ)

前提: SH-23 完了・統括検収済(`3f1d9d1`)。**ユーザー裁定 2026-08-05**(選択肢 A)。

## 0. 背景

`sf.lulumi-tools.com`(VPS・身内向け)で SF 履歴を配信する。
しかしナビの **EXP Ranking / Task Manager** は同一オリジンの `#/` / `#/dashboard` を指しており、
ランキングデータは**相対パス**で取っている:

```js
// useRankingBoard.js:315
const candidates = ["data/v2/rankings.json"];
```

∴ VPS 版でこれらを押すと `sf.lulumi-tools.com/data/v2/rankings.json` を見に行き、
**404 でエラー画面**になる。

**「リンクを張らないだけで公開品質基準は適用する」**と決めた以上、
**押したら壊れるリンクを残さない**。

**ユーザー裁定 = (A)**: **VPS 版のナビの他リンクを、本体への絶対 URL にする。**

## 1. 変更内容

**ビルド時の環境変数**で切り替える(既存の `VITE_*` の流儀に合わせる):

```
VITE_SITE_BASE_URL   未設定(既定) → 現状のまま同一オリジン(`#/`, `#/dashboard`)
                     設定時        → その値を前置した絶対 URL
                                     例: https://lulumi-tools.com/#/ , .../#/dashboard
```

**対象**: `SiteHeader` の
- ブランド `LULUMI TOOLS`(`#/`)
- `EXP Ranking`(`#/`)
- `Task Manager`(`#/dashboard`)

**対象外**: **`SF履歴`(`#/starforce`)は必ず同一オリジンのまま**。
これが VPS 版で動く唯一の画面である。

## 2. ★既定の挙動を1ミリも変えない(最重要)

**`VITE_SITE_BASE_URL` を設定しないビルド = 現在の lulumi-tools.com 向けビルド**であり、
**href が1文字も変わってはいけない**。

- 本番(Pages)は将来 push したときにこの経路を通る。**そこで壊すと本体が壊れる**
- (a) で**未設定時の href が現状と完全一致**することをテストで固定する

## 3. スコープ

**変更してよい**:
- `exp_ranking/web/src/components/BoardHeader.jsx`(`SiteHeader`)
- `exp_ranking/web/src/components/*.test.js`(新規テスト。**新規依存を足さない**)
- `exp_ranking/web/.env.example` 相当があれば追記(無ければ作らない)
- `docs/reports/SH24_VPS_NAV.md`

**触らないもの**(1つでも触れたら停止):
- `useHashRoute.js` / `App.jsx` / `useRankingBoard.js` / `src/board/` / `src/pages/` / `src/taskManager/`
- `src/sfhistory/` 配下すべて
- `server/` 配下すべて / **4h テーブル**
- `src/i18n/`(**文言追加なし**。ラベルは既存のまま)
- `package.json` / **VPS** / **元ツリー**

## 4. 受け入れ基準

- **(a) ★既定不変**: `VITE_SITE_BASE_URL` 未設定時、3つのリンクの `href` が
  **現状と完全一致**(`#/` / `#/` / `#/dashboard`)。**テストで固定**
- **(b)** 設定時、3つが**絶対 URL** になる。`SF履歴` は **`#/starforce` のまま**
- **(c)** 末尾スラッシュの有無・`#` の重複など、**URL 結合の境界をテストで固定**
  (`https://lulumi-tools.com` / `https://lulumi-tools.com/` の両方を与えて同じ結果)
- **(d) `active` の扱い**: 絶対 URL 時も `aria-current` の付き方が壊れない
  (VPS 版では SF履歴 に付く)
- **(e)** `npm run test` 全緑(**`useHashRoute.test.js` を含む既存テストが無改変で緑**)
- **(f)** `npm run build` 成功。**未設定ビルドの成果物に `lulumi-tools.com` の絶対 URL が現れない**
  ことを `grep` で確認(= 既定を汚していない)
- **(g)** SH-7〜SH-23 の性質維持

## 5. 停止条件

1. **(a) が満たせない**(未設定時に href が変わる)
2. `SiteHeader` 以外に手を入れないと実現できない
3. §3 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 6. コミット

- **ローカルコミット1本**。**`git push` は行わない**。**`git add -A` 禁止**。

## 7. 完了報告テンプレ

```
## SH-24 完了報告
- コミット: <hash>
- (a) ★未設定時の href が現状と完全一致(テスト名と実測)
- (b) 設定時の href / SF履歴 が同一オリジンのまま
- (c) 末尾スラッシュ等の境界テスト
- (d) aria-current の挙動
- (e) npm run test(既存テスト無改変)
- (f) npm run build / 未設定ビルドに絶対URLが無いことの grep
- (g) SH-7〜SH-23 の性質維持
- ★VPS 用ビルドのコマンド(統括が実行する)
```
