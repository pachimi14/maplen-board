# SH-30 完了報告 -- 名称を Enhance History に / Dreamy Belt を追加

計画: `docs/IMPL_PLAN_SH30.md`。前提: SH-29 完了・統括検収済。
ユーザー指示 2026-08-06(身内フィードバック起点)。実施日: 2026-08-06。
ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## A -- 名称変更

### (a) 6ロケールの表示文字列

ナビラベル `app.openSfHistory` とページ見出し `sfhistory.pageTitle` を、
**6ロケールとも `"Enhance History"`** に統一(実測):

```
en / es / ja / th / vi / zh-TW  すべて:
  app.openSfHistory      = "Enhance History"
  sfhistory.pageTitle    = "Enhance History"
```

対象コンポーネント: `exp_ranking/web/src/components/BoardHeader.jsx`
(`{t("app.openSfHistory")}`、ナビリンク) /
`exp_ranking/web/src/sfhistory/SfHistoryRoot.jsx`
(`{t("sfhistory.pageTitle")}`、`<h1>` 見出し)。他に `document.title` /
`<Helmet>` 等でこの文字列を使っている箇所は無し(grep で確認)。

### (b) ルートは `#/starforce` のまま

`BoardHeader.jsx` のナビリンクは `<a href="#/starforce" ...>` --
このハードコードされた href 文字列自体は今回のコミットで**触っていない**
(t() の呼び出し先キーの値だけを変えた)。`git diff` の対象行に `href` は含まれない。

### (c) 説明文は各言語の翻訳のまま

`sfhistory.pageDescription` は6ロケールとも**無変更**(英語化していない)。
実測(先頭40文字):

```
en: "Pick a piece of gear and a star range to ..."
es: "Elige un equipo y un rango de estrellas  ..."
ja: "装備と強化範囲を選ぶと、期待強化費用の推移と、現在値が過去のどの水準かを確認でき ..."
th: "เลือกอุปกรณ์และช่วงดาวเพื่อดูการเปลี่ยนแ ..."
vi: "Chọn một trang bị và khoảng sao để xem c ..."
zh-TW: "選擇裝備與強化星數範圍，即可查看期望強化費用的走勢，以及目前價格在這段歷史中處於 ..."
```

`sfhistory.metaTitle` のようなページ独自の meta タイトルキーは存在しない
(grep で確認済み。og:title 等は EXP Ranking 側の `app.metaTitle` を使い回す設計で、
SF History ページはそれを持たない)。

## B -- Dreamy Belt(`1132308`)追加

### (d) items 31件 / 1132308 の内容

`server/sf-history/scripts/gen_item_list.py` を実行して
`data/sf_history_items.json` を再生成:

```
items: 31  excluded: 2  sourceCommit: a9f534b4d1292fd580780a22344198f46027ae38
```

追加された1件:

```json
{
  "itemId": 1132308,
  "itemName": "Dreamy Belt",
  "aliasItemIds": [1132308],
  "maxStar": null,
  "aliases": [{ "itemId": 1132308, "itemName": "Dreamy Belt" }]
}
```

`maxStar` はまだバックフィル前のため `null`(design §7.1 のルールどおり --
DB にデータが無ければ null。この1件向けの特別扱いはしていない)。
既存30件の末尾に**追記**(SH-22 の2件のさらに後ろ)。

### (e) ★既存30件の差分ゼロ

```
$ git diff -w -- server/sf-history/data/sf_history_items.json
```

差分は次のみ:
1. トップレベル `generatedAt`(再生成のたびに変わるタイムスタンプ)
2. ファイル末尾への1エントリの**追記**(`+` のみ、`-` なし)
3. `sourceCommit` は**変化なし**(`a9f534b4...`のまま -- maplenEnhancebot の
   HEAD がこのスライスの前後で動いていない)

既存30件本体(`itemId` / `itemName` / `aliasItemIds` / `maxStar` / `aliases`、
順序含む)は Python の構造比較でも1件ずつ突き合わせ、**1バイトも変わっていない**
ことを確認済み(`changed existing items: []`)。

### (f) カタログ由来の名前・alias(実測)

`maplenEnhancebot/catalog/main_equipment.json` を読み取り専用で実測:

```
1132308  Dreamy Belt  グループ内アイテム1件のみ(自分自身、alias なし)
```

`gen_item_list.build_item_list()` の実行結果(実測、上の (d) と同一)。
名前・alias とも**カタログ由来**(ハードコードなし) -- SH-22 の2件と同じ経路
(`item_catalog.load_catalog()` はカタログの全グループを無条件に読み、
`EXCLUDED_REPRESENTATIVE_ITEM_IDS`/`PARTS_BY_LEVEL` による優先度フィルタとは
無関係に名前・alias の辞書を持っている)。

除外(`1113282` / `1122254`)との衝突なしは
`assert ADDITIONAL_ITEM_IDS.isdisjoint(EXCLUDED_ITEM_IDS)` で実行時に保証、
テスト `test_build_item_list_includes_sh30_dreamy_belt_addition` でも確認。

### maplenEnhancebot 側の裁定(そのまま維持)

`maplenEnhancebot/priority_equipment.py` で Dreamy Belt が除外されている理由
(読み取りのみで確認、変更ゼロ):

```python
# GS-263 (2026-07-21): widened WEAPON-only -> +CAPE/GLOVES/SHOES (real Arcane Umbra groups
# 1102940/1082698/1073160). BELT (Dreamy Belt 1132308) deliberately excluded - high price,
# no liquidity (matches the GS-257 decision to drop it from preset candidates too).
"RANGE_200_TO_209": frozenset({"WEAPON", "CAPE", "GLOVES", "SHOES"}),
```

この判断(「換装候補として薦めない」)はそのまま残る。今回追加したのは
「価格推移を見られるようにする」という**別要件**への対応であり、
`gen_item_list.py` の `ADDITIONAL_ITEM_IDS` に足しただけ --
`priority_equipment.py` の `PARTS_BY_LEVEL` / `EXCLUDED_REPRESENTATIVE_ITEM_IDS`
はどちらも1行も変更していない(コメントで GS-257/GS-263 の関係を明記)。

## (g) ★maplenEnhancebot への書き込みゼロ

```
$ (cd C:\Users\pachi\Desktop\maplenEnhancebot && git status --porcelain)
```

出力は本タスク開始前と**完全に同一**(セッション開始前から存在していた
未コミット差分・未追跡ファイルのみ。SH-30 の作業で新たに変わったものはゼロ)。
`__pycache__/*.pyc` のタイムスタンプも本タスク実行日より前のまま
(`gen_item_list.py` の `sys.dont_write_bytecode = True` がこのスライスでも効いており、
`.pyc` の新規生成もゼロ)。

## (h) pytest / 契約 / npm test / build

```
$ python -m pytest tests/ -q          # server/sf-history/
103 passed in 4.44s

$ npm run test -- --run               # exp_ranking/web/
Test Files  43 passed (43)
     Tests  470 passed (470)

$ npm run build                       # exp_ranking/web/
✓ built in 6.34s(成功、警告は既存のチャンクサイズ警告のみ)
```

契約テスト(`test_response_contract.py`)含め pytest 全緑。`app.py` の応答の形は
未変更(触っていない)。`localeParity.test.js`(6ロケールのキー集合一致)も含め
フロント全緑。

## (i) 6ロケールのキー数

`localeParity.test.js` が6ロケールのフラット化キー集合の完全一致(過不足ゼロ)を
既存のリグレッションテストとして保証。今回のコミットは**既存キーの値を書き換えただけ**
(新規キーの追加・削除なし)のため、キー集合はコミット前後で不変。テスト結果は上の (h) の
とおり全緑。

## (j) SH-7〜SH-29 の性質維持

`app.py` / `aggregate.py` / `schema.sql` / `db.py` / `fetch_latest.py` /
`scripts/update.py` / `scripts/backfill.py` の**ロジックは無変更**。
`src/App.jsx` / `src/board/` / `src/pages/` / `src/taskManager/` /
`package.json` / VPS / 元ツリーにも触っていない。触ったのは
i18n ロケール6ファイル(A)、`scripts/gen_item_list.py` / `data/sf_history_items.json` /
`tests/test_gen_item_list.py` / `README.md`(B)、本報告書のみ。

## コミット

1. `<pending>` -- `i18n(sh30): unify SF history nav/heading label to "Enhance History"`
   (`exp_ranking/web/src/i18n/locales/{en,es,ja,th,vi,zh-TW}.json` -- A)
2. `<pending>` -- `feat(sh30): add Dreamy Belt to SF history target list`
   (`server/sf-history/scripts/gen_item_list.py` /
   `server/sf-history/data/sf_history_items.json` /
   `server/sf-history/tests/test_gen_item_list.py` /
   `server/sf-history/README.md` / `docs/reports/SH30_ENHANCE_HISTORY.md` 新規 -- B)

`git push` は未実施。`git add -A` は使用していない(対象ファイルを個別 `git add`)。

## ★統括が実行すべきバックフィルのコマンド

```bash
cd server/sf-history
python scripts/backfill.py
```

追加1件(Dreamy Belt, `1132308`)× 22段階(itemUpgrade 0..21)= **22リクエスト**。
既存30件分は `sf_history_backfill_progress` に `status='done'` で記録済みのため、
再開機構により自動でスキップされ、新規1件のコンボのみが処理される想定
(コードの変更なし、既存の再開ロジックがそのまま効く)。

実行後:

```bash
python scripts/gen_item_list.py
```

で `data/sf_history_items.json` を再生成(Dreamy Belt の `maxStar` が `null` から
実データ由来の値に更新される)。再生成後、既存30件+SH-22の2件は再び「差分ゼロ」のはず
(バックフィルは新規1件のコンボしか書き込まないため)。**API プロセスの再起動が必要**
(`sf_history_items.json` はプロセス起動時に読み込む想定)。
