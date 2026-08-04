# IMPL_PLAN_SH2 — 履歴 SQLite スキーマ + 再開可能バックフィル(メインPC)

設計正典: `docs/DESIGN_SF_COST_HISTORY.md`(r2・承認済)。本スライスは §13 の SH-2。
前提: **SH-1 完了**(`22f7bc8`)/ **SH-1b 完了**(`35b2bbf`)。前提 P1〜P4・P10〜P14 は §2 の表が正。

## 0. 目的と背景

**28装備 × 22段階 × 150日分の1時間足を、手元PCで SQLite に取り切る。**
以降のスライス(4h 導出・配信・画面)は、このデータが在ることを前提にする。

**実行場所はメインPC**(設計書 §5.3・ユーザー確定)。**VPS には触らない**。

## 1. スコープ

**作るもの**(すべて新規):
- `server/sf-history/schema.sql` — テーブル定義(§3)
- `server/sf-history/db.py` — 接続・スキーマ適用・UPSERT・進捗の読み書き
- `server/sf-history/fetcher.py` — 公式 API 取得(レート制御・再試行)。**SH-1 の `probe.py` の Fetcher の規律を踏襲**
- `server/sf-history/scripts/gen_item_list.py` — 対象装備リスト生成(§4)
- `server/sf-history/scripts/backfill.py` — 再開可能バックフィル本体
- `server/sf-history/scripts/audit_high_star_plateau.py` — **§9.2(☆20/21/22 同値)の集計**
- `server/sf-history/data/sf_history_items.json` — 生成された装備リスト(**コミットする**)
- `server/sf-history/data/.gitignore` — `*.sqlite*` を無視(**DB はコミットしない**)
- `server/sf-history/requirements.txt` / `requirements-dev.txt`
- `server/sf-history/README.md`
- `server/sf-history/tests/` — pytest(**オフライン。公式 API を叩かない**)
- `docs/reports/SH2_BACKFILL.md` — **結果報告書**

**触らないもの**(1つでも触れたら停止):
- `exp_ranking/` 配下すべて / `.github/workflows/` / `server/img-proxy/` 配下すべて
- `docs/DECISION_LOG.md` / `docs/DESIGN_SF_COST_HISTORY.md`(更新は統括)
- **`C:\Users\pachi\Desktop\maplenEnhancebot` は読み取り専用**(§4 で読むが、**1バイトも書かない**)
- **`C:\Users\pachi\Desktop\msu ranking`(元ツリー)には一切触らない**
- **VPS(163.44.118.206)には接続しない**(SH-6 の仕事)

**依存**: `requests` のみ(bot と同じ `>=2.32.3,<3`)。**新規依存の追加は禁止**。

## 2. 公式 API への負荷(厳守)

- **並列数 1(逐次)**・**リクエスト間隔 1.0 秒以上**
- **リクエスト予算 = 700**(616 + 再試行余裕)。超えたら例外で止める(`probe.py` と同じガード)
- **429 が返ったら指数バックオフ**(例 5s→15s→45s)。**3回連続で 429 なら停止条件**
- User-Agent を明示。全リクエストをログに残す(**SH-1 の P2 指摘への対応=手動確認も必ず同じ Fetcher を通す**)

## 3. スキーマ

```sql
CREATE TABLE IF NOT EXISTS sf_price_history_hourly (
    item_id           INTEGER NOT NULL,
    item_upgrade      INTEGER NOT NULL,
    price_at          TEXT    NOT NULL,   -- ISO8601 UTC ("2026-08-04T16:00:00Z")
    step              INTEGER,
    avg_price         REAL,
    max_price         REAL,
    min_price         REAL,
    end_price         REAL    NOT NULL,   -- NESO。SH-1 M1 より無換算で入れる
    sum_enhance_count INTEGER NOT NULL DEFAULT 0,
    fetched_at        TEXT    NOT NULL,
    PRIMARY KEY (item_id, item_upgrade, price_at)
);

CREATE TABLE IF NOT EXISTS sf_history_backfill_progress (
    item_id      INTEGER NOT NULL,
    item_upgrade INTEGER NOT NULL,
    status       TEXT    NOT NULL,   -- 'done' | 'error'
    row_count    INTEGER NOT NULL DEFAULT 0,
    oldest_at    TEXT,
    newest_at    TEXT,
    updated_at   TEXT    NOT NULL,
    note         TEXT,
    PRIMARY KEY (item_id, item_upgrade)
);
```

**★ `end_price` は換算しない。** SH-1 M1 で `closePrice / endPrice = 1e18` が確定しており、
`endPrice` はそのまま NESO。**換算コードをどこにも書かないこと**(書けば 1e18 のズレを持ち込む口になる)。

`sf_price_history_4h` は **SH-3 の仕事**。本スライスでは作らない。

## 4. 対象装備リストの生成(設計書 §7)

`gen_item_list.py` は **maplenEnhancebot を読み取り専用で参照**して生成する:

- `load_priority_representative_item_ids()` … 代表 item_id 群
- `build_priority_item_to_representative_map()` … グループ内の全 item_id → 代表
- 除外: `1113282`(Noble Ifia's Ring)/ `1122254`(Mechanator Pendant)。**除外理由を JSON に残す**

出力 `data/sf_history_items.json`:
```json
{ "generatedAt": "...", "sourceRepo": "maplenEnhancebot", "sourceCommit": "<hash>",
  "excluded": [{ "itemId": 1113282, "reason": "..." }],
  "items": [{ "itemId": 1382265, "itemName": "...", "aliasItemIds": [ ... ] }] }
```

**受け入れ: `items` が 28件ちょうど。** 28 にならなかったら**停止して実数と内訳を報告**
(maplenEnhancebot 側で priority が変わった可能性=設計の前提が動いた事象)。

参照方法は問わない(`sys.path` 追加でも subprocess でも)。**maplenEnhancebot に書き込まないこと**が唯一の条件。

## 5. バックフィルの要件

- 対象: 28装備 × `itemUpgrade` **0..21**(22段階)。★**22 は取得しない** — 本ツールの上限は☆22 到達で、
  必要な価格は「☆21→22」= `itemUpgrade=21` まで(設計 §9.1 の `requiredPriceStars` の最大値)
- 取得窓: 現在から **160日前 〜 現在**(実データは 149.7日分。余裕を持たせて要求する)
- **1件ずつ即座に SQLite へ書く**。全部終わってからまとめて書かない
- **再開可能**: 起動時に `sf_history_backfill_progress` の `status='done'` を読み、**その組み合わせをスキップ**
- `--limit N` で件数を絞って試走できること(検証用)

## 6. 受け入れ基準(数値・機械判定)

- **(a)** `sf_history_items.json` の `items` が **28件ちょうど**
- **(b)** `sf_history_backfill_progress` に `status='done'` が **616行**(28×22)。
  未達なら**失敗した組み合わせを全件列挙**
- **(c)** `sf_price_history_hourly` の総行数を報告(**概算 216万行 = 616 × 約3510**。
  ±10% を外れたら理由を説明する)
- **(d)** **再開の実証**: 途中まで実行 → 中断 → 再実行し、
  **2回目のリクエスト数が「残り件数」と一致する**ことを数値で示す(`--limit` を使ってよい)
- **(e)** **重複ゼロ**: `SELECT COUNT(*) - COUNT(DISTINCT item_id||'/'||item_upgrade||'/'||price_at)` = **0**
- **(f)** DB ファイルサイズの実測値(MB)。**300MB を超えたら報告に理由を書く**
- **(g)** **429 が 0 件**。総リクエスト数と内訳を報告
- **(h)** **★§9.2 の集計**: `audit_high_star_plateau.py` で、各装備について
  `item_upgrade=20/21` の `end_price` 系列(同一 `price_at` 同士)が**完全一致するか**を判定し、
  **「完全一致した装備数 / 一致しなかった装備数 / 一致しなかった装備の不一致点数」**を報告する
  （※ `item_upgrade=22` は取得対象外なので、判定は 20 と 21 の2系列で行う）
- **(i)** pytest 全緑(**オフライン**。ネットワークを叩くテストを書かない)
- **(j)** `git status` に `*.sqlite*` が現れない(gitignore が効いている)
- **(k)** `cd exp_ranking/web && npm run build` が通る(**web を触っていないことの確認**)

## 7. 停止条件(該当したら止めて選択肢+推奨付きで統括に報告)

1. **429 が3回連続**、または合計5回を超えた
2. リクエスト予算 700 を使い切っても (b) が埋まらない
3. **`items` が 28件にならない**(§4)
4. DB が **500MB** を超えた(見積りの2.5倍=前提が崩れている)
5. `end_price` に `null` や負値、または `closePrice` と桁が合わない値が混ざる
   (**SH-1 M1 の 1e18 と矛盾する事象**=単位の前提が崩れる)
6. §1 の「触らないもの」に触る必要が生じた
7. 完走に **2時間**を超えそう(見積り: 616×1.0s ≈ 11分 + 処理時間)

**§9.2 の集計結果((h))が「全装備で完全一致」だったとしても、それは停止条件ではない。**
**事実として報告すること**(判断は統括が行う)。

## 8. コミット

- **ローカルコミットを行う**。2コミット推奨:
  ① スキーマ・db・fetcher・スクリプト・テスト ② `sf_history_items.json` + 報告書
- **`git push` は行わない**(ユーザー専権)。
- **`git add -A` 禁止**。追加したファイルのみ個別 add。**DB ファイルを add しない**。

## 9. 完了報告テンプレ

```
## SH-2 完了報告
- コミット: <hash>(各1行要約)
- (a) items 件数: <n> / 除外: <listed>
- (b) progress done: <n>/616(失敗があれば全件列挙)
- (c) hourly 総行数: <n>(見積り 216万との比 <n>%)
- (d) 再開実証: 1回目 <n> 件 → 中断 → 2回目のリクエスト数 <n>(残り <n> と一致)
- (e) 重複: <n>(0 であること)
- (f) DB サイズ: <n> MB
- (g) 総リクエスト数 <n> / 429: <n> 件
- (h) ★☆20/21 系列: 完全一致 <n>装備 / 不一致 <n>装備(不一致装備の不一致点数を列挙)
- (i) pytest: <n> passed
- (j) git status に sqlite が無いこと
- (k) npm run build: 結果
- 停止条件に触れた事項(あれば)
- 設計書との矛盾(あれば。**自分で設計書を直さずここに書く**)
- 気づいたが本スライスでは扱わなかったこと:
```
