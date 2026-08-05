# SH-22 完了報告 -- Magic Eyepatch / Berserked を SF 履歴対象に追加

計画: `docs/IMPL_PLAN_SH22.md`。前提: SH-21 完了・統括検収済(`112ee21`)。
ユーザー指示 2026-08-05「Magic Eyepatch が入っていない」→ 統括が VPS bot リストと
カタログを照合し、`1022278`(Magic Eyepatch)/ `1012632`(Berserked)の2件を
SF 履歴対象に追加することが確定。実施日: 2026-08-05。
ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## (a) items 件数と追加2件

`data/sf_history_items.json` の `items` は **30件**(旧28件 + 追加2件)。
追加2件は既存28件の**末尾に追記**(優先度セットとマージ・再ソートしない -- (b) を
「追加分以外の差分ゼロ」で機械的に確認できるようにするため、計画 §3-1 の指示どおり)。

```
1012632  Berserked
1022278  Magic Eyepatch
```

## (b) ★既存28件の差分ゼロ

```
$ git diff -w -- server/sf-history/data/sf_history_items.json
```

差分は次の3種のみ:
1. トップレベル `generatedAt`(再生成のたびに変わるタイムスタンプ。既存28件の内容ではない)
2. ファイル末尾への2エントリの**追記**(`+` のみ、`-` なし)
3. `sourceCommit` は **変化なし**(`a9f534b4d1292fd580780a22344198f46027ae38` のまま --
   maplenEnhancebot の HEAD がこのスライスの前後で動いていない)

既存28件本体(`itemId` / `itemName` / `aliasItemIds` / `maxStar` / `aliases`、
順序含む)は**1バイトも変わっていない**ことを diff で確認済み。

## (c) 追加2件の alias 実測

カタログ(`maplenEnhancebot/catalog/main_equipment.json`)を実測して確認:

```
1022278  Magic Eyepatch  RANGE_160_TO_169 / EYE_ACC   / BOSS_PITCHED_BOSS_SET  -- グループ内アイテム1件のみ(自分自身)
1012632  Berserked       RANGE_160_TO_169 / FOREHEAD  / BOSS_PITCHED_BOSS_SET  -- グループ内アイテム1件のみ(自分自身)
```

`gen_item_list.build_item_list()` の実行結果(実測):

```python
{'itemId': 1012632, 'itemName': 'Berserked', 'aliasItemIds': [1012632], 'maxStar': None,
 'aliases': [{'itemId': 1012632, 'itemName': 'Berserked'}]}
{'itemId': 1022278, 'itemName': 'Magic Eyepatch', 'aliasItemIds': [1022278], 'maxStar': None,
 'aliases': [{'itemId': 1022278, 'itemName': 'Magic Eyepatch'}]}
```

名前・alias とも**カタログ由来**(ハードコードなし)。これは、`item_catalog.load_catalog()` /
`item_catalog.build_item_to_representative_map()` が優先度フィルタ(`_group_matches_priority_rules`)
とは無関係に**カタログの全グループ**を無条件に読む実装だったため -- `EXCLUDED_REPRESENTATIVE_ITEM_IDS`
はあくまで `load_priority_representative_item_ids()`(=`representative_ids`)の絞り込みにのみ効き、
名前解決・alias 解決のための辞書 (`name_by_representative` / `representative_to_aliases`) はもともと
この2件を含んでいた。追加実装は「`representative_ids` に無いこの2件を、末尾から補ってループに乗せる」
だけで済んでいる(名前・alias の新規解決コードは書いていない)。

除外(`1113282` / `1122254`)との衝突なしも `assert ADDITIONAL_ITEM_IDS.isdisjoint(EXCLUDED_ITEM_IDS)`
で実行時に保証(テスト `test_build_item_list_includes_sh22_additions` でも確認)。

## (d) maxStar の扱い / 取得後の再生成手順

追加2件はまだバックフィルしていないため、`sf_price_history_hourly` にこの2件のデータが無く、
`_max_upgrade_by_item()` が返す辞書にキーが存在しない → 設計 §7.1 どおり **`maxStar: null`**
(既存の「DB にデータが無ければ null」ルールをそのまま適用しただけで、この2件向けの特別扱いは
していない)。

**バックフィル後に必要な手順**(統括が実行):

```bash
cd server/sf-history
python scripts/backfill.py                       # 追加2件分の欠損コンボを自動で拾う(再開機構)
python scripts/gen_item_list.py                   # data/sf_history_items.json を再生成
                                                    # -- 追加2件の maxStar が null から実データ由来の
                                                    #    値(6件の☆20キャップ組でなければ通常22)に更新される
git add server/sf-history/data/sf_history_items.json
git commit -m "..."                                # 再生成後の再コミットが必要(このコミットはまだ null 版)
# API 再起動(sf_history_items.json はプロセス起動時に読み込む想定 -- README 参照)
```

再生成後、既存28件は再び「差分ゼロ」のはず(バックフィルは新規2件のコンボしか書き込まないため、
既存28件の `max_upgrade_by_item` は変化しない)。この検証は統括のバックフィル実行後に
`git diff -w` で機械確認できる。

## (e) pytest / 契約テスト

```
$ python -m pytest tests/ -q
98 passed in 4.21s

$ python -m pytest tests/test_response_contract.py tests/test_app.py tests/test_gen_item_list.py -q
44 passed in 3.52s
```

契約テスト(`test_response_contract.py`)を含め全緑。応答の形(`app.py` のフィールド)は
未変更 -- 触っていない。

## (f) npm test / build

```
$ npm run test -- --run
Test Files  42 passed (42)
     Tests  442 passed (442)

$ npm run build
✓ built in 6.78s (成功、警告はチャンクサイズのみで既存のもの)
```

`exp_ranking/web/` 配下は無変更(`git status --porcelain` で確認済み。フロントの
ファイルに触っていない)。

## (g) maplenEnhancebot への書き込みゼロ

```
$ (cd C:\Users\pachi\Desktop\maplenEnhancebot && git status --porcelain)
```

出力は本タスク開始前と**完全に同一**(このセッションが開始する前から存在していた
未コミット差分・未追跡ファイルのみ。SH-22 の作業で新たに変わったものはゼロ)。

`__pycache__/item_catalog.cpython-312.pyc` / `__pycache__/priority_equipment.cpython-312.pyc`
のタイムスタンプも本タスク実行日(2026-08-05)より前(それぞれ 2026-06-23 / 2026-07-21)の
ままであることを確認 -- `gen_item_list.py` の `sys.dont_write_bytecode = True` が
このスライスでも効いており、`.pyc` の新規生成もゼロ。

## (h) SH-7〜SH-21 の性質維持

`app.py` / `aggregate.py` / `schema.sql` / `db.py` / `fetch_latest.py` /
`scripts/update.py` / `scripts/backfill.py` の**ロジックは無変更**(対象リストを読む口
=`data/sf_history_items.json` はそのまま)。触ったのは
`scripts/gen_item_list.py`(追加リストの導入)/ `data/sf_history_items.json`(再生成)/
`tests/test_gen_item_list.py`(件数・追加2件の検証)/ `README.md`(件数の記述更新のみ)。

## コミット

1. `<pending>` -- `feat(sh22): add Magic Eyepatch / Berserked to SF history target list`
   (`server/sf-history/scripts/gen_item_list.py` / `server/sf-history/data/sf_history_items.json` /
   `server/sf-history/tests/test_gen_item_list.py` / `server/sf-history/README.md` /
   `docs/reports/SH22_ADD_PITCHED_ACC.md` 新規)

`git push` は未実施。`git add -A` は使用していない(対象ファイルを個別 `git add`)。

## ★統括が実行すべきバックフィルのコマンド

```bash
cd server/sf-history
python scripts/backfill.py
```

追加2件 × 22段階(itemUpgrade 0..21)= **44リクエスト**。既存28件分は
`sf_history_backfill_progress` に `status='done'` で記録済みのため、再開機構により
自動でスキップされ、新規2件のコンボのみが処理される想定(コードの変更なし、
既存の再開ロジックがそのまま効く)。

実行後:

```bash
python scripts/gen_item_list.py
```

で `data/sf_history_items.json` を再生成(追加2件の `maxStar` が `null` から実データ由来の
値に更新される)。再生成後、**API プロセスの再起動が必要**(依頼文の起動手順参照)。
