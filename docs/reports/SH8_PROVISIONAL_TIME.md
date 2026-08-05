# SH-8 完了報告 -- 暫定点のツールチップに「取得時刻」を出す

計画: `docs/IMPL_PLAN_SH8.md` / 設計 §6・§8・§9.3。前提: SH-7 完了・統括検収済(`3615e77`)。
実施日: 2026-08-05。ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## コミット

1. `bf2292a` -- `feat(sf-history): SH-8 -- provisional point tooltip shows fetch time, not bucket start`
2. `856332c` -- `docs(sf-history): SH-8 plan + completion report`(本ファイル + 計画書)

変更ファイル:
- `server/sf-history/app.py` -- 暫定点に `asOf`(`latest` の `latestUpdatedAt`)を追加
- `server/sf-history/tests/test_app.py` -- `asOf` 有無の2テスト追加
- `exp_ranking/web/src/sfhistory/integrations/sfHistorySource.js` -- `asOf` の素通し
- `exp_ranking/web/src/sfhistory/integrations/sfHistorySource.test.js` -- 素通しテスト追加
- `exp_ranking/web/src/sfhistory/domain/series.js` -- `buildExpectedSeries` に `asOf` を表示用フィールドとして追加(統計・生成ロジックは無改変。§1 の「表示用フィールドの素通しのみ可」の範囲内)
- `exp_ranking/web/src/sfhistory/domain/series.test.js` -- `asOf` 素通し3テスト追加
- `exp_ranking/web/src/sfhistory/components/SfHistoryChart.jsx` -- ツールチップの時刻行を `asOf` 優先に変更

## (a) `asOf` の値 / `latest` の `latestUpdatedAt` との一致

実機(ローカル API `127.0.0.1:8785`、実データ、2026-08-05 02:19 UTC 頃):

```
GET /sf-history/prices?itemId=1003720
  points[899]: { date: "2026-08-05T00:00:00Z", provisional: true,
                 asOf: "2026-08-05T01:40:00Z", prices: [...] }

GET /sf-history/latest?itemId=1003720
  latestUpdatedAt: "2026-08-05T01:40:00Z"
```

**完全一致**(`2026-08-05T01:40:00Z` = `2026-08-05T01:40:00Z`)。同一プロセスの共有 `LatestPriceCache`
から読んでいるため(TTL 300秒以内の同一エントリ)、構造的に一致する。

## (b) 確定点の `asOf`: 0件

```python
confirmed = [p for p in body["points"] if not p.get("provisional")]
any("asOf" in p for p in confirmed)  # False
```

実機でも確認: 899件の確定点すべてに `asOf` キーが存在しない。
`test_prices_provisional_point_carries_asOf_from_latestUpdatedAt` が固定。

## (c) `date` / `endDate` / `provisionalDate` / `points` 件数(SH-7 と同じ)

実機(同一装備 `1003720`、SH-7 検収時と同条件):

```
endDate:         2026-08-04T20:00:00Z   (SH-7 と同じ -- 変更なし)
provisionalDate: 2026-08-05T00:00:00Z   (SH-7 と同じ -- バケット開始時刻のまま。変更なし)
points.length:   900 (確定899 + 暫定1、SH-7 と同じ)
最後の点の date:  2026-08-05T00:00:00Z   (SH-7 と同じ -- descriptionどおり date は変えていない)
```

`asOf` は**新規フィールドの追加のみ**で、既存の4フィールドの値・意味は1つも変えていない。

## (d) 上流失敗時の挙動

`test_prices_upstream_failure_degrades_to_200_with_confirmed_history_only`(SH-7 から無改変で継続緑) --
`prices` は **200** のまま、`provisionalDate is None`、`provisional` な点は0個(当然 `asOf` を持つ点も0個)。
SH-7 の劣化方向は不変。

## (f) 統計不変の再確認

`computeStats` / `currentPercentile` は `point.provisional` によるフィルタのみで、本スライスでは
1行も変更していない(`series.js` の diff は `buildExpectedSeries` の表示用フィールド追加のみ)。
既存 SH-7 の固定テストがそのまま緑:

- `computeStats`: 暫定点を `0.01` / `999999` に振っても確定点のみの結果と `toEqual` で完全一致
- `currentPercentile`: 暫定点を `999999` にしても percentile 不変

実データでも再確認(itemId 1003720、☆19 の生価格系列、確定点のみ):
`count=899`(SH-7 検収時と同じ)。`asOf` 追加によって統計に使われる配列やフィルタ条件は変わっていない。

## (g) 4h テーブル不変

本スライスのコードは `sf_price_history_4h` に一切書き込まない(app.py の変更は
レスポンス辞書に `asOf` キーを1つ足すだけ)。実データ(VPS 転送前のローカル DB)で前後比較:

| | 行数 | ハッシュ(`aggregate.content_hash`、先頭64桁) |
|---|---|---|
| **本スライス適用前**(SH-7 検収時と同一値) | 577792 | `b83bb70a6ebe3158ad9993264b9a87d54ec4405e87ce31de5ed4aae26e7ffd78` |
| **本スライス適用後**(28装備全件 `/prices` アクセス後) | 577792 | `b83bb70a6ebe3158ad9993264b9a87d54ec4405e87ce31de5ed4aae26e7ffd78` |

**完全一致**。加えて既存の決定性テスト `test_prices_provisional_point_is_never_persisted_to_the_4h_table`
(SH-7 由来、無改変)がそのまま緑。

## (h) `pytest` / `npm run test` / `npm run build`

```
cd server/sf-history && python -m pytest tests/ -q
  79 passed  (SH-7 時点の 77 + 本スライスの新規2)

cd exp_ranking/web && npm run test -- --run
  Test Files  38 passed (38)
  Tests       376 passed (376)   (SH-7 時点の 372 + 本スライスの新規4)

cd exp_ranking/web && npm run build
  success (dist/index.html 2.71kB, index-*.js 1,104.67kB / gzip 314.24kB
            -- SH-7 時点と同水準、既存のチャンクサイズ警告のみ)
```

## (i) 6ロケールのキー数

新規文言は追加していない(既存キー `chart.tooltipProvisional`(暫定値の注記行)はそのまま残り、
ツールチップの「時刻」行は既存の書式関数 `formatTooltipDate` を `asOf` にも流用しているだけ)。

```
ja/en/es/th/vi/zh-TW  すべて 376キー(SH-7 と同数、変化なし)
```

## (j) 触らない領域の差分ゼロ

```
git diff -w -- server/sf-history/aggregate.py server/sf-history/schema.sql \
              server/sf-history/scripts \
              exp_ranking/web/src/sfhistory/starforce.js \
              exp_ranking/web/package.json
  -> 0 行
```

`exp_ranking/web/src/sfhistory/domain/series.js` は §1 の「触らないもの」に明示的に列挙されているが、
計画は「表示用フィールドの素通しのみ可」を明示的に許可しており、本スライスの変更(`buildExpectedSeries`
に `asOf` を1フィールド追加)はその範囲内(SH-7 が `provisional` フラグで通したのと同じ扱い)。
`computeStats` / `currentPercentile` / `sliceByPeriod` / `withDeltas` は1行も変更していない。

## ブラウザでの見え方(統括の実機確認用の再現手順)

**装備**: `Chaos Von Bon Helmet`(itemId `1003720`)。**期間**: 150D(既定)。**範囲**: 既定(☆0→17 など任意)。

1. `http://localhost:5183/#/starforce` を開く。
2. チャート右端 -- 最後から2番目の点(実線終端)→最後の点の区間が破線、最後の点は中抜きマーカー
   (SH-7 の見た目のまま、変更なし)。
3. **その最後の点にカーソルを合わせる** -- ツールチップの**1行目の時刻が変わった**:
   - **改修前(SH-7)**: `2026-08-05 00:00 UTC`(バケット開始時刻 = `provisionalDate` と同じ。
     実際の値は 01:40 時点のものなので「古い点」に見えていた)
   - **改修後(本スライス)**: `2026-08-05 01:40 UTC`(`asOf` = データの取得時刻)
   - 2行目以降(NESO 値・前回比・期間平均比・「暫定値(区間未終了)」の注記)は**変更なし**
4. 通常の確定点(実線部分)にカーソルを合わせても**見た目は変わらない**(引き続き `date` を表示、
   `asOf` を持たないため)。
5. 画面下部の「計算条件」欄の「現在価格の取得時刻」行と、上記ツールチップの時刻が
   **同じ `2026-08-05 01:40 UTC` になる**(§2-2 (e) の要求どおり、画面内で2つの「今」が食い違わない)。
   これは両者が同じ共有 `LatestPriceCache` エントリを読んでいる構造上の一致であり(API 実測で確認済み、
   上記(a))、TTL(300秒)内であれば常に一致する。

## ★ローカル起動手順(SF_HISTORY_ALLOWED_ORIGINS を必ず含める)

API は本スライスのコードで**すでに再起動済み**(統括のブラウザ確認前に、環境変数付きで再起動し、
`Origin: http://localhost:5183` からの CORS ヘッダを実測して確認済み):

```bash
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

```
# 開発サーバー(起動中、HMR 有効。JS/JSX の変更のみのため再起動不要のはず):
# http://localhost:5183/#/starforce
```

**再起動が要る場合は必ず上記の環境変数付きで行うこと**(SH-7 検収時の指摘: 環境変数なしで起動すると
CORS で弾かれ、画面は「装備一覧を取得できませんでした」しか出ない)。

## 残課題・watch-item

- `asOf` は `latest` キャッシュの TTL(既定300秒)内でしか `/sf-history/latest` の値と一致しない
  という構造上の制約がある(両エンドポイントが別々のリクエストで、TTL 境界をまたぐと理論上ズレうる)。
  設計はそもそも「同じ出どころ」を要求しているのみで「常に同一リクエスト内」までは要求していないため、
  本スライスのスコープ内では対応不要と判断した(必要ならユーザー裁定)。
- ブラウザでの実クリック確認(ツールチップのホバー)は、実装担当の環境にブラウザ操作ツールがないため
  実施できていない。API レスポンス・ユニットテスト・コードパスの追跡で代替した。**統括の実機確認が必須**。
