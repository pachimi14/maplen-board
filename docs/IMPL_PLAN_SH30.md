# IMPL_PLAN_SH30 — 名称を Enhance History に / Dreamy Belt を追加

前提: SH-29 完了・統括検収済。**ユーザー指示 2026-08-06**(身内フィードバック起点)。

## 0. 2つの変更

| # | 内容 |
|---|---|
| A | **ナビとページ見出しを `Enhance History` に**(全言語共通の英語表記) |
| B | **Dreamy Belt(`1132308`)を SF 履歴の対象に追加** |

## 1. A — 名称変更

### 1-1 理由(ユーザー)

> ナビのタイトルが日本語では SF履歴 になっている。ここは全言語統一で英語表記のはず。
> また、**いずれキューブ価格にも対応する可能性がある**。

- 既存ナビ(`EXP Ranking` / `Task Manager`)は**全言語で英語のまま**。**SF履歴だけ翻訳されていたのが不整合**
- 「SF」に限定した名前は、**将来キューブ価格を扱うときに嘘になる**

### 1-2 変更対象

- **ナビのラベル** → `Enhance History`(**6ロケールとも同じ英語文字列**)
- **ページ見出し**(`sfhistory.pageTitle`)→ `Enhance History`(**6ロケールとも**)

**変更しないもの**:
- ルート `#/starforce`(**URL は変えない**。身内に配布済み)
- ページ説明文(`pageDescription`)の翻訳(**中身の説明なので各言語のまま**)
- 他のナビ項目

## 2. B — Dreamy Belt の追加

### 2-1 ★maplenEnhancebot には触らない(ユーザー裁定)

Dreamy Belt は maplenEnhancebot の `PARTS_BY_LEVEL["RANGE_200_TO_209"]` から
**理由付きで意図的に除外**されている:

```python
# GS-263: BELT (Dreamy Belt 1132308) deliberately excluded - high price,
#         no liquidity (matches the GS-257 decision to drop it from preset candidates too)
```

**ユーザー裁定 = 「SF履歴だけに追加」。**
∴ **あちらの `priority_equipment.py` は1バイトも変えない。**
GS-257 / GS-263 の判断(換装候補として薦めない)は**そのまま残る**。

> **理由の整理**: 「換装候補として薦める」ことと「価格推移を見られるようにする」ことは**別の要件**。
> 高額・流通が無い装備でも、**履歴を見たい**という要求は成り立つ。

### 2-2 実装

SH-22 で作った **`ADDITIONAL_ITEM_IDS`** に `1132308` を足す(Magic Eyepatch / Berserked と同じ手法)。

- **理由をコメントに残す**(GS-257/263 との関係を明記。「黙って足した」にしない)
- **名前・alias はカタログから引く**(ハードコードしない)
- `maxStar` は**バックフィル後にデータから導出**される

### 2-3 バックフィル

**統括が実行する**(実装担当は実行しない。DB への同時書き込みを避けるため)。
`1132308` × 22段階 = **22リクエスト**。

## 3. スコープ

**変更してよい**:
- `exp_ranking/web/src/i18n/locales/*.json`(**6ロケール同時**)
- `server/sf-history/scripts/gen_item_list.py`
- `server/sf-history/data/sf_history_items.json`(再生成。**コミットする**)
- `server/sf-history/tests/` / `README.md`
- `docs/reports/SH30_ENHANCE_HISTORY.md`

**触らないもの**(1つでも触れたら停止):
- **`C:\Users\pachi\Desktop\maplenEnhancebot` は読み取り専用**(**1バイトも書かない**)
- **ルート `#/starforce`**(URL を変えない)
- `server/sf-history/app.py` の**応答の形**(**契約テストが緑のまま**)
- `aggregate.py` / `schema.sql` / `db.py` / `fetch_latest.py` / `scripts/{update,backfill}.py` の**ロジック**
- **既存30件の内容**(`maxStar` / `aliases` / 順序)
- SH-7〜SH-29 の性質すべて
- `src/App.jsx` / `src/board/` / `src/pages/` / `src/taskManager/` / `package.json` / **VPS** / **元ツリー**

## 4. 受け入れ基準

- **(a)** ナビとページ見出しが **6ロケールとも `Enhance History`**
- **(b)** ルートが **`#/starforce` のまま**(変わっていない)
- **(c)** ページ説明文は**各言語の翻訳のまま**(英語化していない)
- **(d)** `sf_history_items.json` の `items` が **31件**。`1132308` が含まれる
- **(e) ★既存30件が1バイトも変わらない**(`git diff -w` で `generatedAt` 以外の差分ゼロ)
- **(f)** `1132308` の名前と alias が**カタログ由来**(実測値を報告)
- **(g) ★maplenEnhancebot への書き込みゼロ**(`git status` で確認して報告)
- **(h)** `pytest` 全緑 / **契約テスト緑** / `npm run test` 全緑 / `npm run build` 成功
- **(i)** 6ロケールのキー数一致
- **(j)** SH-7〜SH-29 の性質維持

## 5. 停止条件

1. **(e) が崩れる**(既存30件の内容が変わる)
2. カタログに `1132308` が見つからない、または想定と違うグループだった
3. **ルートを変えないと名称変更ができない**
4. §3 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 6. コミット

- **ローカルコミット2本**(A 名称 / B 追加)。**単独 revert 可**。
- **`git push` は行わない**。**`git add -A` 禁止**。

## 7. 完了報告テンプレ

```
## SH-30 完了報告
- コミット: <hash>(各1行要約)
- (a) 6ロケールの表示文字列
- (b) ルートが #/starforce のまま
- (c) 説明文が翻訳のまま
- (d) items 31件 / 1132308 の内容
- (e) ★既存30件の差分ゼロ
- (f) カタログ由来の名前・alias
- (g) ★maplenEnhancebot への書き込みゼロ
- (h) pytest / 契約 / npm test / build
- (i) 6ロケールのキー数
- (j) SH-7〜SH-29 の性質維持
- ★統括が実行するバックフィルのコマンド
```
