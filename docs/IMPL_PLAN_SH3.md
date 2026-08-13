# IMPL_PLAN_SH3 — 4時間足の導出 + 配信サービス `server/sf-history/`

設計正典: `docs/DESIGN_SF_COST_HISTORY.md`(r2・承認済)§5.1 / §6 / §9 / §10。本スライスは §13 の SH-3。
前提: **SH-2 完了**(hourly が揃っている)/ **SH-1b 完了**(ポート 8785・メモリ制約)。

## 0. 目的と背景

hourly から 4時間足を導出し、**FastAPI で配信できる状態にする**。
**本スライスでは VPS に置かない**(SH-6 の仕事)。ローカルで起動・検証するところまで。

構成は **`server/img-proxy/` の流儀をそのまま踏襲する**(前例を発明し直さない)。

## 1. スコープ

**作るもの**:
- `server/sf-history/aggregate.py` — hourly → 4h の決定的導出(§3)
- `server/sf-history/scripts/rebuild_4h.py` — 4h 全再生成
- `server/sf-history/app.py` — FastAPI(§4)
- `server/sf-history/fetch_latest.py` — 現在価格の取得 + TTL キャッシュ(§5)
- `server/sf-history/scripts/update.py` — **4時間ごとの差分取得ジョブ**(ワンショット)
- `server/sf-history/deploy/Caddyfile.example` / `sf-history.service.example` /
  `sf-history-update.service.example` / `sf-history-update.timer.example`
- `server/sf-history/tests/` の追加分(**オフライン**)
- `server/sf-history/README.md` 更新(起動手順・環境変数・パス一覧)
- `docs/reports/SH3_SERVICE.md` — 結果報告書

**変更してよい既存ファイル**: `server/sf-history/` 配下のみ(SH-2 で作ったもの)。

**触らないもの**(1つでも触れたら停止):
- `exp_ranking/` 配下すべて / `.github/workflows/` / `server/img-proxy/` 配下すべて
- `docs/DECISION_LOG.md` / `docs/DESIGN_SF_COST_HISTORY.md`(更新は統括)
- **VPS(163.44.118.206)には接続しない**(SH-6 の仕事)
- **公式 API を叩くのは §5/§6 の実測時のみ**。テストは必ずオフライン

## 2. ★メモリ制約(SH-1b の実測に基づく・設計 §5.1)

VPS は **available 547 MiB / Swap 既に 310 MiB 使用**。同居しているのは実ユーザーが使う本番サービス群。

- **uvicorn は 1 worker**。プロセスを増やさない
- **28装備分を常駐メモリに載せない。** 1リクエスト = 1装備分だけ組み立てて返す
- SQLite 接続は都度開閉、または単一接続の再利用。**`:memory:` への丸ごとロード禁止**
- 取得ジョブは **ワンショット + timer**(常駐禁止)。
  引き継ぎ書も「daemon 方式のまま新 VPS で enable しない」と明記している

## 3. 4時間足の導出(設計 §9)

- 区間: UTC の `00,04,08,12,16,20` 始まり
- 代表値: **区間内で最後に存在する時刻の `end_price`**
- **ラベルは区間開始時刻**
- **進行中の区間は確定しない**(ジョブ実行時点で未完了の区間は 4h に出さない)
- **星ごとに系列の開始時刻が違う**(設計 §2.2)。「全星そろってから」ではなく**星ごとに独立に**集約する

```sql
CREATE TABLE IF NOT EXISTS sf_price_history_4h (
    item_id        INTEGER NOT NULL,
    item_upgrade   INTEGER NOT NULL,
    price_at       TEXT    NOT NULL,   -- 区間開始 UTC
    end_price      REAL    NOT NULL,
    source_hour_at TEXT    NOT NULL,   -- 採用した1時間足の時刻
    generated_at   TEXT    NOT NULL,
    PRIMARY KEY (item_id, item_upgrade, price_at)
);
```

**決定性の要求**: 同じ hourly から2回生成したら **完全に同じ 4h になる**こと((a) で機械検証)。

## 4. API(設計 §10)

```
GET /sf-history/health                稼働確認
GET /sf-history/equipment             装備一覧(代表itemId + 表示名 + aliasItemIds)
GET /sf-history/prices?itemId=        4時間足・最大150日
GET /sf-history/latest?itemId=        現在価格(§5)
```

- `prices` の形は設計 §10 のとおり。`prices[0]`=☆0→1 … `prices[21]`=☆21→22。**欠損は `null`**
- **★`equipment` は装備ごとに `maxStar` を返す**(設計 §7.1)。
  **ハードコードせず `MAX(item_upgrade)+1` を hourly から導出**する。
  `sf_history_items.json` にも `maxStar` を持たせ、生成スクリプトを更新すること
- **★あわせて `sf_history_items.json` の `excluded[].reason` を訂正する**(設計 §7)。
  正しい出典は「**ユーザーが原案で明示指定した2件**」。SH-2 で書かれた再構成の理由文は**推測なので置き換える**
- **CORS は `https://lulumi-tools.com` のみ**(img-proxy の `IMG_PROXY_ALLOWED_ORIGINS` と同じ流儀。
  環境変数 `SF_HISTORY_ALLOWED_ORIGINS` で上書き可能に)
- **gzip を有効化**(FastAPI の `GZipMiddleware` で可)
- 未知の `itemId` は **404**。パラメータ不正は **400**

## 5. 現在価格(設計 §6)

- 公式 `enhance-price/latest` をサーバー側で取得。**TTL 60秒**のプロセス内キャッシュ
- **同一 itemId への同時アクセスを1リクエストに畳む**(ロックで直列化)
- **上流失敗時は 503 を返し、履歴の最終足で代替しない**(古い値を「現在値」と偽らない)
- 対象は `sf_history_items.json` に載っている28装備のみ(**任意 itemId のプロキシにしない**。
  img-proxy が「固定 upstream prefix のみ・任意 URL を受けない」としているのと同じ理由)

## 6. 差分取得ジョブ(設計 §5.2 / §5.3)

- **最終保存時刻の8時間前 〜 現在**を取得して UPSERT
- 616リクエスト・**逐次・間隔1秒以上**・429 で指数バックオフ・**3回連続 429 で異常終了**
- 完了後に**影響を受けた区間の 4h を再導出**(全再生成でなく差分でよいが、
  **全再生成した場合と同じ結果になる**ことを (a) で担保)
- ログは **1実行1〜3行**(設計原案 §15)。`journal` に出す前提でよい

## 7. 受け入れ基準(数値・機械判定)

- **(a) 決定性**: `rebuild_4h.py` を2回走らせて **`sf_price_history_4h` が完全一致**
  (行数 + 全行のハッシュ)。差分取得後の増分導出も、**同時点で全再生成した結果とバイト一致**
- **(b) 4h の行数**: 28装備 × 22段階 × 約900点。実数を報告(**hourly の約1/4**)
- **(c) `prices` の応答時間**: ローカルで **中央値 ≤ 500ms**(n=10、装備を変えて計測)
- **(d) gzip 実効サイズ**: `Accept-Encoding: gzip` で **≤ 100KB**。実測値を報告
- **(e) 点数**: 1装備の `points` が **900±30**(150日 × 6)。実数を報告
- **(f) 欠損**: `null` が正しく出ていること。**`requiredPriceStars(19,21)` = 10..20 の範囲で
  欠損が無い装備が1つ以上ある**ことを確認(全部欠損なら導出がおかしい)
- **(l) ★`maxStar`**(設計 §7.1): `/sf-history/equipment` の `maxStar` が
  **6装備で 20、22装備で 22**。内訳を列挙する。☆20 の6装備は
  `1022232 / 1032241 / 1072972 / 1082613 / 1102713 / 1212102`。
  **一致しなければ導出がおかしい**(停止条件)
- **(m) `excluded[].reason`** が「ユーザーが原案で明示指定」を出典とする文言に置き換わっている
- **(g) メモリ**: `prices` を10回連続で叩いた後の **RSS ≤ 150MB**(1 worker)。実測値を報告
- **(h) CORS**: `Origin: https://lulumi-tools.com` は許可、`Origin: https://evil.example` は許可しない
- **(i) `latest`**: TTL 60秒でキャッシュが効くこと(2回目が公式を叩かないことをログで確認)。
  上流失敗時に **503**(履歴で代替しないこと)をテストで固定
- **(j) pytest 全緑・オフライン**(公式 API を叩くテストが1つも無いこと)
- **(k) `cd exp_ranking/web && npm run build`** が通る(**web を触っていないことの確認**)

## 8. 停止条件

1. **(a) の決定性が出ない**(2回生成して differ)— 集約規約の曖昧さ。設計 §9 に戻る
2. (c) が **1秒**を超える、または (g) が **250MB** を超える(VPS に載らない)
3. 4h の点数が (e) から大きく外れる(集約規約の解釈違い)
4. 429 が3回連続
5. §1 の「触らないもの」に触る必要が生じた / 新規依存が必要になった
6. **`itemUpgrade=22` を要求しないと成立しない**設計になった(SH-2 は 0..21 しか取っていない)

## 9. コミット

- **ローカルコミットを行う**。3コミット推奨: ① aggregate + rebuild ② app + latest ③ deploy 雛形 + テスト
- **`git push` は行わない**。**`git add -A` 禁止**。**DB を add しない**。

## 10. 完了報告テンプレ

```
## SH-3 完了報告
- コミット: <hash>(各1行要約)
- (a) 決定性: 2回生成の一致(行数・ハッシュ)/ 差分導出 vs 全再生成の一致
- (b) 4h 行数: <n>(hourly <n> の <n>%)
- (c) prices 応答: 中央値 <n> ms(n=10)
- (d) gzip 実効: <n> KB(raw <n> KB)
- (e) 1装備の points: <n>
- (f) 欠損の確認結果
- (g) RSS: <n> MB
- (h) CORS の許可/拒否の実測
- (i) latest の TTL 実証 / 503 テスト
- (j) pytest: <n> passed(オフライン)
- (k) npm run build: 結果
- 停止条件に触れた事項(あれば)
- 設計書との矛盾(あれば。自分で設計書を直さずここに書く)
```
