# IMPL_PLAN_SH6 — VPS 本番投入(2フェーズ)

設計正典: `docs/DESIGN_SF_COST_HISTORY.md` §5.1〜5.3 / §10.3。前提: **SH-3 完了**。
実測の正典: `docs/reports/SH1B_VPS_PROBE.md`(空きポート 8785・Caddyfile 実物・メモリ)
運用の正典: `maplenEnhancebot/docs/ops/VPS_HANDOVER_1GB.md`

## 0. ★このスライスの原則

VPS `163.44.118.206` は **実ユーザーが使っている本番機**である。同居しているもの:

| 稼働中 | 壊すと起きること |
|---|---|
| `img-proxy`(8781)`live-exp`(8782)`notifications`(8784) | lulumi-tools.com の共有カード・ライブEXP・通知が死ぬ |
| Task Manager(8783 static) | タスクマネージャーが死ぬ |
| gear simulator(8765 / `gear.lulumi-tools.com`) | ギアシミュが死ぬ |
| MSU-bots(cron 5分ごと 他) | Discord 通知が止まる |
| **Caddy**(80/443) | **上記が全部同時に死ぬ** |

∴ **フェーズを分ける。SH-6a は既存に一切触れない。共有 Caddyfile を触るのは SH-6b だけ。**

## 1. SH-6a — 転送・サービス単体起動(**既存への影響ゼロ**)

### 1-1 スコープ
- `sf_price_history.sqlite`(275MB)を **メインPC → VPS** へ転送
- `/home/botuser/apps/lulumi-tools-sf-history` へコード配置(**既存の `lulumi-tools-*` の命名に合わせる**)
- venv 構築 + `requirements.txt` 導入
- `sf-history.service` を **`127.0.0.1:8785`** で起動(**loopback のみ。外部公開しない**)
- **Caddy には触らない**

### 1-2 手順の要点
```bash
# 転送(メインPC)
scp -i C:\Users\pachi\.ssh\arb_vps2 \
  server/sf-history/data/sf_price_history.sqlite \
  root@163.44.118.206:/tmp/sf_price_history.sqlite.new

# VPS 側: 完全性確認(sqlite3 CLI は無いので python3 で)
python3 -c "import sqlite3;c=sqlite3.connect('/tmp/sf_price_history.sqlite.new');print(c.execute('PRAGMA integrity_check').fetchone());print(c.execute('SELECT COUNT(*) FROM sf_price_history_hourly').fetchone());print(c.execute('SELECT COUNT(*) FROM sf_price_history_4h').fetchone())"
```
- **サービス実行ユーザーは `botuser`**(既存の `lulumi-tools-*` と同じ)
- `--workers 1`(設計 §5.1 のメモリ制約)
- 環境変数 `SF_HISTORY_ALLOWED_ORIGINS=https://lulumi-tools.com`

### 1-3 受け入れ基準
- **(a)** 転送後 `PRAGMA integrity_check` = `ok`、`hourly` = **2,254,103 行**、`4h` = **577,188 行**
  (メインPCの実測値と**完全一致**。1行でも違えば転送破損)
- **(b)** `systemctl status sf-history` = active。**`ss -ltnp` で 8785 が `127.0.0.1` のみ**にバインド
- **(c)** VPS 内から `curl 127.0.0.1:8785/sf-history/health` = 200、
  `/sf-history/equipment` が **28件・maxStar が 20×6 / 22×22**
- **(d)** `/sf-history/prices?itemId=1382265` が **≤ 500ms**、**900点**
- **(e)** **★既存が無傷**: `free -m`(available が **300MiB 未満にならない**)、
  `systemctl is-active caddy img-proxy`、`curl -fsS https://api.lulumi-tools.com/healthz`、
  `curl -fsSI http://127.0.0.1:8783/`、`curl -fsSI https://gear.lulumi-tools.com`、
  **`ss -ltnp` の既存ポート一覧が SH-1b の実測と同じ**
- **(f)** サービスの RSS が **≤ 150MB**

### 1-4 停止条件
1. `integrity_check` が `ok` 以外、または行数が (a) と1行でも違う
2. `free -m` の available が **300MiB を下回った**
3. 既存サービスのどれかが (e) で異常
4. **8785 が `0.0.0.0` にバインドされた**(外部公開は禁止)

## 2. SH-6b — Caddy 経路追加 + timer 有効化(**共有設定を触る**)

### 2-1 スコープ
- `/etc/caddy/Caddyfile` に **`(sf_history_upstream)` snippet + `handle /sf-history/*` の1ブロックを追加**
- `sf-history-update.service` / `.timer` を配置・enable(4時間ごと)

### 2-2 ★Caddy の触り方(これ以外の形にしない)
```
# 追加するのはこの2箇所だけ。既存の handle 4つと他サイトは1行も変更しない。
(sf_history_upstream) { reverse_proxy 127.0.0.1:8785 { header_down -Server } }

(proxy_routes) {
  handle /healthz          { import proxy_upstream }        # 既存・無変更
  handle /img/*            { import proxy_upstream }        # 既存・無変更
  handle /exp/*            { import live_exp_upstream }     # 既存・無変更
  handle /notifications/*  { import notification_upstream } # 既存・無変更
  handle /sf-history/*     { import sf_history_upstream }   # ← 追加はこの1行ブロックのみ
  respond 404
}
```

**手順(この順序を崩さない)**:
1. `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-<YYYYMMDD>-sfhistory`(既存のバックアップ命名に倣う)
2. 編集
3. **`caddy validate --config /etc/caddy/Caddyfile`**(`Valid configuration` を確認)
4. **`systemctl reload caddy`**(**restart ではなく reload**)
5. **即座に回帰確認**((c) の全項目)
6. **1つでも失敗したらバックアップへ戻して reload し、停止報告**

### 2-3 timer
- `OnCalendar=*-*-* 01,05,09,13,17,21:43:00` / `Persistent=true` / `RandomizedDelaySec=120`
- **`Type=oneshot`**(常駐禁止。引き継ぎ書 §13「daemon 方式のまま enable しない」)
- **既存の cron/timer と時刻が衝突しないこと**を `systemctl list-timers` で確認して報告

### 2-4 受け入れ基準
- **(a)** `caddy validate` = `Valid configuration`(**reload 前に実行した証拠**を報告)
- **(b) ★既存経路の回帰ゼロ**(reload 直後に実測):
  - `curl -fsS https://api.lulumi-tools.com/healthz` = 200
  - `curl -fsSI https://api.lulumi-tools.com/img/charimages/transient/<既存の任意パス>` が従来と同じ挙動
  - `curl -fsSI https://gear.lulumi-tools.com` = 200系
  - `curl -fsSI http://127.0.0.1:8783/` = 200
  - **`/exp/*` と `/notifications/*` が 404 にならない**(upstream 到達を確認)
- **(c)** `curl -fsS https://api.lulumi-tools.com/sf-history/health` = 200
- **(d)** `https://api.lulumi-tools.com/sf-history/prices?itemId=1382265` が **gzip で ≤100KB・≤500ms**
- **(e)** **CORS**: `Origin: https://lulumi-tools.com` で `access-control-allow-origin` が返る
- **(f)** `systemctl list-timers` に `sf-history-update.timer` が出て、次回発火時刻が妥当
- **(g)** **timer を手動で1回実行**(`systemctl start sf-history-update.service`)して:
  - 正常終了(`systemctl status` = exited/success)
  - **429 が 0 件**
  - 実行後に `free -m` の available が **300MiB を下回らない**
  - **§10.3 の暫定バケットが正しい値に置き換わる**(実行前後で最新バケットの `end_price` を比較して報告)
- **(h)** 実行時間の実測(616リクエスト×1秒 ≈ 11分の想定と比較)

### 2-5 停止条件
1. `caddy validate` が通らない → **reload しない**
2. (b) の回帰確認が1つでも失敗 → **即バックアップへ戻して reload**、停止報告
3. update ジョブで **429 が発生**
4. available メモリが **300MiB を下回った**
5. 既存の timer/cron と実行時刻が重なることが判明した

## 3. 共通の禁止事項

- **既存サービスの設定・ユニット・crontab を変更しない**
- **8785 を外部公開しない**
- **`/raffle/*` の route を足さない**(別作業・別ブランチ。SH-1b で未デプロイと確認済み)
- **`sf-priority-cache-bot` を有効化しない**(引き継ぎ書 §13 の禁止事項)
- **秘密情報をログ・報告に出さない**(引き継ぎ書 冒頭)
- **`git push` は行わない**

## 4. ロールバック

| 対象 | 戻し方 |
|---|---|
| Caddy | `cp /etc/caddy/Caddyfile.bak-<date>-sfhistory /etc/caddy/Caddyfile && caddy validate && systemctl reload caddy` |
| サービス | `systemctl disable --now sf-history` |
| timer | `systemctl disable --now sf-history-update.timer` |
| DB | 削除するだけ(既存データに影響しない) |

**どれも既存サービスに触れずに戻せる。**

## 5. 完了報告テンプレ

```
## SH-6 完了報告
### SH-6a
- (a) integrity_check / hourly 行数 / 4h 行数(メインPC実測との一致)
- (b) systemctl status / ss -ltnp の 8785 バインド
- (c) equipment 28件・maxStar 20×6 / 22×22
- (d) prices 応答時間 / 点数
- (e) ★既存の無傷確認(free -m / caddy / img-proxy / healthz / 8783 / gear / ポート一覧)
- (f) RSS
### SH-6b
- (a) caddy validate の出力(reload 前)
- (b) ★既存経路の回帰確認 全項目の実測
- (c)(d)(e) sf-history の公開経路の実測
- (f) list-timers の出力
- (g) 手動1回実行の結果(終了状態 / 429件数 / メモリ / 暫定バケットの置換 前後の値)
- (h) 実行時間
- バックアップファイル名
- 停止条件に触れた事項(あれば)
```
