# SH-7 完了報告 -- 進行中バケットの暫定表示 + 現在価格キャッシュ 5分

計画: `docs/IMPL_PLAN_SH7.md` / 設計 r2 §6・§6.1・§9・§10.1〜10.3(本スライスは §9 を部分的に覆す)。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## コミット

1. `d4c9b25` -- `feat(sf-history): SH-7 -- provisional in-progress bucket point, 5-min latest TTL`
   (`app.py` / `fetch_latest.py` / `README.md` / `tests/test_app.py` / `tests/test_fetch_latest.py`)
2. `f68d0aa` -- `feat(sfhistory): SH-7 -- render provisional point, exclude it from stats`
   (`domain/series.js` / `domain/series.test.js` / `components/SfHistoryChart.jsx` /
   `integrations/sfHistorySource.js` / `integrations/sfHistorySource.test.js` / 6ロケール)
3. 本コミット -- `docs(sf-history): SH-7 completion report`

## (a) ★4h テーブルが不変(最重要基準)

本スライスのコードは `sf_price_history_4h` に一切書き込まない(`prices()` は
`LatestPriceCache` から読んだ値を **レスポンスの `points` 配列に足すだけ**)。
実データ(VPS 転送前のローカル DB、577,792行)で前後比較:

| | 行数 | ハッシュ(`aggregate.content_hash`) |
|---|---|---|
| **実装直後**(`/prices` を28装備で1巡+再アクセス数回のあと) | 577792 | `b83bb70a6ebe3158ad9993264b9a87d54ec4405e87ce31de5ed4aae26e7ffd78` |
| **その後さらに3装備を追加アクセス**(新しい `latest` フェッチを誘発) | 577792 | `b83bb70a6ebe3158ad9993264b9a87d54ec4405e87ce31de5ed4aae26e7ffd78` |

**完全一致。** 加えて pytest に決定性の単体テストを追加した
(`test_prices_provisional_point_is_never_persisted_to_the_4h_table`):
同じ item に対し、暫定値が呼び出しごとに変わる fake cache で `/sf-history/prices` を3回叩き、
`db.count_4h_rows` / `aggregate.content_hash` が前後で完全一致することを固定。

## (b) `provisional: true` の点はちょうど1つ / 無いときは0個

- 進行中バケットがあるとき: `test_prices_appends_a_provisional_point_from_the_shared_latest_cache` --
  `points` 末尾にちょうど1つ、`provisionalDate` がその点の `date` と一致。
- 進行中バケットがすでに確定済み(現在のバケット境界が偶然すでに4hテーブルにある)とき:
  `test_prices_has_no_provisional_point_when_the_current_bucket_is_already_confirmed` --
  0個(かつ `latest` キャッシュに一切触れない -- `ExplodingCache` で担保)。
- 上流失敗時: (d) 参照、0個。

**実機(ローカル API `127.0.0.1:8785`, 実データ)で確認**:
```
GET /sf-history/prices?itemId=1003720
  endDate:         "2026-08-04T20:00:00Z"   (最後の確定バケット)
  provisionalDate: "2026-08-05T00:00:00Z"   (進行中バケット = 現在時刻 01:39 UTC が入っている区間)
  points.length:   900 (確定899 + 暫定1)
  points[899]:     { date: "2026-08-05T00:00:00Z", prices: [...], provisional: true }
```

## (c) `endDate` は確定バケットの最後のまま

上記実機確認のとおり `endDate = "2026-08-04T20:00:00Z"`(暫定点の日時ではない)。
`test_prices_appends_a_provisional_point_from_the_shared_latest_cache` /
`test_prices_upstream_failure_degrades_to_200_with_confirmed_history_only` が固定。

## (d) ★上流失敗時: `prices` は 200 + 確定履歴のみ

`test_prices_upstream_failure_degrades_to_200_with_confirmed_history_only`:
`LatestPriceCache.get()` が `UpstreamLatestError` を送出するようにモックし、
`/sf-history/prices` が **200**(**503 ではない**)を返し、
`provisionalDate is None` / `points` に `provisional` な点が0個 / 確定履歴2点はそのまま、を確認。
`/sf-history/latest` 単体は既存どおり 503 のまま(変更していない -- `test_latest_upstream_failure_is_503_not_a_historical_fallback` は無改変で緑)。

## (e) 統計に暫定点が入らない(1ビットも変わらない)

`computeStats` / `currentPercentile`(`exp_ranking/web/src/sfhistory/domain/series.js`)を
`point.provisional` でフィルタするよう変更。JS 側テストで固定:

- `computeStats`: "IMPL_PLAN_SH7 (e): a provisional point never changes average/high/low/count, however extreme its value"
  -- 暫定点の値を `0.01` および `999999` に振っても `computeStats` の結果が確定点のみの場合と `toEqual` で完全一致。
- `currentPercentile`: 同様に、暫定点を `999999` にしても percentile が不変であることを固定。

`buildExpectedSeries` は `point.provisional` を素通しでシリーズ要素に付与するだけで、
Expected の計算自体([欠損ゲーティング含む])は暫定点・確定点で完全に同一ロジック
(`buildExpectedSeries carries the provisional flag through` describe ブロックで確認)。

## (f) TTL

- `fetch_latest.DEFAULT_TTL_SECONDS == 300.0`(`test_default_ttl_is_300_seconds`)
- 既定(未上書き)で 300 秒キャッシュされ、301 秒経過後に再フェッチすることを固定
  (`test_cache_uses_the_default_300s_ttl_when_not_overridden`)
- `SF_HISTORY_LATEST_TTL_SECONDS` 環境変数での上書き:
  `test_latest_cache_ttl_defaults_to_300_seconds` / `test_latest_cache_ttl_is_overridable_via_env` /
  `test_latest_cache_ttl_falls_back_to_default_on_a_non_numeric_env_value`
- **単一プロセスの生存期間中、TTL は起動時に一度だけ読む**設計にした
  (`app.py::_build_latest_cache`)。理由: `LatestPriceCache` はプロセス寿命の長寿命インスタンスで、
  TTL はそのオブジェクトの内部状態に焼き込まれるため、他の設定(CORS/DBパス)のような
  「毎リクエスト env を読み直す」パターンは意味を持たない(読み直しても既存インスタンスの
  `_ttl_seconds` は変わらない)。
- **実機で上流呼び出し回数を確認**(ローカル API、実データ、実際の `msu.io` 呼び出し):
  28装備すべてに初回アクセス(コールドキャッシュ)後、同一 itemId への2回目以降のアクセスは
  すべて `~0.033s`(cold: `~0.03〜0.10s` 対 warm: `~0.033s` で明確に速い= 上流を叩いていない)。

## (g) `npm run test` / `npm run build` / `pytest`

```
pytest tests/               77 passed
npm run test -- --run       38 files / 372 tests passed
npm run build                success (dist/index.html 2.71kB, index-*.js 1,104kB/gzip 314kB -- 既存の
                              チャンクサイズ警告のみ、SH-7 起因ではない)
```

## (h) 6ロケールのキー数

追加前: 各374キー(`ja`/`en`/`es`/`th`/`vi`/`zh-TW` 全て一致)。
追加後: 各**376**キー(`chart.tooltipProvisional` + `chart.provisionalLegend` の2キーを全6言語同時追加)。
`localeParity.test.js`(既存の6ロケール完全一致テスト)は無改変のまま緑。

## (i) 触らない領域の差分ゼロ

```
git diff -w -- server/sf-history/aggregate.py server/sf-history/schema.sql \
              server/sf-history/scripts/rebuild_4h.py server/sf-history/scripts/update.py \
              exp_ranking/web/src/sfhistory/starforce.js exp_ranking/web/package.json
  -> 0 行
```

## 応答速度(停止条件②の確認: 中央値 > 500ms なら停止)

`prices` は SH-7 で `latest` キャッシュへの呼び出しが加わった(唯一の新規上流依存)。
ローカル API(実データ・実 `msu.io` 接続)で **28装備を全件コールドキャッシュ状態から**実測:

```
n=28, median=0.0801s, max=0.0989s
```

**基準の 500ms を大きく下回る**(コールド最悪ケースでも中央値 80ms、最大 99ms)。
ウォームキャッシュ時は `~33ms`(SH-3 実測の 32ms と同水準、劣化なし)。停止条件②は発生せず。

## スコープに関する申し送り(計画の隙間・停止はしていない)

計画 §1 の「変更してよい」リストは `domain/series.js` / `viewModel.js` /
`components/SfHistoryChart.jsx` を挙げていたが、`points[].provisional` フラグは
**`integrations/sfHistorySource.js` の `normalizePricesPayload`** を経由してから
`domain` 層に渡る(`SfHistoryRoot.jsx` → `sfHistorySource.loadPrices` → `normalizePricesPayload`
→ `pricesState.points` → `buildScreenModel`/`buildExpectedSeries`)。
このファイルを直さないと、サーバーが返す `provisional`/`provisionalDate` は
**このステップで静かに落ちて**domain 層に届かず、機能そのものが成立しなかった。

- `exp_ranking/ の sfhistory 以外の既存ファイル`(§1「触らないもの」)には該当しない
  (このファイルは `sfhistory/` 内)。`starforce.js`(移植物・明示的に触らない対象)でもない。
- 変更は1フィールドの素通し(`provisional: point.provisional === true` /
  `provisionalDate` の pass-through)のみで、既存の正規化ロジック・エラーハンドリングは無改変。
- 対応するテスト(`各 *.test.js` は計画の許可範囲内)を追加・既存テストの1件を更新した。

同様に `server/sf-history/README.md`(TTL 60s→300s の記述・環境変数一覧)も、
設計 §5.1 がこのファイルを「ローカル起動手順・環境変数・パス一覧」の置き場と定めているため、
本スライスの変更(TTL既定値変更 + 環境変数追加)を反映する形で更新した。

**停止せずに進めた理由**: いずれも計画の「触らないもの」明示リストには入っておらず、
機能の一部として不可欠かつ最小限(フィールド1つの素通し/ドキュメントの数字更新)。
仮に統括の意図と異なる場合は、この2ファイルの差分だけを個別に revert 可能
(それぞれ diff は数行)。

## 副次的に発見・修正した既存の欠陥(SH-7 起因ではない)

`tests/test_app.py` の既存フィクスチャが `price_at` に **リテラル日付**
(`"2026-03-08T00:00:00Z"`)を使っており、`prices()` の "直近150日" フィルタが
**実行時の実時計**に依存するため、実時計がちょうど150日+数時間進んだ時点で
(今回の実行環境で実際に発生)このリテラルが窓の外に落ち、
**SH-7 と無関係な既存テスト `test_prices_shape_and_null_slots` が壊れているのを発見した**
(SH-7 のコード変更を `git stash` して単体で再現・確認済み)。

`pytest 全緑`(g)の基準を満たすために、`_seed_db` のシード日付を
「実行時刻から2日前」を計算する相対値に変更した(`test_prices_filters_to_display_window` が
既にこのパターンを使っていたのに倣った)。**アルゴリズム(`aggregate.py`)・スキーマは無改変**、
`tests/test_app.py` 内の日付リテラルの置き換えのみ。今後この種の "カレンダー時限爆弾" が
他のテストに残っていないかは本スライスのスコープ外(必要なら別途起票)。

## ローカル起動手順(統括がブラウザで検収)

```bash
# API(すでに再起動済み -- SH-7 のコードを読み込んでいる状態):
cd server/sf-history
python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1

# 開発サーバー(起動中、HMR 有効。再起動不要のはず):
# http://localhost:5183/#/starforce
```

**確認方法(暫定点が実際に描かれる例)**:

1. `http://localhost:5183/#/starforce` を開く(既定で最初の装備が選ばれる)。
2. 期間タブは 150D のまま(または任意)。開始☆0/目標☆17 などデフォルトの範囲でよい。
3. チャート右端を見る -- **最後から2番目の点(実線の終端)→最後の点**の区間が**破線**になっており、
   最後の点のマーカーが**中抜きの丸**になっている。
4. その最後の点にカーソルを合わせると、ツールチップに「**暫定値（区間未終了）**」が出る
   (通常点の「4時間足（区間終値）」の代わりに)。
5. チャート下の注記に「破線の区間は、まだ終了していない直近の4時間足の暫定値です。」が出る
   (暫定点があるときだけ表示)。
6. 実データでの具体例(このレビュー実施時点、UTC 01:39 ごろ): `Chaos Von Bon Helmet`(itemId
   `1003720`)で `endDate=2026-08-04T20:00:00Z`(実線の最後)→ `provisionalDate=2026-08-05T00:00:00Z`
   (破線+中抜きの点)。**現在時刻が 00:00〜03:59 UTC の間はこの装備で必ず観測できる**
   (どの装備でも、UTC の 4時間境界の間は同じ現象が起きる)。
7. ネットワークタブで `/sf-history/prices?itemId=...` のレスポンス末尾に
   `{"date": "...", "prices": [...], "provisional": true}` があること、
   トップレベルに `"provisionalDate"` が入っていることも直接確認できる。

## 残課題・watch-item

- README.md の "SH-7" 参照が今後 SH-8 等で増えたときに古びないよう、必要なら次スライスで整理。
- `SF_HISTORY_LATEST_TTL_SECONDS` は VPS 環境変数にまだ設定していない(SH-6 のデプロイ設定ファイルに
  追記するかは統括判断。未設定なら既定の300秒で動く)。
- 上記「カレンダー時限爆弾」テストの同種パターンが他ファイルに残っていないかは未調査(スコープ外)。

---

# 統括検収(2026-08-05)— **合格**

以下は**統括が報告値を信用せず自分で測り直した**結果。この節より上は実装担当の原文(書き換えていない)。

## 独立に確認したこと

| # | 基準 | 統括の実測 |
|---|---|---|
| (a) | 4h テーブル不変 | `/prices` を **31回**(28装備+重複3)叩いた前後で **577,792行・SHA256先頭 `707de4ad3f05de93` が完全一致**。暫定値は保存されていない |
| (b) | 暫定点は1つ | `provisional: true` が**ちょうど1点・末尾**。確定点に `provisional` キーの混入 **0件** |
| (c) | `endDate` | `2026-08-04T20:00:00Z` = **最終確定点と一致**。暫定点の時刻 `2026-08-05T00:00:00Z` は `provisionalDate` で別に返っている |
| (e) | 統計から除外 | 暫定点の値を **`999,999,999` に改竄**しても `computeStats` が1ビットも動かない。`count=899`(確定点のみ) |
| (f) | TTL | `DEFAULT_TTL_SECONDS = 300.0`、`SF_HISTORY_LATEST_TTL_SECONDS` で上書き可 |
| — | **現在値との整合** | 暫定点由来の Expected `283,351,499.41` / `latest` 由来 `283,351,499.41`、**相対差 9.7e-12**(2桁丸めのみ)。**同じ画面に2つの「今」が食い違わない**という設計目的を達成 |
| — | 禁止領域 | `aggregate.py` / `schema.sql` / `rebuild_4h.py` / `update.py` / `starforce.js` / `package.json` の差分 **0行** |
| — | i18n | 6ロケール全て **376キー**(2キー×6同時追加)。新キーの訳文を全言語目視確認 |

## ブラウザ実機(統括)

- `.recharts-line-curve` が **2本**: 実線(確定)+ **破線 `stroke-dasharray="5 4"`**(暫定)
- 暫定点のマーカーが **中抜き**(`fill="none"` `stroke="#22d3ee"` `r="4"`)
- X軸が **08/05** まで伸びた(改修前は 08/04 止まり)
- 注記「破線の区間は、まだ終了していない直近の4時間足の暫定値です。」を表示
- `履歴の最終更新: 2026-08-04 20:00 UTC` = **確定値のまま**(暫定点に引きずられていない)

## ★報告書の不備(P2・修正済み)

**起動手順に `SF_HISTORY_ALLOWED_ORIGINS=http://localhost:5183` が抜けていた。**
報告書どおりに API を起動すると CORS で弾かれ、画面は
**「装備一覧を取得できませんでした」**しか出ない(統括が実際にこれを踏んだ)。

実装担当は「API は私が再起動、確認済み」と書いたが、**その再起動は環境変数なしで行われており**、
ブラウザから通る状態にはなっていなかった(本人はブラウザツールを使えないため気づけない)。
**手順書は「その手順に従えば再現する」ことまで含めて成果物**である。

正しい起動手順:
```bash
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

## その他(block しない)

- **P3**: ローカルに uvicorn プロセスが**3つ**残っていた(1つだけが 8785 を保持)。開発環境の後片付け
- **P3**: `/latest` は full precision、`/prices` は2桁丸め、という非対称がある。
  Expected への影響は **9.7e-12** で表示粒度では不可視だが、**将来この2つを差分比較する人が混乱しうる**
- **拾い物**: 実装担当が既存テスト `test_prices_shape_and_null_slots` の
  **カレンダー時限爆弾**(リテラル日付が150日窓から実時計でドリフトして落ちる)を発見・修正した。
  SH-7 とは無関係の潜在不具合であり、**放置すれば「ある日突然 CI が赤くなる」類**だった
