# IMPL_PLAN — 報酬分類の実データ追随(Power Crystal直接付与 / Ring Box / 対象外の可視化)

> 状態: 統括承認済み(ユーザー報告 2026-08-27「またぱわくりが入ってない」「ring boxがラッフルに入ってない」)
> ブランチ: `raffle/multi-clear-same-count` に**積み増し**(同時デプロイのため)
> **サーバー+Web を変更**(反映時に VPS raffle-api 更新+再起動が必要)

## 0. 調査結果(統括が本番の**現在の開催回 2026-08-27** で確定)

※統括は当初 1週間古い回(08-20)を見ており、ユーザー指摘で是正した。以下はすべて現行回の実データ。

PT6人の本番ジョブを実行した結果:

- **`POWER_CRYSTAL` 分類が 0件**(COIN 33 / OTHER 187 / NESO 48 / EQUIPMENT 32)。全員 `pc=0`
- Ascendant 報酬に **`itemId 1000` が数量=パワクリ金額そのまま**(例: pachimi Eternal = `NESO 70,000,000` + `Item 1000 × 55,000,000`)で出現
- **`10M Power Crystal Coupon` 形式は今回1件も無い**(前回 08-20 は全員クーポン形式だった)
- `errors: item_metadata_unavailable (itemId 1000)` — itemId 1000 のメタデータ取得は **404 相当で失敗**。**NESO(itemId 1)も同様に失敗**することを実測 → 1000 は NESO と同じ「メタデータを持たない通貨系ID」
- `Rank 3 / Rank 7 Special Skill Ring Box` が **OTHER** として出現(分配対象外)

**結論**: 公式が **Power Crystal をクーポンアイテム方式から `itemId 1000` の直接付与方式へ変更**した。コードは名前パターン `^(\d+)([KM]?) Power Crystal Coupon$` でしか PC を認識しないため、**今回の回は PC が全く計上されない**。

**クラス判定**: LULU-119(装備 tier0)・LULU-130(Ascendantレイヤー改名)・Ring Box に続く **4例目**の「外部データ語彙 × コード期待値の不一致」。共通の検出原因は**分類から漏れた報酬がサイレントに消える**こと。

## 1. S1. Power Crystal の直接付与(itemId 1000)に対応(サーバー)

- `_classification`: **`item_id == 1000` → `("POWER_CRYSTAL", "Power Crystal")`**(メタデータ不要。NESO の `item_id == 1` と同じ扱い)
- PC 数量の算出を関数化 `_power_crystal_amount(prize, metadata)`:
  - `item_id == 1000` → **数量をそのまま加算**(額面1)
  - 名前が `^(\d+)([KM]?) Power Crystal Coupon$` に一致 → 数量 × 額面(**旧方式を維持**=過去回の再計算が壊れない)
  - それ以外 → 0
- `_member_settlement` の `power_crystal` 集計を上記関数経由へ
- `_positive_prize_item_ids`: **itemId 1000 をメタデータ取得対象から除外**(NESO と同様)。これにより `item_metadata_unavailable` の誤発火と無駄な上流呼び出しが消える

## 2. S2. Ring Box を売却対象(EQUIPMENT)に(サーバー)

ユーザー裁定=**Ring Box のみ追加**(`Sealed Nodestone` は従来どおり対象外)。

- `_classification` に規則追加: **`tier1 == "Voucher"` かつ アイテム名が `Ring Box` で終わる → `EQUIPMENT`**
  - tier で範囲を絞り無関係アイテムを巻き込まない。語尾一致で将来の `Rank 8 …` にも追随(リテラル完全一致を避ける=LULU-130 の教訓)
- `Sealed Mirror World Nodestone`(FT_ITEM)・`Sealed Nodestone`(OTHER)・その他規則は**不変**

## 3. S3. 分配対象外の報酬を可視化(fail-visible・本クラスの構造的対処)

4回連続で「分類漏れがサイレントに分配対象外」になったため、**その場で気づける導線**を作る。

- サーバー: 各 clear に **`excludedRewards`**(当該クリアで獲得したが分配対象外=OTHER の報酬 `{name, quantity}` 配列。同名は合算)を追加
- Web: 分配設定の項目チェック群の下に、対象外がある場合のみ1行表示
  「分配対象外の報酬: Sealed Nodestone ×2、…」(新規i18nキー・6ロケール)
- **警告(alert)ではなく情報表示**(Sealed Nodestone は毎回出るためアラート化はノイズ)

## 4. バージョンと再発防止

- `CLASSIFICATION_VERSION` を **3** へ(サーバー・Web 同時。デプロイ順序は LULU-122 の手順に従う)
- `testdata/raffle/v1/item-metadata-vocabulary.json` を**最新のVPSキャッシュ(311件)へ更新**し Ring Box 6件を含める
- 全件分類テストに追加: Ring Box 6件=**EQUIPMENT** / `Sealed Nodestone`=**OTHER** / `Sealed Mirror World Nodestone`=**FT_ITEM**
- **`itemId 1000` の分類・数量計上テスト**(メタデータ無しでも POWER_CRYSTAL になり、数量がそのまま加算される)
- **旧クーポン方式の回帰テスト**(`10M Power Crystal Coupon × 5` = 50,000,000)を残す

## 5. 受け入れ基準

1. 現行回の実データ相当(`Item 1000 × 55,000,000` を含む Ascendant 履歴)で **`powerCrystalAmount` が 55,000,000 になる**(従来は0)
2. 旧クーポン形式(`10M Power Crystal Coupon × 5`)が引き続き **50,000,000** になる(回帰なし)
3. Ring Box が EQUIPMENT として drops に出て**売却価格の入力欄が表示される**
4. `item_metadata_unavailable (itemId 1000)` が**発火しなくなる**
5. `excludedRewards` が payload に含まれ Web に表示される(対象外が無ければ非表示)
6. `CLASSIFICATION_VERSION` = 3 がサーバー・Web で一致
7. raffle-api pytest 全緑 / web テスト全緑 / build 成功 / 6ロケールパリティ

## 6. 変わってはいけない

- NESO/COIN/FT_ITEM/装備(tier0=Item)の判定、5%手数料、PC除算方式(表示レート)、送金アルゴリズム、Ascendant照合(LULU-130)、複数討伐対応(同ブランチのS1〜S3)
- wallet のログ・キャッシュ非保存方針 / 新規npm依存 0

## 7. 検証コマンド

```
cd server/raffle-api && python -m pytest -q
cd exp_ranking/web && npm run test
cd exp_ranking/web && npm run build
```
