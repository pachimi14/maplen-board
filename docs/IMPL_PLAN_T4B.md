# IMPL_PLAN_T4B — ホーム上の自キャラ成績サマリー(表示層)

> 承認者: ユーザー(方針承認 2026-07-14)/ 実装: implementer / 前提: T3(統計・完成)・T4a(保存層 `maplen-board-profile-v1`・完成/未配線)
> 役割: T4b=**表示層**。T3(計算)と T4a(保存)を**呼んで表示するだけ**。統計・保存ロジックを再実装しない。**利用者向けの大きな変更**=統括検収+ユーザー実機確認を経てマージ。

## 0. 目的・境界
- 既存ホーム `#/` の上部(TOP3 の上)に「自分のキャラの成績サマリー」を表示。**新規ルート/別ホーム画面は作らない**。
- **T3**(数値)・**T4a**(ピン/目標保存+唯一 state)を消費。**丸め・色・文言・レイアウト・件数制限は T4b**。
- 参照: LULU-023(T3)/ LULU-024〜027(T4方針・主キャラ)/ LULU-005(historyKey)/ LULU-007(依存)

## 1. コンポーネント構成
```
App.jsx
└ <ProfileProvider>            ← T4b で初配線(アプリ上位に1回)
   └ <BoardProvider>
      └ AppShell
         └ RankingListView (#/)
            ├ <MyCharacterSummary/>   ← 新規(fragment 先頭=TOP3の上)
            │   ├ 未登録: <MyCharacterEmptyCta/>(検索へ誘導)
            │   ├ 登録済: <MyCharacterSwitcher/>(主+サブ タブ)
            │   │        + <MyCharacterCard/>(初期stats + もっと見る展開stats)
            │   └ <GoalModal/>(カード内から開く)
            ├ HighlightsSection (TOP3)
            ├ RankingControls
            └ RankingTable(検索input を保持)/ CharacterDetail(+<MyCharacterPinButton/>)/ GroupPanel
```
- 新規: `src/components/MyCharacterSummary.jsx` / `MyCharacterCard.jsx` / `MyCharacterSwitcher.jsx` / `MyCharacterEmptyCta.jsx` / `MyCharacterPinButton.jsx` / `GoalModal.jsx`(必要に応じ統合可)
- profile ロジックは `useProfile()` を使う小コンポーネント側に置き、**`CharacterDetail` に profile ロジックを直書きしない**。

## 2. ProfileProvider の配線位置
- `App.jsx` で **`<ProfileProvider>` を `<BoardProvider>` の外側に1回だけ**配置(アプリ上位・重複配置しない)。
- **配線後は bundle に入る**ため、**T4a 保存層を含む統合動作を実機検証**(§13)。

## 3. 検索欄 focus の ref 設計(未登録 CTA)
- **ref 所有者 = `RankingListView`**。`searchInputRef = useRef(null)` を作り:
  - `RankingTable` に渡して検索 `input` の `ref` に接続(既存 input へ ref 追加、**portal 構造は変えない**=検索 input は portal 先ではなくカード内の通常要素)。
  - `MyCharacterSummary` に `onFocusSearch` を渡す。
- `onFocusSearch()`: `const el = searchInputRef.current; if (!el) return; el.scrollIntoView({ behavior:"smooth", block:"center" }); el.focus({ preventScroll:true });`
  - **既存の検索文字列を消さない**(focus のみ)/ **input が未 DOM でもクラッシュしない**(null ガード)/ **CTA はフィルタ・URL 状態を変更しない**。
  - モバイル: `block:"center"` で固定ヘッダー等に隠れないよう配慮(必要なら scroll offset)。

## 4. CharacterDetail へのピン操作追加方法
- `CharacterDetail` に **`pinControls` ノード prop**(または `renderPinControls`)を追加し、お気に入り★・折りたたみボタン付近に**受け取ったノードを描画するだけ**。profile 参照は持たせない。
- 呼び出し側(`RankingListView` の compact サイドバー / `CharacterDetailView` の expanded)が `<MyCharacterPinButton character={selectedCharacter} />` を渡す。`MyCharacterPinButton` が `useProfile()` を使用。
- `MyCharacterPinButton` の状態表示(**お気に入り★と明確に別 見た目・ラベル**):
  - 未登録: **「マイキャラに追加」**(押下 `pin(historyKey)`)
  - 登録済: **「登録済み」**表示 + **「マイキャラから削除」**(`unpin`)+ **「主キャラにする」**(主でなければ、`setPrimary`=**追加/削除と別操作**)
  - **3体登録済で未登録キャラ**: 追加ボタン**無効化 + 上限理由**表示(`limitReached`)
  - **historyKey が無い**: 追加ボタン**無効化 + 理由**表示
  - **保存失敗**(`saveFailed` 等): **このボタン付近にインライン文言**(§8)

## 5. 初期表示 / 展開表示の項目
### 初期(折りたたみ・**シャード不要=summary のみ即時**)
| 項目 | 出所 | ラベル方針 |
|---|---|---|
| 名前・職業・サーバー | summary | — |
| 日/週/月の増加量 | `dailyGain`/`weeklyGain`/`monthlyGain` | 「日間増加量」等 |
| **レベル順位 + 前日比 ▲▼** | `rank`/`previousRank`/`rankFluctuation`(=**総合レベル順位**) | **「レベル順位」**(=総合)。**「日間ランク」の語で日間EXP増加順位と混同させない**(§日間ランクの意味) |
| 職業内順位 / サーバー内順位 + 上位率 | `jobRank`/`worldRank`(+Total)+ **T3 `calculateTopPercent`** | 「職業内 #x / N(上位y%)」 |
| **抜いた/抜かれた** | **T3 `computePassedAndOvertaken`**(summary の rank+previousRank=シャード不要) | §抜いた/抜かれた件数 |

### 展開(「もっと見る」で**一括展開**・個別トグルにしない)
- 連続記録(**T3 C**、初期 `maxRank=500`)/ 自己ベスト内順位(**T3 D**)/ 目標との先行・遅れ(**T3 E**、ペース= **T3 F** `calculateAverageDailyGain`)
- これらは表示中キャラの **history シャード**が要る → §6。

## 6. 履歴シャードの取得状態管理
- **展開した時点で、表示中キャラの history シャードだけ取得**(既存 `ensureHistories([char])` を再利用)。**ページを開いただけで3体分を一括取得しない**。
- **折りたたんでも取得済み履歴を保持**(ensureHistories がキャラの `history` を board state に載せる=再取得しない)。
- **展開中に別キャラへ切替 → そのキャラ分だけ取得**。
- 状態区別: **読み込み中 / 取得失敗 / 履歴不足** を分けて表示。**取得失敗時は再試行導線**(再度 ensureHistories)。
- **折りたたみ状態は localStorage 保存しない**(ローカル UI state のみ)。

## 7. 主キャラ と 表示中キャラ の状態分離
- **`primaryHistoryKey`(T4a・保存)= 主キャラ**。**表示中キャラ = `MyCharacterSummary` のローカル UI state(`displayedHistoryKey`)**。
- **初期表示 = 主キャラ**。**サブを一時表示しても主キャラは変えない**(`setPrimary` は明示操作のみ)。
- **表示中キャラが unpin された場合の次表示規則(固定)**: `displayedHistoryKey` が pinned から外れたら → **主キャラ(まだ pinned なら)→ 無ければ pinnedHistoryKeys[0] → 無ければ未登録状態**。

## 8. 保存結果コード → 表示文言(インライン・トーストにしない)
- **操作箇所の近くにインライン**表示:
  | 失敗操作 | 表示位置 |
  |---|---|
  | ピン追加 | `MyCharacterPinButton` の追加ボタン付近 |
  | 主キャラ変更 | `MyCharacterSwitcher`(切替部) |
  | ピン解除 | 解除操作付近 |
  | 目標保存 | `GoalModal` 内 |
- **結果コード別の自然な文言**(6言語): `saveFailed`(保存失敗・再試行)/ `limitReached`(最大3体)/ `invalidKey`(ID無しで登録不可)/ `invalidGoal`(目標入力不正)/ `unsupportedVersion`(保存形式が新しく操作不可・稀)。
- **成功操作後は古いエラーを消す** / **別操作のエラーを無関係な場所に出さない** / **console warning だけで済ませない**(T4a の `{ ok:false, code }` を使う)。

## 9. 目標設定 UI(カード内・小モーダル `GoalModal`)
- 入力: **目標レベル / 目標日**。
- **状態遷移**:
  - 開く → 保存済み目標(`getGoal`)を**初期値**に表示(無ければ空/既定)
  - **保存 / キャンセル / 目標削除を明確に分離**
  - **キャンセル**(または Escape / 背景クリック / 閉じるボタン)→ **保存データを変更しない**・モーダルを閉じる
  - 入力検証 → **不正**(T4a `setGoal` が `invalidGoal`)→ **既存の正常な目標を消さず**・**モーダルを閉じず**・**入力内容を維持**・インラインエラー
  - **保存成功後だけモーダルを閉じる** / **保存失敗(`saveFailed`)→ 閉じず・入力維持**・インラインエラー
- **計算は既存 `rankingUtils`(remainingExp 等)+ T3 E を再利用**。既存プランナーの計算/入力検証を**重複実装しない**(共通化が要る検証/変換のみ純粋関数として最小抽出)。
- モバイル: 画面外にはみ出さない(§計画のモーダルは `position:fixed` を使わずフロー内オーバーレイ or 適切なスクロール)。**focus 管理**(開いたら最初の入力へ focus、閉じたらトリガへ戻す)+ 最低限の a11y(`role="dialog"`/`aria-modal`/ラベル)。**モーダル開閉状態は localStorage 保存しない**。

## 10. 日間ランクの意味(混同防止)
- カードの「順位」は **`rank`/`previousRank`/`rankFluctuation` = 総合レベル順位**。ラベルは **「レベル順位」**系。
- **日間EXP増加順位**(既存 gain rank / `history.dailyRank`)は**別物**。カードでこの語を「レベル順位」と混同させない。増加量は「日間増加量」、増加の順位を出す場合のみ「増加ランク」と明示。

## 11. 抜いた/抜かれたの件数制限
- **T3 の返り値は全件保持**。**T4b で初期表示件数のみ制限**: 抜いた最大3・抜かれた最大3、超過は **「ほか N 人」**。

## 12. 6言語で追加するキー(`myCharacters` セクション・ja/en/es/th/vi/zh-TW)
代表(全キーを6ロケール同時追加):
- `myCharacters.section`(マイキャラ / My Characters)/ `myCharacters.todaySummary`(今日の成績 / Today's Summary)
- `empty.title` / `empty.cta`(未登録 CTA)
- `pin.add`(マイキャラに追加)/ `pin.registered`(登録済み)/ `pin.remove`(マイキャラから削除)/ `pin.setPrimary`(主キャラにする)/ `pin.primaryBadge`(主)
- `pin.disabled.limit`(最大3体)/ `pin.disabled.noHistoryKey`
- `showMore` / `showLess`
- `stat.levelRank` / `stat.jobRank` / `stat.worldRank` / `stat.topPercent`(上位{{p}}%)/ `stat.newOrIncomparable`(前日比 null)
- `movement.passed` / `movement.overtaken` / `movement.others`(ほか{{n}}人)
- `streak.positive`(N日連続増加)/ `streak.rank`(N日連続トップ{{max}})/ `selfBest`(自己歴代{{rank}}位)
- `goal.title` / `goal.level` / `goal.date` / `goal.save` / `goal.cancel` / `goal.delete` / `goal.aheadBehind`(+{{d}}日先行 / {{d}}日遅れ / 予定どおり / 達成 / データ不足)
- `state.notInRanking`(現在ランキング外)/ `state.loading` / `state.loadFailed` / `state.retry` / `state.insufficientHistory`
- `error.saveFailed` / `error.limitReached` / `error.invalidKey` / `error.invalidGoal` / `error.unsupportedVersion`

## 13. モバイルレイアウト
- カードは **1カラム・スタック**(既存テーブルは横スクロール前提)。スイッチャは横スクロール可能なチップ。モーダルは画面内に収める。狭幅で stat をグリッド→縦積み。

## 14. 作成・変更ファイル一覧
- 新規: `src/components/MyCharacterSummary.jsx`(+ `MyCharacterCard`/`MyCharacterSwitcher`/`MyCharacterEmptyCta`/`MyCharacterPinButton`/`GoalModal`。統合可)/(必要時)入力検証の純粋関数 `src/stats/`or小モジュール
- 変更: `src/App.jsx`(ProfileProvider 配線)/ `src/pages/RankingListView.jsx`(サマリー注入・searchInputRef・pinControls 受け渡し)/ `src/pages/CharacterDetailView.jsx`(pinControls 受け渡し)/ `src/CharacterDetail.jsx`(`pinControls` prop で受け取り描画のみ)/ `src/components/RankingTable.jsx`(検索 input に ref 接続)/ `src/i18n/locales/*.json`(6言語)
- **不変**: bot / `.github/workflows/**` / 既存 `favorites.js`・`groups.js`・`use*`・`msu_exp_ranking_*` / T3 `src/stats/`(消費のみ)/ T4a `src/profile/`(消費のみ、変更しない)/ URL・SEO・vite本番設定

## 15. コミット分割
1. `App.jsx` に ProfileProvider 配線 + `MyCharacterPinButton`(CharacterDetail に pinControls prop・pin/unpin/setPrimary + インラインエラー)。i18n 骨子キー
2. `MyCharacterSummary`: 未登録 CTA(→ 検索 focus・ref 配線)+ 登録済み初期カード(summary系 stats)+ スイッチャ(主/表示中分離)
3. 「もっと見る」展開: 履歴系 stats(T3 C/D/E)+ シャード取得状態(loading/failed/insufficient/retry)
4. `GoalModal`(T3 E + rankingUtils 再利用・状態遷移・a11y・インラインエラー)
5. i18n 6言語 完備 + モバイル最終調整 + 件数制限/ラベル最終化

各コミット後 `npm run test` と `npm run build` 緑。**`git add -A` 禁止**・個別 add・`git diff -w`。**push しない**。

## 16. 自動テスト + 実機検証項目
### 自動テスト(純粋ロジックがあれば vitest)
- 表示件数制限(抜いた/抜かれた ≤3・「ほかN人」)/ 表示中キャラ解除時の次表示規則 / 目標入力検証(既存流用の純粋部)/ 結果コード→文言マップ。**表示の丸めユーティリティ**があれば単体テスト。
### 実機検証(統括→その後ユーザー)
- 未登録→CTA→検索 focus(文字列消えない・URL/フィルタ不変・モバイルで隠れない)
- 詳細から「マイキャラに追加」→ サマリー反映 / ★お気に入りと別物 / 3体で上限無効化 / historyKey無で無効化
- 主/サブ切替(主キャラ不変)/ 主キャラ設定(明示)/ 解除→次表示規則
- もっと見る展開でシャード取得(一括取得しない・再取得しない・切替で対象分のみ・loading/failed/retry/不足の区別)
- 目標モーダル(初期値・保存で閉じる・キャンセル/Escape/背景で不変・不正で既存不消失・失敗で閉じず維持・モバイル収まり・focus/a11y)
- 保存失敗のインライン表示(コード別文言・成功で消える・6言語)
- T1 null / 現在ランキング外 / 未読込 の表示崩れなし
- **統合(T4a+T4b)**: pin/unpin/目標が全箇所へ即時反映・別タブ storage 反映・リロードで復元
- 6言語・モバイル1カラム / 既存ランキング画面の他部分不変

## 17. 受け入れ条件
`npm run test`/`npm run build` 緑 / 上記実機項目クリア / **既存 favorites/groups(`msu_exp_ranking_*`)不変** / **bot・workflow・URL・SEO 不変** / T3・T4a 未変更(消費のみ) / 6言語 / モバイル。

## 18. 停止条件 / ロールバック / 完了報告
- 停止条件: profile 参照を CharacterDetail に直書きせず成立しない / 検索 ref が portal 構造を壊す / シャード取得状態管理が既存 ensureHistories と整合しない / スコープ外変更が必要。
- ロールバック: コミット単独 revert 可。Provider 配線(コミット1)を revert すれば T4a 未配線=T3前の見た目に戻る。
- 完了報告: 実施コミット / `npm run test`・`build` / 実機項目結果(未確認は明記=統括追検証)/ 追加 i18n キー(6言語)/ favorites・groups・bot・workflow・URL・SEO 不変の確認 / 統合動作の確認 / watch-item。

## 20. 追加条件(承認時 2026-07-14・§各所を上書き/補足)

1. **「今日の成績」の期間表現**: 内部基準は**最新確定データの日付**(端末「今日」で断定しない)。カードに**最新更新日/対象日を表示**。最新データが想定日と一致するときのみ ja「今日の成績」/en「Today's Summary」、遅延・欠測時は「最新の成績」/「Latest Summary」相当へ切替 or 対象日を明示。**日/週/月増加量の集計期間の既存定義は変更しない**(meta.gainPeriods 準拠)。
2. **ProfileProvider 読み込み状態**: **localStorage は同期**で、`ProfileProvider` は `useState(() => readProfile(storage))` により**初回レンダー時点で profile を確定**(SSR 無しの client SPA)→ **未登録CTA のちらつきは構造上発生しない**(loading フェーズが無い=`loading` 状態や T4a 変更は不要)。状態区別は **T4a 既存の `useProfile().status`**(`ok/missing/corrupt/unsupportedVersion/storageError`)を使用: `unsupportedVersion` は空プロフィール表示だが**操作不可・既存データ上書きしない**(T4a 契約); corrupt/storageError でも**画面全体を落とさない**(サマリー枠内で穏当に処理し、**保存層エラーをランキング画面全体のエラーと混同しない**)。将来 storage が非同期化した場合のみ loading 状態を追加。
3. **表示中キャラ `displayedHistoryKey` 同期規則(§7 を厳密化)**: 初回=primary / サブ表示で primary 不変 / **別タブで primary が変わっても、表示中キャラが pin 済みなら勝手に切り替えない** / 表示中が unpin されたら **①新 primary ②残り先頭 ③CTA** の順 / **summary から一時消失でも表示中キーを即時削除しない** / **同一 historyKey への不要な state 更新をしない**。
4. **履歴取得の競合対策**: **loading/error を historyKey ごとに管理**。A取得中にBへ切替→**A後着でもBの表示を壊さない**(最新表示キーと突合、古い結果は破棄)。**アンマウント後に setState しない**。再試行は**現在表示中キャラのみ**。**既存 ensureHistories のキャッシュ契約を確認し、独自の二重キャッシュを作らない**(character.history が board state に載る=それを正とする)。
5. **CharacterDetail の全表示形態**: 「マイキャラに追加」は **compact サイドバー・`#/character/:historyKey` 詳細・詳細→一覧後**のすべてで**一貫**して使える(`RankingListView` と `CharacterDetailView` の**両方**に pinControls を渡す。片方だけにしない)。
6. **検索CTAのスクロール**: 実入力要素が**描画された後に focus**(ref null は安全に何もしない)。**scroll-margin 等**で固定ヘッダーに隠れない配慮。OS で smooth 無効の利用者に配慮(prefers-reduced-motion で auto)。**CTA で URL/検索文字/ページ/フィルタを変更しない**。
7. **抜いた/抜かれたの文言**: **総合レベル順位の追い越し**と伝わるラベル(例「レベル順位で抜いた/抜かれた」)。曖昧なら**補足/ツールチップ**。日間EXP順位ではない。
8. **初期カードの情報量**: TOP3 を押し下げすぎない。未登録=コンパクトCTA / 登録初期も主要情報のみコンパクト / 抜いた抜かれた各最大3+ほかN人 / 履歴系は「もっと見る」内 / **3体分を縦に並べず「表示中1体+切替UI」** / モバイルでファーストビュー占有しすぎない。
9. **目標入力範囲(検証済)**: `rankingUtils.MIN_PLANNER_LEVEL=225`/`LEVEL_CAP=275`、プランナーも同値、T4a も 225-275=**一致**。目標モーダルの検証は **T4a の `setGoal`(単一の検証パス)を再利用**(独自の上限を持たない)。※T4a は 225/275 を profile.js のローカル定数として持つ(値は rankingUtils と一致)。**定数の重複は値一致のため許容・将来統合はバックログ**。今後もし範囲不一致が判明したら**停止して相談**。
10. **push 前提示物(§18 完了報告 + 統括が push 前に提示)**: 変更ファイル / テスト件数結果 / build / Provider 配線位置 / 未登録→検索→詳細→ピン登録の実機 / 主・サブ切替・解除・主変更の実機 / リロード復元 / 別タブ同期 / history 遅延取得×高速切替の検証 / 保存失敗・上限・invalidKey・unsupportedVersion の表示 / 目標 保存・キャンセル・削除・不正入力 / 6言語表示 / **デスクトップ+モバイルのスクリーンショット** / 既存お気に入り・グループ維持 / bot・workflow・URL・SEO 未変更。**実装後 push・PR せず一度停止**。

## 21. 一覧レイアウト再構成(ユーザー確定 2026-07-14・同一 t4b ブランチで継続)

### 21.1 一覧の「リンクをコピー」廃止 → 詳細ページへ移設
- **`RankingControls.jsx` から `ShareLinkButton` を削除**(import + 描画)。
- **キャラ詳細ページ(`CharacterDetail` expanded の header actions=お気に入り付近)に「リンクをコピー/共有」を移設**。`CharacterDetail` に `shareControls` ノード prop を追加し、`CharacterDetailView` が `<ShareLinkButton t={t} />` を渡して**折りたたみ+お気に入りの `flex` 領域**に描画。**コピー対象は現在の詳細ページURL**(`window.location.href` = `#/character/:key?query`。ShareLinkButton は既に location.href をコピー=再利用)。名称は「リンクをコピー」or「共有」(i18n 既存 `share.copyLink` 流用可)。

### 21.2 一覧操作に「グループ比較」トグル
- `ShareLinkButton` があった位置(sort ボタン群の隣)に **「グループ比較」トグルボタン**を追加(`RankingControls` に `groupOpen`/`onToggleGroup` prop、**list 表示時のみ**=`showFilterSection` と同条件で gate、詳細ルートのミニ一覧では出さない)。
- 押下で **絞り込みの下・ランキング一覧の上に `GroupPanel` を展開/折りたたみ**。再押下で閉じる。**開閉状態は RankingListView のローカル state のみ**(URL・localStorage に保存しない)。

### 21.3 GroupPanel = B 案(右サイドバー廃止・一覧フローに展開)
- 右サイドバーの GroupPanel は廃止。上記トグルで一覧フローに `GroupPanel`(`mode` は既存 compact/expanded を流用 or inline)を描画。
- **`character` anchor**: GroupPanel は `character` 必須(無いと null)。**主マイキャラ(profile の primary を characters から解決)→ 無ければ最上位キャラ(`rankingPool[0] ?? characters[0]`)** をフォールバック供給し**常時描画可能**に(RankingListView が `useProfile()` で primary を解決)。グループ管理・比較は既存 `CharacterGroupTools`/検索追加で全機能維持。

### 21.4 一覧サイドバー(compact CharacterDetail)廃止・行クリック→詳細遷移
- 一覧の **compact `CharacterDetail` + 空プレースホルダ + `selectedHistoryReady` 経由の compact 表示分岐**を削除。
- **行クリック**: `RankingTable` の `onSelectCharacter(id)` を **`onRowNavigate(character)`** に置換 → `historyKey` があれば `navigateToCharacter(historyKey)`(現クエリ維持=T2 既存)、**無ければ no-op(遷移せずクラッシュしない)**。**行内のお気に入り★等は `stopPropagation` で行遷移を発火させない**。
- **TOP3(HighlightsSection)** も選択でなく**詳細遷移**に統一(サイドバー選択概念を廃止)。selectedId ハイライトは一覧から除去。
- **selectedId は詳細ルート(CharacterDetailView)で使用継続のため board からは削除しない**。一覧側の `setSelectedId` 呼び出し・ハイライトのみ削除。

### 21.5 レスポンシブ配置(1インスタンス・レイアウトのみ差)
DOM 順を固定し、デスクトップは grid 配置で右列へ:
- **モバイル(縦)**: TOP3 → **マイキャラ** → ランキング操作 → 絞り込み → GroupPanel(開時) → ランキング一覧
- **デスクトップ**: 左列= TOP3 / 操作 / 絞り込み / GroupPanel(開時) / 一覧、**右列= マイキャラのみ(sticky 可)**
- **`MyCharacterSummary` は1インスタンス**。CSS(grid-template-areas 等)で位置だけ切替、統計計算・保存は複製しない。条件付き GroupPanel でも崩れない配置にする。

### 21.6 維持
グループデータ・グループ比較機能 / マイキャラ(追加・解除・主/サブ切替・目標・T3・履歴遅延・P0修正)/ お気に入り / **T2 URLステート(クエリ復元)** / 6言語 / bot・workflow・SEO・データ契約。

### 21.7 受け入れ(§17 に追加)
- 一覧右側に簡易詳細が出ない / 行クリックで**1回**で詳細ページへ / 詳細→戻るで query・page 維持 / お気に入りボタンで詳細に飛ばない
- 一覧「リンクをコピー」廃止・詳細ページに「リンク/共有」があり詳細URLをコピー
- 「グループ比較」トグルで GroupPanel 開閉(絞り込み下・一覧上)・開閉は URL/localStorage 非保存
- デスクトップ右列=マイキャラ常設 / モバイルは TOP3 と操作の間 / 未登録CTA 両レイアウトで自然 / 375px 崩れなし
- 既存グループ表示・比較が機能 / `npm run test`・`npm run build` 成功 / bot・workflow・SEO・データ不変

### 21.8 変更ファイル(§14 に追加/更新)
- `RankingControls.jsx`(ShareLinkButton 削除・グループ比較トグル追加)/ `RankingListView.jsx`(サイドバー廃止・GroupPanel トグル・レスポンシブ配置・行遷移・useProfile で primary 解決)/ `RankingTable.jsx`(行 onClick→遷移・★ stopPropagation・selectedId ハイライト除去)/ `HighlightsSection.jsx`(選択→遷移)/ `CharacterDetail.jsx`(`shareControls` prop 追加描画)/ `CharacterDetailView.jsx`(ShareLinkButton を CharacterDetail へ渡す)/ 必要に応じ i18n。**board(useRankingBoard)は selectedId 維持=最小変更**。

## 19. 作らないもの(T4b 除外)
- お気に入り/グループの historyKey 移行・統合(独立後続タスク=DECISION_LOG §7)
- ~~新規ルート~~・別ホーム画面 / bot・workflow・URL(クエリ契約)・SEO 変更 / T3・T4a の再実装 / 通知・既読(将来)
  - **§22 で更新**: 新規ルート `#/group` は解禁(下記 §22.4)。それ以外の除外は継続。

---

## 22. ローカル確認後の追加修正(第2ラウンド。決定 A/B/C 確定済み)

前提: PR #11 のローカル確認後の追加要望。**決定A**=CharacterDetail は変更せずマイキャラカード側でヘッダー再現(Option C)。**決定B**=目標編集はマイキャラカードに残す(内容を3構成へ変更)。**決定C**=グループ比較は `#/group` 専用ルート化。**PR #11 は更新せず、この修正込みで再検収 → ユーザー最終確認まで push/PR更新/merge しない。**

### 22.1 マイキャラカード再設計(詳細ページの簡易版)
対象: `MyCharacterCard.jsx`。CharacterDetail は変更しない(決定A)。参照デザイン: [CharacterDetail.jsx:624-705](../exp_ranking/web/src/CharacterDetail.jsx)。

- **「最新の成績/今日の成績」見出し(h2)を削除**。データ日付は `isLatestDateToday` 判定を使った**小さな注記**に留める(約束と請求の一致は維持)。
- **ヘッダーを詳細ページ準拠で再現**(共有純粋フォーマッタ `formatJobName`/`levelExpPercent`/`formatExp`/`getGainAmount` を流用。JSXはカード側に再現、CharacterDetail からの抽出はしない):
  - キャラ**画像**(`character.imageUrl`、詳細の compact と同等サイズ `w-20 h-20` 目安)
  - 名前 / `職業 · サーバー(worldId)` / 右に `Lv.X` + `EXP%`(`expPercent.toFixed(3)%`、詳細と同じ太字 tabular-nums)
  - レベル順位ラベル + `#rank`(詳細と同じ cyan 系配色)。**数字色・文字サイズを可能な限り詳細ページに合わせる**。
- **Main/Sub 表記**: `MyCharacterPinButton` の「主要/主・副」を **`Main`/`Sub`** に変更(6言語共通の短い英語表記。i18n キー値を全ロケール `Main`/`Sub` に)。
- **順位表示の見切れ解消**: 現行の3列 `StatBox`(各 `min-w-0 truncate`)をやめ、職業内順位・サーバー内順位・全体順位を **1行1項目のラベル横並び**(または2列)に再構成。`#10/2381`・`上位1.3%` を**省略なし・小フォント化なし・ellipsis なしで全表示**。
- **「もっと見る」廃止**: `expanded`/トグルボタンを削除。従来 expanded 内にあった連続増加日数・順位維持連続・自己ベスト・目標を**最初から常時表示**。
- **詳細ページ導線**: ヘッダーの**名前クリック**と末尾の **「詳細を見る」リンク**の両方から `navigateToCharacter(displayedHistoryKey)`(現クエリ維持=T2 既存)で `#/character/:historyKey` へ遷移。`historyKey` は表示中キー(常に存在)。

### 22.2 履歴取得タイミング(もっと見る廃止後)
対象: `MyCharacterSummary.jsx` / `myCharacterUtils.js`。

- fetch エフェクトから **`expanded` ゲートを除去**し、**表示中キャラ(`displayedHistoryKey`)を表示した時点で即取得**。**3ピン全部ではなく表示中1キャラのみ**の遅延取得は維持。
- **LULU-028 の P0 修正は温存**: deps は `[displayedHistoryKey, ensureHistories, retryTick]`(`historyFetch`/`characters` を deps に入れない・retryTick で明示再試行)。`shouldStartHistoryFetch`/`classifyHistoryAvailability` から `expanded` 引数を削除し、**該当テストを更新**(expanded 分岐の削除)。
- 履歴到着までは履歴依存スタッツ(連続系・自己ベスト・目標②③)のみ「読み込み中」表示。日/週/月増加・順位・抜いた/抜かれたは履歴不要で即表示。

### 22.3 目標表示 3構成(決定B。マイキャラカードに残す)
対象: `MyCharacterCard.jsx`(GoalSection) / `myCharacterUtils.js`(純粋関数) / GoalModal は現状のままカードに残す。

**pace は「今日の増加量」= `getGainAmount(character, "daily")` を `computeGoalProgress` の `averageDailyGain` に注入**(T3 F の「pace は呼び出し側が選ぶ」契約どおり。7d平均は使わない)。0/欠測時は `null` 注入 → `insufficientData` → 推定不能に自然に落ちる。

**新規純粋関数(重複計算禁止)**: `myCharacterUtils.js` に `buildGoalDisplayModel({ character, expTable, goal, todayGain })` を追加(`../stats` の `computeGoalProgress` を内部で1回呼ぶ)。返す view-model:
- `hasGoal`, `targetLevel`, `targetDateIso`(①用)
- `todayGain`, `requiredDailyGain`(= 結果の必要日次EXP), `achievementRate`(= `requiredDailyGain > 0 ? todayGain / requiredDailyGain : null`)(②用)
- `estimatedArrivalDate`, `daysDelta`(③用)
- `indeterminate`(= todayGain ≤ 0 or status `insufficientData` or `estimatedArrivalDate == null`), `achieved`(status `achieved`)
- UI は達成率・日数の**表示のみ**担当。算出は本関数に集約。テストは `myCharacterUtils.test.js` に追加(目標達成/先行/遅れ/推定不能/欠測/達成率境界)。

**UI 構成(常時表示)**:
- **① 目標**: `Lv{targetLevel}` / `{targetDate}まで` + **編集**(GoalModal を開く)+ **削除**(`clearGoal(historyKey)`)。未設定時は「目標を設定」ボタン。
- **② 今日の進捗**: `今日 +{formatExp(todayGain)}` / `必要 +{formatExp(requiredDailyGain)}` / `達成率 {round(achievementRate*100)}%`。**100%以上=emerald / 未満=amber** で色分け可(強制ではない)。`indeterminate` 時は達成率を「-」。
- **③ 到達予測**: 前提「今日の増加量を今後も毎日続けた場合」を明記し、`到達予定日 {estimatedArrivalDate}` + `目標より{|daysDelta|}日先行/遅れ`(daysDelta 符号で分岐)。`indeterminate` 時は「推定不能(増加量が0/欠測)」。

### 22.4 グループ比較の `#/group` 専用ルート化(決定C)
対象: `useHashRoute.js` / `App.jsx` / 新規 `pages/GroupCompareView.jsx` / `RankingControls.jsx` / `RankingListView.jsx`。

- **`useHashRoute.js`**: T2 と同じ流儀で `#/group` を追加。
  - `parseHash`: `path === "/group"` → `{ name: "group", query }`。未知パスは従来どおり list フォールバック。
  - `buildHash`: `name === "group"` → `/group`(+ 既存クエリ直列化)。
  - `routesEqual`: `name` 一致で判定(group は groupId を持たない=決定C。アクティブグループは既存 `activeGroupId`/localStorage が正、URL に載せない)。
  - `navigateToGroup(partialQuery = {}, options = {})` を追加(`navigateToCharacter` と同型、base.query 継承)。
  - 単体テスト(`useHashRoute.test.js` 等既存があれば追加、無ければ新規): `#/group` の parse・build・往復・クエリ保持・`navigateToGroup`・戻り(`navigateToList`)でクエリ復元・未知→list。
- **`App.jsx`(AppShell)**: `RankingListView active={route.name === "list"}`(group 時は非アクティブ=null 描画で state 保持)。`route.name === "group"` で `<GroupCompareView />` を描画(detail と同じ条件分岐、他UIは出さない=全画面)。
- **`RankingListView.jsx`**: §21.2/21.3 のインライン `groupOpen`/`groupAnchorId`/`GroupPanel` 描画・`toggleGroup` を撤去。`RankingControls` の「グループ比較」ボタンは **`navigateToGroup()` で遷移**に変更(トグルではない)。
- **`pages/GroupCompareView.jsx`(新規)**: 全幅。**目的は「右側にあったグループ表示を全画面へ移動する」ことのみ**。グループの機能・計算・データ・操作・仕様は一切変えない。
  - **既存 `GroupPanel` をそのまま描画**(GroupPanel/CharacterGroupTools は無変更)。§21 の一覧が渡していたのと同じ props で `<GroupPanel character={anchor} characters={characters} mode="expanded" onCollapse={() => navigateToList()} onSelectCharacter={setAnchorId} {...groupDetailProps} />` を描画するだけ。`groupDetailProps`/`characters` は `useBoard()` から。
  - **アンカー解決は §21(LULU-029)で既にシップ済みのロジックを RankingListView から移設(=変更しない)**: 明示 override(`setAnchorId`)→ primary(useProfile)→ `rankingPool[0] ?? characters[0]` → null。**新しいフォールバックや解決方法は追加しない**(§21 と同一挙動を場所だけ移す)。null 時は空表示。
  - **戻るボタン**: `navigateToList()`(クエリ保持でリスト状態復元)。GroupPanel 既存の `onCollapse` を戻る動作に割り当てるだけ(新規UIの追加は最小限)。

### 22.5 (撤回)グループ比較表は作らない
**ユーザー確定仕様(2026-07-14)**: 今回のグループ側の目的は「表示場所の移動のみ」。比較表は**新しい挙動の追加=不要**。よって §22.5 の比較表・`groupComparison.js`・`GroupComparisonTable.jsx`・`CharacterGroupTools.jsx` への表組み込みは**すべて撤回/削除**する(既に実装済みなら revert)。GroupPanel・CharacterGroupTools・グループ計算/データ/localStorage/操作/仕様は**無変更**に戻す。
- 履歴取得: board が `activeGroup` 変化で自動 `ensureHistories`([useRankingBoard.js:519](../exp_ranking/web/src/board/useRankingBoard.js))するため**新規取得ロジック不要**。

### 22.6 既存グループデータ互換性(不変)
- **localStorage 形式・グループ members(名前配列)は無変更**。historyKey 移行は別件(§7)。既存グループが `#/group` にそのまま表示・グラフ・表描画される。マイグレーション無し。

### 22.7 変更/新規/削除ファイル(グループ側=表示移動のみに縮小)
- **新規**: `pages/GroupCompareView.jsx`(既存 GroupPanel を全画面で描画する薄いページのみ)
- **変更**: `MyCharacterCard.jsx`(§22.1/22.3 再設計)/ `MyCharacterSummary.jsx`(§22.2 expanded 撤去・表示時取得)/ `myCharacterUtils.js`(+`buildGoalDisplayModel`、`shouldStartHistoryFetch`/`classifyHistoryAvailability` の expanded 除去)/ `myCharacterUtils.test.js`(更新+追加)/ `MyCharacterPinButton.jsx`(Main/Sub)/ `useHashRoute.js`(+`#/group`・`navigateToGroup`)(+テスト)/ `App.jsx`(group ルート分岐)/ `RankingListView.jsx`(インライングループ撤去・ボタン遷移化・§21 のアンカー解決を GroupCompareView へ移設)/ `RankingControls.jsx`(グループ比較=遷移)/ `i18n/locales/*.json`(×6: Main/Sub、目標②③文言、達成率、詳細を見る、戻る、到達予測 — **表ヘッダーは撤回**)
- **削除**: なし(第2ラウンドの誤削除を是正)
- **不変(グループ側は明示的に元に戻す)**: `GroupPanel.jsx`(**削除を撤回=復元し無変更**)/ `CharacterGroupTools.jsx`(**§22.5 の比較表組み込みを revert=無変更**)/ グループ計算(`buildGroupGainSeries` 等)・データ構造・localStorage・操作・グループ仕様 / `CharacterDetail.jsx`(決定A)/ board(`selectedId` 維持・最小変更)/ bot・workflow・SEO・データ契約。
- **撤回して削除**: `components/GroupComparisonTable.jsx` / `components/groupComparison.js`(+ test)(§22.5 撤回に伴い削除)。

### 22.8 受け入れ基準(数値含む)
- マイキャラカード: 「最新の成績」見出し無し / キャラ画像表示 / 名前・職業・サーバー・Lv・EXP%・順位が詳細ページと同配色・同系文字サイズ / Main・Sub 表記 / **職業内・サーバー内順位が省略なし全表示**(`#10/2381`・`上位1.3%` が欠けない) / もっと見るボタン無し・履歴系スタッツ常時表示 / 名前 or「詳細を見る」で**1回**で `#/character/:key` へ・戻りで query/page 維持。
- 履歴: 非プリロードキャラ(galbi 等)を表示した時点で該当シャード取得・スタッツ表示 / キャラ切替で新キャラ分を取得 / 取得失敗時に再試行(表示中キャラのみ)/ 「読み込み中」に張り付かない(P0 非再発)。
- 目標: ①目標(Lv・期日・編集・削除)②今日の進捗(今日/必要/達成率、達成率=今日÷必要×100)③到達予測(前提明記・到達予定日・先行/遅れ日数)/ 今日の増加量0・欠測で**推定不能** / 算出は `buildGoalDisplayModel` に集約(UI 重複計算無し)。
- グループ(**表示移動のみ**): 一覧「グループ比較」ボタンで **`#/group` へ遷移**(全画面・他UI非表示)/ 戻るボタンで一覧へ(query 復元)/ **既存 GroupPanel の全機能がそのまま**(グループ選択・改名・削除・メンバー削除・お気に入り追加・チャートサイズ・7/30/カスタム期間)/ 既存グループがそのまま表示 / **GroupPanel・CharacterGroupTools・計算・データ・localStorage・操作は無変更**(比較表は作らない)。
- 品質: `cd exp_ranking/web && npm run test` 全緑 / `npm run build` 成功 / 6言語キー欠落無し / bot・workflow・SEO・データ契約不変。

### 22.9 テスト・実機検証
- **単体**: myCharacterUtils(expanded 除去 / `buildGoalDisplayModel` 各状態)/ useHashRoute(`#/group` parse/build/往復/クエリ/navigateToGroup/戻り/未知→list)。**groupComparison テストは撤回に伴い削除**。
- **実機(統括)**: ①デスクトップ右カラム=詳細準拠・全スタッツ・順位省略なし・Main/Sub・詳細導線(クエリ保持)②galbi 表示で履歴取得・切替で再取得③目標3構成の数値(達成率・到達予測・推定不能)④375px 積み上げ⑤`#/group` 全幅=**既存グループパネルがそのまま**動く(チャート・改名/削除/お気に入り追加/期間トグル)・戻りでクエリ復元⑥既存グループ表示。screenshot がタイムアウトする場合は DOM/座標/ネットワークで一次検証(最終スクショはユーザーのローカル確認で取得)。

### 22.10 停止条件・ロールバック
- 停止: 決定 A/B/C と矛盾する事実 / P0(履歴張り付き)再発 / 既存グループ localStorage が読めない・表示できない / CharacterDetail 変更が不可避になった場合(決定A違反)は選択肢付きで停止報告。
- ロールバック: 各コミットは単独 revert 可(カード再設計 / 履歴取得 / 目標3構成 / `#/group` ルート / 比較表を分離コミット)。`#/group` は未知パス→list フォールバックがあるため revert 後も旧URL は壊れない。

## 22.11 ローカル確認後の追加修正(第3ラウンド。UI微調整+プランナー1日ずれ修正)

グループは**前回どおり「表示移動のみ」を維持・仕様変更しない**(GroupPanel/CharacterGroupTools/計算/データ/localStorage/操作/仕様 無変更)。以下はマイキャラカードの見た目調整と、既存レベルプランナーの到達予定日オフバイワン修正のみ。

### A. マイキャラカード(`MyCharacterCard.jsx`)
- **① 増加量の色**: 日/週/月増加量を**詳細ページと同じ緑 `text-emerald-400`**に(現在 `StatBox` 既定の `text-slate-100`)。`StatBox` に value 色を渡せるようにする等、最小変更で緑化。ラベルは現状のまま。
- **② 「詳細を見る」をヘッダー右上へ**: 現在カード最下部の `viewDetail` ボタンを**削除し、ヘッダー右上**(画像右のブロック上端・名前/バッジ行の右)へ移動。スクロールせず押せること。`navigateToCharacter(historyKey)`(クエリ保持)は不変。
- **③ タイトル・データ日時の削除**: 現在の `<p>{todaySummary/latestSummary · asOf}</p>`(先頭の小注記)を**丸ごと削除**。`isToday`/`asOfDate`/関連 import が未使用になれば整理。
- **④ 自己ベストの文言**: `selfBestOf`(「(比較可能N日中)」)を**表示しない**。`自己歴代N位`(`selfBestValue`)のみ・**改行が入らない1行**に。
- **⑤ 連続記録(順位維持)の階層化** — **ユーザー確定契約(2026-07-14)**: 純粋関数 `pickBestRankStreak(history, tiers = [5,10,50,100,500])` を `myCharacterUtils.js` に追加。
  - 各 tier の **現在継続中 `current`**(`computeDailyRankStreak(history,{maxRank:tier}).current`。**`longest` ではない**)を評価。
  - 表示条件は **`current >= 2`**。この条件を満たす tier のうち **最も厳しい(maxRank 最小)tier を1件だけ**選ぶ。返り値 `{ maxRank, days }`(days=その tier の current)。満たす tier が無ければ `null`(=順位維持ストリーク非表示)。
  - **確定例**: Top5=2/Top10=8/Top500=20 → `{maxRank:5,days:2}`(2日連続トップ5)/ Top5=1/Top10=8 → `{maxRank:10,days:8}`/ Top10=1/Top50=1/Top500=20 → `{maxRank:500,days:20}`/ 全帯 current≤1 → `null`。
  - `computeDailyRankStreak` を tier ごとに呼ぶだけで計算は再実装しない。**独立テストで上記4例+境界(current=2 で採用/current=1 で不採用)を固定**。
  - 表示は既存 i18n `rankStreak`(「{{count}}日連続でトップ{{max}}」)に `count=days`・`max=maxRank`。`null` 時は行を出さない。
- **⑥ 目標「削除」ボタンの撤去**: `GoalSection` ① の「削除」ボタンを**削除**(削除機能は `GoalModal` 内に既にあるため重複)。「編集」ボタンのみ残す。未使用化する `clearGoal`/`errorMessageKeyForCode`/`deleteError` を整理。

### B. レベルプランナー到達予定日の1日ずれ(`CharacterPlannerTools.jsx`)
- **症状**: 最新データ 7/13・必要日数 11 のとき到達予定日が **7/25**(期待 **7/24**)。原因: 181行 `targetDatePartsAfterDays(estimate.days, t)` が **today + days**(today=7/14 + 11 = 7/25)。
- **仕様**: 「必要日数=今日から必要なデイリー回数」「到達予定日は**基準日(今日)を1日目**として数えた日付」。→ 到達予定日 = today + (days − 1)。例: day1=7/14 … day11=7/24。
- **修正**: 純粋ヘルパー `arrivalDatePartsForDailyRuns(days, t, reference)` を `rankingUtils.js` に追加(`days≥1` ガード、内部で `targetDatePartsAfterDays(days-1, ...)` 相当)しテスト。`CharacterPlannerTools.jsx:181` をこれに差し替え。**必要日数 `estimate.days`(=`estimateDaysToLevelWithGain`)の計算は変更しない**。
- **他の到達日は変更しない**: 250/275 マイルストーン(`latestGainSnapshotDate + days`)と目標カード③(`computeGoalProgress` の `latest + daysToArrive`)は latest 基準で既に「latest 翌日=1日目」相当=正しいため無変更。`CharacterDetail.jsx` は触らない(決定A維持。プランナーは別ファイル `CharacterPlannerTools.jsx`)。

### C. 受け入れ・検証(§22.8/22.9 に追加)
- カード: 増加量が緑 / 「詳細を見る」がヘッダー右上・スクロール不要 / タイトル・日時なし / 自己ベストが1行・「(比較可能N日中)」なし / 順位維持が tier 階層で最良1つ / 目標に「削除」ボタンなし(編集のみ・モーダルで削除可)。
- プランナー: 必要日数 N のとき到達予定日 = today+(N−1)。**境界テスト固定**: 1日必要→今日 / 2日必要→翌日 / 11日必要→10日後。`npm run test`(新テスト含む全緑)/ `npm run build` 成功 / 6言語パリティ維持。
- グループ: `#/group` は前回のまま(GroupPanel/CharacterGroupTools 無変更・比較表なし)。

## 22.12 ローカル確認後の追加修正(第4ラウンド。導線ボタンの視認性)
グループ・決定Aとも前回どおり維持。以下2ボタンの視認性向上のみ。

### #1 マイキャラカード「詳細を見る」ボタン(`components/MyCharacterCard.jsx`)
- 現在の `text-xs` リンク調(`text-sky-400 hover:underline`)をやめ、**枠付き・やや大きめ**に(border + 淡い背景 + padding + `text-sm`、sky系で目立たせる)。位置(ヘッダー右上・バッジ行の右)・遷移(`navigateToCharacter(historyKey)`・クエリ保持)は不変。

### #2 詳細画面「簡易表示に戻る」→「一覧に戻る」を大きく(`pages/CharacterDetailView.jsx`。**CharacterDetail.jsx は触らない=決定A維持**)
- 現状: 「簡易表示に戻る」ボタンは `CharacterDetail.jsx:644-653`(`characterDetail.collapseDetail`)がヘッダー内に小さく描画。決定Aで同ファイルは変更不可。
- 対応: **CharacterDetailView から CharacterDetail への `onCollapse` の受け渡しをやめる**(→ ヘッダー内の小さな「簡易表示に戻る」が消える。`isExpanded && onCollapse` ゲートにより非表示)。代わりに **CharacterDetailView の詳細の最上部に「一覧に戻る」の大きめ・枠付きボタンを1つ新設**(ラベル=既存 i18n `route.backToList`「一覧に戻る」、`onClick={collapseDetail}`=既存の一覧復帰・クエリ保持、左向き矢印など可)。
- not-found 時の既存「一覧に戻る」ボタン(CharacterDetailView 内)は現状維持。`CharacterDetail.jsx` の `onCollapse` prop 定義自体は残置(他からの再利用余地・未使用でも害なし)。
- `#/group` の戻るボタン(`group.collapseGroup`「簡易表示に戻る」)は**今回は対象外**(ユーザー指定は詳細画面のみ・グループは無変更方針)。将来必要なら別途。

### 受け入れ
- カード「詳細を見る」が枠付きで明確に大きい・ヘッダー右上・遷移不変。
- 詳細画面の上部に「一覧に戻る」大型ボタン・押下で一覧へ(クエリ保持)。ヘッダー内の小「簡易表示に戻る」は消えている。`CharacterDetail.jsx`/`GroupPanel.jsx`/`CharacterGroupTools.jsx` は無変更(`git diff` 空)。`npm run test` 全緑・`build` 成功・6言語パリティ維持。

## 22.13 ローカル確認後の追加修正(第5ラウンド。バグ1件+視認性+カード内登録)
ユーザー確定(2026-07-15): ①はサーバー名リンクのバグ修正で**一覧＋詳細の両方**、③は**実装する**。グループ(GroupPanel/CharacterGroupTools/計算/データ/localStorage/操作/仕様)は引き続き無変更。

### #1 サーバー名のナビゲーターリンク削除(一覧＋詳細)— **決定Aを本件のみ緩和**
- バグ: 一覧・詳細とも名前だけでなく**サーバー名(worldId)もナビゲーター(外部)へ飛ぶ**。名前→ナビゲーターは仕様として維持、サーバー名のリンクのみ撤去。
- `components/RankingTable.jsx:176-182`: worldId の `NavigatorLink` を撤去し**プレーン `<span>`**(非リンク色=slate 系)に。名前(166-171)のリンクは維持。→ サーバー名クリックは行 onClick に伝播し**詳細へ**(行と同じ挙動)。
- `CharacterDetail.jsx:671-678`: worldId の `NavigatorLink` を撤去しプレーン span に(**サーバー名をリンクから外す最小変更のみ**)。名前(663-665)のリンクは維持。**決定A はこの1点のみ緩和**(それ以外の CharacterDetail 変更はしない)。
- `getNavigatorUrl` 等のロジックは不変(呼び出しを減らすだけ)。

### #2 詳細「一覧に戻る」ボタンを目立たせる(`pages/CharacterDetailView.jsx`)
- 現状 `variant="outline" border-slate-700 bg-slate-950`(近黒ページ背景に埋没・上部左で気付きにくい)。**塗り(filled)・高コントラスト**にして「ぱっと見で分かる」視認性へ。例: 明るい塗り or アクセント枠(既存トークン範囲)。左矢印は維持、サイズは現状〜やや大きめ。位置は上部でよいが明確に浮くこと。**CharacterDetail.jsx は触らない**。

### #3 マイキャラカード内で検索して登録(往復解消)
既存 `CharacterSearchPicker`(`characters`/`selectedId`/`onSelect(id)`)と `useProfile().pin`(`MAX_PINS=3`)を**再利用**。計算・データ構造・保存形式は不変。
- **状態**: `MyCharacterSummary` に `registerMode`(既定 false)を追加。ピン登録は `onSelect(id)` → `characters.find(c=>c.id===id)` → `pin(character.historyKey)`。`pin` の code(`added`/`alreadyPinned`/`limitReached`/`invalidKey`)を見てエラー時は `myCharacters.error.*` を表示、成功/既存なら registerMode を閉じる。初回ピンは LULU-026 で自動 primary。
- **未指定(ピン0)**: `MyCharacterEmptyCta` の「一覧の検索へ誘導」ボタンをやめ(または併存やめ)、**カード内に `CharacterSearchPicker` を表示**して検索結果から直接ピン。見出し(例 `myCharacters.register.title`)。
- **スイッチャー(`MyCharacterSwitcher`、ピン≥1 かつ `< MAX_PINS`)**: タブ列に **「＋サブキャラ追加」ボタン**(`onAddSub` prop)を表示。押下で `registerMode=true`。`MAX_PINS` 到達時は非表示。
- **登録モード(ピン≥1 かつ registerMode)**: カード内に `CharacterSearchPicker` +「キャンセル」ボタンを表示。選択でピン→ registerMode=false。
- **`CharacterSearchPicker` に任意 `placeholder` prop を追加**(後方互換=未指定時は既存 `characterDetail.switchCharacter`)。マイキャラ登録文脈では登録向けプレースホルダを渡す。**この変更は CharacterSearchPicker の既存呼び出し(詳細/グループ)に影響しない**(グループの GroupPanel/CharacterGroupTools 経由の利用も props 増加のみで挙動不変)。※CharacterGroupTools は `CharacterSearchPicker` を直接は使わない(お気に入りから追加)ため無変更。
- **i18n(6ロケール)**: `myCharacters.register.title`(未指定時見出し)/ `myCharacters.switcher.addSub`(＋サブキャラ追加)/ `myCharacters.register.searchPlaceholder`(検索プレースホルダ)/ `myCharacters.register.cancel`(キャンセル)等を追加。`myCharacters.error.limitReached` は既存を再利用。
- **表示中キャラ**: ピン追加後、`MyCharacterSummary` の既存 displayedHistoryKey 解決に委ねる(空→新primaryへ、サブ追加時は現行維持)。新規状態の追加は最小限に。

### 受け入れ・検証
- #1: 一覧・詳細ともサーバー名クリックで**ナビゲーターに飛ばない**(一覧は行と同じく詳細へ/詳細は非リンク text)。名前クリックは従来どおりナビゲーター。`git diff ce36e3f..HEAD -- CharacterDetail.jsx` は **worldId をリンクから外す差分のみ**(それ以外ゼロ)。GroupPanel/CharacterGroupTools は空。
- #2: 「一覧に戻る」ボタンが近黒背景で明確に目立つ・押下で一覧(クエリ保持)。
- #3: 未指定時カード内検索で直接ピン→カードが即その主キャラ表示 / スイッチャーの「＋サブキャラ追加」→検索→サブ追加(≤3)/ 4件目は追加ボタン非表示 or limitReached 表示 / キャンセルで戻る。詳細・グループの CharacterSearchPicker 利用は挙動不変。
- `npm run test` 全緑 / `build` 成功 / 6言語パリティ維持。

## 22.14 マージ後の是正(§22.11 B の不完全修正のバグ)— レベルプランナー到達日を**スナップショット日基準**へ
**背景(ユーザー本番確認 2026-07-15)**: §22.11 B で到達予定日を `today + (days-1)`(**実時刻の今日基準**)にしたが、これは **データが当日分に更新済み(today = 最新スナップショット日+1)のときだけ**正しい。本番はデータが1日古い状態(データ=7/13末、実時刻=7/15 JST、サイト表記は UTC)で、`today(7/15) + (5-1) = 7/19` と表示されるが、**正しくは最新スナップショット日 7/13 を起点に「14日=1日目」で数え、5日後=7/18**。実時刻基準だと stale データで +1 ずれる。

**正しい仕様**: 到達予定日 = **最新スナップショット日(`character.history` の末尾 `snapshotDate`)+ 必要日数 N**(day1 = snapshot+1)。**TZ非依存・データ基準**。既存の 250/275 マイルストーン(`CharacterDetail.jsx:541` の `addDaysToIsoDate(latestGainSnapshotDate, days)`)と**同じ基準に統一**する(マイルストーンは元から正しい)。目標カード③(`computeGoalProgress` の `resolveTodayIso=最新スナップショット` + `addDaysToIsoDate`)も既に snapshot 基準で**正しい=変更不要**。

**対象(修正はプランナーのみ)**: `CharacterPlannerTools.jsx` / `rankingUtils.js`(+ テスト)。**`CharacterDetail.jsx` は触らない(決定A)**。**必要日数 `estimateDaysToLevelWithGain` は変更しない**。
- **`rankingUtils.js`**: 誤った `arrivalDatePartsForDailyRuns`(today+(N-1))を**削除**し、純粋関数 **`arrivalDatePartsFromSnapshot(latestSnapshotIso, daysNeeded, t, reference = new Date())`** を追加:
  - `daysNeeded < 1` or 非有限 → `null`。
  - `latestSnapshotIso` が `YYYY-MM-DD` なら **`datePartsFromIsoDate(addDaysToIsoDate(latestSnapshotIso, daysNeeded), t)`**(=snapshot+N)。
  - snapshot 無効/欠落時のみフォールバック **`targetDatePartsAfterDays(daysNeeded, t, reference)`**(マイルストーンの fallback と同じ today+N)。
- **`CharacterPlannerTools.jsx`**: `latestGainSnapshotDate = character.history?.at(-1)?.snapshotDate ?? character.history?.at(-1)?.date ?? null`(CharacterDetail と同一取得)を用意し、`slashDateFromParts(arrivalDatePartsFromSnapshot(latestGainSnapshotDate, estimate.days, t))` に差し替え。import を差し替え。
- **テスト(`rankingUtils.test.js`)**: 旧 `arrivalDatePartsForDailyRuns` テストを置換。snapshot `"2026-07-13"` 固定で **N=1→2026-07-14 / N=5→2026-07-18 / N=11→2026-07-24**、N=0/負→null、snapshot 欠落→fallback(reference 固定で today+N)を固定。

**受け入れ・検証**:
- プランナー: 最新スナップショット日 S・必要日数 N で到達予定日 = S+N(実時刻に依存しない)。**stale データ実機シナリオ**: データ 7/13末・実時刻 7/15 で N=5 → **7/18**(7/19 でない)、N=1 → **7/14**。
- 250/275 マイルストーン・目標カード③は無変更で従来どおり正しい。
- `CharacterDetail.jsx`/`GroupPanel.jsx`/`CharacterGroupTools.jsx` は無変更。`npm run test` 全緑 / `build` 成功 / 6言語パリティ維持。

## 22.15 キャラ画像の余白トリミング(拡大でなくズームで詰める)— ユーザー確定(2026-07-15)
**背景**: 前案(旧 §22.15=画像ボックス拡大 `a036fa5`)は「思ってた修正と違う」。真の要望は**余白の削減**。画像は **180×180 正方形**でキャラが中央に小さく周囲が透明余白(=画像に内蔵)。ボックスは正方形のため `object-cover` でもトリミングされず全体表示=余白がそのまま出る。ユーザー選択: **CSSズームで詰める(画像加工なし)**。
**方針**: `a036fa5` のボックス拡大は**取り消し(元サイズに戻す)**。代わりに **`overflow-hidden` コンテナ + 内側 img に `transform: scale`** でズームし、透明余白の外周を枠外へ逃がして隠す。
- **`MyCharacterCard.jsx`**: 画像を**元サイズ `w-20 h-20 md:w-24 md:h-24`** に戻し、`img` を **`overflow-hidden` の固定サイズ `div` でラップ**(サイズ class は div へ・`rounded-2xl bg-slate-800 shrink-0`)。内側 img は `w-full h-full object-cover` + **`scale-[1.3]`**(初期値)。
- **`CharacterDetail.jsx`(決定Aを画像表示の1点のみ緩和)**: 展開時の画像を**元サイズ `w-24 h-24 md:w-28 md:h-28`** に戻し、同様に `overflow-hidden` div ラップ + 内側 img `scale-[1.3]`。compact 側は据置。**画像表示部分以外は一切変更しない**。
- **スケール値**: 初期 `1.3` → **ユーザー確認後 `1.5` に変更 + 少し上へずらす(2026-07-15)**。内側 img を `scale-[1.5]` + **`-translate-y-[8%]`**(上シフト)。※画像は正方形のため `object-position` は無効(正方形→正方形は object-cover でクロップ無し=余白クロップは scale の transform 由来)。上ずらしは **translate**(Tailwind4 は `translate`/`scale` を別 CSS プロパティで出力し合成)。translate 量・scale はユーザー確認で微調整可。
- **受け入れ**: カード・詳細ともキャラが枠を埋め余白が明確に減る / レイアウト崩れ・横あふれなし・`shrink-0` 維持 / `npm run test` 全緑・`build` 成功 / `git diff origin/main -- CharacterDetail.jsx` は画像表示部のみ・GroupPanel/CharacterGroupTools 空。
