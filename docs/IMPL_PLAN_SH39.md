# IMPL_PLAN_SH39 — キューブ価格履歴の取得(スライス1: データのみ・画面なし)

**ユーザー指示 2026-08-22**:
> Red/Black/Bonus/White Bonus キューブについて、期待値ではなく**価格の履歴チャートをそのまま**表示したい。
> 現状 SF 価格は LT で見れるのに、キューブ価格は公式に行かないと見れない。
> 同じページでタブの切り替えのみでキューブ価格とその履歴が見れたら一番うれしい。
> さらに、期待値と同様に4時間足毎の中央値との乖離や現在何%かといった情報も全部表示したい。

**本スライスはデータ取得のみ。画面・API は次スライス。**

**作業ツリー**: `C:\Users\pachi\Desktop\msu ranking`(ブランチ `main`)。

## 0. ★統括が実測で確定させた前提

| # | 事実 | 実測 |
|---|---|---|
| I1 | **キューブ履歴は既存の履歴エンドポイントで取れる**。`itemUpgradeType=UPGRADE_PROSPECTIVE` + `itemUpgradeSubType=<種別>` | 6種すべて 200 |
| I2 | **応答の形は SF と同一**(`date` / `step` / `avgPrice` / `maxPrice` / `minPrice` / `endPrice` / `sumEnhanceCnt`) | 実測 |
| I3 | **粒度は1時間足・約160日**(3,767点) | Staff の BLACK |
| I4 | **`itemUpgrade` は 0 のみ有効**(キューブに星の概念が無い)。`1` / `10` は 0点 | 実測 |
| I5 | **1装備1種につき1系列**。∴ **34装備 × 4種 = 136リクエスト**(SF の 682 より軽い) | 計算 |
| I6 | **White だけ履歴が短い**(2026-06-11 開始 ≈72日)。**これは正常**(最近実装されたため。ユーザー確認済み) | 実測 |
| I7 | `aggregate.compute_buckets(rows, now=...)` は **1系列の (price_at, end_price) を取る汎用関数**。**キューブにそのまま再利用できる** | コード確認 |

## 1. ★対象の4種(ユーザー確認済み)

```
RED               Red Cube
BLACK             Black Cube
ADDITIONAL        Bonus Potential Cube
WHITE_ADDITIONAL  White Cube
```

**`SUSPICIOUS` / `SUSPICIOUS_ADDITIONAL`(Occult 系)は対象外**(ユーザー裁定)。
**この4つを定数として持つ。上流が返す全 subType を無条件に取り込まない。**

## 2. スコープ(このスライス)

| # | 内容 |
|---|---|
| A | **新テーブル**(1時間足 / 4時間足 / バックフィル進捗) |
| B | **バックフィル**(160日 × 34装備 × 4種) |
| C | **4時間足への集約** |
| D | **既存の4時間ごとの更新ジョブにキューブを追加** |

**画面・API は作らない。**次スライスで行う。

## 3. A — テーブル

**既存テーブルを変更しない**(`sf_price_history_hourly` 2.5M行 / `sf_price_history_4h` 70万行が本番稼働中)。

- **新規** `sf_cube_price_history_hourly`: 主キー **`(item_id, cube_sub_type, price_at)`**
  列は既存の hourly と同じ流儀(`step` / `avg_price` / `max_price` / `min_price` /
  `end_price` / `sum_enhance_count` / `fetched_at`)
- **新規** `sf_cube_price_history_4h`: 主キー **`(item_id, cube_sub_type, price_at)`**
  (`end_price` / `source_hour_at` / `generated_at`)
- **新規** バックフィル進捗表(既存 `sf_history_backfill_progress` と同じ役割・別表)
- **`item_upgrade` 列を作らない**(I4: 常に 0 で意味を持たない)
- **`end_price` は既存と同じく無変換で保存**(上流がそのまま NESO を返す。SF と同一)

## 4. B — バックフィル

- **既存 `scripts/backfill.py` を壊さない。** 新規スクリプトにするか、
  共通部を切り出して両方から使うかは実装担当の裁量。**既存の挙動は1ビットも変えない**
- **`fetcher.Fetcher` を使う**(レート制限・429バックオフ・予算)。
  **`fetch_history_page` は SF 専用のまま変えず、prospective 用の関数を別に足す**
- **窓は 160日**(既存 `WINDOW_DAYS` と同じ)
- **再開可能**(進捗表を見て済んだ組み合わせを飛ばす)
- **部分成功でよい**。失敗数を必ずログに出す
- **★統括が実行する。実装担当は実行しない**(コマンドを報告に書く)

## 5. C — 4時間足

- **`aggregate.compute_buckets` を再利用する**(I7)。**同関数を改変しない**
- **未終了バケットを含めない**(既存と同じ規則)
- 既存 `scripts/rebuild_4h.py` に相当するものをキューブ用に用意する

## 6. D — 更新ジョブ

**既存の `sf-history-update.timer`(01,05,09,13,17,21:43 JST)にキューブを乗せる。**

- **新しい timer を増やさない**(同じ4時間周期で足りる)
- **SF の更新を先に、キューブを後に**。**キューブ側が失敗しても SF の更新は完了する**こと
- 追加リクエストは **136/回**(既存 616 に対して +22%)。**429 が出たら報告**

## 7. スコープ(ファイル)

**変更してよい**:
- `server/sf-history/`: `schema.sql`(**追加のみ**)/ `db.py` / `fetcher.py`(**追加のみ**)/
  `scripts/`(新規スクリプト、`update.py` への追加)/ `tests/`
- `server/sf-history/deploy/`(更新ジョブの説明を直す場合)
- `docs/reports/SH39_*.md`

**触らないもの**(1つでも触れたら停止):
- **`sf_price_history_hourly` / `sf_price_history_4h` / `sf_history_backfill_progress` のスキーマとデータ**
- **`aggregate.py`**(**再利用のみ・改変禁止**)
- **`fetch_history_page` の既存シグネチャと挙動**
- **discovery 系すべて**(テーブル・スキャン・ポーリング。**リクエスト数を増やさない**)
- **`app.py` の既存4エンドポイント**(本スライスでは API を作らない)
- **`exp_ranking/web/` 配下すべて**(本スライスは画面を作らない)
- **raffle 関連すべて** / **VPS** / **maplenEnhancebot(読み取りのみ)**

## 8. 受け入れ基準

- **(a)** 4種の定数が **RED / BLACK / ADDITIONAL / WHITE_ADDITIONAL** のみ。
  **上流の全 subType を無条件に取り込まない**ことをテストで固定
- **(b)** バックフィルが **34装備 × 4種 = 136 の組み合わせ**を対象にする
- **(c) ★既存テーブルへの書き込みゼロ**(キューブの処理が SF のデータに触れない)
- **(d)** 4時間足が `compute_buckets` で導出され、**未終了バケットを含まない**
- **(e)** **再開可能**(途中で止めて再実行しても重複せず、済んだ組み合わせを飛ばす)
- **(f)** 更新ジョブで **SF が先・キューブが後**。**キューブ失敗時も SF は完了**する
  ことをテストで固定
- **(g)** `aggregate.py` / `fetch_history_page` の**差分ゼロ**
- **(h)** `pytest` 全緑 / **既存の契約テスト緑**
- **(i)** **`exp_ranking/web/` の差分ゼロ**
- **(j)** discovery のリクエスト数が増えていない
- **(k)** **APIキーをログ・応答・報告書・コミットに出さない**
  (※本エンドポイントは無認証だが、同居する Open API の鍵に触れないこと)
- **(l)** **★統括が実行するバックフィル/集約のコマンド**が報告に書かれている

## 9. 停止条件

1. **既存テーブルのスキーマを変えないと実現できない**
2. **`aggregate.py` を改変しないと 4時間足が作れない**
3. **136リクエストで 429 が頻発する**(→ 止めて報告。頻度・並列度は統括が決め直す)
4. §7 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 10. コミット

- **A+B / C / D を別コミット**(単独 revert 可)。**`git push` 禁止**。**`git add -A` 禁止**。
- **バックフィルの実行と VPS 反映は統括が行う**(実装担当は VPS に触らない)。

## 11. 完了報告テンプレ

```
## SH-39 完了報告
- コミット: <hash>(各1行)
- (a) 4種の定数(テスト名)
- (b) 136 組み合わせ
- (c) ★既存テーブル無書き込みの確認方法
- (d) 4時間足(未終了を含まない)
- (e) 再開可能
- (f) ★SF 先行・キューブ失敗時も SF 完了(テスト名)
- (g) aggregate.py / fetch_history_page 差分ゼロ
- (h)(i)(j) pytest / web 差分ゼロ / discovery 不変
- (k) APIキー
- (l) ★統括が実行するコマンド
```
