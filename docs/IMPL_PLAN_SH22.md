# IMPL_PLAN_SH22 — Magic Eyepatch / Berserked を履歴対象に追加

前提: SH-21 完了・統括検収済(`112ee21`)。**ユーザー指示 2026-08-05**。

## 0. 背景

ユーザーから「Magic Eyepatch が入っていない」と指摘。統括が VPS の SF キャッシュ bot の
実リストを取得して照合した結果:

- **bot のリスト(30件)と SF 履歴(28件)の差は、ユーザーが原案で除外指定した
  `1113282`(Noble Ifia's Ring)/ `1122254`(Mechanator Pendant)の2件だけ**。
  リストの出どころは同じ関数(`load_priority_representative_item_ids()`)
- **Magic Eyepatch は bot のリストにも入っていない**。
  maplenEnhancebot の `priority_equipment.py` の `EXCLUDED_REPRESENTATIVE_ITEM_IDS` で除外されている
  (`1003622` Black Bean Hat / `1052527` Black Bean Suit / `1012632` Berserked /
  `1022278` Magic Eyepatch / GS-263 の3件)

**ユーザー裁定**: **Magic Eyepatch(`1022278`)と Berserked(`1012632`)を SF 履歴の対象に追加する。**

### 0-1 ★maplenEnhancebot は触らない

あちらの除外は GS-263 の需要実測に基づく判断を含む**別プロジェクトの台帳案件**。
**SF 履歴が欲しい装備と、SF キャッシュを温める装備は別の要件**なので、
**本リポ側で追加指定する**形にする。

## 1. 追加する2件(カタログ実測)

```
1022278  Magic Eyepatch  RANGE_160_TO_169 / EYE_ACC   / BOSS_PITCHED_BOSS_SET  (単独グループ)
1012632  Berserked       RANGE_160_TO_169 / FOREHEAD  / BOSS_PITCHED_BOSS_SET  (単独グループ)
```

どちらも**グループ内が自分1件のみ**(別名なし)。

## 2. スコープ

**変更してよい**:
- `server/sf-history/scripts/gen_item_list.py`
  — **priority から導出したうえで、明示的な「追加リスト」を足せる**ようにする
- `server/sf-history/data/sf_history_items.json`(再生成。**コミットする**)
- `server/sf-history/tests/` / `README.md`
- `docs/reports/SH22_ADD_PITCHED_ACC.md`

**触らないもの**(1つでも触れたら停止):
- **`C:\Users\pachi\Desktop\maplenEnhancebot` は読み取り専用**(**1バイトも書かない**)
- `server/sf-history/app.py` の**応答の形**(契約テストが守っている。フィールドを増やさない)
- `aggregate.py` / `schema.sql` / `db.py` / `fetch_latest.py` / `scripts/update.py` / `scripts/backfill.py`
  の**ロジック**(対象リストを読む口は変えない)
- **既存28件の内容**(`maxStar` / `aliases` / 順序)
- `exp_ranking/web/` 配下すべて(**フロントは変更不要のはず**)
- SH-7〜SH-21 の性質すべて / `package.json` / **VPS** / **元ツリー**

## 3. 実装

### 3-1 追加リストの持ち方

`gen_item_list.py` に**明示的な追加指定**を持たせる。
maplenEnhancebot の `EXTRA_PRIORITY_GROUPS` と同じ流儀(**理由をコメントで残す**):

```python
# SH-22 (2026-08-05, ユーザー指示): maplenEnhancebot の priority からは
# EXCLUDED_REPRESENTATIVE_ITEM_IDS で除外されているが、SF 履歴では見たい2件。
# 除外の理由はあちらのコードにコメントが無く追えない(GS-263 の3件とは別)。
# SF 履歴が欲しい装備と SF キャッシュを温める装備は別要件、という整理で本リポ側に持つ。
ADDITIONAL_ITEM_IDS = { 1022278, 1012632 }
```

- **名前・グループ内 alias はカタログから引く**(ハードコードしない)
- **除外(`1113282` / `1122254`)との整合**: 追加と除外が衝突しないことを確認

### 3-2 バックフィル

追加2件 × 22段階 = **44リクエスト**。
**`scripts/backfill.py` を使う**(既存の再開機構で、既に done の組み合わせはスキップされるはず)。

- **統括が実行する**(実装担当は実行しない。DB への同時書き込みを避けるため)
- 実装担当は**コマンドを報告に書く**こと

## 4. 受け入れ基準

- **(a)** `sf_history_items.json` の `items` が **30件**。追加2件が含まれる
- **(b) ★既存28件が1バイトも変わらない**(`git diff -w` で、追加分以外の差分がゼロ)
- **(c)** 追加2件の `aliases` がカタログ由来(それぞれ自分1件のみのはず。実測値を報告)
- **(d)** `maxStar` は**バックフィル後にデータから導出**されるので、
  この時点では**未取得であることを前提にした値**になる。
  **どう扱ったかを報告**(取得後に再生成が要るなら、その手順も)
- **(e)** `pytest` 全緑 / **契約テストが緑**(応答の形を変えていない)
- **(f)** `npm run test` 全緑 / `npm run build` 成功(フロント無変更のはず)
- **(g)** maplenEnhancebot に**書き込みゼロ**(`git status` で確認して報告)
- **(h)** SH-7〜SH-21 の性質維持

## 5. 停止条件

1. **(b) が崩れる**(既存28件の内容が変わる)
2. カタログに `1022278` / `1012632` が見つからない、または想定と違うグループだった
3. 追加リストを持たせるのに `backfill.py` / `update.py` のロジック変更が要る
4. §2 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 6. コミット

- **ローカルコミット1〜2本**(生成スクリプト / 再生成した JSON)。
- **`git push` は行わない**。**`git add -A` 禁止**。

## 7. 完了報告テンプレ

```
## SH-22 完了報告
- コミット: <hash>
- (a) items 件数と追加2件
- (b) ★既存28件の差分ゼロ
- (c) 追加2件の alias 実測
- (d) maxStar の扱い / 取得後の再生成手順
- (e) pytest / 契約テスト
- (f) npm test / build
- (g) maplenEnhancebot への書き込みゼロ
- (h) SH-7〜SH-21 の性質維持
- ★統括が実行すべきバックフィルのコマンド
```
