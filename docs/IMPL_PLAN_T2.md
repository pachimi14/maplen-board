# IMPL_PLAN_T2 — URLステート(フィルタ/ソートのURL反映)+ リンクコピー

> 承認者: ユーザー(設計承認 2026-07-14)/ 実装: implementer
> 前提: T0 で `#/` `#/character/:historyKey` は URL単一の正(LULU-011)。T2 はそこに**反映対象フィルタのクエリ**を単一の正として追加する。

## 0. 目的

今見ているランキングの絞り込み条件を URL に持たせ、その URL を**共有・ブックマーク・戻る/進む・F5 で完全再現**できるようにする(+ リンクコピー)。SEO とは別軸(hash クエリは索引されない=T6 の実URLとは責務が別)。

## 1. スコープ

### 触るファイル
- `src/board/useHashRoute.js` — クエリ解析/直列化・正規化・集中 navigate(push/replace)・popstate 連携
- `src/board/useRankingBoard.js` — 反映対象フィルタを**URL派生の単一の正**に(useState 撤去)。cascade/page 規則の再表現
- `src/board/BoardContext.jsx` — 必要なら route.query 配布
- `src/components/RankingControls.jsx`(または新規 `ShareLinkButton.jsx`)— 「リンクをコピー」ボタン
- `src/pages/CharacterDetailView.jsx` — キャラ間移動でクエリ維持(既存 handleSwitchCharacter の navigate 経路)
- `src/i18n/locales/*.json`(6) — コピー系文言

### 触ってはいけないもの
- bot / `.github/workflows/**` / vite / CNAME
- T0 で確立した挙動(フィルタ計算結果・詳細ディープリンク・selectedId サイドバー選択・グループ/TOP3 等)

## 2. URL 反映対象(確定)

**反映する**: `sort` / `world` / `alliance` / `branch` / `job` / `minLevel` / `gainPeriod` / `minGain` / `q` / `page`
**反映しない**: `favoritesOnly`(閲覧者個人の localStorage 依存)/ `selectedId`(過渡的。キャラのディープリンクは `#/character/:key`=T0 が担う)

## 3. データ契約(クエリ・固定)

| param | board state | 値 | 既定(=URLから省略) |
|---|---|---|---|
| `sort` | sortKey | `rank`/`daily`/`weekly`/`monthly` | `daily` |
| `world` | worldFilter | meta.worldIds のいずれか | `all` |
| `alliance` | jobAlliance | JOB_TAXONOMY の alliance | `all` |
| `branch` | jobBranch | alliance=冒険家 時のみ有効な branch | `all` |
| `job` | jobFilter | 整形済み職業名 | `all` |
| `minLevel` | minLevel | 整数(≥225) | `225` |
| `gainPeriod` | gainFilterPeriod | `daily`/`weekly`/`monthly` | `daily` |
| `minGain` | minGainBillions | 数値 | `""`(空) |
| `q` | query | 文字列 | `""`(空) |
| `page` | page | 整数(≥1) | `1` |

- **直列化順序は上表の順に固定**(同一状態→常に同一URL)
- **空文字列・既定値はパラメータから除去**(短いURL)
- 値のエンコードは **`URLSearchParams` 標準**に一任(日本語含む。手動の二重エンコードをしない)

## 4. アーキテクチャ(案A: URL が単一の正)

- 反映対象フィルタは **useState を持たず route.query から導出**(既定値フォールバック付き)。各 setter は「次のクエリを計算 → 集中 navigate」
- **クエリは list/detail 両ルートに載せる**(`#/?...` と `#/character/<key>?...`)。詳細往復・キャラ間移動でクエリを失わない
- **URLと別の永続フィルタ state を持たない**(二重管理禁止)

## 5. URL更新と画面更新(重要・集中化)

`history.replaceState` は `hashchange` を発火しないため、「URLだけ変わって画面が更新されない」構造を作らない。**URL更新を1関数に集約**し、内部更新は route state も即時更新する:

- 集中関数 `applyRoute(nextRoute, { replace })`:
  1. クエリを直列化して URL を構築
  2. `history.pushState`(離散操作)または `history.replaceState`(検索入力)で URL 更新
  3. **同じ関数内で route state も即時 setRoute**(イベント発火に依存しない=画面が確実に更新)
- **外部更新(ブラウザ由来のURL変更)** は `popstate` **と** `hashchange` の**両方を監視** → **同じ URL 解析・正規化関数**へ流す:
  - 対象: 初回表示 / 戻る・進む / アドレスバーでの hash 直接変更 / 既存リンク遷移 のすべて
  - **冪等**: 両イベントが同じ遷移で発火しても、**解析済み route が現在と同一なら setRoute しない**(不要な再描画を防ぐ)
  - イベントリスナーは **cleanup で確実に解除**(useEffect の return)
- 離散操作=履歴追加(pushState) / 検索入力=履歴置換(replaceState)。両者とも即時に同一 route state を更新
- **`applyRoute`(内部更新)とブラウザイベント(外部更新)で、無限ループや履歴の二重追加を起こさない**(内部更新は setRoute 済み=イベントで再度更新しても冪等で吸収 / pushState は離散操作時のみ)
- T0 の `navigateToList`/`navigateToCharacter` はこの集中関数経由に統一(現クエリを保持)。**T0 の詳細ディープリンク・F5 復元は不変**

## 6. URL値の正規化(不正でクラッシュしない)

parse 時に検証+正規化し、正規化後クエリが URL と異なれば **`replaceState` で正規URLへ置換**(履歴を汚さない):
- 未知の `sort`/`gainPeriod` → 既定へ
- 存在しない `world`(meta.worldIds 外)→ `all`
- 数値でない/範囲外: `minLevel`(非数値→225)、`minGain`(非数値→空)、`page`(非整数/0以下→1)
- **alliance と整合しない `branch`** → branch 解除、**branch と整合しない `job`** → job 解除(§7 cascade と同一規則)
- 壊れたパーセントエンコード → 当該 param を既定へ(全体を落とさない)
- **不正 URL でもクラッシュしないことを必須**

## 7. フィルタ連動とページ(既存挙動の維持・共有URL復元時も同一規則)

- **sort・検索・各種フィルタなど、ランキング結果または並び順を変更する条件が変わったら `page=1`**(page を URL から除去)。**ページ送り操作のみ、指定した page を維持する**(数値・テキスト入力は `replace` で履歴を増やさないが、値変更時は page=1 へ戻す)。〔訂正 2026-07-14: 旧記述「sort以外の絞り込みで page=1」を本文へ改める。sort 変更も page=1(LULU-019)〕
- **alliance 変更時**: 無効になった branch/job を解除
- **branch 変更時**: 無効になった job を解除
- **page が結果件数に対し範囲外**なら有効範囲へ補正(既存 `safePage` 相当)。**フィルタ結果件数の確定後に補正が必要**なため:
  - 範囲外 page の補正は **`replace` を使う**(不要な履歴を増やさない)
  - **一時的に空ページを描画し続けない**(補正を反映して有効ページを描く)
  - **補正後の URL をコピー対象**にする(リンクコピーは正規化・補正済み URL)
  - **データ読み込み前に「件数不明」を理由に page を誤って 1 へ戻さない**(loading 中/件数未確定では補正しない。件数確定後にのみ範囲補正)
- **既定の1ページ目は `page` を URL に出さない**
- 共有URLから復元した場合も上記規則を適用(正規化 §6 と一体)

## 8. クエリ表現(データ契約の固定)

- param 名・値一覧を §3 の契約に固定
- **同一状態→常に同一順序のURL**
- 空文字列は param から除去
- 日本語等は `URLSearchParams` 標準エンコード(手動二重エンコード禁止)
- 詳細→一覧で**クエリを失わない** / キャラ詳細間移動でも**クエリ維持**

## 9. 検索入力

- 検索文字列は **1文字ごとに履歴を増やさず replaceState で置換更新**
- **既存の入力応答性を悪化させない**: URL更新のために検索欄が遅延しない・**入力カーソルが飛ばない**(controlled input が route.query.q を同期的に反映)。**実機確認**(受け入れ)

## 10. リンクコピー(ランキング操作UI内)

- **現在の正規化済み URL** をコピー(`navigator.clipboard.writeText`)
- **成功時のみ**「コピーしました」を表示
- **失敗時**は成功表示を出さず、利用者が手動コピーできる代替を用意(例: URL を選択可能な形で提示)
- フィードバックは一定時間後に自動で消える
- **連打によるタイマー競合・表示残留を起こさない**(既存タイマーを毎回クリア)
- `document.execCommand('copy')` は**主要経路にしない**。Clipboard API 失敗時の最低限の代替としてのみ
- i18n: `share.copyLink` / `share.copied` /(失敗時の代替文言があれば `share.copyFailed` 等)を **6言語**追加

## 11. 互換性(既存リンクを壊さない・必須)

- クエリなしURL `#/` / `#/character/:historyKey` は**現在と同じ既定表示**
- 既存の共有リンクを壊さない

## 12. 変わってよい・いけないもの

- 変わってよい: 反映対象フィルタが URL に載る/戻る進むで復元される/リンクコピーが増える
- 変わってはいけない: フィルタ計算結果・ページング・cascade・詳細往復・T0 ディープリンク・selectedId サイドバー・`favoritesOnly` の挙動(URLに出さないだけ)

## 13. 受け入れ条件

| # | 基準 | 測定 |
|---|------|------|
| 1 | ビルド成功 | `npm run build` |
| 2 | **URL直貼り・新規タブ・F5 で完全に同じ状態が再現** | 実機 |
| 3 | 一覧→詳細→戻る で**フィルタとページ維持** | 実機 |
| 4 | 戻る/進むで**各離散操作が復元** | 実機 |
| 5 | **検索入力の各文字は戻る履歴を増やさない** | 実機(履歴長確認) |
| 6 | 不正クエリを開いても**クラッシュしない**(§6 各種) | 実機 |
| 7 | **同一状態から生成されるURLが常に同一**(順序含む) | 実機/単体 |
| 8 | フィルタ変更時の **page リセット**と**職業 cascade** が現状どおり | 実機 |
| 9 | **`favoritesOnly` と `selectedId` が URL に出ない** | 実機 |
| 10 | **URL同期による無限更新・二重レンダー・Console Warning が無い** | dev コンソール |
| 11 | **T0 のキャラ詳細ディープリンクを壊さない**(F5/新規タブ/Not Found) | 実機 |
| 12 | 検索欄の**応答性劣化・カーソル飛びが無い** | 実機 |
| 13 | 既定値パラメータが URL に出ない(短いURL) | 実機 |

## 14. 停止条件(該当したら止めて選択肢+推奨付きで報告)

- URL単一の正化でフィルタ計算/cascade/page の既存挙動を保てない構造差
- 検索入力の URL 同期でカーソル飛び/応答劣化が解消しない(→ 設計相談)
- URL同期で無限更新/二重レンダーが解消しない
- スコープ外(bot/workflow 等)の変更が必要

## 15. コミット分割(挙動不変先行)

1. ルーティング基盤: `useHashRoute` にクエリ解析/直列化・正規化・集中 navigate(push/replace)・popstate を追加。`navigateToList/Character` を集中経由に統一しクエリ保持。**この時点では board は未配線(クエリは解析されるが未使用)= T0 挙動不変**
2. board 配線: 反映対象フィルタを URL派生の単一の正へ(useState 撤去)。cascade/page/正規化を適用(挙動変更の本体)
3. リンクコピー(ShareLinkButton)+ i18n 6言語

各コミット後 `npm run build` 成功。`git add -A` 禁止・個別 add・`git diff -w`。**push しない**。

## 16. 検証コマンド

```
cd exp_ranking/web && npm run build
# 実機: run_local_dev.bat / npm run dev。URL直貼り・F5・戻る進む・検索入力の履歴・不正クエリ・リンクコピーを確認
git diff -w -- exp_ranking/web/src/board/ exp_ranking/web/src/components/ exp_ranking/web/src/pages/ exp_ranking/web/src/i18n/
```

## 17. ロールバック

- 各コミット単独 revert 可。コミット2 を revert すれば URL非反映(T0 相当)に戻る。コミット1/3 も独立。

## 18. 完了報告テンプレ

- 実施コミット(ハッシュ・件名)
- 受け入れ条件 §13 全項目の実測(実機確認できなかった項目は正直に列挙=統括が追検証)
- **push 前の実機検証(通常操作に加え、以下を必須提示)**:
  - URL をアドレスバーへ**直接貼り付け**た場合
  - **hash 部分を手動変更**した場合
  - **戻る・進むを連続操作**した場合
  - **不正 page を含む URL** を開いた場合
  - **検索中にカーソル位置や入力文字が飛ばない**こと
  - **詳細画面から一覧へ戻ってクエリと page が維持**されること
  - **同じ URL への更新で履歴や再描画が増殖しない**こと
- データ契約(§3)どおりの URL 例(複数状態)
- 追加 i18n キー(6言語)
- 残課題・watch-item(特に検索カーソル/応答性、URL同期の再レンダー)

## 19. 作らないもの(T2 除外 → 後続)

- キャラ個別の索引される実URL・per-character OG = T6(hash クエリは SEO 資産にならない)
- `favoritesOnly`/グループ等の個人状態の共有URL = 将来(プロファイル層 T4a 以降)
- history routing への移行(実パス化)= T6 で判断(T2 は hash のまま)
- マイキャラ/派生統計(T3/T4)= 未着手
