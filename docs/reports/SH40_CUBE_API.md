# SH-40: キューブ価格の API(スライス2: API のみ) -- 完了報告

計画: `docs/IMPL_PLAN_SH40.md`。画面(タブ)は次スライス。

## 実施コミット

- A(系列エンドポイント): `ef421d0` -- feat(sh40-a): add GET /sf-history/cube-prices (4h cube series endpoint)
- B(latest への追加): `a12eb94` -- feat(sh40-b): add cube current prices to GET /sf-history/latest

いずれもローカルのみ(`git push` 未実施)。統括裁定により、`contract.test.js` の追補修正+本報告書を**新規コミット1本**にまとめて追加(下記「追補」参照)。

## 変更ファイル

- `server/sf-history/cube.py`: `CUBE_ITEM_ID_BY_SUB_TYPE` を追加(current-price 上流の `potential` マップが cube itemId キーであることに対する、この4 sub_type との対応表。実測: 2026-08-22 本番 Open API プローブ、item 1382265 で確認)
- `server/sf-history/fetch_latest.py`: `parse_potential_cubes`(新規、純粋関数)+ `parse_latest_payload`/`parse_openapi_payload` の返り値に `cubes`(4要素、`cube.CUBE_SUB_TYPES` 順)・`cubeOrder` を追加。**既存の `prices`/`latestUpdatedAt` の計算行は1行も変更していない**(スターフォースの読み取りに追加リクエストなし、J3)
- `server/sf-history/db.py`: `cube_four_h_rows_for_item` / `cube_latest_generated_at_for_item`(`four_h_rows_for_item`/`latest_generated_at_for_item` の CUBE 版、読み取りのみ)
- `server/sf-history/app.py`: `GET /sf-history/cube-prices?itemId=`(新規ルート、A)。`/sf-history/latest` 自体は無改修(`cache.get()` の返り値をそのまま返す既存コードが、`fetch_latest.py` の返り値拡張をそのまま透過する構造のため)
- `server/sf-history/contract/response_fields.json`: `latest.root` に `cubes`/`cubeOrder` を追加(既存フィールドは削除・改名なし)。新セクション `cubePrices` を追加
- `server/sf-history/tests/test_response_contract.py`: `latest` の `FakeCache` に `cubes`/`cubeOrder` を追加、`cubePrices` の contract テスト2本を追加
- `server/sf-history/tests/test_app_cube_prices.py`(新規): 8テスト
- `docs/reports/SH40_CUBE_API.md`(本ファイル)

## (a) 系列の実測(Arcane Umbra Staff = 1382265 の4種)

一時DB に item 1382265 で RED/BLACK/ADDITIONAL の2バケット、WHITE_ADDITIONAL は新しい方のバケットのみを実データとして投入し、`app.cube_prices()` を直接実行した実測(`git diff` 対象外のアドホックスクリプトで実行、出力そのまま):

```
cubeOrder: ['RED', 'BLACK', 'ADDITIONAL', 'WHITE_ADDITIONAL']
2026-05-14T00:00:00Z cubes= [111.0, 111.0, 111.0, None] closed= True
2026-08-12T00:00:00Z cubes= [222.0, 222.0, 222.0, 333.0] closed= True
```

4種すべてが1つの足(1レコード)に並んで返っている(SF の `prices[22]` と同じ流儀)。

## (b) ★White の null(実データ)

上の実測の1行目: `2026-05-14`(White Cube の実運用開始 2026-06-11 より前を模した日付)で `cubes[3]`(WHITE_ADDITIONAL)が **`None`**。`0` でも前方値でもない。専用テスト `test_cube_prices_shape_and_white_null_before_its_backfill_start`(`server/sf-history/tests/test_app_cube_prices.py`)でも同じことをアサートし、緑。

注: ローカルには本番相当DBが無いため(統括指示どおり)、この実測は一時DB + 実 itemId(1382265)で行った。本番 DB の実データ突き合わせは統括/VPS 側で可能。

## (c)(d) 並び順 / closed の規則

- (c) `cubeOrder`(`["RED","BLACK","ADDITIONAL","WHITE_ADDITIONAL"]`、`cube.CUBE_SUB_TYPES` そのもの)を `cube-prices` のルートと `latest` のルート両方に固定で持たせている。`test_cube_prices_order_is_fixed_and_exposed` で確認
- (d) `closed`/`provisional` の意味論は `/sf-history/prices` と完全に同一規則(確定 4h 行 = `closed:true`・`provisional`キーなし / 経過済み未集計バケット = `closed:true, provisional:true` / 未終了バケット = `closed:false, provisional:true`、`closed:false` は常に1点のみ)。`test_cube_prices_closed_and_provisional_mirror_sf` が `test_prices_fills_a_completed_but_unaggregated_bucket_from_hourly_data` と同型のシナリオ(確定1点+経過済み未集計1点+進行中1点=計3点)で実測・緑

## (e) ★上流リクエスト不変(実測)

テスト: `test_latest_and_cube_prices_together_make_exactly_one_upstream_call`(`server/sf-history/tests/test_app_cube_prices.py`)。

実測内容: 実物の `fetch_latest.LatestPriceCache`(TTLキャッシュ・単一フライトはそのまま)を HTTP 呼び出し回数を数える `_FakeSession` で構成し、同一 itemId に対して `/sf-history/latest` → `/sf-history/cube-prices` の順で1回ずつリクエスト。結果:

```
assert len(session.calls) == 1
assert real_cache.upstream_call_count == 1
```

両方とも `1`(緑)。つまり **1装備あたりの上流呼び出し回数は、キューブを足す前と同じ「1」のまま**(同じ `app.state.latest_cache` を両ルートが共有し、TTL 内なので2回目はキャッシュヒット)。

## (f)(g) latest の既存フィールド / potential 欠損時

- (f) `test_latest_and_cube_prices_together_make_exactly_one_upstream_call` の中で `latest_body["prices"][0] == 100.0` を実測(既存の `prices` は従来どおり)。`latest.root` は `itemId, latestUpdatedAt, prices, cubes, cubeOrder` の5キー(追加のみ、削除・改名なし) -- `test_latest_root_keys_match_contract` で緑
- (g) `test_latest_prices_are_unaffected_when_upstream_has_no_potential_data`: レガシー(APIキー未設定)上流(`potential` を一切持たない、完全に別形状のペイロード)で `/sf-history/latest` を叩き、`prices[0] == 50.0`(従来どおり)・`cubes == [None, None, None, None]`(推測せず null)を実測

## (h)(i)(j)(k) 契約 / pytest / web 差分ゼロ / discovery 不変

- (h) `contract/response_fields.json` 更新済み。契約テスト: `python -m pytest tests/test_response_contract.py -q` → **6 passed**
- (i) `python -m pytest . -q`(`server/sf-history/`)→ **286 passed, 1 failed**(失敗は既知の `test_build_item_list_derives_max_star_from_real_db` のみ、計画で除外対象と明記)
- (j) 初版時点: `git status --porcelain -- exp_ranking/web` → 出力なし(差分ゼロ)。追補コミットで `contract.test.js` のみ変更(下記「追補」参照、(o) として再掲)
- (k) `discovery.py` / `scripts/scan_discovery.py` / `scripts/poll_discovery.py` は無変更(`git status --porcelain` の変更ファイル一覧に含まれない)。discovery 系エンドポイントの上流アクセスはゼロのまま(元々このスライスは discovery を一切触っていない)

## (l) APIキー

ログ・応答・報告書・コミットいずれにも値を出していない。実データ確認(本番 Open API `data.currentPrices.potential` の形、item 1382265)は `MSU_OPEN_API_KEY`(`~/.lulumi-tools/raffle-api.env`)をローカルで読んで1回叩いたが、鍵の値は一切出力していない(出力したのは `potential` の6キー・step・price・startDate のみ、いずれも非秘匿の価格データ)。

## 追補: `contract.test.js` の赤の解消(統括裁定 2026-08-22)

初版報告で「★要検収事項」として挙げた `exp_ranking/web/src/sfhistory/integrations/contract.test.js` の赤について、統括裁定: 「検出器が求めているのは沈黙ではなく認識。`INTENTIONALLY_DROPPED` に明示列挙するのが正しい応答であり、制約(`exp_ranking/web` 差分ゼロ)のほうを見直す」。以下を実施(新規コミット、`ef421d0`/`a12eb94` は無改変):

- `INTENTIONALLY_DROPPED.latest.root` に `"cubes"`/`"cubeOrder"` を明示追加(コメントで理由・次スライスでの解消条件を明記)。`response_fields.json`(サーバー側の正)は無改変
- `describe("contract: /sf-history/latest")` のフィクスチャ payload に実際のサーバー形状どおり `cubes`/`cubeOrder` を追加(現実の contract を反映)
- **(n) 検出器の厳格さを固定するテストを追加**: `describe("contract detector regression guard (accept criterion (n))")` -- `INTENTIONALLY_DROPPED` にも無く `normalizeLatestPayload` も通さない仮想フィールド `"totallyNewUndocumentedField"` を含む契約リストで `assertContractFieldsSurvive` を呼び、`toThrow(/totallyNewUndocumentedField/)` を実測。**「未知の列挙」を許すような緩和(例: 部分一致・サブセット許容)は一切していない** -- 個々のフィールドを明示列挙する方式のまま

### (m) `npx vitest run` 全緑(実測)

```
Test Files  64 passed (64)
     Tests  824 passed (824)
```

`contract.test.js` 単体: `Test Files  1 passed (1)` / `Tests  6 passed (6)`(旧5テスト + 新規の regression guard テスト1本)。

### (n) 検出器の厳格さ維持(テストで固定・実測)

`contract detector regression guard (accept criterion (n))` の1テストが上記6件に含まれ、緑。このテストは「未列挙のフィールドが来たら必ず落ちる」ことそのものを検証しているため、**将来サーバーが別のフィールドを `latest` に足しても、`INTENTIONALLY_DROPPED` にも `normalizeLatestPayload` にも反映しない限り `describe("contract: /sf-history/latest")` は同じ理由で再び赤くなる**(検出器は生きたまま)。

### (o) `exp_ranking/web/` の差分は `contract.test.js` のみ(実測)

```
$ git status --porcelain -- exp_ranking/web
 M exp_ranking/web/src/sfhistory/integrations/contract.test.js
```

`sfhistory/` のコンポーネント・domain・`sfHistorySource.js`(`normalizeLatestPayload` 本体)は無変更。

### (p) pytest / Python 契約テスト(再実測・本追補では無変更のため同値)

```
$ python -m pytest . -q   (server/sf-history/)
286 passed, 1 failed  # 既知の test_build_item_list_derives_max_star_from_real_db のみ

$ python -m pytest tests/test_response_contract.py -q
6 passed
```

### コミット

- 追補分は**新規コミット1本**(`ef421d0`/`a12eb94` は書き換えなし)。`git push` 未実施
- 対象ファイル: `exp_ranking/web/src/sfhistory/integrations/contract.test.js`、本報告書(`docs/reports/SH40_CUBE_API.md`)
