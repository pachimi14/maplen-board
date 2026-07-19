# IMPL_PLAN_T5 — SEO 基礎パック(サイト全体・ルート単一URL向け)

> 承認者: ユーザー(設計承認 2026-07-14)/ 実装: implementer
> 境界: **T5=ルート単一URLのSEO基礎 / T6=キャラ個別の実URL+静的HTML+キャラ別OG**(hash ルーティングのままでは索引される実URLはルートのみ)

## 0. 目的と背景

- 北極星への寄与(②SEO/共有): 海外検索・Discord・X からの流入を目的に、ルート `https://lulumi-tools.com/` の**静的HTMLで主要なSEOを担保**する(メタ/OG/Twitter Card/favicon/robots/sitemap)。実行時メタ更新は補助。
- 参照決定: DECISION_LOG(LULU-006 v1廃止と無関係)/ roadmap T5 / 本計画の追加条件はユーザー指定(2026-07-14)
- **基準言語=英語**(静的HTMLの title/description/OG は英語。OGスクレイパは JS 非実行のため静的1言語)

## 1. スコープ

### 触るファイル
- 編集: `exp_ranking/web/index.html`(head 拡充・`lang="en"`・no-JS フォールバック文言を英語化)
- 編集: `exp_ranking/web/src/i18n/I18nContext.jsx`(既存の言語 effect に document.title / description 更新を追加)
- 編集: `exp_ranking/web/src/i18n/locales/{ja,en,es,th,vi,zh-TW}.json`(runtime 用 `app.metaTitle` / `app.metaDescription` を6言語追加)
- 追加(static, `public/`): `robots.txt` / `sitemap.xml` / `favicon.svg` / `favicon.ico` / `apple-touch-icon.png` / `og.png`
- 追加(dev ツール, dist に含めない): `scripts/generate-seo-assets.py`(Pillow で og.png/ico/apple-touch を生成。再生成の再現性のため commit)

### 触ってはいけないもの
- `.github/workflows/**` / bot 一式 / 朝のデータ更新処理 = **変更しない**(静的アセット追加と web 編集のみで完結)
- vite.config(base=`/` のまま)/ CNAME(`lulumi-tools.com`)/ gtag
- 既存の `app.pageTitle` / `app.pageDescription`(アプリ内ヒーロー文言。SEO メタとは別キーにする)
- **新規 npm 依存を追加しない**(画像は Python/Pillow=ビルド外ツールで生成)

## 2. 実装内容(具体)

### 2.1 index.html(head)
静的・英語基準で以下を持たせる:
- `<html lang="en">`(現状 ja → en)
- `<title>Lulumi Tools | MapleStory N EXP Ranking</title>`
- `<meta name="description" content="Track daily, weekly, and monthly EXP rankings for MapleStory N characters, with detailed progress history and comparison tools.">`
- `<link rel="canonical" href="https://lulumi-tools.com/">`(現状維持)
- `<meta name="robots" content="index, follow">`
- `<meta name="theme-color" content="#0f172a">`(UI の slate-950 に合わせる)
- OG: `og:type=website` / `og:site_name=Lulumi Tools` / `og:title`(=title) / `og:description`(=description) / `og:url=https://lulumi-tools.com/` / `og:image=https://lulumi-tools.com/og.png`(絶対URL) / `og:image:width=1200` / `og:image:height=630` / `og:locale=en_US`
  - **`og:locale:alternate` は付けない**(言語別実URLが無く実益なし=ユーザー指定)
- Twitter: `twitter:card=summary_large_image` / `twitter:title` / `twitter:description` / `twitter:image=https://lulumi-tools.com/og.png`
- favicon 群:
  - `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`
  - `<link rel="icon" href="/favicon.ico" sizes="32x32">`
  - `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`
- **hreflang は付けない**(言語別実URL無しのため=ユーザー指定)
- no-JS フォールバック(`#root` 内の `<main>`)の文言を英語化(静的基準言語に合わせる)

### 2.2 実行時メタ更新(補助・主目的はタブ/description/lang の整合)
`I18nContext.jsx` の既存 effect(現在 `document.documentElement.lang = language` のみ)を拡張し、言語切替時に:
- `document.title = t("app.metaTitle")`
- `meta[name="description"]` の content を `t("app.metaDescription")` に更新
- `document.documentElement.lang = language`(現状維持)

**OG/Twitter は runtime 更新しない**(スクレイパは JS 非実行=無意味)。SEO の主担保は静的HTML(ユーザー指定)。

### 2.3 i18n キー(6言語)
`app.metaTitle` / `app.metaDescription` を6ロケールに追加。
- `en`: 上記の英語 title / description をそのまま
- 他5言語: 各言語で検索意図に沿った忠実訳(ゲーム名 "MapleStory N" は原則そのまま)

### 2.4 静的アセット
- `robots.txt`:
  ```
  User-agent: *
  Allow: /
  Sitemap: https://lulumi-tools.com/sitemap.xml
  ```
- `sitemap.xml`: **ルートURL 1件のみ**、`<loc>https://lulumi-tools.com/</loc>`。**不正確な `lastmod` は付けない**(ユーザー指定)。キャラURL列挙は T6。
- `favicon.svg`: 手書きの簡易ブランドマーク(**これを正**とする)。**公式ゲーム素材・Nexon ロゴを使わない**(ユーザー指定)。汎用の図形+文字のみ
- `favicon.ico` / `apple-touch-icon.png`(180×180): favicon.svg のデザインから派生生成。SVG ラスタライザ(cairosvg/resvg/rsvg 等)が追加依存なしで使えればそれで、無ければ **Pillow で同等の簡易デザインを直接描画**(簡易プレースホルダのため許容)
- `og.png`: **1200×630 の簡易共通画像**を Pillow で生成(ブランド文字="Lulumi Tools" + "MapleStory N EXP Ranking" + サブ、ダーク背景、システムサンズ体使用)。**後から同名ファイルで差し替え可能**(ユーザー指定)。ゲーム公式素材は使わない

## 2.5 追加条件(承認時・2026-07-14)

- **決定的な生成**: `scripts/generate-seo-assets.py` は再実行しても**同一成果物**になる(固定フォント・固定サイズ/色・乱数やタイムスタンプを埋め込まない)
- **成果物は commit・本番ビルドで Pillow 不要**: 生成済み `og.png` / `favicon.ico` / `apple-touch-icon.png`(および `favicon.svg`)を**リポジトリに含める**。`npm run build`・Pages workflow は**これら静的ファイルをコピーするだけ**で、Pillow を実行しない
- **Pillow は開発用途限定**: 画像生成手段としてのみ使用。npm build / Pages workflow に依存を追加しない
- **runtime メタのフォールバック**: `t("app.metaTitle")`/`t("app.metaDescription")` がロケール欠落等で解決できない/空の場合は、**英語の title/description(静的基準値)へフォールバック**し、**画面を落とさない**(例外を投げない)
- **dist 混入防止**: 生成スクリプト・一時生成物が `dist` に入らないこと(script は `public/`・`src/` 外に置く。生成の中間ファイルを `public/` に残さない)
- **URL 基準**: favicon / OG画像 / robots / sitemap の URL はすべて独自ドメイン **`https://lulumi-tools.com/`** 基準(OG画像・sitemap は絶対URL)

## 3. 変わってよい・いけないもの

- 変わってよい: head のメタ群の追加、静的アセットの追加、`lang` の ja→en、no-JS フォールバック文言の英語化、言語切替時の title/description の動的更新
- 変わってはいけない: アプリ本体の挙動・レイアウト(ランキング/詳細/フィルタ)、既存 `app.pageTitle`/`pageDescription` の文言、canonical、workflow・bot・データ配信、vite base

## 4. 受け入れ条件

| # | 基準 | 目標 | 測定 |
|---|------|------|------|
| 1 | ビルド | 成功・新規npm依存なし | `cd exp_ranking/web && npm run build` |
| 2 | dist/index.html のメタ | og:(title/description/image/url/type/site_name/locale=en_US)・twitter:card=summary_large_image・twitter:image・canonical=root・favicon(svg/ico/apple-touch)・theme-color・robots=index,follow・`lang="en"`・英語 title/description がすべて存在 | dist/index.html を grep |
| 3 | 静的ファイル配信 | `dist/{robots.txt,sitemap.xml,og.png,favicon.svg,favicon.ico,apple-touch-icon.png}` が生成 | ls |
| 4 | og.png 寸法 | 1200×630 | `python -c "from PIL import Image;print(Image.open('dist/og.png').size)"` |
| 5 | sitemap | 妥当XML・ルート1件・lastmod無し | 目視/パース |
| 6 | robots | `Sitemap:` 行を含む | grep |
| 7 | 実行時メタ | 言語切替で document.title / meta description / html lang が該当言語に更新 | dev 実機(言語切替) |
| 8 | 非破壊 | workflow/bot 無変更・朝の更新に影響なし | 差分確認(該当ファイル不触) |
| 9 | 素材 | 公式ゲーム素材/Nexon ロゴ不使用 | 目視(生成は汎用図形+文字のみ) |

## 5. 停止条件(該当したら止めて選択肢+推奨付きで報告)

- SVG ラスタライズ/画像生成が追加 npm/py 依存なしに実現できない(→ 生成手段を相談)
- 実行時メタ更新が既存の i18n/表示挙動を壊す
- スコープ外(workflow/bot/vite base)の変更が必要になった

## 6. コミット分割(各コミット単独 revert 可)

1. 静的 SEO アセット追加(robots.txt / sitemap.xml / favicon.svg / favicon.ico / apple-touch-icon.png / og.png)+ 生成スクリプト
2. index.html head/lang/フォールバック英語化
3. 実行時メタ更新(I18nContext)+ i18n `app.metaTitle`/`app.metaDescription`(6言語)

各コミット後 `npm run build` 成功を確認。`git add -A` 禁止・個別 add・`git diff -w`。

## 7. 検証コマンド

```
cd exp_ranking/web && npm run build
grep -iE "og:|twitter:|canonical|apple-touch|favicon|theme-color|robots|lang=" dist/index.html
ls dist/robots.txt dist/sitemap.xml dist/og.png dist/favicon.svg dist/favicon.ico dist/apple-touch-icon.png
python -c "from PIL import Image;print(Image.open('dist/og.png').size)"
# 実行時メタ: run_local_dev.bat or npm run dev → 言語切替で title/description/lang を確認
git diff -w -- exp_ranking/web/index.html exp_ranking/web/src/i18n/
```

## 8. ロールバック

- 各コミット単独 revert 可。静的アセット/メタ追加のみで既存挙動に非依存のため、revert しても本体は無傷。

## 9. 完了報告テンプレ

- 実施コミット(ハッシュ・件名)
- 受け入れ基準の実測(ビルド、dist の各メタ/ファイル、og.png 寸法、実行時メタの言語別確認)
- 追加した i18n キー(6言語)
- 生成アセットの手段(Pillow/ラスタライザ)と、公式素材不使用の確認
- 残課題・watch-item

## 10. 作らないもの(T5 除外 → T6 以降)

- キャラ個別の実URL(`/character/:key`)・静的HTML・キャラ別OG → **T6**
- CI 生成の大規模 sitemap(キャラURL列挙)→ **T6**
- 言語別の実URL / hreflang link → T6 era(実URL化とセット)
- **hash→history ルーティング移行は現時点で確定事項にしない**(T6 でキャラ個別実URLを設計する中で判断)
- フルPWA(manifest+SW)→ 6ヶ月目
