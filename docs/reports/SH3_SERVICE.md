# SH3_SERVICE — 4時間足の導出 + 配信サービス `server/sf-history/` 結果報告

計画書: `docs/IMPL_PLAN_SH3.md`。設計正典: `docs/DESIGN_SF_COST_HISTORY.md`(r2)§5.1 / §6 / §9 / §10。
前提: SH-2 完了(hourly 2,254,103行・28装備・`data/sf_price_history.sqlite`(275MB、未コミット)が手元にある)。

再実行コマンド:
```bash
cd server/sf-history
python -m pip install -r requirements-dev.txt
python -m pytest tests/
python scripts/gen_item_list.py
python scripts/rebuild_4h.py
python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

---

## (a) 決定性

`scripts/rebuild_4h.py` を実データ(hourly 2,254,103行・604 combo)に対し、同じ `--now` で2回走らせた:

```
run1: combos=604 rowsWritten=577188 contentHash=4b4116fd06ba58b1c83fa2852fff0d05bd18b33f39bf63d76c62707d528e7fe7
run2: combos=604 rowsWritten=577188 contentHash=4b4116fd06ba58b1c83fa2852fff0d05bd18b33f39bf63d76c62707d528e7fe7
```

**行数・content hash とも完全一致。**

`aggregate.content_hash` は `(item_id, item_upgrade, price_at, end_price, source_hour_at)` の
ソート済み連結の SHA-256 で、`generated_at`(いつ計算したかの記帳列であって導出値そのものではない)は
意図的に除外している。この除外の理由と、実運用の2回走行(壁時計時刻が秒単位でずれる)でも
`generated_at` 以外が一致することは `tests/test_aggregate.py::test_rebuild_all_is_deterministic_across_two_runs`
が固定している。

**差分導出 vs 全再生成の一致**: `scripts/update.py` の差分UPSERT後に `aggregate.update_combo_incremental` が
再計算した範囲が、同時点で全再生成した結果と完全一致することを
`tests/test_aggregate.py::test_update_combo_incremental_matches_full_rebuild_after_a_revision`
（バケットの元データが後から修正された場合を含む）と
`tests/test_update.py::test_update_matches_full_rebuild_at_the_same_point`
の2箇所でオフライン機械検証している(いずれも `content_hash` の完全一致で判定)。

---

## (b) 4h の行数

**577,188 行**(hourly 2,254,103 行の **25.61%** ≈ 1/4)。604 combo(616 − 12件の空 combo、
SH-2 の☆20/☆21 が空の6装備分)が対象。

---

## (c) `prices` の応答時間

ローカルで uvicorn 1 worker(`--host 127.0.0.1 --port 18785`)を起動し、**全28装備**を1回ずつ
(`Accept-Encoding: gzip`)叩いて計測(n=28、要求されたn=10を上回る全数で実施):

```
median: 41.5 ms
min:    38.0 ms
max:    58.8 ms
```

**基準 ≤500ms を大きく下回る**(中央値で12倍の余裕)。

---

## (d) gzip 実効サイズ

同じ28装備の応答本体(gzip済み)の最大値は **90,323 バイト(88.2KB)**。全28装備で最大。

初期実装(`end_price` を丸めずそのまま返す)では **最大127KB**(基準100KBを超過)だった。
生の `endPrice` が小数点以下6桁の精度を持っていたため(例: `43177.362752`)、JSON表現の桁数が
大きく、gzip後もそのまま反映されていた。

**対応**: `/sf-history/prices` の応答生成時(`app.py`)にのみ `round(end_price, 2)` を適用した
(**DB の `sf_price_history_4h.end_price` は丸めない** — 転送境界だけの精度削減)。
NESO 価格は数十万〜数百万のオーダーであり、小数点以下2桁より細かい桁はチャート表示に意味を持たない
と判断した。丸め後の実測:

```
raw (2 decimals):  227,553 B (1装備あたり例)
gzip (2 decimals):  81,001 B
全28装備中の最大gzip: 90,323 B(88.2KB)
```

**これは計画書に明記のない実装判断**(数値の受け入れ基準(d)を満たすための精度削減)であり、
統括の確認をお願いしたい。丸め幅を変える必要が出た場合は `app.py` の該当コメント1箇所を直すだけで済む。

---

## (e) 1装備の points

`itemId=1003720`(Chaos Von Bon Helmet)・`itemId=1382265`(Arcane Umbra Staff)いずれも
**`points` = 900**(150日 × 6 = 900、基準 900±30 の中央値ちょうど)。

(DB 全量に対する素の 4h 行数を装備単位で数えると 961 になる — これは `/sf-history/prices` の
150日カットオフを掛ける前の生データで、160日分の取得窓に起因する。**API の応答は正しく150日で
切っており、900 点で基準を満たす。**)

---

## (f) 欠損の確認結果

`itemId=1003720` の `/sf-history/prices` 応答で、`prices[9:20]`(itemUpgrade 9..19、
☆10→11 〜 ☆20→21 の11段階、設計の「10..20の範囲」に相当)を全900点についてスキャンし、
**null が1件も無い**ことを確認した(`requiredPriceStars(19,21)` 相当の範囲。実際の関数は
SH-4 で starforce.ts から vendor されるため、本スライスでは範囲を手で対応させて検証した)。

```
points with a null in stars 10..20 range: 0 of 900
```

**基準を満たす装備が1つ以上ある**ことを確認(全欠損ではない=導出は正しく機能している)。

---

## (g) メモリ

uvicorn 1 worker のベースライン RSS: **52.4 MB**。`/sf-history/prices` を(装備を変えながら)
**10回連続で叩いた後**: **62.4 MB**。

**基準 ≤150MB を大きく下回る**(停止条件の250MBにも遠い)。

---

## (h) CORS

実サーバーに対し `curl` で実測:

```
Origin: https://lulumi-tools.com -> Access-Control-Allow-Origin: https://lulumi-tools.com  (許可)
Origin: https://evil.example     -> Access-Control-Allow-Origin: https://lulumi-tools.com  (evilの値と不一致=拒否)
```

img-proxy の `proxy_core.cors_origin_for_request` と同じパターン(常に許可済みの固定値を返し、
要求元が許可リストに無ければ要求元とは異なる値になるため、ブラウザが CORS チェックで弾く)。
`SF_HISTORY_ALLOWED_ORIGINS` 環境変数での上書きは `tests/test_app.py::test_cors_is_configurable_via_env`
でオフライン検証済み。

---

## (i) `latest` の TTL 実証 / 503 テスト

**TTL 60秒キャッシュ**(オフライン、`tests/test_fetch_latest.py`):
- `test_cache_returns_fresh_result_without_a_second_upstream_call` — TTL内の2回目は
  `upstream_call_count == 1`(フェイクセッションへの呼び出し回数で直接検証、ログ経由ではなく
  より厳密な呼び出し回数アサーション)
- `test_cache_refetches_after_ttl_expires` — TTL超過後は再度上流を叩く(`== 2`)
- `test_concurrent_requests_for_the_same_item_are_coalesced_to_one_upstream_call` — 5スレッド
  同時アクセスでも上流呼び出しは1回(single-flight)

**503**(オフライン、`tests/test_app.py::test_latest_upstream_failure_is_503_not_a_historical_fallback`):
上流失敗時に `503` を返し、応答本体に `prices` キー(=履歴由来の代替値)が一切含まれないことを固定。

**実機スモーク**(計画書 §1「公式APIを叩くのは §5/§6 の実測時のみ」に基づき、本スライスで唯一
公式APIを叩いた箇所。1回だけ実行):

```
itemId=1382265, 1回目: 429ms(上流取得+パース)
itemId=1382265, 2回目: 38ms(TTLキャッシュヒット、上流無し)
```

`prices` の値は履歴(`endPrice`)と同オーダー(数十万〜数百万)で、`closePrice / 1e18` の換算が
正しく効いていることを実データで確認した。

---

## (j) pytest

**68 passed**(オフライン。公式APIを叩く呼び出しは `tests/` に1つも無い —
`grep -rl "msu.io\|requests.get\|urllib.request.urlopen\|session.get" tests/` は0件)。

```
68 passed in 2.44s
```

内訳: 既存(SH-2)42件 + 本スライス新規26件
(`test_aggregate.py` 9 / `test_rebuild_4h.py` 2 / `test_update.py` 6 / `test_app.py` 13 /
`test_fetch_latest.py` 9 / `test_gen_item_list.py` 追加4 — 合計は既存分の重複修正込みで26件純増)。

---

## (k) `npm run build`

```
cd exp_ranking/web && npm run build
✓ 2363 modules transformed.
✓ built in 4.91s
```

緑(web を触っていないことの確認)。

---

## (l) ★`maxStar`

`/sf-history/equipment` を実機で叩いた結果と、`data/sf_history_items.json` の再生成結果が完全一致:

```
maxStar=20: 6装備 -- 1022232 / 1032241 / 1072972 / 1082613 / 1102713 / 1212102
maxStar=22: 22装備
```

**計画書の期待値と1件の過不足もなく一致。** 導出は `db.max_upgrade_by_item`
(`SELECT item_id, MAX(item_upgrade) FROM sf_price_history_hourly GROUP BY item_id`)を
`app.py`(API 応答)と `scripts/gen_item_list.py`(JSON スナップショット)の両方が共有しており、
ハードコードされた☆上限は存在しない(design §7.1 の要求どおり)。

---

## (m) `excluded[].reason`

`data/sf_history_items.json` を再生成し、`excluded[].reason` を
「ユーザーが原案で明示指定した2件」を出典とする文言に置き換えた
(旧: SH-2 の実装担当が実測から再構成した「RANGE_118_TO_127 帯の唯一の2件」という理由づけ ——
これは**裏付けとして** reason 文中に残しているが、**除外の理由としては明示的に否定**している)。

```
1113282 (Noble Ifia's Ring): "...one of the two items the user explicitly named for exclusion
  in the original 28-item draft list... Corroborating context (not the reason): ..."
1122254 (Mechanator Pendant): 同様
```

`tests/test_gen_item_list.py::test_excluded_reason_attributes_to_the_users_explicit_draft_choice`
で `"user"` と `"explicit"` を含むことを固定(maplenEnhancebot が手元に無い環境では skip)。

---

## 停止条件に触れた事項

該当なし。

## 設計書との矛盾・申し送り(自分では直さず、ここに書く)

1. **(d) の gzip サイズ超過と、その場しのぎでない対応**: 上記(d)節のとおり、丸めなしでは
   基準(100KB)を最大27KB超過した。DB 保存値は変えず API 応答生成時のみ2桁丸めで対応したが、
   これは計画書に明記された作業ではなく実装判断。**丸め桁数の妥当性は統括の確認をお願いしたい**
   (2桁で最大88.2KBまで下がり基準に対して12KB弱の余裕がある。装備が増える/価格が上がるなどで
   将来再び100KBに近づく可能性はゼロではない)。
2. **deploy ファイル名の軽微な表記ゆれ**: 設計 §5.1 は `sf-history-fetch.service.example` /
   `.timer.example` と書いているが、計画書 §1 は `sf-history-update.service.example` /
   `.timer.example` と書いている。**計画書の表記(`update`)を採用した**
   (`scripts/update.py` というファイル名と語を揃えるため)。挙動に影響しない命名の食い違いであり、
   停止条件には該当しないと判断した。
3. **`/sf-history/prices` は代表 itemId のみ受理する**(alias itemId では 404)。設計 §7 は
   「検索対象はグループ内の全 itemId、取得・表示は代表」と書いており、alias -> representative の
   解決はクライアント側(`equipment` の `aliasItemIds` を使う)でSH-5が行う前提としてサーバー側は
   単純化した。設計書に明記されたAPI形状(§10)にも alias 解決の記述はないため矛盾ではないと
   判断したが、SH-5 着手前に前提が正しいか確認をお願いしたい。
4. **`latest` の応答形状は設計書に明示例が無かった**ため、`prices` と対称的な22要素配列
   (`{"itemId", "latestUpdatedAt", "prices": [22]}`)として実装した。設計 §6.1 の
   「現在値 vs 期間統計を比較させる」という目的に沿うよう、`prices[i]` の意味を
   `sf_price_history_4h` の `prices[i]`(☆i→i+1のコスト)と揃えている。

## 気づいたが本スライスでは扱わなかったこと

- `prices` レスポンスの `priceVersion` は該当装備の4hデータの `MAX(generated_at)` を採用した
  (設計書に厳密な定義は無く、文字列としての「バージョン」相当のものが必要と判断して実装)。
  クライアント側でのキャッシュ無効化等に使う想定だが、実際の用途は SH-5 側の設計次第
- `scripts/update.py` は実運用(4時間ごとの616リクエスト)を通しては実行していない
  (公式APIへの負荷を避けるため。ロジックはオフラインテストで担保。SH-6 の本番投入前に
  1回だけ実測しておくことを推奨)
