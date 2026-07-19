# IMPL_PLAN_T0 — App.jsx 分割 + hashルーター導入(純リファクタ・挙動変更ゼロ)

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー(承認済み 2026-07-14) / 実装: implementer
> **最優先原則: T0 は「挙動変更ゼロの構造整理」。迷ったら現状の挙動を正とする。**

## 0. 目的と背景

- 北極星への寄与: 963行モノリス `App.jsx` を分割し hashルーティングを導入することで、以降の全機能タスク(URLステート/マイキャラ/個別ページ)が App.jsx の競合なしで並行実装可能になる。**この時点でユーザーから見える挙動は変えない**。
- 参照する決定: DECISION_LOG **LULU-005**(正準ID=historyKey)/ **LULU-011**(T0確定仕様)/ PR-001・PR-007・PR-008
- 参照設計書: `lulumi-tools_master_roadmap.md` T0

## 1. スコープ

### 触るファイル(新規)
- `src/board/useRankingBoard.js` — 状態の単一の正(取得・フィルタ・選択・派生を集約)
- `src/board/BoardContext.jsx` — useRankingBoard の戻り値を配布する Provider + useBoard フック
- `src/board/useHashRoute.js` — hashルーティング(`#/` ・ `#/character/:historyKey`)
- `src/pages/RankingListView.jsx` — `#/`。**画面合成のみ**(ロジック禁止)
- `src/pages/CharacterDetailView.jsx` — `#/character/:historyKey`。詳細展開
- `src/components/BoardHeader.jsx` — ヘッダー(見出し+更新ラベル+言語切替)
- `src/components/HighlightsSection.jsx` — TOP3 開閉セクション
- `src/components/RankingControls.jsx` — ソート+フィルタ群(**portal 込み・現構造維持**)
- `src/components/RankingTable.jsx` — テーブル本体

### 触るファイル(改変)
- `src/App.jsx` — スリム化。`<BoardProvider>` + ルート分岐 + `<BoardHeader>` のみに(~80行)

### 触ってはいけないファイル
- `src/CharacterDetail.jsx` / `GroupPanel.jsx` / `TopGainHighlights.jsx` / `FavoriteStar.jsx` / `LanguageSwitcher.jsx` / `NavigatorLink.jsx` — 流用のみ、中身変更禁止
- `src/rankingUtils.js` / `historyData.js` / `jobCategories.js` / `useFavorites.js` / `useGroups.js` — ロジックの正。移設先から呼ぶだけ、中身変更禁止
- `src/JobGainRankings.jsx` — **削除禁止**(T4b で回収)
- `main.jsx` / `index.html` / i18n locales / bot / CI — 対象外
- 旧v1フォーマット `data/rankings.json` を新たに参照しない(既存の fallback candidates 配列はそのまま維持)

## 2. 変わってよいもの・いけないもの

### 変わってよい(唯一許容する挙動差)
- **詳細展開が URL 遷移になる**: `onExpand` → `#/character/:historyKey` へ navigate、`onCollapse` → `#/` へ navigate。これに伴い**詳細URLの直接オープン/リロードでその詳細が復元される(ディープリンク)**。これは routing 導入の目的そのもの(LULU-011)。見た目は現状の expanded 表示と完全一致させる。

### 変わってはいけない
- 上記1点を除く**全挙動**: コンパクト表示のレイアウト、TOP3/フィルタの開閉、ソート、フィルタ計算結果、ページング、お気に入り絞り込み、グループ展開/折りたたみ、スクロール挙動(`scrollIntoView`/`scrollTo`)、履歴遅延ロードのタイミングと対象
- **データ取得・履歴ロード・gtag の発火回数**を増やさない(hashルーティングに gtag 呼び出しを追加しない)
- 6言語すべての表示

## 3. 状態管理の設計(LULU-011 準拠)

`useRankingBoard()` に**現行 App.jsx の 102〜465行のロジックを順序保存でそのまま移設**する。`BoardContext` で配布し、各コンポーネントは `useBoard()` で取得(portal 先の子・深い子の prop ドリル回避)。

**T0 で禁止(やらない)**:
- Context の分割(単一 Context)
- useReducer 化 / 外部ストア(Zustand 等)
- **新規の** useMemo/useCallback 最適化(現行にある useMemo/useCallback は**そのまま移設**。増やさない・減らさない)
- 状態構造の変更(state 変数の統廃合・名称変更をしない)

**URL を詳細表示の唯一の正にする(①)**:
- 現行の `detailView`("compact"/"expanded")state を**廃止**。展開状態は `useHashRoute()` の route から導出する。`detailView` と URL の二重管理をしない。
- `selectedId`(コンパクト時サイドバーの選択)は内部 state として維持。`#/character/:historyKey` へ入ったら、該当キャラの id で `selectedId` を同期(`#/` へ戻った時に同じキャラが選択されている現挙動を保つ)。
- `showListWhenExpanded` は `CharacterDetailView` のローカル UI 状態、`groupView`/`showHighlights`/`showFilters` は `RankingListView` 側のローカル UI 状態として保持(routing しない)。

**RankingListView は画面合成のみ(③)**: データ取得・フィルタ計算・派生計算を持たせない。必要な値はすべて `useBoard()` から受け取る。

## 4. ルーティングの設計

- `useHashRoute()`: `window.location.hash` を購読(`hashchange` イベント)。返り値 `{ name: 'list' | 'detail', historyKey?: string }`。
  - `#/` または空 → `{ name: 'list' }`
  - `#/character/:historyKey` → `{ name: 'detail', historyKey: decodeURIComponent(seg) }`(**③ 解析時 decodeURIComponent**)
  - 未知のパス → `list` にフォールバック(クラッシュしない)
- URL 生成側(expand 導線): `#/character/${encodeURIComponent(historyKey)}`(**③ 生成時 encodeURIComponent**)
- navigate は `window.location.hash = ...` で行い、**戻る/進む(popstate/hashchange)が自然に効く**ようにする(独自の履歴スタックを持たない)。

### historyKey 解決と Not Found(②)
`#/character/:historyKey` を開いたとき:
1. データ取得前(`loading`) → 既存の Loading 表示
2. 取得後、`characters` から `historyKey` 一致を検索
   - 見つかる → その詳細を expanded 表示(+ selectedId 同期)
   - 見つからない → **Not Found 表示**(文言は6言語に追加)+「一覧へ戻る」導線(`#/` へ）。**自動で別キャラへリダイレクトしない**
- historyKey を持たないキャラの行 expand: 現状どおり id 選択のみで動く経路を壊さない(ディープリンク非対応は許容)。expand 導線は historyKey がある場合のみ URL 遷移。

## 5. i18n(6ロケール同時)

Not Found 用に最小のキーを **ja/en/es/th/vi/zh-TW すべてに同時追加**(例: `route.notFoundTitle` / `route.notFoundHint` / `route.backToList`)。既存キーの流用で足りるなら新規追加しない。追加した場合はキー名を完了報告に列挙。

## 6. 受け入れ基準(数値・チェックリスト)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | 本番ビルド | 成功(エラー0) | `cd exp_ranking/web && npm run build` |
| 2 | 新規 Console Error / React Warning | **0件(現状比で増加なし)** | dev で全モード操作しコンソール確認 |
| 3 | データ取得 fetch 回数 | 現状と同数 | Network タブ / `console.count` で比較 |
| 4 | gtag 発火回数 | 現状と同数(hash遷移で増えない) | Network(collect)確認 |
| 5 | 目視挙動一致 | 全モード一致 | 下記手動チェック |

### 手動チェック(検収項目・全て合格必須)
- [ ] `#/` を直接開く → コンパクト表示が現状どおり
- [ ] キャラ展開で `#/character/:historyKey` へ遷移、見た目は現 expanded と一致
- [ ] 詳細URLを**新しいタブ**で開いて同じキャラが表示される
- [ ] 詳細URLで **F5**しても復元される
- [ ] ブラウザの**戻る・進む**が正常動作
- [ ] 存在しない historyKey → Not Found + 戻る導線、**クラッシュしない・自動遷移しない**
- [ ] フィルタ設定 → 詳細 → 一覧へ戻ってもフィルタ状態が維持される
- [ ] portal の操作UIが**二重表示されない**(portal ターゲット不在でもクラッシュしない)
- [ ] TOP3/フィルタ開閉、ソート、ページング、お気に入り絞り込み、グループ展開が現状一致
- [ ] **6言語すべて**で表示崩れなし

## 7. 停止条件(該当したら実装を止め、選択肢+推奨付きで統括に報告)

- 現行ロジックを順序保存で移設できない構造的事情が判明(例: 副作用順序が変わらざるを得ない)
- 挙動一致が2回の試行で崩れる(特にスクロール/portal/選択同期)
- スコープ外ファイルの変更が必要になった
- 状態構造を変えないと routing が成立しない、と判断した場合(= URL単一正の前提が崩れる)

## 8. コミット分割(各コミット単独 revert 可・挙動不変先行)

1. `board/`(useRankingBoard・BoardContext・useHashRoute)を追加。**この時点では App.jsx から未使用**でビルドが通る状態(挙動不変)
2. 表示コンポーネント(`BoardHeader`/`HighlightsSection`/`RankingControls`/`RankingTable`)を抽出。App.jsx から呼び出しに置換(挙動不変)
3. `pages/`(RankingListView・CharacterDetailView)へ画面合成を移し、App.jsx をスリム化(挙動不変)
4. `detailView` state を廃止し hashルーティングへ接続(**唯一の許容挙動差=ディープリンク**を導入)+ Not Found + i18n キー
5. (必要時)整理・デッドコード除去

各コミット後に `npm run build` 成功を確認。

## 9. 検証コマンド(コミットごと)

```
cd exp_ranking/web && npm run build
# ローカル目視: run_local_dev.bat  または  cd exp_ranking/web && npm run dev
git diff -w -- <touched files>   # 改行ノイズ排除・実質差分の確認(PR-008)
```

bot は触らないため pytest 不要。

## 10. ロールバック

- 各コミットは単独 revert 可。最悪コミット4のみ revert すれば routing 前(挙動完全一致)に戻る。
- 新規ファイルは追加のみで既存を壊さないため、コミット1〜3の revert も独立に安全。

## 11. 完了報告テンプレ

- 実施コミット(ハッシュ・件名):
- 受け入れ基準の実測値(表の全行 + 手動チェック結果):
- 追加した i18n キー(6ロケール):
- fetch/gtag 発火回数の現状比:
- 残課題・watch-item:
