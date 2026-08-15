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
python -m pytest -q (server/sf-history)      : 159 passed
npm run test (exp_ranking/web, vitest)       : 676 passed / 59 files
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
