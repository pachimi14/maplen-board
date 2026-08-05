# IMPL_PLAN_SH20 — サーバー応答とフロント正規化の契約テスト

前提: SH-19 完了・統括検収済(`dc0bfed`)。**ユーザー指示 2026-08-05**「修正して」。

## 0. 直す対象 — 3回起きた同じ欠陥

`exp_ranking/web/src/sfhistory/integrations/sfHistorySource.js` の
`normalizePricesPayload` は**ホワイトリスト方式**で、明示した項目しか通さない。
∴ **サーバーが新しいフィールドを足すと、フロントで黙って落ちる。**

| 回 | 落ちたフィールド | 結果 |
|---|---|---|
| SH-9 | `provisional` / `provisionalDate` | 実装担当が気づいて素通しを追加(申し送り) |
| SH-16 | `asOf` | 同上 |
| **SH-19** | **`closed`** | **P0**。破線が描画されず、`npm run test` は緑のまま |

**3回目なので偶然ではなく構造の問題。**

## 1. 方針(統括裁定・ユーザー承認済)

**採用**: サーバーの応答フィールドとフロントの正規化を**突き合わせるテスト**を置く。
**新しいフィールドがサーバーに増えたら、フロントを直すまでテストが落ちる**ようにする。

**不採用**: 正規化をパススルー(未知フィールドをそのまま通す)に緩める案。
**型の緩さを持ち込み、「何が届くか」が読めなくなる**ため。

### 1-1 前例に合わせる

本リポには **`exp_ranking/web/src/raffle/domain/contract.test.js`** という契約テストの前例がある。
**その流儀に合わせること**(新しい仕組みを発明しない)。実装前に必ず読む。

## 2. 仕組み

**1つの契約ファイルを、Python 側と JS 側の両方が参照する。**

```
server/sf-history/contract/response_fields.json   (新規・唯一の正)
```

内容(例。実際の形は実装担当が決めてよい):
```json
{
  "prices":    { "root": ["itemId","interval","labelIs","startDate","endDate",
                          "priceVersion","upgradeCount","provisionalDate","points"],
                 "point": ["date","prices","provisional","closed","asOf","current"] },
  "latest":    { "root": ["itemId","latestUpdatedAt","prices"] },
  "equipment": { "root": ["items"], "item": ["itemId","itemName","maxStar","aliasItemIds","aliases"] }
}
```

- **`point` の項目は「出うる」もの全部**(`asOf` のように条件付きで出るものも含む)
- **Python 側テスト**: 実際の応答のキー集合が契約と**一致する**
  (**契約に無いキーを返したら落ちる / 契約にあるキーを返せなくなっても落ちる**)
- **JS 側テスト**: 正規化の出力が契約の項目を**すべて保持している**
  (**落としたら落ちる**)

∴ **サーバーにフィールドを足す → Python テストが落ちる → 契約を更新 → JS テストが落ちる →
正規化を直す**、という順に必ず気づく。

## 3. スコープ

**作る/変更してよい**:
- `server/sf-history/contract/response_fields.json`(新規)
- `server/sf-history/tests/test_response_contract.py`(新規・**オフライン**)
- `exp_ranking/web/src/sfhistory/integrations/contract.test.js`(新規)
- `exp_ranking/web/src/sfhistory/integrations/sfHistorySource.js`
  — **契約テストが落ちた場合の修正のみ**(§4)
- `server/sf-history/README.md` — 契約ファイルの位置と運用を明記
- `docs/reports/SH20_CONTRACT.md`

**触らないもの**(1つでも触れたら停止):
- `server/sf-history/app.py` の**応答の中身**(**フィールドを足したり消したりしない**)
- `server/sf-history/aggregate.py` / `schema.sql` / `scripts/*` / `db.py` / `fetch_latest.py`
- **4h テーブル**
- `src/sfhistory/starforce.js` / `domain/*` の**計算・統計**
- SH-7〜SH-19 の性質すべて(破線1点・ラベル終了時刻・UTC・意味色・2桁表記 など)
- `src/App.jsx` / `src/board/` / `src/pages/` / `src/components/` / `src/taskManager/`
- `package.json` / **VPS** / **元ツリー**

## 4. ★いま落ちているフィールドがあれば直す

契約テストを書くと、**現時点で正規化が落としているフィールドが見つかる可能性がある**
(`current` / `upgradeCount` / `labelIs` / `priceVersion` など)。

- **見つかったら列挙して報告**する
- **フロントが実際に使うもの**は素通しを足す
- **使っていないものは、契約に残したうえで「正規化では意図的に落とす」ことを明示**してよい
  (その場合は**テストがその意図を表現する**こと。黙って落とさない)

**判断に迷ったら止めて報告**すること。**勝手にフロントの挙動を変えない。**

## 5. 受け入れ基準

- **(a)** 契約ファイルが1つだけ存在し、**Python と JS の両方がそれを読む**
  (**2箇所に項目リストが書かれていない**)
- **(b) ★負のテストが効く**: 契約に項目を1つ足すと **JS 側が落ちる**、
  応答に項目を1つ足すと **Python 側が落ちる**ことを**実際に一時変更して確認**し、
  **その手順と結果を報告**する(**落ちることを確認していない契約テストは意味がない**)
- **(c)** 現時点で正規化が落としているフィールドの**全一覧**を報告
- **(d)** テストは**オフライン**(実 API を叩かない)
- **(e)** `pytest` 全緑 / `npm run test` 全緑 / `npm run build` 成功
- **(f) 挙動不変**: 本スライスで**画面の見え方が変わらない**こと。
  §4 で素通しを足した場合は、**何がどう変わったか**を報告
- **(g)** 4h テーブル不変 / SH-7〜SH-19 の性質維持

## 6. 停止条件

1. **(b) の負のテストが作れない**(落ちることを確認できない)
2. §4 でフロントの挙動を変える判断が必要になった
3. §3 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 7. コミット

- **ローカルコミット**(2本: 契約+テスト / §4 の修正があれば)。**単独 revert 可**。
- **`git push` は行わない**。**`git add -A` 禁止**。

## 8. 完了報告テンプレ

```
## SH-20 完了報告
- コミット: <hash>(各1行要約)
- (a) 契約ファイルの場所と、両側がそれを読んでいることの確認
- (b) ★負のテストの手順と結果(契約に足す / 応答に足す の両方向)
- (c) 現時点で落ちているフィールドの全一覧
- (d) オフラインであることの確認
- (e) pytest / npm test / build
- (f) 挙動不変(変えた場合は内容)
- (g) 4h テーブル / SH-7〜SH-19
- ★起動手順(SF_HISTORY_ALLOWED_ORIGINS 込み)
```
