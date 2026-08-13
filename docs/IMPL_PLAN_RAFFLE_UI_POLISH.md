# IMPL_PLAN — Raffle Calculator UIポリッシュ(見やすさ・わかりやすさ改善)

> 状態: 統括承認済み(ユーザー指示「デザインを修正してほしい」起点)
> ブランチ: `codex/raffle-calculator`(現在の未コミット作業ツリーの上に編集する。**コミットは行わない**)
> モットー: 「誰でも使える、誰にでもわかりやすい」

## 0. 背景(統括のローカル実機確認で確定した問題)

fixtureモード(`RAFFLE_API_FIXTURE_MODE=1`、port 8783)+ web dev(port 5174、`--mode review`)で全フローを実測した。

1. **最重要出力が最小フォント**: 精算テーブル本文 12.2px、ヘッダー 11.0px、支払/受取バッジ 10.5px、メトリクスラベル 11.4px(ページ基準は17px)。最終答えである「実際の送金」が最下部の極小テーブル。
2. **生の技術文字列が利用者に露出**: 「処理段階: complete」「2 / 2 · 62 ms」、警告が生コードのカンマ結合(`fixture_mode` 等)、APIエラーが「…できません。(networkError)」、対象開催回が生ISO `2026-07-30T00:00:00Z`。
3. **導線が不明瞭**: ①PT作成→②履歴読込→③分配 のステップ構造が画面に現れていない。計算結果は y≈1630px に出現するがスクロール誘導なし。分配計算ボタンが無効のとき理由の表示なし。
4. **操作性**: 削除ボタン高さ21px(テキストのみ)、チェックボックス13px。「Power Crystal 1 = NESO」というラベルが文として壊れている。
5. 取得状況が独立カードでデバッグ表示のまま。

## 1. スコープ

**UI表示層のみの変更**。計算・正規化・取得ロジック・保存形式は一切変えない。

### 触ってよいファイル(これ以外は変更禁止)

- `exp_ranking/web/src/raffle/RaffleCalculatorRoot.jsx`
- `exp_ranking/web/src/raffle/RaffleResultCard.jsx`
- `exp_ranking/web/src/raffle/SettlementResult.jsx`
- `exp_ranking/web/src/raffle/PartyCarryoverSettings.jsx`
- `exp_ranking/web/src/raffle/raffle.css`
- `exp_ranking/web/src/i18n/locales/*.json`(6ファイル、キー追加と本計画で指定した既存キー文言の修正のみ)
- 新規UIヘルパーが必要なら `exp_ranking/web/src/raffle/uiText.js`(+テスト)のみ許可

### 変更してはいけないもの

- `src/raffle/domain/` `src/raffle/integrations/` `src/raffle/storage/`(純粋関数・API契約・保存形式)
- `server/raffle-api/` 全部
- 既存i18nキーの削除・リネーム(追加と、指定箇所の文言修正のみ)
- 計算結果の数値・分配ロジック・API呼び出し回数
- ルーティング・localStorageキー
- 新規npm依存の追加(禁止)
- **git commit しない**(作業ツリーに未コミットの実装一式があるため。検証後の扱いは統括が裁定)

## 2. 変更内容

### C1. タイポグラフィスケール引き上げ(raffle.css)

原則: **利用者向けテキストの最小フォントは 0.68rem(≈11.5px)。数値データは 0.8rem 以上。最終送金額は最大級**。

| セレクタ | 現在 | 変更後 |
|---|---|---|
| `.raffle-settlement-table` | 0.72rem | 0.82rem |
| `.raffle-settlement-table thead th` | 0.65rem | 0.72rem |
| `.raffle-settlement-metrics span` | 0.67rem | 0.74rem |
| `.raffle-settlement-metrics strong` | 0.92rem | 1.05rem |
| `.raffle-payment`/`.raffle-receipt`/`.raffle-settled`/`.raffle-history-*` | 0.62rem | 0.72rem |
| `.raffle-payment strong`/`.raffle-receipt strong` | 0.68rem | 0.82rem |
| `.raffle-summary-metrics small` | 0.55rem | 0.68rem |
| `.raffle-summary-metrics strong` | 0.82rem | 0.95rem |
| `.raffle-reward-kind` | 0.55rem | 0.66rem |
| `.raffle-reward-name` | 0.78rem | 0.85rem |
| `.raffle-reward-quantity` | 0.78rem | 0.88rem |
| `.raffle-difficulty` | 0.62rem | 0.7rem |
| `.raffle-result-title time` | 0.65rem | 0.72rem |
| `.raffle-layer-detail` | 0.72rem | 0.78rem |
| `.raffle-settlement-formula` | 0.72rem | 0.78rem |
| `.raffle-carryover-toggle small`/`.raffle-carryover-sign-help` | 0.68rem | 0.75rem |
| `.raffle-carryover-member > span` | 0.72rem | 0.8rem |
| `.raffle-member-amount small` | 0.62rem | 0.7rem |
| `.raffle-category-quantity > small` | 0.6rem | 0.7rem |
| `.raffle-equipment-item b` | 0.48rem | 0.6rem |
| `.raffle-ascendant-tier-line span` | 0.56rem | 0.68rem |

列幅・min-width は必要に応じて微調整可(`.raffle-member-table` の min-width 62rem→68rem 程度まで)。

### C2. 「実際の送金」を最終回答として最上級の見た目に(SettlementResult.jsx + css)

- テーブルをやめ、送金1件=1行のリストに変更: `支払う人 →(矢印)受け取る人  金額`
- 金額は **1rem・font-weight 900・tabular-nums**。支払う人は既存の赤系、受け取る人は緑系トークンを流用
- セクション見出しの直後に置き、行背景を薄い強調色(既存 `#ecfdf5` / deep `#123c35` 系)で囲む
- 「送金は不要です」の空状態は現状文言を維持
- deepテーマ対応を同時に書く(既存の配色トークンを踏襲)

### C3. ステップ導線の明示(RaffleCalculatorRoot.jsx)

- 3カードの見出しに番号を付ける: 「1. パーティ」「2. 履歴の読み込み」「3. ラッフル結果・分配」(i18nキー: 既存 `raffle.party` 等は変えず、表示側で `1.` 等のプレフィックスを付けるか、新キー `raffle.step1`〜`step3` を追加してもよい。6ロケール整合が保てる方を選ぶ)
- **取得状況カードを廃止し、「2. 履歴の読み込み」カードへ統合**。構成: 対象開催回(C5の表示)→ 読み込みボタン → 進捗表示(C4)
- ジョブ完了時に結果カードへ `scrollIntoView({ behavior: "smooth", block: "start" })`(`prefers-reduced-motion: reduce` 時は `behavior: "auto"`)
- 分配計算実行後、精算結果へ同様にスクロール
- 分配計算ボタンが `disabled` のとき、ボタン直下に理由テキストを表示: 新キー `raffle.confirmBeforeCalculate` = 「分配人数の確認チェックをすべて入れると計算できます。」(6ロケール)

### C4. 進捗の人間語化(RaffleCalculatorRoot.jsx)

- `処理段階: {stage}` と `{n} / {m} · {ms} ms` を廃止
- 進捗バー(横幅 `completed/total` %、CSSのみで実装)+ 1行テキスト: 「取得中… 2 / 6人」
- stage の対応表(新i18nキー、6ロケール):
  - `queued` → 「順番待ち…」
  - `fetching` → 「履歴を取得中…」(このときだけ n/m 人 を併記)
  - `normalizing` → 「結果を整理中…」
  - `complete` → 「完了」
  - `partial` → 「一部のみ取得できました」
  - `error` → 「取得に失敗しました」
  - `cancelled` → 「中断しました」
  - 未知の stage → 汎用「処理中…」(生文字列は出さない)
- ms表示は削除(所要時間は出さない)

### C5. 対象開催回の表示(RaffleCalculatorRoot.jsx)

生ISOをやめ、**ユーザーのローカル時刻 + UTC併記**にする。例(ja): 「2026/7/30(木) 9:00(あなたの時刻)/ 00:00 UTC」。実装は `Intl.DateTimeFormat(現在ロケール, { dateStyle:.., timeStyle:.. , weekday.. })` ベースで新規ヘルパー `uiText.js` に置き、単体テストを付ける(タイムゾーンをモックできる形: `timeZone` 引数を受け取る純粋関数にする)。

### C6. エラー・警告の人間語化(RaffleCalculatorRoot.jsx / uiText.js)

生コードのカンマ結合と `(code)` サフィックスをやめ、**コード→ローカライズ文言+次の行動** に変換する。未知コードは汎用文言+小さく `(code)` を残す(情報を隠さない)。マッピング(新i18nキー群、6ロケール):

| コード(群) | 表示(ja の例) |
|---|---|
| `rateLimited` / `client_rate_limited` / `upstream_daily_budget_exceeded` | 「アクセスが混み合っています。しばらく待ってから再試行してください。」 |
| `networkError` / `httpError` / `upstream_unavailable` / `api_key_not_configured` / `queue_full` / `job_not_found` | 「APIサーバーに接続できませんでした。時間をおいて再試行してください。」 |
| `aborted` | 「読み込みを中断しました。」 |
| `invalidResponse` | 「サーバーの応答を解釈できませんでした。時間をおいて再試行してください。」 |
| `history_unavailable`(memberId付き) | 「{name} のラッフル履歴を取得できませんでした。」(memberMapで名前解決、なければmemberId) |
| `wallet_not_available`(memberId付き) | 「{name} のウォレット情報を取得できませんでした。」 |
| `metadata_timeout` / `item_metadata_unavailable` | 「一部のアイテム情報を取得できませんでした。分類できない報酬は分配に含まれません。」 |
| `ambiguous_party_cluster` | 「同じボス・難易度で複数の討伐候補が見つかりました。分配対象を手動で選択してください。」 |
| `fixture_mode` | 「テストデータを表示しています(開発用)。」 |

- 精算バリデーションエラー(`invalid_integer` / `input_too_large` / `invalid_signed_integer` / `result_too_large` / `invalid_rate` / `fractional_neso` / `invalid_boss` / `incomplete_clear` / `invalid_member_count` / `party_mismatch` / `invalid_drop`)も同様にローカライズ。dropId/memberId は名前に解決して文中に含める(例: 「pachimi — Phantasma Coin の売却総額は0以上の整数で入力してください。」)。`fractional_neso` は「Power Crystal換算が整数NESOになりません。レートを見直してください。」
- 既存 `carryover_not_balanced` のローカライズは維持
- 警告(amber)とエラー(rose)の視覚区分は現状の色分けを維持し、1件=1行で表示(カンマ結合をやめる)

### C7. 入力まわりの操作性(RaffleCalculatorRoot.jsx / css)

- Power Crystal レート入力をインライン形式へ: `1 Power Crystal =` `[入力欄]` `NESO`(新キー `raffle.powerCrystalRatePrefix` / `raffle.powerCrystalRateSuffix`。既存 `raffle.powerCrystalRate` は「Power Crystal換算レート」に文言修正しラベルとして維持)
- メンバー削除ボタン: 枠付きボタン化(`.raffle-button-secondary` 相当の小型版、min-height 2rem、色は rose 系)
- raffleページ内のチェックボックスに `width/height: 1.05rem; accent-color: var(--color-emerald-600, #059669)` を適用(deep でも視認可能)
- タブに補助ラベルを追加: 「Raffle Results」の下に小さく「当選結果」、「Party Clears」の下に「分配計算」(新キー `raffle.tabRafflesSub` / `raffle.tabClearsSub`。英名は固有名として全ロケール共通のまま)

## 3. 変わってよい/いけない

- 変わってよい: 見た目、文言、DOM構造、スクロール挙動、i18nキー追加
- 変わってはいけない: 計算結果の数値、API呼び出し(回数・内容)、保存形式、domain層のexport、既存テストが検証する純粋関数の挙動

## 4. 受け入れ基準(数値)

1. raffleページの利用者向けテキストに **computed font-size < 11px が0件**(devtoolsで精算領域を実測)
2. 精算テーブル本文 ≥ 13px、送金一覧の金額 ≥ 16px 相当(1rem)
3. 既知コードの警告・エラー・進捗で**生コード文字列が単独表示されない**(fixture_mode / metadata_timeout / rateLimited で確認)。未知コードは汎用文言+括弧書きで表示される
4. 対象開催回にローカル時刻とUTCが併記される
5. 6ロケールすべてで新規キーが揃う(パリティ欠落0)
6. `npm run test` 全緑(既存358+新規)・`npm run build` 成功
7. 変更ファイルが §1 の許可リスト内に収まる(`git status` で確認)
8. 新規npm依存 0

## 5. 停止条件

- domain層に触れないと実現できない項目が見つかった場合(その項目をスキップし報告)
- 既存テストがUI変更で赤になる場合、テストの意図を変えずに直せないなら停止・報告

## 6. 検証コマンド

```
cd exp_ranking/web && npm run test
cd exp_ranking/web && npm run build
git status --short   # 許可リスト外の変更がないこと
git diff -w -- <touched files>  # 改行ノイズ確認
```

## 7. ロールバック

未コミットのため `git checkout -- <file>` はCodexの既存変更まで戻してしまう。**編集前に各対象ファイルを `%TEMP%` へコピーしてから作業し、破棄時はコピーから復元する**こと。

## 8. 完了報告テンプレ

- 変更ファイル一覧(許可リスト対比)
- C1〜C7の実施状況(スキップがあれば理由)
- テスト結果(件数)・ビルド結果
- 新規i18nキー数と6ロケールパリティ確認方法
