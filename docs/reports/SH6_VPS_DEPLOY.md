# SH-6 VPS 本番投入 報告(統括が実施)

実施: 2026-08-05(JST)/ 対象 `163.44.118.206` / 計画書 `docs/IMPL_PLAN_SH6.md`
**実施者は統括**(本番機への操作は blast radius が大きく、失敗時の即時ロールバック判断が要るため、
実装担当に委ねず統括が直接行った)。

## 0. ベースライン(変更前・回帰判定の基準)

```
2026-08-04T19:38:39Z
Mem: total 960  used 433  available 526      Swap は未変化
listen: 22, 2019, 8765, 8781, 8782, 8784, 8783, 80, 443
caddy=active  img-proxy=active
healthz=200   gear.lulumi-tools.com=302   127.0.0.1:8783=200
disk: 8.2G / 99G (9%)
```

## 1. SH-6a — 転送・サービス起動(既存に触れない)

配置: `/home/botuser/apps/lulumi-tools-sf-history`(既存の `lulumi-tools-*` 命名に合わせた)
実行ユーザー: `botuser` / venv 57MB / `fastapi 0.141.1` `uvicorn 0.52.1` `requests 2.34.2`

### 受け入れ基準

| # | 基準 | 実測 | 判定 |
|---|---|---|---|
| (a) | 転送の完全性 | `integrity_check=ok` / **バイト数がローカルと完全一致(361,119,744)** / hourly **2,254,103** / 4h **577,188** / 28装備 / done **616** | ✅ |
| (b) | バインド | `LISTEN 127.0.0.1:8785`(**外部公開なし**)/ active / enabled | ✅ |
| (c) | equipment | 28件 / **maxStar 22×22・20×6** / ☆20 = `1022232,1032241,1072972,1082613,1102713,1212102` | ✅ |
| (d) | prices | **178〜229ms**(n=5)/ 900点 / interval=4h / labelIs=bucketStart | ✅ |
| (e) | **既存が無傷** | caddy・img-proxy active / healthz=200 / gear=302 / 8783=200 / listen はベースライン+8785 のみ | ✅ |
| (f) | RSS | **64.8MB**(基準150MB) | ✅ |
| — | メモリ | available **489MiB**(ベースライン526・停止条件300) | ✅ |

> 注: DB のサイズが SH-2 報告の 275.2MB から 344MB に増えているのは、**SH-3 が 4h テーブル
> (577,188行)を追加したため**であり、転送の異常ではない。

## 2. SH-6b — Caddy 経路追加

バックアップ: `/etc/caddy/Caddyfile.bak-20260805-sfhistory`

### 実際に入れた差分(これが全部)

```diff
+(sf_history_upstream) {
+    reverse_proxy 127.0.0.1:8785 {
+        header_down -Server
+    }
+}
+
 (proxy_routes) {
 	handle /healthz { ... }          # 無変更
 	handle /img/* { ... }            # 無変更
 	handle /exp/* { ... }            # 無変更
 	handle /notifications/* { ... }  # 無変更
+	handle /sf-history/* {
+	    import sf_history_upstream
+	}
+
 	respond 404
 }
```

**手順**: backup → 編集 → **`caddy validate` = `Valid configuration`** → **`systemctl reload caddy`**
(restart ではない)→ 即時回帰確認。回帰時に自動ロールバックするスクリプトで実行したが、**発動しなかった**。

**`caddy` の `ActiveEnterTimestamp` は `2026-07-29 06:04:14 JST` のまま** =
reload はプロセスを再起動しておらず、既存接続に影響していない。

### 経路ごとの実測(reload 直後)

| 経路 | code | body 先頭 | 意味 |
|---|---|---|---|
| `/healthz` | 200 | `{"status":"ok"}` | img-proxy 到達 |
| `/img/charimages/transient/probe.png` | 200 | `PNG...` | img-proxy 到達(placeholder フォールバック) |
| `/exp/live/PROBE` | 400 | `{"detail":"invalid character asset key"}` | **live-exp 到達** |
| `/notifications/` | 404 | `{"detail":"Not Found"}` | **notifications 到達** |
| `/sf-history/health` | **200** | `{"status":"ok"}` | **新経路** |
| `/nope` | 404 | (空) | Caddy の `respond 404` |
| `gear.lulumi-tools.com` | 302 | — | ベースラインと同じ |
| `127.0.0.1:8783` | 200 | `<!doctype html>` | ベースラインと同じ |

**`/exp/*` と `/notifications/*` が upstream の JSON を返し、`/nope` が空ボディの Caddy 404 を返す**
という違いにより、「経路が upstream に届いている」ことを body で区別して確認した
(ステータスコードだけでは 404 同士を区別できない)。

### 公開経路

- `prices?itemId=1382265`: **141ms** / gzip **86,448B**
- CORS: `Origin: https://lulumi-tools.com` → `access-control-allow-origin: https://lulumi-tools.com`

## 3. timer

`sf-history-update.timer` = active / enabled、`Type=oneshot`(常駐ではない)。
次回発火 **05:43:26 JST**。

**衝突確認**:

| 時刻 | ジョブ |
|---|---|
| 05:23 | `sf-priority-cache-bot.service`(**別プロジェクト**) |
| **05:43** | **`sf-history-update.service`(本件)** |
| 05:47 | `fwupd-refresh.service` |
| 毎時 02,17,32,47 / */5 | MSU-bots(twitch / trade) |

20分以上離れており衝突なし。

## 4. 差分更新ジョブの実測(手動1回実行)

`systemctl start sf-history-update.service` を1回実行。

| 項目 | 実測 | 基準 |
|---|---|---|
| 実行時間 | **10分58秒**(19:43:08Z → 19:54:06Z) | 見積り 616×1秒 ≈ 11分 → **一致** |
| 終了状態 | `Result=success` / `ExecMainStatus=0` / `ActiveState=inactive` | oneshot が正しく完了 |
| リクエスト | **616**(= 28装備 × 22段階)/ **HTTP 200 が 616**(全件) | — |
| **429** | **0 件** | **必須基準** ✅ |
| エラー/警告/traceback | **0 件** | — |
| CPU | 4.046s | — |
| **メモリピーク** | **31.8 MB** / swap **0 B** | 常駐化していない証拠 |
| available メモリ | **477 MiB**(停止条件 300) | ✅ |
| 書き込み | hourly **+1,154 行**(2,254,103 → 2,255,257) | — |

ログは設計どおり**1行サマリ**で終わっている:
```
sf-history update: 616/616 combos ok, 5988 hourly rows written, 616 requests, 0 x429, stop=None
```

### 4.1 ★設計 §10.3 の暫定バケットは「除去」で解消した(予測どおり)

| | 実行前 | 実行後 |
|---|---|---|
| 4h 行数 | 577,188 | **576,584**(= 577,188 − **604**、1 combo あたり1本) |
| 最新バケット | `2026-08-04T16:00Z`(source `17:00` = **進行中**) | **`2026-08-04T12:00Z`**(source `15:00` = 完成) |
| 最新 hourly | `17:00Z` | `18:00Z` |

**機序**: 初回の全再生成は `--now` を後ろに置いて走ったため、`16:00–19:59` の**進行中バケットが
確定扱いで入っていた**。差分ジョブは実時刻(19:43Z)で走るので `bucket_end = 20:00 > now` により
**このバケットを出さない**。

∴ 暫定値は「正しい値に置き換わる」のではなく **除去される**方向で解消した。
**設計 §9 の「進行中の区間は確定しない」に対しては、こちらのほうが厳密**である。
`604` は 4h を持つ combo 数(616 − ☆20 上限6装備 × 2段階 = 604)と一致しており、
**全 combo で漏れなく効いた**ことの機械的な裏付けになっている。

### 4.2 実行後の既存サービス

`caddy` / `img-proxy` / `sf-history` すべて active、`healthz=200`、`/sf-history/health=200`。

## 5. 引き継ぎ書との差分(申し送り)

`maplenEnhancebot/docs/ops/VPS_HANDOVER_1GB.md` の記述と実機が食い違う点(**本件の障害ではないが、
あちらのリポの正典なので更新の要否はユーザー判断**):

1. **§7「8765 は listen させない」/ §9「catalog server と SF cache bot はまだ本番起動しない」**
   → 実機では **8765 で listen 中**、`gear.lulumi-tools.com` が公開済み(GS 引っ越し後に文書が未追随)
2. **§9「SF cache bot は旧 VPS」** → 実機では **`sf-priority-cache-bot.service` が新 VPS の timer で
   05:23 に稼働**(OPS-1 の oneshot 化後に移設されたと思われる)。
   ∴ **この VPS は既に公式 API へ定期アクセスしている**。本件の 616リクエスト/4時間はそれに加算される
3. **`/raffle/*` の route は Caddyfile に無い** → raffle API は未デプロイ。
   web 側は `api.lulumi-tools.com` を向いているので現状 404。**本件では触っていない**(別作業)

## 6. ロールバック手順(有効性を確認済み)

| 対象 | 戻し方 |
|---|---|
| Caddy | `cp /etc/caddy/Caddyfile.bak-20260805-sfhistory /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy` |
| サービス | `systemctl disable --now sf-history` |
| timer | `systemctl disable --now sf-history-update.timer` |
| DB | `/home/botuser/apps/lulumi-tools-sf-history/data/sf_price_history.sqlite` を削除 |

**いずれも既存サービスに触れずに戻せる。**
