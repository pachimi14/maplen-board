# Claude Code 移行プロンプト（lulumi-tools / maplen-board）

以下をそのまま Claude Code の最初のメッセージとして貼り付けてください。

---

このリポジトリ(maplen-board)は https://lulumi-tools.com/ として公開している MapleStory N 向け経験値ランキングサイトです。戦略レビューと実装計画は策定済みで、これから設計地図に沿って実装を進めます。あなたの役割は、リポジトリ直下の3つの設計書に従って、指示されたタスクを1つずつ実装することです。

## まず読むファイル(この順で)

1. `lulumi-tools_master_roadmap.md` — 最終設計地図。タスクキュー(T0〜)・依存関係・分解方針のすべてがここにある
2. `lulumi-tools_improvement_plan.md` — 各施策の背景と優先度
3. `lulumi-tools_review_2026-07-06.md` — 現状分析・競合比較・領域別レビュー(参照用)
4. `README.md` / `exp_ranking/DEPLOY.md` / `exp_ranking/bot/README.md` — 既存の構成・運用

## プロジェクト構成(要点)

- `exp_ranking/bot/` — Python。公式ランキングAPI(Lv225+、約7,100体)を毎日取得 → SQLite(90日保持) → `rankings.json` + v2シャード形式をエクスポート。GitHub Actions(`.github/workflows/maplen-board-pages.yml`)で毎日 JST 9:20 以降に自動実行
- `exp_ranking/web/` — React 19 + Vite + Tailwind 4 + recharts の SPA。現在ルーターなし、`src/App.jsx`(963行)がモノリス
- デプロイ: GitHub Pages(静的のみ)。カスタムドメイン lulumi-tools.com
- i18n: 6言語(ja/en/es/th/vi/zh-TW)、`src/i18n/locales/`

## 確定済みの意思決定

- 取得対象は Lv225+ のまま拡大しない
- バックエンドサーバーは持たない(静的サイト+CI で完結)
- bot の取得ロジック(`main.py` の fetch/リトライ/スキップ判定)は変更禁止。bot 側で触ってよいのは原則 `mvp_export.py`(エクスポート項目の追加)のみ
- 戦略の軸: ①主語を「あなた」に変えるリテンション(マイキャラホーム) ②キャラ個別URL+OG による SEO/共有
- 旧v1フォーマット(`data/rankings.json`、62MB)は廃止方向。新機能から参照しない

## 実装規約(全タスク共通)

- 1タスク=1PR=1関心事。リファクタと機能追加を混ぜない
- キャラの正準IDは `historyKey`(assetKey ベース)。URLやピン留めのキーに name を使わない
- UI文言を追加したら、6ロケール全部(`src/i18n/locales/*.json`)に同時にキーを追加する
- 新規 npm 依存の追加は事前に私へ確認
- 受け入れ条件: `npm run build` 成功。bot に触れた場合は `exp_ranking/bot/` で pytest 通過。ローカル確認は `run_local_dev.bat`(または `exp_ranking/web` で `npm run dev`)
- localStorage キーは既存の命名(`maplen-board-*`)に合わせる

## 最初のタスク: T0 — App.jsx 分割+ルーター導入(純リファクタ)

目的: 963行の `src/App.jsx` をページ/コンポーネント単位に分割し、hashルーティングを導入する。**ユーザーから見える挙動の変更はゼロ**。

- ルート設計(最低限): `#/`(ランキング一覧) `#/character/:historyKey`(詳細) を用意。既存の「詳細の展開表示」は `#/character/...` への遷移に置き換えてよいが、見た目は現状維持
- 分割方針: ランキング一覧・キャラ詳細・グループパネル・フィルタ群をそれぞれ独立ファイルへ。共有状態(選択キャラ、フィルタ)の持ち方は提案してから実装
- 未使用の `JobGainRankings.jsx` は削除しない(T4bで回収予定)
- 完了条件: ビルド成功、全機能が従前どおり動作、以降のタスクが App.jsx の競合なしで並行できる状態

T0 完了後は、設計地図のタスクキュー(T1: mvp_export 拡張 → T5: SEO基礎パック → T2: URLステート → …)の順で私が個別に指示します。

まず T0 について、分割案(ファイル構成と状態管理の方針)を提示してください。実装はその承認後に始めてください。

---

## 補足(貼り付け不要・自分用メモ)

- 設計書3点は Cowork(Claude デスクトップ)での調査セッション(2026-07-06)の成果物。競合 MapleBoss の実地調査・本番サイト検証・リポジトリ全読の裏付けあり
- 時限課題: `.git` が1.6GB(db.gz の毎日コミットが原因)。T12(保存先移行+履歴掃除)を3ヶ月以内に。履歴書き換えは force push を伴うため、実施タイミングは自分で判断すること
- 62MB旧JSONの配信除去(クイックウィン)は T0 と独立にいつでも指示可能
