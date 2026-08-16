# SH-34 完了報告 — キューブ(potential)の価格形成も記録・表示する

計画: `docs/IMPL_PLAN_SH34.md`。§2-2 は着手直後に統括から簡素化の差し替え指示を受け、Navigator metadata 解決を撤回して静的6件テーブルに変更済み(以下は差し替え後の仕様で実装)。

## コミット

- A(記録): `f93961c` — `feat(sh34-a): record cube (potential) price formation alongside SF`
- B(API): `6b1be7c` — `feat(sh34-b): return cube (potential) price/status/transition from the API`
- C(表示): このコミット — `feat(sh34-c): show the cube price table on the New Equipment page`

3コミットとも単独 revert 可能(A→B→C の順に依存。Cを revert してもA/Bは自己完結、Bを revert する場合はCも合わせて revert が必要)。`git push` は行っていない。`git add -A` は使用せず、触ったファイルのみ個別 `git add` + `git diff -w` で実質差分を確認した。

## (a) ★リクエスト数が増えない

`poll_discovery.py` は `data.currentPrices.starforce` に加えて同じレスポンスの `data.currentPrices.potential` を読むだけで、上流への GET は増やしていない。

- テスト: `tests/test_poll_discovery.py::test_poll_writes_cube_points_from_the_same_response_with_no_extra_request`(`requestsMade == 1`)、`test_poll_hits_only_representatives_never_aliases`(既存、`requestsMade == 3`、無改変で緑)
- 実測: ローカル実データに対して `python scripts/poll_discovery.py` を実行(`MSU_OPEN_API_KEY` 使用、鍵の値は出力していない)。
  ```
  poll_discovery: monitoredGroups=3 polled=3 failed=0 rowsWritten=186 requests=3 x429=0
  ```
  `requests=3` — 3グループ(3代表装備)に対し1リクエストずつ、SH-32/33 時点から不変。

## (b) 保存された行数(実測)

同じ実行で `sf_discovery_cube_price_history` を実測:

```
item_id=1004811: 12行 (6種 × current/previous 2点)
item_id=1053064: 12行
item_id=1152199: 12行
合計: 36行 = 代表3件 × 6種 × 2点
```

## (c) upsert

同じ代表に対して2回連続でポーリングを実行し、`(item_id, cube_item_id, price_at)` の重複が発生しないことを確認:

```
total 54  distinct 54   -- COUNT(*) == COUNT(DISTINCT item_id/cube_item_id/price_at)
```
(1回目36行→2回目で新しい5分窓の18行が追加され54行。同一窓の再ポーリングでは行が増えないことは `tests/test_poll_discovery.py::test_poll_cube_upsert_is_idempotent_across_runs` と `tests/test_db_discovery.py::test_upsert_discovery_cube_price_points_is_idempotent_same_window` で固定。)

## (d) ★名前のハードコード無し(§2-2 差し替え後: 6種の静的対応表)

`discovery.py` の `CUBE_NAMES`(6エントリの静的 dict)+ `cube_display_name()`。Navigator への通信は一切行っていない(`poll_discovery.py`/`app.py` の `discovery_prices` とも Navigator 系エンドポイントを呼ばない — grep で `Navigator`/`metadata/items` の参照が本変更に含まれないことを確認)。

未知コードのフォールバック:
- `tests/test_discovery.py::test_cube_display_name_falls_back_to_the_code_for_an_unknown_id` — `cube_display_name(9999999) == "9999999"`
- `tests/test_app_discovery.py::test_discovery_prices_includes_cubes_with_resolved_names_in_code_order` — API レベルで `cubeName == "9999999"`(未知コード)
- フロント: `discoverySource.test.js`(`falls back to the code itself as a string`)、`bands.test.js`(`falls back to the code itself when cubeName is missing/blank`)

## (e) API 応答(遷移時刻)

`/sf-history/discovery/prices` の `cubes[]` は `bands[]` と並列のフィールド(混ぜていない)。実データに対する実行(item 1004811):

```json
{"cubeItemId": 2711000, "cubeName": "Occult Cube",          "price": 1e-06,     "step": "STEP_TYPE_DISCOVERY", "isDiscovery": true,  "windowStart": null, "windowEnd": null}
{"cubeItemId": 2730000, "cubeName": "Bonus Occult Cube",    "price": 1e-06,     "step": "STEP_TYPE_DISCOVERY", "isDiscovery": true,  "windowStart": null, "windowEnd": null}
{"cubeItemId": 5062009, "cubeName": "Red Cube",              "price": 41584.71, "step": "STEP_TYPE_DISCOVERY", "isDiscovery": true,  "windowStart": null, "windowEnd": null}
{"cubeItemId": 5062010, "cubeName": "Black Cube",            "price": 570649.87,"step": "STEP_TYPE_CHANGE",    "isDiscovery": false, "windowStart": null, "windowEnd": null}
{"cubeItemId": 5062500, "cubeName": "Bonus Potential Cube",  "price": 30558.97, "step": "STEP_TYPE_DISCOVERY", "isDiscovery": true,  "windowStart": null, "windowEnd": null}
{"cubeItemId": 5062503, "cubeName": "White Cube",            "price": 402855.91,"step": "STEP_TYPE_CHANGE",    "isDiscovery": false, "windowStart": null, "windowEnd": null}
```

全件 `windowStart`/`windowEnd` が `null`(現時点でどのキューブも DISCOVERY→CHANGE の遷移を観測していない — 実データと一致)。遷移時刻の導出は `discovery.find_transition` を再利用(`db.find_discovery_cube_transitions_for_item`)、別ロジックは作っていない。

## (f) ★監視対象が15装備=3グループのまま

`scan_discovery.py`(Component A、監視条件の判定)は一切変更していない(diff 空)。`git diff` 対象ファイルに `scripts/scan_discovery.py` は含まれない。ローカル実データで確認:

```sql
SELECT representative_item_id, item_name, equip_part_type, is_active
FROM sf_discovery_monitored_groups WHERE is_active=1;
-- 1004811 Arcane Umbra Thief Hat      CAP
-- 1053064 Arcane Umbra Mage Suit      CLOTHES
-- 1152199 Arcane Umbra Thief Shoulder SHOULDER
```
3グループ(=15装備、SH-32/33 時点と不変)。

## (g)(h)(i)(j) 表示

New Equipment ページ(`DiscoveryRoot.jsx`)の SF 表(`DiscoveryPriceTable.jsx`、無改変)の下に `DiscoveryCubeTable.jsx` を追加。

- 列: キューブ名 / 価格(NESO、SF と同じ `formatDiscoveryPrice` — 小数6桁固定・右揃え・`tabular-nums`) / 状態(`sfhistoryDiscovery.prices.formingBadge`="Forming"/`settledBadge`="Settled" を SF とそのまま共有) / 形成済みになった時刻(`settledRange`/`-`、SF と同じ表現)
- 見出し: `DiscoveryCubeTable.jsx` の先頭に `sfhistoryDiscovery.cubes.tableHeading`("Cubes"/日本語"キューブ" 等)を表示し、SF 表(無見出し)と視覚的に区別
- キューブが1件も無い装備では `DiscoveryCubeTable` は `null` を返し、表そのものを出さない(`buildCubeRows([]).length === 0` で判定)
- 並び順は `cube_item_id` 昇順(サーバー `latest_discovery_cubes_for_item` の `ORDER BY` 由来、フロントの `buildCubeRows` でも防御的に再ソート)。「上位キューブ」等の序列は発明していない

## (k)(l) 契約 / 既存フィールド

`contract/response_fields.json` の `discoveryPrices.root` に `"cubes"` を追加、新規 `discoveryPrices.cube` を追加。契約テスト:
```
tests/test_app_discovery.py::test_discovery_prices_cubes_is_empty_when_no_cube_data_recorded
tests/test_app_discovery.py::test_discovery_prices_includes_cubes_with_resolved_names_in_code_order
tests/test_app_discovery.py::test_discovery_prices_cube_windowStart_windowEnd_null_when_never_transitioned
tests/test_app_discovery.py::test_discovery_prices_cube_reports_the_observed_transition_for_a_settled_cube
```
既存4エンドポイント(`equipment`/`prices`/`latest`/`discoveryEquipment`/`discoveryRecent`)の既存フィールドは削除・改名ゼロ(`git diff -w` で `contract/response_fields.json` の差分が加算のみであることを確認)。

## (m) pytest / npm test / build

```
cd server/sf-history && python -m pytest tests/ -q
  -> 217 passed

cd exp_ranking/web && npx vitest run
  -> Test Files 60 passed (60) / Tests 706 passed (706)

cd exp_ranking/web && npm run build
  -> vite build 成功(dist/ 生成、既存の chunk サイズ警告のみ、エラーなし)
```

## (n) ★既存の回帰ゼロ

- `DiscoveryPriceTable.jsx`(SF 表本体)は `git diff -w` で差分ゼロ(このコミットで一切触っていない)
- `#/starforce`(`SfHistoryRoot.jsx`/`SfHistoryTabs.jsx`/`sfhistory/domain/`/`sfhistory/integrations/sfHistorySource.js` 等)は touched files に一切含まれない
- `server/sf-history/scripts/scan_discovery.py`、`sf_discovery_monitored_groups`/`sf_discovery_scan_raw`/`sf_price_history_hourly`/`sf_price_history_4h` のスキーマ・アクセサはいずれも無変更

## (o) 6ロケール

`en/ja/es/th/vi/zh-TW` の `sfhistoryDiscovery.cubes.{tableHeading,cube}` を同一コミットで追加。`src/localeParity.test.js`(6ロケールのフラット化キー集合が完全一致することを検証する既存テスト)が緑。追加した文言(暫定訳、ネイティブレビュー未実施 — 既存の SF History 機能と同方針):

| ロケール | tableHeading | cube |
|---|---|---|
| en | Cubes | Cube |
| ja | キューブ | キューブ |
| es | Cubos | Cubo |
| th | คิวบ์ | คิวบ์ |
| vi | Cube | Cube |
| zh-TW | 方塊 | 方塊 |

キューブ自体の表示名(`cubeName`、例 "Occult Cube")は §2-2 の指示どおり6ロケールとも英語固定(装備名と同じ扱い、翻訳していない)。

## (p) APIキーの扱い

`.lulumi-tools/raffle-api.env` の `MSU_OPEN_API_KEY` の値は本報告・コミット・ログ・応答のいずれにも出力していない(実行ログは `x-nxopen-api-key` ヘッダを表示しない `fetcher.py`/`poll_discovery.py` の既存の非ログ方針をそのまま利用)。

## 残課題・watch-item

- es/th/vi/zh-TW の "Cubes"/"Cube" 見出しはネイティブレビュー未実施の暫定訳(LULU-065 と同方針で「完成扱い」)
- VPS への反映は統括の専権(本実装は VPS に一切触れていない — `ssh`/`scp` は未使用)
