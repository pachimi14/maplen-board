# IMPL_PLAN — 装備分類バグ修正 + Will FT Item カテゴリ + 共有画像の持ち越し表示

> 状態: 統括承認済み(ユーザー報告 2026-08-20)
> ブランチ: `raffle/drop-classification`(origin/main 起点・コミットする・push しない)
> 前提: **サーバー変更を含む**(反映時に VPS raffle-api 更新+再起動が必要)

## 0. 調査結果(統括が本番実データで確定 — debug-strategy 準拠)

**症状**: 「装備のドロップ分が読み込まれず売却価格入力欄が出ない」。実データ(pachimi / 2026-08-20 回)で確認すると、`Nightfall Shroud Weapon` / `AbsoLab Knight Suit` / `Trixter Ranger Pants` / `Odile Ballet Slippers` など**明白な装備が全件 `OTHER`** に分類されていた。**方向=全件漏れ(100%)**、スコープ=EQUIPMENT 分類のみ(NESO / COIN / POWER_CRYSTAL は実データで正常動作を確認)。

**直接原因**: `normalizer.py:_classification` が `tier0 == "Equipment"` のときだけ EQUIPMENT を返すが、**公式メタデータに `"Equipment"` という tier0 は存在しない**。VPS メタデータキャッシュ全236件の実測語彙は:

| tier0 | tier1 | 件数 | 内容 |
|---|---|---:|---|
| `Item` | `Decoration` | 114 | アウトフィット類(Nightfall Shroud Weapon 等) |
| `Item` | `Armor` | 64 | 防具(AbsoLab Knight Suit 等) |
| `Item` | `Utility` | 16 | ペット等 |
| `Item` | `Set-up` | 14 | 椅子等 |
| `Item` | `Weapon` | 12 | 武器(Fafnir Rapid Edge 等) |
| `Consumable` | `Exchange Currency` | 10 | Phantasma/Arachno/Florin/AbsoLab/Stigma 等 |
| `Consumable` | `ETC` | 4 | Power Crystal Coupon(10K/100K/1M/10M) |
| `Consumable` | `Voucher` | 2 | `Sealed Nodestone` / `Sealed Mirror World Nodestone` |

→ **EQUIPMENT 分岐は一度も成立したことがない死んだコード**。公開以来100%の装備が OTHER として分配対象外になっていた。

**構造原因**: 分類規則が実データの語彙と機械照合されていない。fixture は合成データ(`tier0="Equipment"`)で作られており、実APIの語彙を反映していなかった。

**検出原因(検証網の盲点)**: ①fixture が実語彙と不一致のためユニットテストは緑のまま ②装備は毎回出るとは限らず、E2E も「装備が出ない週」なら成立してしまう ③`classificationVersion` を持ちながら**実データ語彙との整合検査が存在しない**。

**クラス判定**: 「分類規則 × 実データ語彙の未照合」クラス。同クラスの残り3規則(NESO/COIN/POWER_CRYSTAL)は実データで成立を確認済み。**再発防止として、実データ由来 fixture 全件の分類期待値+未知語彙の検出**を機械検査に入れる(§F1-3)。

## F1. 装備分類の修正(サーバー)

- `_classification`: `tier0 == "Equipment"` → **`tier0 == "Item"`** で EQUIPMENT 判定(Armor/Weapon/Decoration/Utility/Set-up をすべて含む=マーケットで売却できるドロップ品全般)。UI ラベル「装備ドロップ」は既存のまま維持(利用者の呼称)
- `CLASSIFICATION_VERSION` を **2** へ更新(分類規則の変更。PR-003 の事前承認は本計画をもって取得済み)
- 既存の COIN / POWER_CRYSTAL / NESO 判定は**変更しない**(実データで正常動作を確認済み)

### F1-3. 再発防止(クラス網羅検査)

- VPS メタデータキャッシュ由来の**匿名化 fixture**を `testdata/raffle/v1/item-metadata-vocabulary.json` に追加(`itemId` / `itemName` / `tier0` / `tier1` のみ。ウォレット・キー・利用者情報を含まない公開ゲームデータ)
- テスト①: fixture 全件を `_classification` に通し、期待分類(EQUIPMENT / COIN / POWER_CRYSTAL / FT_ITEM / OTHER)と**全件一致**することを固定
- テスト②: fixture に現れる `(tier0, tier1)` の組が**既知の語彙集合に収まる**ことを検査。公式APIが新語彙を返し始めたら fixture 更新時に落ちる(語彙ドリフトの早期検出)

## F2. Will FT Item カテゴリの追加(サーバー+Web)

ユーザー要望: Will のとき `Sealed Mirror World Nodestone` を当選した人がいたら売却価格を入力したい。

- **識別**: アイテム名の**厳密一致** `Sealed Mirror World Nodestone`(itemId 2358010、`Consumable`/`Voucher`)。汎用の `Sealed Nodestone`(2358005、全ボスで出る)は**対象外**
- サーバー: `_classification` に `FT_ITEM` を追加(上記名の厳密一致のみ)。`_member_settlement` で **WILL のクリアのときだけ** `drops` に `{ category: "FT_ITEM", ... }` を追加(Lucid では従来どおり非対象)
- Web:
  - `ITEM_KEYS` に `ftItem` を追加。**チェックボックスは Will のクリアを選択中かつ該当ドロップが存在するときだけ表示**(Lucid では出さない)
  - 売却価格入力は既存の drops 機構をそのまま利用(当選者ごと・ドロップごと)
  - `settlement.js`: 現在 `drop.category === "COIN" ? include.coin : include.equipment` の二分岐を **COIN / FT_ITEM / EQUIPMENT の三分岐**へ。**5%販売手数料はコイン・装備と同じく控除対象**(マーケット売却のため。LULU-090 と同一規則)
  - カテゴリ別合計・メンバー別テーブル・共有画像・送金通知に反映(数量+売却控除後NESO の2段表示=コインと同形式)
- i18n: `raffle.item_ftItem`(ja「ウィルFT Item」他5言語)を6ロケール追加

## F3. 共有画像に持ち越しを表示(Web)

- `carryoverEnabled` のとき、共有画像のメンバーテーブルに**「前回持ち越し」「次回持ち越し」列**を追加(ブラウザのメンバー表と同じ値・同じ符号規則 `+`=受取 / `-`=支払)
- 無効時は列を出さない(現状どおり)
- 列追加で幅1200pxに収まらない場合は、カテゴリ列の幅配分を詰める(数値の欠落・重なりを作らない)

## 受け入れ基準(数値)

1. 実データ由来 fixture 236件で、`Item` 系220件が **EQUIPMENT**、`Sealed Mirror World Nodestone` が **FT_ITEM**、`Sealed Nodestone` が **OTHER**、Power Crystal Coupon 4件が **POWER_CRYSTAL**、対象2コインが **COIN**、Florin/AbsoLab/Stigma が **OTHER** に分類されることを全件固定
2. 未知の `(tier0, tier1)` が fixture に現れたらテストが落ちる(語彙ドリフト検出)
3. Will クリアで FT Item を当選したメンバーがいる場合、`ftItem` チェックと売却価格入力欄が表示され、控除後(×0.95)の額が当選総額・カテゴリ別合計・分配に反映される
4. Lucid クリアでは `ftItem` のチェック・入力欄が表示されない
5. 持ち越し有効時、共有画像に前回・次回持ち越しが表示され、**ブラウザのメンバー表と同一の値**になる
6. web 全テスト緑・raffle-api pytest 全緑・build 成功・6ロケールパリティ

## 変わってはいけない

- NESO / COIN / POWER_CRYSTAL の判定、5%手数料の率、PC除算方式、送金アルゴリズム、メンバー順正規化
- wallet のログ・キャッシュ非保存方針
- 新規npm依存 0

## 検証コマンド

```
cd server/raffle-api && python -m pytest -q
cd exp_ranking/web && npm run test
cd exp_ranking/web && npm run build
```

## ロールバック

F1/F2/F3 を分離コミットし単独 revert 可能にする。サーバーは旧ファイルを退避してから差し替える。
