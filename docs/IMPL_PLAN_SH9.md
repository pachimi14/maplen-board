# IMPL_PLAN_SH9 — ナビ導線 / 全装備検索 / テーマ対応

設計正典: `docs/DESIGN_SF_COST_HISTORY.md` §7(装備リスト)/ §11(UI)。
前提: SH-8 完了・統括検収済。**ユーザー実機レビュー起点の3件**。

## 0. 3つのテーマ(いずれもユーザー指摘)

| # | 指摘 | 原因(統括が特定済み) |
|---|---|---|
| ① | 左上のナビに **SF History** を足して飛べるように | `SiteHeader` のリンクが2つ固定で、項目自体が無い |
| ② | 装備検索が代表装備しか出ない。**カタログから全装備**を引き、**データは代表**を使う(ギアシミュと同じ) | alias が **ID のみ 186件**で保持され、**名前が無い**ので名前検索に掛からない |
| ③ | **ページのテーマカラーが効かない** | `SfHistoryRoot` が `site-theme` クラスを付けていない + `SiteHeader` に `theme`/`onThemeChange` を渡していない |

## 1. スコープ

**変更してよい**:
- `exp_ranking/web/src/components/BoardHeader.jsx`(`SiteHeader`)— **リンク追加のみ**
- `exp_ranking/web/src/sfhistory/SfHistoryRoot.jsx`
- `exp_ranking/web/src/sfhistory/components/EquipmentSelector.jsx`
- `exp_ranking/web/src/sfhistory/sfhistory.css`
- `exp_ranking/web/src/sfhistory/integrations/sfHistorySource.js`
- `exp_ranking/web/src/i18n/locales/*.json` — **6ロケール同時**
- `server/sf-history/app.py`(`equipment` 応答)/ `scripts/gen_item_list.py` / `data/sf_history_items.json`
- 各 `*.test.js` / `server/sf-history/tests/`
- `docs/reports/SH9_UI_FIXES.md`

**触らないもの**(1つでも触れたら停止):
- `server/sf-history/aggregate.py` / `schema.sql` / `scripts/rebuild_4h.py` / `scripts/update.py` /
  `fetch_latest.py`(**データ層と 4h テーブルは不変**)
- `exp_ranking/web/src/sfhistory/starforce.js`
- `exp_ranking/web/src/sfhistory/domain/series.js` の**統計・系列生成**(表示用の素通しのみ可)
- `src/taskManager/` / `src/board/` / `src/pages/` の既存挙動 / `package.json`
- **`C:\Users\pachi\Desktop\maplenEnhancebot` は読み取り専用**(カタログを読むが**1バイトも書かない**)
- **VPS**

## 2. ① ナビ導線

`SiteHeader` に3つ目のリンクを**追加のみ**で入れる:

- href = `#/starforce`、ラベルは **i18n キー**(`app.openSfHistory` 等。ハードコードしない)
- `active` の値に `"sfhistory"` を追加し、`SfHistoryRoot` は `active="sfhistory"` を渡す
- **既存2リンクの href・ラベル・`active` の値・スタイルを1文字も変えない**

**★`SiteHeader` はランキングとタスクマネージャーでも使われる共有コンポーネント。**
受け入れ基準 (f) で**両ページの回帰なし**を実測すること。

## 3. ② 全装備検索(データは代表)

### 3-1 データ生成

`scripts/gen_item_list.py` が、maplenEnhancebot のカタログ
(`catalog/main_equipment.json`。**構造は `groups[].items[].{item_id,item_name}`**、
`build_priority_item_to_representative_map()` で item→代表を解決)から
**代表に紐づく全 item の名前**を取り込む。**実測で 186件**(28代表)。

`data/sf_history_items.json` の各 item に足す:
```json
{ "itemId": 1102940, "itemName": "Arcane Umbra Knight Cape", "maxStar": 22,
  "aliasItemIds": [1102940, 1102943, 1102942],
  "aliases": [ { "itemId": 1102943, "itemName": "Arcane Umbra Thief Cape" }, ... ] }
```
- **`aliasItemIds` は残す**(既存フィールドの意味を変えない)
- `aliases` は**代表自身を含めてよいが、重複させない**方針を決めて README に書く

### 3-2 API

`/sf-history/equipment` が `aliases`(itemId + itemName)を返す。**他のフィールドは変えない**。

### 3-3 UI

- **検索対象 = 代表名 + 全 alias 名 + 全 itemId**(現状は代表名と ID のみ)
- alias を選んだら **その alias の名前を表示**しつつ、**データは代表**から取る
  (`prices`/`latest` は代表 itemId で叩く。SH-3 の申し送りどおり代表のみ受理)
- **★正直さの要求**: alias を選んだときは、**「強化費用はこのグループ共通(代表: ○○)」**の旨を
  1行で示すこと。**黙って別装備の数字を出さない**(表示と計算の一致)
- **`maxStar` はグループの値をそのまま使う**(代表の値=グループの値)

> **スコープの線引き(重要)**: ここで言う「全装備」は **28グループに属する 186件**である。
> **28グループの外の装備は価格データ自体が存在しない**ので出さない。
> 対象を広げるならバックフィルの拡張(リクエスト数と保存量の増加)が要る=**別スライス・要ユーザー判断**。

## 4. ③ テーマ対応

- `SfHistoryRoot` の最上位に **`site-theme` を付ける**(`TaskManagerRoot` の
  `site-theme tm-app ...` と同じ流儀。**新しい仕組みを発明しない**)
- `SiteHeader` に **`theme` と `onThemeChange` を渡す**(ヘッダの `ThemePicker` を機能させる)
  — テーマ状態の持ち方は**既存の仕組みをそのまま再利用**する(`taskManager` 側の実装を読むこと)
- `sfhistory.css` の「この画面は `.site-theme` に乗らない」旨のコメントは**実態に合わせて更新**
- 4色(グリーン/ブルー/パープル/オレンジ)× 3段階(Light/Standard/Deep)で
  **背景・枠線・アクセントが変わること**を確認

## 5. 受け入れ基準

- **(a)** ナビに SF History が出て `#/starforce` に飛べる。SF History 表示中は `aria-current="page"`
- **(b)** `equipment` 応答の `aliases` 総数が **186**(28代表分の合計)。名前が全件入っている
- **(c)** 検索: `AbsoLab Warrior Gloves` のような**代表でない装備名で引ける**こと(実例を報告)。
  選択後、**`prices` が代表 itemId で叩かれる**ことをネットワークで確認
- **(d)** alias 選択時に「グループ共通(代表: ○○)」の表示が出る
- **(e)** テーマ4色 × 3段階を切り替えて、**この画面の配色が変わる**(DOM の `data-theme-color` /
  計算済みスタイルで機械確認し、値を報告)
- **(f) ★既存ページの回帰なし**: `#/`(ランキング)と `#/dashboard`(タスクマネージャー)で
  ヘッダが従来どおり表示され、既存2リンクの href/ラベル/選択状態が不変。
  `useHashRoute.test.js` を含む**既存テストが無改変で緑**
- **(g)** `npm run test` 全緑 / `npm run build` 成功 / `pytest` 全緑
- **(h)** 6ロケールのキー数一致(追加分を含め全言語同数)
- **(i)** `git diff -w` で §1 の「触らないもの」に差分ゼロ。**4h テーブルの行数・ハッシュが不変**
- **(j)** SH-7/SH-8 の性質が維持: 暫定点1つ・統計に暫定点が入らない・`asOf` 表示

## 6. 停止条件

1. `SiteHeader` を**追加でなく書き換えないと**入らない
2. 既存2ページのヘッダに見た目/挙動の差が出る
3. テーマを効かせるのに `taskManager` 側の仕組みを**変更**する必要がある
4. カタログから 186件の名前が取れない(構造が §3-1 と違う)
5. §1 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 7. コミット

- **ローカルコミット**。3コミット推奨(① ナビ ② 全装備検索 ③ テーマ)。**単独 revert 可**に。
- **`git push` は行わない**。**`git add -A` 禁止**。

## 8. 完了報告テンプレ

```
## SH-9 完了報告
- コミット: <hash>(各1行要約)
- (a) ナビの実測(リンク・aria-current)
- (b) aliases 総数 / 名前の充足
- (c) 代表でない装備名での検索実例 / prices が叩く itemId
- (d) グループ共通表示の文言
- (e) テーマ4色×3段階の機械確認結果
- (f) ★既存2ページの回帰確認(ヘッダ・既存テスト)
- (g) npm test / build / pytest
- (h) 6ロケールのキー数
- (i) 触らない領域の差分ゼロ / 4h テーブルのハッシュ
- (j) SH-7/SH-8 の性質維持の確認
- ★ローカル起動手順(**SF_HISTORY_ALLOWED_ORIGINS を必ず含める**)
```
