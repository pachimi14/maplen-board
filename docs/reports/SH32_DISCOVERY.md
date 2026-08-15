# SH-32: DISCOVERY(ボーナス期間)の自動検出・記録・専用ページ — 実装報告

計画: `docs/IMPL_PLAN_SH32.md`。実装担当による完了報告。

## 0. 全体構成

3つの独立した部品(計画 §2)を、それぞれ単独 revert 可能な3コミットに分割した。

| 部品 | ファイル | 役割 |
|---|---|---|
| **A. 日次スキャン(検出)** | `server/sf-history/discovery.py`, `scripts/scan_discovery.py` | 472装備を走査し `itemUpgrade` 0〜21 に DISCOVERY を持つグループを代表へ畳んで `sf_discovery_monitored_groups` に記録 |
| **B. 監視ポーリング(記録)** | `scripts/poll_discovery.py` | 監視対象の代表itemIdのみ5分ごとに叩き、`sf_discovery_price_history` へ upsert |
| **C. 専用ページ(表示)** | `app.py` の `/sf-history/discovery/*` 3本 + `exp_ranking/web/src/sfhistory/discovery/` | DB読み取り専用。上流アクセスはゼロ |

新規テーブル4つ(`sf_discovery_scan_runs` / `sf_discovery_monitored_groups` / `sf_discovery_scan_raw` / `sf_discovery_price_history`)を追加。既存の `sf_price_history_hourly` / `sf_price_history_4h` および既存4エンドポイントの応答形は**完全に不変**(app.py の diff は追加行のみ、削除行ゼロを確認済み)。

## 1. 実装上の解釈・設計判断(統括レビューを仰ぎたい点)

計画書の記述には現れない、実装時に決めた具体的な挙動を以下に記録する。**いずれも「安全側(過小に監視するより機能を止める側)」に倒した判断**であり、計画の趣旨に反すると判断されれば修正する。

### (1) A-1 の「畳まず」の解釈

計画 §2 A-1: 「代表と alias の `step` が全帯で一致しない場合は畳まず、警告をログに出す」。

実装は次の2つの状態を区別した:

- **そのグループが今回はじめて監視候補になった場合**: 不一致なら `sf_discovery_monitored_groups` に一切書かない(監視開始しない)。警告ログのみ。
- **そのグループが既に(過去の一貫した走査で)監視対象として `is_active=1` になっている場合**: 今回の走査で不一致が出ても、`is_active` を**変更しない**(凍結)。警告ログは出すが、既存の監視は止めない。

理由: 「畳まず」を文字通り「毎回 `is_active` を不一致のたびに剥奪する」実装にすると、~4分間の走査中に生じうる正当なタイミングのズレ(F9: 上流は毎分更新)だけで既存の監視が瞬間的に外れうる。5分ポーリング(B)は `is_active=1` の行しか読まないため、誤って `is_active=0` にすると F2/F3(DISCOVERY 中は履歴が復元不能)により**記録の欠落が本物の損失になる**。安全側に倒し、"新規追加のみ厳格・既存監視は凍結"とした。

該当テスト: `tests/test_scan_discovery.py::test_scan_preserves_active_status_when_a_previously_folded_group_turns_inconsistent`

### (2) DISCOVERY 価格の単位変換

`sf_discovery_price_history.price` は **変換後**(`fetch_latest.PRICE_DIVISOR`=1e18 で除算)の値を保存する。既存の `sf_price_history_hourly/_4h.end_price` が「無変換」なのとは扱いが異なる。

理由: DISCOVERY のデータソースは `history` API(無変換の `endPrice` を返す)ではなく、`fetch_latest.py` が既に使っている **openapi `dynamicprice`**(`closePrice` と同じ 1e18 スケールの `price` を返す)。既存コードが同じ upstream に対して既に適用している変換規則をそのまま流用しただけで、新しい換算ロジックを発明していない。`schema.sql` に根拠を明記。

### (3) スキャンの列挙 API と既存 `item_catalog.py` の使い分け

`scripts/scan_discovery.py` は 472装備の列挙(`/stats/enhance-group` 全フィルタ空)を**独自に実装**し、`item_catalog.fetch_enhance_groups`(既定 `boss_only=True`/`min_level=100`)は使わなかった(F6 の472件はそのフィルタでは得られないため)。一方で **代表の選定規則**(`pick_representative_item`、週間強化回数最大)は maplenEnhancebot から読み取り専用でそのまま import し、別ルールを発明しなかった(計画の明示的な指示どおり)。

## 1.5 ★検収差し戻し修正(2026-08-15、4本目のコミット)

**統括からの指摘(計画書 A-1 の欠落・統括の責任として明記)**: 「代表の選び方は既存 `pick_representative_item()` と同じ規則」とだけ書かれ、「一度決めたら固定する」が計画に書き落とされていた。`pick_representative_item()` は毎回「週間強化回数最大」を選ぶため、日次スキャンごとに代表 itemId が変わりうる(実際に統括の走査と本実装担当の走査で別の代表が選ばれた: `1004808/1053063/1152196` vs `1004811/1053064/1152199`)。`sf_discovery_monitored_groups` の主キーが `representative_item_id` のため、代表が変わるたびに**別行として二重登録**され、`sf_discovery_price_history` も分断されて `find_transition` が遷移を見落とす欠陥だった。

### 修正内容

1. **`schema.sql`**: `sf_discovery_monitored_groups` に **部分ユニークインデックス**を追加
   `CREATE UNIQUE INDEX ... ON sf_discovery_monitored_groups(equip_level_type, equip_type, equip_part_type) WHERE is_active = 1`。
   同じグループ識別子(3つ組)を持つ**アクティブな行は常に1つまで**という制約を DB レベルでも強制する(アプリ側のロジックが将来壊れても静かに二重化しない安全網)。旧代表(再選出で置き換わった行)は `is_active=0` のまま**永久に残る**(部分インデックスなので非アクティブ行同士・アクティブ行1つは共存可能)。
2. **`db.py`**: `get_discovery_monitored_group_by_group_key()`(グループ識別子から既存行を検索)/ `deactivate_discovery_group()`(1行だけを明示的に非アクティブ化。再選出時、新しい行を挿入する**前**に呼ぶ必要がある=部分インデックスとの衝突回避のため順序が重要)を追加。
3. **`scripts/scan_discovery.py`**: `run_scan()` のループを変更。**候補グループごとに、まず `get_discovery_monitored_group_by_group_key()` で既存行を検索**し、
   - 既存の代表が今回の members に含まれていれば **その代表をそのまま使う**(`pick_representative_item` を呼ばない=選び直さない)
   - 既存行が無い(初検出)場合のみ `pick_representative_item` を呼ぶ
   - 既存の代表が members から消えていた場合のみ `pick_representative_item` で再選出し、**`sys.stderr` に WARNING を出力**してから旧行を `deactivate_discovery_group()` する

### 開発用DBへの影響・移行

本実装担当が実施した動作確認用の実スキャン(§2(a))は **1回のみ**だったため、修正前のコードでも二重登録は発生していない(3グループが1回ずつ登録されただけ)。`data/sf_price_history.sqlite`(gitignore対象・VPS未設置)に対して `db.apply_schema()`(=新しい部分ユニークインデックスの追加)を再実行し、**エラーなし・行数不変(3行)**を確認済み。**作り直しは不要だった。** 本番はまだVPS未設置のため、他に移行対象データは無い。

### 受け入れ基準(追加分)の実測

| # | 内容 | テスト | 結果 |
|---|---|---|---|
| **(q)** | weekCount の大小を入れ替えて2回スキャンしても代表が変わらない | `tests/test_scan_discovery.py::test_q_representative_does_not_change_when_weekcount_order_flips_across_scans` | ✅ |
| **(r)** | 2回スキャンしても `sf_discovery_monitored_groups` の行が増えない | `tests/test_scan_discovery.py::test_r_two_identical_scans_do_not_duplicate_the_monitored_group_row` | ✅ |
| **(s)** | 代表が member から消えた場合のみ再選出・WARN | `tests/test_scan_discovery.py::test_s_reselects_only_when_the_fixed_representative_drops_out_and_warns` | ✅ |
| **(t)** | `find_transition` がスキャンをまたいで連続して遷移を検出 | `tests/test_scan_discovery.py::test_t_find_transition_stays_continuous_across_two_scans` | ✅ |

DBレベルの防御(部分ユニークインデックス)自体のテストも追加: `tests/test_db_discovery.py::test_partial_unique_index_rejects_a_second_active_row_for_the_same_group` / `test_partial_unique_index_allows_a_superseded_inactive_row_to_coexist` / `test_get_discovery_monitored_group_by_group_key_*` / `test_deactivate_discovery_group_flips_is_active_and_keeps_the_row`。

**既存 (a)〜(p) との整合**: この修正で新たに部分ユニークインデックスが有効になったことで、複数のACTIVEグループを同一グループ識別子で擬似的に seed していた既存テストのヘルパー(`tests/test_app_discovery.py::_seed_group` / `tests/test_poll_discovery.py::_seed_active_group`)が現実には起こり得ない状態を作っていたことが判明し、`equip_part_type` を呼び出し側で区別するよう修正した(3件のテストのみ、アサーション自体は無変更)。

## 1.6 ★VPS 検収差し戻し修正(2026-08-15、5本目のコミット)

**症状**: VPS(`163.44.118.206`)で `sf-history-discovery-scan.service` が即座に `ModuleNotFoundError: No module named 'item_catalog'` で失敗。原因は `scripts/scan_discovery.py` が代表選定のため maplenEnhancebot の `item_catalog` を import していたが、`server/sf-history/` は VPS に単独配置(`/home/botuser/apps/lulumi-tools-sf-history/`)であり maplenEnhancebot が存在しないため。ローカルには両リポジトリが並んで存在するためテスト・手元実行では検出できなかった。

**統括裁定(計画書 A-1 の欠落・統括の責任)**: 「代表の選び方は既存 `pick_representative_item()` と同じ規則」という記述を「その関数を import する」と読んだのは妥当だが、VPS配置構成が受け入れ基準に無かったのも欠陥。

### 修正内容

1. **`discovery.py`**: `pick_representative_item()` を**新規実装**(maplenEnhancebot への import を廃止)。ルールは `item_catalog.py` の同名関数と同一(週間強化回数最大)である旨をコメントに明記(出典)。**同点時は itemId 昇順**で決定性を保証(`min(items, key=lambda item: (-weekCount, itemId))`)。旧実装(`max()`)は同点で入力順依存だったが、代表固定(コミット `6dd4966`)の趣旨に反するため修正。
2. **`scripts/scan_discovery.py`**: `_default_pick_representative_item()` / `DEFAULT_SOURCE_REPO` / `--source-repo` 引数を**削除**。`run_scan()` の `pick_representative_item` 引数はテスト注入口として維持し、デフォルトを `discovery.pick_representative_item` に変更。
3. **`scripts/gen_item_list.py`**(SF History の既存31装備リスト生成スクリプト)は**対象外**(DISCOVERY機能のランタイムサービスではなく、ローカルで手動実行する生成スクリプトのため、maplenEnhancebot 読み取り専用importは元々の設計どおり継続)。

### 受け入れ基準(追加分)の実測

| # | 内容 | テスト | 結果 |
|---|---|---|---|
| **(u)** | `scan_discovery.py`/`poll_discovery.py`/`discovery.py`/`app.py`/`db.py` が `server/sf-history/` の外を import しない | `tests/test_no_cross_repo_imports.py`(5モジュール × サブプロセスimport検証 + 静的import文検出、計10件) | ✅ |
| **(v)** | weekCount 同点時、入力順を入れ替えても同じ代表 | `tests/test_discovery.py::test_v_pick_representative_item_is_deterministic_regardless_of_input_order` | ✅ |

(u) は `PYTHONPATH` を除去したクリーンな `sys.path`(`server/sf-history/` のみ)でサブプロセス import する方式(統括提案どおり)+ 実import文の静的検出(コメント上の言及は誤検出しない正規表現)の二段構え。加えて、実際の VPS 起動経路そのもの(`python scripts/scan_discovery.py --help` / `poll_discovery.py --help` を `PYTHONPATH` 除去環境でサブプロセス実行)でも手元で再現・確認済み(returncode 0)。

### ★F8「エラー0」の意味についての注記(統括裁定によりコード変更なし)

統括の裁定により **本件はコードを変更しない**。§2(a) に記載した実測は、後日「F8『エラー0』は HTTP ステータスのみの意味(ペイロード形状異常=価格データなしの102件は含まない)」という理解で読むこと。統括が独立に60件サンプル検証し、`Sacred Rosary`/`Evolving Wrist Armor` 等の強化不可能な装備が該当することを確認済み(統括裁定に基づきここに転記)。

## 2. 受け入れ基準の実測

(§8 テンプレート順)

### (a) 走査件数・所要時間・失敗数

実測(2026-08-15 09:58 UTC、`data/sf_price_history.sqlite` に対する実走査 1 回、動作確認としてこの1回のみ実施):

```
groups=84 items=472 failed=102 monitoredGroups=3 requests=556 x429=0 durationMs=234328.0(≒3分54秒)
```

**★F8「エラー0」との不一致(統括レビュー要)**: 失敗**102件は全件 HTTP 200 だが `data.currentPrices.starforce` が丸ごと存在しない**
(`payload missing data.currentPrices.starforce`)。内訳を確認したところ、**102件は集計対象を `boss_only=True` に絞らず全84グループ(NORMAL含む)を列挙したことで新たに入ってきた低ティアの `NORMAL`/`NORMAL_GROWTH` 装備**(実測: `NORMAL`×25グループ相当, `NORMAL_GROWTH`×5グループ相当 が該当グループの大半)。これらは Open API の `dynamicprice` 自体が価格データを持たない(=そもそも動的価格の対象外)とみられる。
**F8 の「エラー0」は恐らく HTTP ステータスのみを見た計測**(この102件も HTTP 200 なので「エラー」に数えなかった)であり、**本実装の `items_failed` はペイロード形状異常も含めて数えている**ため定義が違う可能性が高い。

- 選択肢A(推奨): F8 の記述を「HTTP エラー0」に修正し、`items_failed` は今回の実測どおり報告する(監視対象の判定結果 (b) には一切影響しない — 該当102件はいずれも DISCOVERY 判定の対象になっていない)
- 選択肢B: `items_failed` を「HTTP失敗」と「ペイロード形状異常(価格データなし)」で分けて集計するよう `run_scan` を改修する
- トレードオフ: A は追加実装なしで済むが「失敗」の定義があいまいなまま残る。B は監視精度に影響しないログの精緻化のみで実利は薄いが、日次運用ログの読みやすさは上がる

**(b) には影響しない**(§2参照): 監視対象と判定されたのは常に「価格データが取得できた」370件の中からのみであり、102件はそもそも候補にすら入らない。

### (b) 判定結果と §1 の一致

```
active monitored groups: 3
  1004811 Arcane Umbra Thief Hat   RANGE_200_TO_209 BOSS_ARCANE_UMBRA_SET CAP      aliases=[1004808,1004809,1004810,1004811,1004812] consistent=True
  1053064 Arcane Umbra Mage Suit   RANGE_200_TO_209 BOSS_ARCANE_UMBRA_SET CLOTHES  aliases=[1053063,1053064,1053065,1053066,1053067] consistent=True
  1152199 Arcane Umbra Thief Shoulder RANGE_200_TO_209 BOSS_ARCANE_UMBRA_SET SHOULDER aliases=[1152196,1152197,1152198,1152199,1152200] consistent=True

sf_discovery_scan_raw: 375 rows (15 items x 25 bands) -- exactly the §1 "15装備"
```

**グループ構成(15装備=3グループ×5職業)は §1 と完全一致**。代表 itemId は §1 記載時点(1004808/1053063/1152196)と一部異なる(1004811/1053064/1152199)が、これは §1 自身が明記するとおり「週間強化回数最大」で毎回変わりうる正常な挙動(ハードコード禁止の裏取り)。`steps_consistent` はいずれも `True`(F7 が本実測でも成立)。

### (c) ☆23-25 を判定に使っていないテスト

- `server/sf-history/tests/test_discovery.py::test_is_monitored_false_when_only_display_only_bands_are_discovery`
- `server/sf-history/tests/test_scan_discovery.py::test_scan_ignores_a_group_with_no_judge_range_discovery_band`
- フロント: `exp_ranking/web/src/sfhistory/discovery/domain/bands.test.js`(表示は25帯のまま)

### (d)(e) 25帯 + previousPrice / upsert

- `server/sf-history/tests/test_db_discovery.py::test_upsert_discovery_price_points_writes_current_and_previous`
- `server/sf-history/tests/test_db_discovery.py::test_upsert_discovery_price_points_is_idempotent_same_window`
- `server/sf-history/tests/test_poll_discovery.py::test_poll_writes_current_and_previous_for_every_present_band`
- `server/sf-history/tests/test_poll_discovery.py::test_poll_upsert_is_idempotent_across_runs`

### (f) 遷移の判定

- `server/sf-history/tests/test_discovery.py::test_find_transition_detects_the_flip` ほか5件
- `server/sf-history/tests/test_db_discovery.py::test_find_recent_discovery_transitions_filters_by_since`

### (g)(g-1)(g-2)(g-3) ページ3行 / alias検索 / 代表のみポーリング / 不一致警告

- (g): `server/sf-history/tests/test_app_discovery.py::test_discovery_equipment_lists_only_active_groups`
- (g-1): `exp_ranking/web/src/sfhistory/discovery/domain/search.test.js`
- (g-2): `server/sf-history/tests/test_poll_discovery.py::test_poll_hits_only_representatives_never_aliases` (`requestsMade == 3`)
- (g-3): `server/sf-history/tests/test_scan_discovery.py::test_scan_does_not_fold_an_inconsistent_group_and_warns`

### (h) 25行 + バッジ、Suit の実データ

- `server/sf-history/tests/test_app_discovery.py::test_discovery_prices_returns_25_bands_with_discovery_badges`(実データの帯パターンを固定 fixture 化)

### (i) 上流を叩かないテスト

- `server/sf-history/tests/test_app_discovery.py::test_discovery_routes_never_touch_the_latest_cache`

### (j) 観測時刻・古さの見分け

- `exp_ranking/web/src/sfhistory/discovery/domain/bands.test.js::isObservationStale`
- `DiscoveryRoot.jsx` が `observedAt` を必ず表示し、15分超で警告文言を追加表示

### (k) 最近終了30日・設定可能・記録は残す

- `server/sf-history/tests/test_app_discovery.py::test_discovery_recent_defaults_to_30_days`
- `test_discovery_recent_env_var_changes_the_default` / `test_discovery_recent_query_param_overrides_default`
- `test_discovery_recent_survives_a_group_that_has_since_been_deactivated`(記録は永久)

### (l) 監視対象ゼロ

- `server/sf-history/tests/test_poll_discovery.py::test_poll_makes_no_requests_when_no_monitored_groups`

### (m) pytest / 契約 / npm test / build

```
python -m pytest -q (server/sf-history)      : 159 passed  (C コミット時点)
                                                169 passed  (検収差し戻し①: 代表固定修正後)
                                                183 passed  (検収差し戻し②: VPS依存除去修正後 --
                                                             (u)(v) 計14件 追加)
npm run test (exp_ranking/web, vitest)       : 676 passed / 59 files(2回の修正後も再実行・不変)
npm run build (exp_ranking/web, vite build)  : 成功(dist/ 生成、2404 modules transformed)
```

契約テスト(`tests/test_response_contract.py`)は無改変のまま緑(既存4エンドポイントの応答形は不変)。新規3エンドポイントぶんの契約は `tests/test_app_discovery.py` が `contract/response_fields.json` の新セクションと突き合わせている。

### (n) 既存 #/starforce の回帰ゼロ

- `app.py` diff: 追加行のみ(削除0行、`git diff -w` で確認)
- `useHashRoute.js`/`App.jsx`: 既存 `starforce` 分岐は変更せず、`||` で新条件を追加しただけ
- 既存 `tests/test_app.py` / `tests/test_response_contract.py` / `exp_ranking/web/src/sfhistory/**/*.test.js`(discovery/ を除く既存分)は無改変のまま全緑

### (o) 6ロケール

`src/localeParity.test.js` で `en`/`ja`/`es`/`th`/`vi`/`zh-TW` のキー集合完全一致を確認。

### (p) APIキーの扱い

- `scripts/scan_discovery.py` / `scripts/poll_discovery.py` とも `os.getenv("MSU_OPEN_API_KEY", "")` からのみ読み取り、ログ・応答に値を出力しない(既存 `app.py`/`fetch_latest.py` と同じ規律)。
- 検証時もキー値は一切標準出力・ファイルへ出力していない(実行結果のうち `returncode` と「キーが出力に含まれるか」の bool のみを確認)。

## 3. VPS 設置手順(統括が実施)

```
# 1. コード配置(既存 sf-history デプロイと同じ手順)
# 2. スキーマは起動時に自動適用される(db.apply_schema, CREATE TABLE IF NOT EXISTS)

# 3. timer/service を2本追加
sudo cp deploy/sf-history-discovery-scan.service.example /etc/systemd/system/sf-history-discovery-scan.service
sudo cp deploy/sf-history-discovery-scan.timer.example /etc/systemd/system/sf-history-discovery-scan.timer
sudo cp deploy/sf-history-discovery-poll.service.example /etc/systemd/system/sf-history-discovery-poll.service
sudo cp deploy/sf-history-discovery-poll.timer.example /etc/systemd/system/sf-history-discovery-poll.timer
# WorkingDirectory / venv パスを実環境に合わせて編集

# 4. ★秘密情報: MSU_OPEN_API_KEY を /etc/lulumi-tools/sf-history-discovery.env に配置(0600, root所有)
#    既存 raffle-api / sf-history 本体と同じ鍵を使い回してよい(同じ Open API キー)

sudo systemctl daemon-reload
sudo systemctl enable --now sf-history-discovery-scan.timer
sudo systemctl enable --now sf-history-discovery-poll.timer

# 5. フロントは通常の web ビルド反映(dist再デプロイ)のみ。API側は
#    api.lulumi-tools.com の CORS 許可オリジンは既存のまま(新規オリジン不要)
```
