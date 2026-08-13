# SH-1b — VPS 実測(P10)

実施: 2026-08-05 / 統括が読み取り専用コマンドのみで実測(本番機のため変更操作は一切行っていない)
対象: `163.44.118.206`(引き継ぎ書 `maplenEnhancebot/docs/ops/VPS_HANDOVER_1GB.md`)
設計正典: `docs/DESIGN_SF_COST_HISTORY.md` §2 P10 / §5.1 / §5.3

## 1. 結論(設計への反映)

| 問い | 実測 | 設計への影響 |
|------|------|--------------|
| hourly SQLite 約150〜200MB を置けるか | **ディスク空き 86 GiB / 99 GiB(使用 9%)** | **U1 = 「全量を VPS に置く」で確定**。縮小案は不要 |
| RAM 余裕 | **available 547 MiB**(total 960 / used 412)、**Swap 310 MiB 使用 / 2048** | uvicorn 1本の追加は可能だが**余裕は大きくない**。§2 の制約を守ること |
| 空きポート | 8781/8782/8783/8784/8765 が使用中 → **8785 が空き** | **`127.0.0.1:8785` を採用** |
| Caddy の追加方法 | snippet 構造。`(proxy_routes)` 内の `respond 404` の**前**に `handle` を1つ足す | §5.1 の想定どおり。**既存 handle を1行も触らずに追加できる** |
| Python | **3.12.3** | bot と同じ。問題なし |
| `sqlite3` CLI | **無い** | `PRAGMA integrity_check` は `python3 -c` で行う(§5.3.1 の手順を修正) |

## 2. メモリ制約(SH-3 の設計に効く)

available 547 MiB・Swap は既に 310 MiB 使用済み。**同居しているのは実ユーザーが使う本番サービス**
(img-proxy / live-exp / notifications / task manager / gear simulator 8765 / MSU-bots cron)。
∴ `sf-history` サービスは以下を守る:

- **uvicorn は 1 worker**(`--workers 1`)。プロセスを増やさない
- **SQLite 接続は都度開閉**、または単一接続を再利用。**メモリに全系列を載せない**
- レスポンスは**都度クエリ**で組み立てる(28装備分を常駐キャッシュしない)。
  必要なら**ディスク上の事前生成 gzip** を返す(RAM を使わずに 500ms 目標を満たす手段)
- 取得ジョブは **ワンショット + timer**(常駐禁止)。§5.2 の方針を再確認
  — 引き継ぎ書 §13 も「`sf-priority-cache-bot` を現行 daemon 方式のまま新 VPS で enable しない」と明記

## 3. 実測ログ

```
=== DISK ===
/dev/vda2  99G  8.2G  86G  9%  /

=== MEM (MiB) ===
Mem:   total 960  used 412  free 144  buff/cache 549  available 547
Swap:  total 2047 used 310  free 1737

=== LISTEN ===
127.0.0.1:2019   caddy (admin)
127.0.0.1:8781   uvicorn   (img-proxy)
127.0.0.1:8782   uvicorn   (live-exp)
127.0.0.1:8784   uvicorn   (notifications)
127.0.0.1:8765   python    (gear simulator / catalog_server)
*:8783           caddy     (task manager static)
*:80 / *:443     caddy
0.0.0.0:22       sshd

=== SERVICES ===
caddy: active / img-proxy: active

=== PYTHON ===
Python 3.12.3 / sqlite3 CLI: 無し

=== /home/botuser/apps ===
lt-taskmanager  lulumi-tools-img-proxy  lulumi-tools-live-exp
lulumi-tools-notifications  maplenEnhancebot  MSU-bots
```

### 3.1 Caddyfile(現行・コメント除去)

```
(proxy_upstream)        { reverse_proxy 127.0.0.1:8781 { header_down -Server } }
(live_exp_upstream)     { reverse_proxy 127.0.0.1:8782 { header_down -Server } }
(notification_upstream) { reverse_proxy 127.0.0.1:8784 { header_down -Server } }

(proxy_routes) {
  handle /healthz        { import proxy_upstream }
  handle /img/*          { import proxy_upstream }
  handle /exp/*          { import live_exp_upstream }
  handle /notifications/* { import notification_upstream }
  respond 404
}

api.lulumi-tools.com { import proxy_routes }
:8783                { root * /home/botuser/apps/lt-taskmanager/current ; file_server }
gear.lulumi-tools.com { reverse_proxy 127.0.0.1:8765 { transport http { read_timeout 180s } } }
```

`caddy validate` = **Valid configuration**。
バックアップ規約(既存): `/etc/caddy/Caddyfile.bak-YYYYMMDD-N` 等が5世代ある。

### 3.2 SH-6 で入れる差分(この形以外にしない)

```
(sf_history_upstream) { reverse_proxy 127.0.0.1:8785 { header_down -Server } }

(proxy_routes) {
  ... 既存の handle 4つは1行も変更しない ...
  handle /sf-history/* { import sf_history_upstream }   ← 追加はこの1ブロックのみ
  respond 404
}
```

## 4. 引き継ぎ書との差分(統括の申し送り)

`VPS_HANDOVER_1GB.md` の記述と実機が食い違う箇所が2つある(**本設計の障害ではないが、
引き継ぎ書は maplenEnhancebot 側の正典なので、あちらで直すべき**):

1. **§7「8765 は現在 listen させない」/ §9「catalog server と SF cache bot はまだ本番起動しない」**
   → 実機では **8765 で python が listen 中**、`gear.lulumi-tools.com` が Caddy で公開済み。
   2026-07-21 の GS 引っ越し完了後に文書が追随していない
2. **`/raffle/*` の route が Caddyfile に無い** → raffle API は**まだ未デプロイ**。
   web 側(`raffleSource.js`)は `api.lulumi-tools.com` を向いているので、現状では 404 になる。
   **SH-6 で `/sf-history/*` を足すときに、raffle の route を勝手に足さないこと**(別作業・別ブランチ)

## 5. 受け入れ基準

- P10 の4項目(空き容量・RAM・実 Caddyfile・空きポート)すべてに実測値が付いた ✅
- **本番機に対する変更操作ゼロ**(実行したのは `df` / `free` / `ss` / `systemctl is-active` /
  `ls` / `grep` / `caddy validate` のみ。`caddy validate` は設定を読むだけで反映しない) ✅
