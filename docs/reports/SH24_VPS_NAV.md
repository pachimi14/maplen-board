# SH-24 完了報告 -- VPS 版でナビの他リンクを本体へ向ける(ビルド時フラグ)

計画: `docs/IMPL_PLAN_SH24.md`。前提: SH-23 完了・統括検収済(`3f1d9d1`)。
ユーザー裁定 2026-08-05(選択肢 A)。ブランチ: `feat/sf-cost-history`
(worktree `msu-ranking-sfhist`)。

## 変更内容

`exp_ranking/web/src/components/BoardHeader.jsx` に純関数 `resolveSiteNavHref(hashPath, siteBaseUrl)`
を追加し、`SiteHeader` のブランドリンク(`#/`)/ `EXP Ranking`(`#/`)/ `Task Manager`(`#/dashboard`)の
3つの `href` をこの関数経由にした。**`SF履歴`(`#/starforce`)はこの関数を通さず、`href="#/starforce"` の
リテラルのまま**(コード上、この1件だけ元のまま手を触れていない)。

```js
const SITE_BASE_URL = import.meta.env.VITE_SITE_BASE_URL || "";

export function resolveSiteNavHref(hashPath, siteBaseUrl = SITE_BASE_URL) {
  if (!siteBaseUrl) {
    return hashPath;
  }
  const normalizedBase = String(siteBaseUrl).replace(/\/+$/, "");
  return `${normalizedBase}/${hashPath}`;
}
```

## (a) ★未設定時の href が現状と完全一致

テスト `exp_ranking/web/src/components/SiteHeader.test.js`(`describe("resolveSiteNavHref")`):

- `"(a) returns the hash path unchanged when siteBaseUrl is unset (default build)"`
  -- `resolveSiteNavHref("#/", "")` === `"#/"`、`resolveSiteNavHref("#/dashboard", "")` === `"#/dashboard"`
- `"(a) returns the hash path unchanged when siteBaseUrl is omitted entirely"`
  -- 引数省略時(=実際の `import.meta.env.VITE_SITE_BASE_URL` 未設定時のデフォルト経路)が
  上記と同じ結果になることを確認

実測(build 成果物レベルでも確認): `VITE_SITE_BASE_URL` を設定せずに `npm run build` した
`dist/assets/*.js` を grep すると、コンパイル後の関数定義は
`function Uy(e,t=oU){return t?...:e}`(`oU` = `SITE_BASE_URL` の圧縮後の名前)であり、
`oU` は空文字のため実行時は常に第1引数 `e`(=元の hash 文字列)をそのまま返す。
`href` 属性の呼び出し箇所は `href:Uy("#/")` / `href:Uy("#/dashboard")` で、渡している
文字列リテラル自体は変更前と一字一句同じ。

## (b) 設定時の href / SF履歴 が同一オリジンのまま

同テストの `"(b) builds an absolute URL when siteBaseUrl is set"`:

- `resolveSiteNavHref("#/", "https://lulumi-tools.com")` === `"https://lulumi-tools.com/#/"`
- `resolveSiteNavHref("#/dashboard", "https://lulumi-tools.com")` === `"https://lulumi-tools.com/#/dashboard"`

build 成果物レベルでも実測(`VITE_SITE_BASE_URL=https://lulumi-tools.com npm run build`):

```
$ grep -o '.\{20\}#/starforce.\{5\}' dist/assets/*.js
}),f.jsx("a",{href:"#/starforce","ar

$ grep -o 'function Uy([^}]*}' dist/assets/*.js
function Uy(e,t=oU){return t?`${String(t).replace(/\/+$/,"")}
```

`SF履歴` の `href` は設定時ビルドでも文字列リテラル `"#/starforce"` のまま(`resolveSiteNavHref`
を通っていないので env 変数の値に関わらず不変)。ブランド / EXP Ranking / Task Manager は
`Uy(...)`(=`resolveSiteNavHref`)経由で、`oU`(=`SITE_BASE_URL`)が
`"https://lulumi-tools.com"` のため実行時は絶対 URL になる。

## (c) 末尾スラッシュ等の境界テスト

同テストの `"(c) trailing slash on siteBaseUrl yields the same result as no trailing slash"` /
`"(c) collapses multiple trailing slashes on siteBaseUrl the same way"`:

- `"https://lulumi-tools.com"` と `"https://lulumi-tools.com/"` の両方で
  `resolveSiteNavHref("#/", ...)` === `"https://lulumi-tools.com/#/"`(同一)
- `"https://lulumi-tools.com///"`(連続スラッシュ)も同じ `"https://lulumi-tools.com/#/"` に正規化

## (d) aria-current の扱い

`SiteHeader` の `aria-current={active === "ranking" ? "page" : undefined}` 等の行は
**この変更で1文字も触っていない**(`git diff -w` で確認可能。変わったのは `href` 属性の
値だけで、同じ `<a>` タグの `aria-current` 式は元のまま)。`aria-current` は `href` の値でなく
`active` prop でのみ決まるロジックのため、絶対 URL 化しても壊れない。`SF履歴` の
`aria-current={active === "sfhistory" ? "page" : undefined}` 行も1バイトも変えていない
(VPS 版で `active="sfhistory"` の状態なら引き続き `aria-current="page"` が付く)。

## (e) npm run test(既存テスト無改変)

```
$ npm run test -- --run
 Test Files  43 passed (43)
      Tests  447 passed (447)
```

`useHashRoute.test.js` を含め既存の全テストファイルは無改変(`git diff -w` / `git status --porcelain`
で確認済み)で緑。新規は `src/components/SiteHeader.test.js`(1ファイル・5テスト)のみ。

## (f) npm run build / 未設定ビルドに絶対URLが無いことの grep

**未設定ビルド**:

```
$ rm -rf dist && npm run build
✓ built in 5.83s

$ grep -o "lulumi-tools.com" dist/assets/*.js dist/index.html | wc -l
10
```

この `10` 件はすべて本変更と無関係な**既存**の絶対 URL(`api.lulumi-tools.com` を使う
`shareImageProxy.js` / `sfHistorySource.js` / `liveExpSource.js` / `notificationSource.js` の
API ベース URL 定数、`shareImageUtils.js` の origin フォールバック、`DashboardPage.jsx` の
キャラクター共有リンク)で、`SiteHeader` のナビリンクに由来する箇所はゼロ
(`grep -o '.\{40\}lulumi-tools\.com/#/.\{5\}' dist/assets/*.js` の唯一のヒットは
`.../#/character/...` = 既存の `DashboardPage` 共有リンクであり、ナビの `#/` / `#/dashboard`
パターンではない)。

**このリポジトリの SH-24 変更を `git stash` で一時退避してビルドした baseline** でも
同じ `grep -o "lulumi-tools.com" ... | wc -l` = **10**(完全一致)。∴ 未設定ビルドの成果物は
SH-24 適用前後で `lulumi-tools.com` の出現数が1件も増減していない。

**設定ビルド**(`VITE_SITE_BASE_URL=https://lulumi-tools.com npm run build`)では
`href:Uy("#/")` × 2 / `href:Uy("#/dashboard")` × 1 が絶対 URL に解決される一方、
`href:"#/starforce"` は変わらないことを確認(上記 (b))。

`dist/` は `.gitignore` 対象(`exp_ranking/web/dist/`)のため両ビルドとも作業ツリーを
汚さない(検証後 `rm -rf dist` 済み)。

## (g) SH-7〜SH-23 の性質維持

触ったのは `exp_ranking/web/src/components/BoardHeader.jsx`(既存関数に純関数を追加・
3箇所の `href` を関数呼び出しに置換のみ)と新規テストファイルのみ。
`useHashRoute.js` / `App.jsx` / `useRankingBoard.js` / `src/board/` / `src/pages/` /
`src/taskManager/` / `src/sfhistory/` / `server/` / `src/i18n/` / `package.json` は
**無改変**(`git status --porcelain` で確認)。i18n の文言追加なし(既存キー
`app.openDailyDashboard` / `app.openSfHistory` をそのまま使用)。新規依存追加なし
(既存の vitest のみで完結)。

## コミット

1. `<pending>` -- `feat(sh24): resolve VPS-only build nav links to absolute site URL via VITE_SITE_BASE_URL`
   (`exp_ranking/web/src/components/BoardHeader.jsx` / `exp_ranking/web/src/components/SiteHeader.test.js`(新規) /
   `docs/reports/SH24_VPS_NAV.md`(新規))

`git push` は未実施。`git add -A` は使用していない(対象ファイルを個別 `git add`)。

## ★VPS 用ビルドのコマンド(統括が実行する)

```bash
cd exp_ranking/web
VITE_SITE_BASE_URL=https://lulumi-tools.com npm run build
```

(既存の Pages 向けビルド `npm run build`(env 変数なし)は無変更のまま。VPS デプロイ手順の
どこで `VITE_SITE_BASE_URL` を渡すか、および `sf.lulumi-tools.com` へのデプロイ経路の配線は
本計画のスコープ外 -- 統括の判断に委ねる。)
