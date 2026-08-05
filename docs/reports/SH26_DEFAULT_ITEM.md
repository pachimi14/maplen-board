# SH-26 — 初期表示の装備を Arcane Umbra Staff にする

実施: 2026-08-06 / 実装担当

**ユーザー指示**: デフォルトで開く装備を Arcane Umbra Staff に変えて欲しい。

## 1. 変更

`SfHistoryRoot` の equipment-load 完了時、これまで装備一覧の
**先頭(`items[0]`)** を初期選択していた(= API 応答順に依存した、意図しない選択)。

`exp_ranking/web/src/sfhistory/domain/series.js` に

- `DEFAULT_INITIAL_ITEM_ID = 1382265`(Arcane Umbra Staff。理由をコメントに記載)
- `selectInitialItem(items)` — `DEFAULT_INITIAL_ITEM_ID` を優先し、無ければ `items[0]`
  にフォールバックする純粋関数

を追加し、`SfHistoryRoot.jsx` の `const first = result.items[0]` を
`const first = selectInitialItem(result.items)` に置き換えた。

星範囲の初期値(`defaultPresetForMaxStar(first.maxStar)`)の呼び出し方は不変。

## 2. 実データでの裏取り

ローカル API(`http://127.0.0.1:8785/sf-history/equipment`)で
`itemId=1382265` が実在し、`itemName="Arcane Umbra Staff"`、`maxStar=22`
であることを確認済み(この装備がグループの代表 itemId)。

## 3. 受け入れ基準

- **(a)** 初期表示が Arcane Umbra Staff(`1382265`) — 実データで実在確認、
  `selectInitialItem` のテストで固定
- **(b)** 初期の星範囲は従来どおり `defaultPresetForMaxStar(maxStar)` に委譲。
  呼び出し箇所・引数とも無変更(SH-5 の「不正な星範囲で開かない」性質は不変)
- **(c)** フォールバック: `DEFAULT_INITIAL_ITEM_ID` が一覧に無い場合 `items[0]` を返す
  ことを `series.test.js` で固定(2ケース: 複数件時 / 単一件時)
- **(d)** 検索候補の並び(`equipmentSearch.js` の `localeCompare` 昇順)は無変更
  (このファイルは今回一切触っていない)
- **(e)** `npm run test`: 43 files / **450 tests 全緑**。`npm run build`: 成功
  (6.25s、既存の chunk サイズ警告のみ、エラーなし)。`server/` 差分ゼロ
  (`git diff --stat server/` 出力なし)
- **(f)** SH-7〜SH-25 のテストは今回のスイート実行にすべて含まれ全緑
  (個別に削除・改変していない)
