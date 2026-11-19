# IMPL_PLAN_RAFFLE_MANUAL_MODE — 公式API停止中でも、当選内容の手入力で分配計算できる「マニュアルモード」

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー / 実装: 実装担当(implementer)
> 決定: DECISION_LOG **LULU-145**(ユーザー裁定 2026-11-19)
> 前提: **`docs/IMPL_PLAN_RAFFLE_BOX_CATEGORY.md` 完了後に着手**(`BOX` カテゴリ・`include.box` を使う)

## 0. 目的と背景

- 寄与: 公式側の障害で MSU API が長期停止しており、Raffle Calculator は履歴を読み込めず**分配計算に一切到達できない**。手入力で同じ計算・共有画像・送金一覧まで到達できるようにする。
- 既存構造(コードで確認済み):
  - 計算の正 `domain/settlement.js` `calculateSettlement` は純粋関数で、入力はメンバーごとの `bossNeso` / `ascendantNeso` / `powerCrystalAmount` / `drops[]` と `saleNesoByDropId`。**API に依存しない**。
  - 画面は `jobResult`(API 応答)→ `jobResult.clears` → ボス選択 → `combineSelectedPartyClears` → `activeClear` → 分配設定 → `calculateBoss` の流れ。
  - メンバー追加はランキング予測候補(LULU-115)なら API 不要。
- **方針**: 手入力値から「API 応答の clear と同じ形」を組み立てる純粋関数を作り、`activeClear` に流し込む。精算・端数・持ち越し・税/配分・追加報酬・共有画像・送金一覧は**既存コードをそのまま使う**(計算ロジックの二重実装をしない=約束と請求の一致)。

## 1. ユーザー裁定(LULU-145)

1. 入口: セクション「2. PTラッフル履歴」の **「PTのラッフル履歴を読み込む」ボタンの直下に「マニュアルモード」ボタン**を置き、押すとマニュアルモードに入る。
2. 入力の細かさ: **API 版と同様に、分配対象の項目をチェックし、チェックが入っている項目の入力欄だけを表示**する。
3. メンバー追加: **ランキング候補のみ**(保存形式・共有リンク形式は変えない)。
4. 入力内容は **localStorage に保存**(開催回 × PT 単位)。

## 2. 仕様

### 2.1 モードの出入り
- 「マニュアルモード」ボタン(secondary・全幅)。PT メンバー0人なら既存と同じ `raffle.missingParty` エラー。
- 押すと: `jobResult`・`progress`・`requestError` をクリアし `manualMode = true`。セクション2の状態文言を「マニュアルモード: 当選内容を手入力しています」に置き換える。
- 「PTのラッフル履歴を読み込む」を押すとマニュアルモードを抜ける(API モードへ)。PT 切替・PT 削除・メンバー増減でも抜ける(入力自体は保存済みなので戻れば復元される)。
- API のジョブ・名前検索が失敗したとき、既存のエラー表示に「API停止中は『マニュアルモード』で手入力して計算できます」を1文添える(新キー)。

### 2.2 セクション3(マニュアルモード時)
- Raffle Results / Party Clears のタブは出さず、見出しに「マニュアルモード」バッジ。
- ボス選択ボタン: Lucid / Will / Chaos Guardian Angel Slime(既存の `raffle-boss` スタイル)。各ボスは独立(LULU-072)。
- 難易度セレクト: Lucid・Will = Easy / Normal / Hard(初期値 Hard)、Slime = Chaos 固定。`formatPartyClearTitle` の表示・共有画像のボス名に使う。
- 項目チェック(ボスごと。初期値は API モードと同じ `initialBossSetting().include`=FT 以外 ON):

  | ボス | 表示する項目 |
  |------|--------------|
  | LUCID | ボスNESO / Ascendant NESO / Power Crystal / コイン(Phantasma) / 装備ドロップ / Box |
  | WILL | 上記 + FT Item(コインは Arachno) |
  | SLIME | ボスNESO / Ascendant NESO / Box(LULU-141: コイン・PC・装備なし) |

- **メンバー入力表**(新コンポーネント `ManualEntryTable.jsx`): 行=PT メンバー(既存の並び順)、**チェックされた項目の欄だけ**表示。
  - ボスNESO / Ascendant NESO: NESO 額。
  - Power Crystal: 個数(換算レートは既存の入力欄を使う)。
  - コイン / FT Item: 個数 + 売却価格(手数料控除前・その行の合計)+ 控除後受取額プレビュー(`calculateSaleProceedsNeso`)。
  - 装備ドロップ / Box: メンバーごとに「+ 追加」で行を増やす(名前=任意 / 売却価格 / 控除後プレビュー / 削除)。名前空欄の表示は項目名で代替。
  - 数値入力は既存と同じく桁区切り表示(`formatNesoInput` / `ungroupNesoInput`)。**空欄=0**(LULU-126 と同じ注記を表示)。不正値はそのまま計算に渡し、既存の `invalid_integer` エラー表示で止める(fail-visible)。
- 以降は既存 UI をそのまま表示: Power Crystal 換算レート(PC チェック時)/ 追加報酬 / 税・配分ルール / 「分配を計算」/ `SettlementResult`。
- **API モード専用の売却価格一覧(`saleableDrops`)はマニュアルモードでは出さない**(入力表に統合済みのため二重入力を防ぐ)。
- 入力値を1つでも変えたら、そのボスの計算結果をクリアする(古い結果が正常な顔で残らないように。既存の `updateBossSetting` と同じ挙動)。

### 2.3 clear の組み立て(純粋関数 `domain/manualClear.js`)
- `buildManualClear({ boss, difficulty, partyOrder, include, entriesByMemberId })` → `{ clear, saleNesoByDropId }`。
- `clear` は `combineSelectedPartyClears` の戻り値と同じ形: `clearId = "manual-<boss>-<difficulty>"`、`boss`、`bossDifficulty`、`ascendantTier`(`contract.js` の対応表を **export して参照**。これが contract.js 唯一の変更)、`partyCount = partyOrder.length`、`historyMemberIds = partyOrder`(確認ダイアログを出さない)、`complete: true`、`excludedRewards: []`、`sourceClears: [clear本体]`、`members[]`。
- メンバーごと: `bossNeso` / `ascendantNeso` / `powerCrystalAmount` は空欄→`"0"`、桁区切り除去、それ以外の文字列はそのまま。
- drops: コイン・FT は個数か売却価格のどちらかが空でなければ1件(`category` は `COIN` / `FT_ITEM`)。装備・Box は行ごとに1件(`EQUIPMENT` / `BOX`、quantity `"1"`、imageUrl なし)。`dropId` は `manual-<boss>-<memberId>-<kind>[-<rowId>]` で **clear 内一意**。
- `saleNesoByDropId` に各 drop の売却価格(空欄は空文字のまま=計算側で0)。
- **チェックされていない項目の値も保存はする**が、計算では既存どおり `include` で除外される(チェックを戻せば値が戻る)。

### 2.4 保存(`storage/manualEntryStorage.js`)
- キー `maplen-board-raffle-manual-v1`(LULU-008)。エントリ ID = `round + "|" + 並べ替えた assetKey`(`historyCache.raffleHistoryCacheId` と同じ形式)。
- 値: `{ savedAt, expiresAt: raffleRoundResetAt(round), bosses: { LUCID|WILL|SLIME: { difficulty, include, entriesByAssetKey } } }`。**memberId は位置依存なので保存には assetKey を使う**。
- 読込時: 期限切れ・形式不正は無視して空から始める(例外を投げない)。保存時に期限切れエントリを掃除し、最大12エントリ。
- 保存失敗(容量超過など)は既存の `storageError` 表示に乗せる。

### 2.5 結果表示
- `SettlementResult` に任意の prop `hideHistory`(既定 false)を追加し、マニュアルモードでは「ラッフル履歴 あり/なし」の表示を隠す(手入力では意味がないため)。既定値では表示は不変。
- 共有画像のボス名は `formatPartyClearTitle(clear) + "(手入力)"` 相当(新キー `raffle.manualLabelSuffix`)。`shareImage.js` は無変更で、Root から渡す `bossLabel` で付ける。
- 受取ウォレットは不明(`memberWallets = {}`)。既存の「ウォレット不明」注記がそのまま出ることを許容する。

## 3. 変わってよいもの・いけないもの

- 変わってよい: セクション2にボタンが1つ増える / マニュアルモード中のセクション3の表示 / API 失敗時のエラーに案内文が1文増える / `SettlementResult` の prop 追加。
- 変わってはいけない: **API モードの挙動すべて**(読込・キャッシュ・候補選択・計算・共有画像)/ `settlement.js`・`partyClears.js`・`shareImage.js`・`integrations/`・`server/` / 既存の localStorage キーの形式。

## 4. 受け入れ基準(数値)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | raffle 配下テスト | 全緑 | `npx vitest run src/raffle` |
| 2 | web 全体テスト | 失敗は既存の sfhistory `format.test.js` 5件以外0 | `npx vitest run` |
| 3 | ビルド | 成功 | `npm run build` |
| 4 | **等価性**(約束と請求の一致) | 同じ値を「手入力→`buildManualClear`」と「API 形 fixture clear」の2経路で `calculateSettlement` に通し、clearId・dropId 以外が完全一致(LUCID・WILL・SLIME の各1ケース以上、装備・Box 複数行、PC、持ち越し有効を含む) | `manualClear.test.js` |
| 5 | 数値ゴールデン | Hard Will・6人。A: ボスNESO 30,000,000 / Ascendant 50,000,000 / PC 110(レート1.1)/ Arachno 2個を 10,000,000 で売却、他5人は空欄 → `total = 89,500,100`、`baseShare = 14,916,683`、`remainder = 2`、送金5件、送金合計 = A の `payment` | `manualClear.test.js` |
| 6 | チェック連動 | チェックを外した項目は入力欄が描画されず、計算への寄与が0。戻すと入力値が復元される | テスト + 実機 |
| 7 | 保存 | 保存→再読込で全項目が復元 / 次の開催回では空 / 壊れた JSON でも例外なしで空 / 13エントリ目で最古が削除 | `manualEntryStorage.test.js` |
| 8 | API モード不変 | `settlement.js`・`partyClears.js`・`shareImage.js`・`integrations/`・`server/`・`package.json` の差分0行。`contract.js` は対応表の `export` 追加のみ(1行) | `git diff --stat` |
| 9 | i18n | 新キーが6ロケールすべてに存在 | ロケール整合テスト or `grep` |
| 10 | 実機 | API に接続できない状態(`npm run dev` で raffle-api 未起動)で、PT 作成(ランキング候補)→マニュアルモード→ Hard Will 入力→計算→共有画像コピー→送金通知コピーまで到達。リロード後に入力が残っている | 統括が実機で確認 |

## 5. 停止条件

- 計画と実コードの構造差、または基準未達が2回の試行で解消しない
- 等価性テスト(#4)を通すために `settlement.js` / `partyClears.js` の変更が必要になった
- スコープ外ファイルを触る必要が生じた(`contract.js` の export 1行は許可済み)
- `RaffleCalculatorRoot.jsx` への追加が 200 行を超えそう(状態を `useManualEntry` フック等へ切り出す案を付けて報告)

## 6. コミット分割

1. `feat(raffle): build settlement clears from manual entries`(`manualClear.js` + テスト + `contract.js` export。UI 未接続)
2. `feat(raffle): persist manual raffle entries per round and party`(`manualEntryStorage.js` + テスト。UI 未接続)
3. `feat(raffle): add manual mode for entering raffle winnings by hand`(Root・`ManualEntryTable.jsx`・`SettlementResult` の `hideHistory`・6ロケール・API 失敗時の案内)

## 7. 検証コマンド

```
cd exp_ranking/web && npx vitest run src/raffle && npx vitest run && npm run build
git diff -w -- <touched files>
npm run dev   # raffle-api を起動しない状態でマニュアルモードを通しで操作
```

## 8. ロールバック

3 を revert すればボタンと画面が消え、API モードは元どおり(1・2 は UI から未参照)。保存データ(`maplen-board-raffle-manual-v1`)は残るが、どこからも読まれず期限切れで消えるので害はない。

## 9. 完了報告テンプレ

- 実施コミット(ハッシュ):
- 受け入れ基準 1〜10 の実測値(#5 は実際の出力値を貼る):
- `RaffleCalculatorRoot.jsx` の増加行数:
- 残課題・watch-item:
