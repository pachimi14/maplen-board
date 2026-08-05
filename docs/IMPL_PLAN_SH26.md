# IMPL_PLAN_SH26 — 初期表示の装備を Arcane Umbra Staff にする

前提: SH-25(プレオープン公開)完了。**ユーザー指示 2026-08-06**:
> デフォルトで開く装備を arcane umbra staff に変えて欲しい。

## 0. 現状

`SfHistoryRoot` は装備一覧の**先頭(`items[0]`)**を初期選択している。
`/sf-history/equipment` の並びは装備リスト JSON の順(代表 itemId 順)なので、
**意図して選ばれた装備ではない**。

## 1. 変更内容

**初期選択を `1382265`(Arcane Umbra Staff)にする。**

- **定数として名前付きで持ち、理由をコメントに残す**(「なぜこの装備か」が後から分かるように)
- **一覧に無い場合は従来どおり `items[0]` にフォールバック**する
  (将来リストから外れても**画面が壊れない**こと。**停止せず穏当に劣化する**)
- 初期の星範囲は従来どおり `defaultPresetForMaxStar(maxStar)` に任せる(**変えない**)

## 2. スコープ

**変更してよい**:
- `exp_ranking/web/src/sfhistory/SfHistoryRoot.jsx`
- `exp_ranking/web/src/sfhistory/domain/*.js`(**初期選択を純粋関数に切り出す場合のみ**)
- 対応する `*.test.js`
- `docs/reports/SH26_DEFAULT_ITEM.md`

**触らないもの**(1つでも触れたら停止):
- `server/` 配下すべて(**API の並び順を変えない**)
- `src/sfhistory/starforce.js` / 統計・ヒートマップの算出
- **装備の検索・並び順(SH-14 の `localeCompare` 昇順)**
- SH-7〜SH-25 の性質すべて
- `src/App.jsx` / `src/board/` / `src/pages/` / `src/components/` / `src/taskManager/` / `src/i18n/`
- `package.json` / **VPS** / **元ツリー**

## 3. 受け入れ基準

- **(a)** 初期表示が **Arcane Umbra Staff(`1382265`)**
- **(b)** 初期の星範囲が `maxStar`(=22)に対して妥当(**不正な範囲で開かない**。SH-5 の性質)
- **(c) フォールバック**: 一覧に `1382265` が無い場合、`items[0]` が選ばれる。**テストで固定**
- **(d)** 検索候補の並び(`localeCompare` 昇順)は**変わらない**
- **(e)** `npm run test` 全緑 / `npm run build` 成功 / **`server/` の差分ゼロ**
- **(f)** SH-7〜SH-25 の性質維持

## 4. 停止条件

1. 初期選択を変えると SH-5 の「不正な星範囲で開かない」性質が崩れる
2. `server/` の並び順を変えないと実現できない
3. §2 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 5. コミット

- **ローカルコミット1本**。**`git push` は行う**(プレオープン中はリモートを最新に保つ。
  **ただし `main` にはマージしない**)。**`git add -A` 禁止**。

## 6. 完了報告テンプレ

```
## SH-26 完了報告
- コミット: <hash>
- (a) 初期表示の装備
- (b) 初期の星範囲
- (c) フォールバックのテスト
- (d) 検索候補の並びが不変
- (e) npm test / build / server 差分ゼロ
- (f) SH-7〜SH-25 の性質維持
```
