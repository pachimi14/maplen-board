# IMPL_PLAN_SH46 — Enhance History 系ページの読み込み改善

前提: SH-45 完了(未 push)。**作業ツリー**: `C:\Users\pachi\Desktop\msu ranking`(`main`)。

**ユーザー指示 2026-08-22**:
> SF の読み込みが非常に長いのは何か理由がある? 改善は難しい?
> → 統括が実測して原因を提示。**「読み込み改善まで終えてから公開」と裁定**。

## 0. ★統括が本番で実測した内訳

```
DOMContentLoaded          574ms
index.js                  362KB / 291ms
rankings.json           1,399KB / 622ms   ← ★EXPランキングのデータ
shard-51.json             165KB / 235ms   ← ★同上
/sf-history/equipment              647ms   (644 → 1,291)
/sf-history/prices                 509ms   (1,427 → 1,936)  ← equipment 完了後に開始
/sf-history/latest                  34ms
```

| # | 事実 |
|---|---|
| L1 | **API は速い**(`prices` 509ms / 85KB gzip)。**サーバーは原因ではない** |
| L2 | **期待値の計算も速い**(900点で **34ms**、統括が実測)。**計算も原因ではない** |
| L3 | **`rankings.json` 1.4MB + `shard-51.json` 165KB を、SF のページでも読んでいる**。**不要** |
| L4 | 原因は `App.jsx:35` の `useBoard()` が**ルートに関係なく先頭で呼ばれている**こと |
| L5 | **`useRankingBoard(route)` は既に `route` を受け取っている**(`BoardContext.jsx:9`)。**判断できる場所がある** |
| L6 | `/equipment` → `/prices` が**直列**。初期装備は固定(SH-26)なので**待つ必要がない** |
| L7 | **`/equipment` が2回呼ばれている**(統括が実測) |

## 1. スコープ

| # | 内容 | 期待効果 |
|---|---|---|
| A | **Enhance History 系のルートでランキングデータを取得しない** | **1.5MB と 850ms が消える** |
| B | `/equipment` と `/prices` を**並列**に投げる | 約500ms |
| C | `/equipment` の**重複呼び出し**をやめる | 数百ms |

**A が圧倒的に効く。**B/C は A の後で測って判断してもよい。

## 2. A — ランキングデータを読まない

**対象ルート**: `starforce` / `starforceCubePrices` / `starforceDiscovery`
(**Task Manager 系は対象外**。あちらの現在の挙動を変えない)

### 2-1 ★壊してはいけないこと

- **`useBoard()` が返す他の値**(`t` / `route` / テーマ関連)は**従来どおり使える**こと。
  **ランキングデータの取得だけを止める**
- **ランキング画面(`#/`)に移動したら取得が走る**こと。
  **「一度スキップしたら二度と読まない」にしない**
- **Enhance History 系のページが `characters` / `meta` を参照していない**ことを確認する。
  参照していたら**止めて報告**(未定義参照で壊れる)
- **`loading` の扱い**: ランキングを読まないルートで `loading` が真のまま
  張り付かないこと(**画面が「読み込み中」で止まらない**)

### 2-2 ★「速くなった」を数字で示す

**改善前後を同じ方法で実測して報告すること。**
最低限、**`rankings.json` と `shard-51.json` が SF のページで要求されない**ことを示す。

## 3. B — 並列化

`/equipment` の完了を待たずに `/prices` を投げる。

- **初期装備は `DEFAULT_INITIAL_ITEM_ID`(SH-26)で固定**なので、
  **`/equipment` を待たなくても itemId が分かる**
- **★ただし SH-26 の性質を壊さないこと**: `DEFAULT_INITIAL_ITEM_ID` が
  一覧に無い場合は `items[0]` にフォールバックする。**この場合は先読みが無駄になるが、
  画面は正しく `items[0]` を表示する**こと(**先読みの結果を誤って表示しない**)
- **引き継ぎ(SH-42)がある場合はそちらが優先**。**先読みが引き継ぎを上書きしない**こと

**難しいと判断したら B は見送ってよい**(A だけでも目的は達する)。**その判断を報告すること。**

## 4. C — 重複呼び出し

`/equipment` が2回呼ばれている原因を特定して1回にする。

- **原因を報告すること**(React の StrictMode による二重実行なら、
  **開発時のみの現象で本番には無い**可能性がある。**本番ビルドで実測して判断**する)

## 5. スコープ(ファイル)

**変更してよい**:
- `exp_ranking/web/src/board/useRankingBoard.js` / `BoardContext.jsx`
- `exp_ranking/web/src/App.jsx`(**必要最小限**)
- `exp_ranking/web/src/sfhistory/`(B/C に必要な範囲)
- 各テスト / `docs/reports/SH46_*.md`

**触らないもの**(1つでも触れたら停止):
- **`server/` 配下すべて**
- **ランキング画面・Task Manager・Raffle の挙動**(**回帰ゼロ**)
- **SH-26 の初期選択** / **SH-42 の引き継ぎ**
- **統計・チャート・ヒートマップの算出**
- **ルート3つ** / **契約テストの厳格さ**
- `src/pages/` / `src/components/` / `src/taskManager/` / **raffle 関連すべて**
- `package.json` / **VPS**

## 6. 受け入れ基準

- **(a) ★SF / Cube / New Equipment のページで `rankings.json` と `shard-51.json` が要求されない**。
  **実測(リクエスト一覧)で報告**
- **(b) ★ランキング画面(`#/`)では従来どおり取得される**。**実測で報告**
- **(c)** SF → ランキング と移動したときに**取得が走る**(遅延取得が機能する)
- **(d)** ランキングを読まないルートで **`loading` が張り付かない**
- **(e)** Enhance History 系が `characters` / `meta` を**参照していない**ことの確認結果
- **(f)** B を実施した場合: **SH-26 の初期選択と SH-42 の引き継ぎが不変**。
  見送った場合はその**判断理由**
- **(g)** C: 原因の特定結果。**本番ビルドでの実測**
- **(h) ★改善前後の実測**(リクエスト数・転送量・時間)
- **(i)** `npm run test` 全緑 / `npm run build` 成功 / **`server/` の差分ゼロ**
- **(j) ★ランキング画面・Task Manager の回帰ゼロ**

## 7. 停止条件

1. **Enhance History 系が `characters` / `meta` を参照していた**(→ 止めて報告)
2. **取得を止めると `loading` や他の値が壊れる**
3. §5 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 8. コミット

- **A / B / C を別コミット**(単独 revert 可)。**`git push` 禁止**。**`git add -A` 禁止**。

## 9. 完了報告テンプレ

```
## SH-46 完了報告
- コミット: <hash>(各1行)
- (a) ★SF 系で ranking を読まない(実測)
- (b)(c)(d) ランキング画面では読む / 遅延取得 / loading
- (e) characters/meta の参照確認
- (f) B の結果または見送りの理由
- (g) C の原因と本番ビルドでの実測
- (h) ★改善前後の実測
- (i) test / build / server 差分ゼロ
- (j) ★回帰ゼロ
```
