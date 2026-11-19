# IMPL_PLAN_RAFFLE_BOX_CATEGORY — Ring Box を「装備ドロップ」から独立した分配カテゴリ「Box」にし、FT Item を初期OFFにする

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー / 実装: 実装担当(implementer)
> 決定: DECISION_LOG **LULU-144**(ユーザー裁定 2026-11-19)
> 後続: `docs/IMPL_PLAN_RAFFLE_MANUAL_MODE.md`(本計画の `BOX` カテゴリを前提にする。**本計画を先に完了させる**)

## 0. 目的と背景

- 寄与: 実運用の分配ルール「**FT Item は基本分配しない / Box は分配する**」を、毎回のチェック外し・頭の中での切り分けなしで再現する。
- 現状(コードで確認済み):
  - サーバー `server/raffle-api/normalizer.py` `_classification` は `tier1 == "Voucher"` かつ名前が `Ring Box` で終わる報酬を **`EQUIPMENT`** で返す(LULU-135 S2)。Ascendant 層の Ring Box も同じ経路(LULU-142)。
  - Web は Box を「装備ドロップ」チェック(`include.equipment`)の中で扱い、独立したON/OFFが無い。
  - FT Item(`Sealed Mirror World Nodestone`)の `include.ftItem` は **初期値 true**(`RaffleCalculatorRoot.jsx` `initialBossSetting`)。
  - 共有画像は 装備+FT Item を「その他売却」1列に合算(LULU-124)。Box も装備としてここに入る。
- 裁定(LULU-144): **Web 側で分離**(サーバー・API 契約・`classificationVersion` は無変更)/ **FT Item はチェックを残し初期OFF** / **Box は専用チェック(初期ON)・結果表の専用列・共有画像の「Box」列**。

## 1. スコープ

触るファイル:
- 新規 `exp_ranking/web/src/raffle/domain/boxDrops.js` + `boxDrops.test.js`
- `exp_ranking/web/src/raffle/domain/settlement.js` + `settlement.test.js`(`BOX` カテゴリ追加)
- `exp_ranking/web/src/raffle/RaffleCalculatorRoot.jsx`(再分類の適用・Box チェック・FT 初期OFF・売却欄の対象判定)
- `exp_ranking/web/src/raffle/SettlementResult.jsx`(Box のカテゴリ合計行・メンバー列)
- `exp_ranking/web/src/raffle/shareImage.js` + `shareImage.test.js`(Box 列)
- `exp_ranking/web/src/raffle/uiText.js` / `uiText.test.js`(必要な場合のみ)
- `exp_ranking/web/src/i18n/locales/{ja,en,es,th,vi,zh-TW}.json`(`raffle.item_box` ほか新キーを **6ロケール同時**)

触らないもの: `server/` 全体 / `domain/contract.js`(`DROP_CATEGORIES` 含む。**API 応答の検証は従来どおり EQUIPMENT のまま受ける**)/ `domain/partyClears.js` / `integrations/` / `storage/`(売却価格キャッシュは dropId キーなので無変更で引き継がれる)/ `package.json`

## 2. 仕様

### 2.1 再分類(純粋関数)
- `boxDrops.js` に `RING_BOX_NAME_SUFFIX = "Ring Box"` と `isRingBoxDrop(drop)`(`category === "EQUIPMENT"` かつ `name.trim().endsWith("Ring Box")`。**大文字小文字はサーバーと同じく区別する**)、`reclassifyBoxDrops(clear)` を置く。
- `reclassifyBoxDrops` は clear を**変更せずコピーを返し**、該当 drop の `category` だけを `"BOX"` に置き換える。`dropId`・`name`・`quantity`・`imageUrl` は不変。
- 適用箇所は Root の `activeClear` 算出直後の1箇所のみ(`combineSelectedPartyClears` の結果に適用)。契約検証・キャッシュ保存は従来どおり EQUIPMENT のまま。

### 2.2 計算(`settlement.js`)
- `DROP_CATEGORIES` に `"BOX"` を追加。`include.box` で加算対象を判定。
- 行に `boxQuantity` / `boxSaleNeso` / `boxDrops`(`equipmentDrops` と同じ形: dropId・name・quantity・imageUrl・salePriceNeso・saleNeso)を追加。
- **5% 販売手数料を控除**(コイン・装備・FT と同一規則 LULU-090)。空欄=0(LULU-126)。
- `transferableNeso` に `boxSaleNeso` を加算(売却して得る NESO のため送金原資に含む)。
- 出力: `members[].boxQuantity/boxSaleNeso/boxDrops`、`categoryTotals.boxQuantity/boxSaleNeso`、トップレベル `boxDrops`(`equipmentDrops` と同様に memberId 付き)。
- 既存フィールドの意味・値は不変(Box が EQUIPMENT に来ない限り、既存入力の結果は1円も変わらない)。

### 2.3 画面(`RaffleCalculatorRoot.jsx` / `SettlementResult.jsx`)
- `initialBossSetting().include` に `box: true` を追加し、**`ftItem` を `false` に変更**。
- 「Box」チェックは **アクティブな clear に BOX drop が1件以上ある場合だけ**表示(FT Item の表示条件と同じ方式)。ラベル `raffle.item_box`。
- 売却価格入力一覧(`saleableDrops`)の対象判定に `BOX → include.box` を追加。表示形式は装備と同じ(取得者名 — 名前 × 数量 / 売却価格 / 控除後受取額)。
- `SettlementResult` のカテゴリ合計に Box 行(`include.box` 時)、メンバー別に Box 列(装備と同じアイコン+控除後額表示)。

### 2.4 共有画像(`shareImage.js`)
- 「Box」列を新設(キー `box`、ラベル `raffle.item_box`)。値=`boxSaleNeso`。**全員0なら列を描かない**(LULU-127 の規則に合わせる)。
- 「その他売却」= `equipmentSaleNeso + ftItemSaleNeso` のまま(Box はここから外れる)。
- 列順: コイン → Box → その他売却(他の列の順序は不変)。

## 3. 変わってよいもの・いけないもの

- 変わってよい: Ring Box の表示位置(装備 → Box)、FT Item の初期チェック(ON → OFF)、共有画像の列(Box 列の追加。全員0なら非表示)。
- 変わってはいけない: API 応答の検証・キャッシュ・サーバー / Box・FT 以外の全カテゴリの計算値 / 端数配分・送金ペアリング・持ち越し / 既存の売却価格キャッシュの引き継ぎ(dropId 不変)。

## 4. 受け入れ基準(数値)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | raffle 配下テスト | 全緑(失敗0) | `cd exp_ranking/web && npx vitest run src/raffle` |
| 2 | web 全体テスト | 失敗は既存の `src/sfhistory/domain/format.test.js` の5件(Intl 環境依存・本計画と無関係、統括が着手前に確認)以外0 | `npx vitest run` |
| 3 | ビルド | 成功 | `npm run build` |
| 4 | 再分類 | `Rank 3 Special Skill Ring Box`(EQUIPMENT)→ BOX、`Arcane Umbra Archer Gloves` → EQUIPMENT のまま、`ring box`(小文字)→ EQUIPMENT、入力 clear が不変(deep-freeze で検証) | `boxDrops.test.js` |
| 5 | Box 計算 | 売却価格 10,000,000 の Box → `boxSaleNeso = 9,500,000`、`transferableNeso` に同額加算、`include.box=false` で 0 | `settlement.test.js` |
| 6 | 既存値の不変 | Box を含まない既存 fixture の `calculateSettlement` 出力が、新フィールド以外で変更前と完全一致 | 既存テストが無修正で緑 + 追加の比較テスト |
| 7 | 初期値 | `include.box === true` / `include.ftItem === false` | Root の初期設定(単体テストか実機) |
| 8 | 共有画像 | Box 列: 全員0なら非表示 / 1人でも非0なら表示。最大構成(全カテゴリ+FT+Box+持ち越し+6人)でキャンバス幅 1200px 以内・文字の重なり0 | `shareImage.test.js` + 実レンダリング確認 |
| 9 | i18n | 新キーが6ロケールすべてに存在(キー集合が一致) | 既存のロケール整合テスト or `grep -c` |
| 10 | 範囲外ファイル | `server/`・`contract.js`・`package.json` の差分 0 行 | `git diff --stat origin/main -- server exp_ranking/web/src/raffle/domain/contract.js exp_ranking/web/package.json` |

## 5. 停止条件

- 計画と実コードの構造差(行番号ズレ以上)、または受け入れ基準の未達が2回の試行で解消しない
- スコープ外ファイル(特に `server/`・`contract.js`・`storage/`)を触る必要が生じた
- 共有画像が最大構成で 1200px に収まらず、列の削減・統合などの**レイアウト判断**が必要になった(推奨案を付けて報告)
- 既存テストの期待値を書き換えないと緑にならない(FT 初期OFF に起因するものは除く。その場合は該当テスト名を報告に列挙)

## 6. コミット分割

1. `feat(raffle): add BOX drop category to settlement`(domain のみ: `boxDrops.js`・`settlement.js` とテスト。UI 未接続=画面挙動不変)
2. `feat(raffle): separate Ring Box from equipment and default FT Item off`(Root・SettlementResult・6ロケール)
3. `feat(raffle): add Box column to share image`(shareImage とテスト)

## 7. 検証コマンド

```
cd exp_ranking/web && npx vitest run src/raffle && npx vitest run && npm run build
git diff -w -- <touched files>
```

ローカル実機: `npm run dev`(API 停止中のため、Box を含む表示確認は fixture API か、`settlement`/`shareImage` テストのフィクスチャで行う。後続のマニュアルモード完成後はそちらでも確認する)。

## 8. ロールバック

各コミット単独 revert 可。1 を revert する場合は 2・3 も revert(2・3 は 1 の出力フィールドを参照)。サーバー・契約は無変更のため、デプロイ順序の考慮(LULU-122)は不要。

## 9. 完了報告テンプレ

- 実施コミット(ハッシュ):
- 受け入れ基準 1〜10 の実測値:
- 書き換えた既存テスト(あれば名前と理由):
- 共有画像の最大構成スクリーンショットの所見(幅・重なり):
- 残課題・watch-item:
