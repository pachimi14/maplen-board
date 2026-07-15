# IMPL_PLAN_T7_IMG_PROXY — 共有画像用キャラ画像プロキシ(VPS)+ web 接続

状態: **ドラフト(ユーザー承認待ち・未発注)** / 作成 2026-07-16 / 根拠: LULU-040〜042(§8 共有インフラ)

## 0. 背景と目的

T7 共有画像はブラウザ生成が完成済みだが、キャラ画像(`https://market-static.msu.io/msu/platform/charimages/transient/<b64>.png`、180×180 PNG)が CORS 非対応のため canvas が汚染され `toBlob()` が失敗する。VPS 上の画像プロキシが CORS ヘッダ付きで代理取得し、共有画像にキャラ画像を含められるようにする。**画像レイアウト生成はブラウザのまま**(プロキシは取得・キャッシュ・fallback のみ)。

## 1. 前提(着手前に完了しているべきもの)

- [ ] **LULU-042 の HTTPS 基盤**: DNS `api.lulumi-tools.com` A レコード + caddy(推奨、Let's Encrypt 自動)or nginx+certbot — **ユーザー手作業**
- [ ] **パイロットラン(PR-013 準拠・実装前に必ず実施)**: VPS から
      `curl -sS -o /tmp/t.png -w '%{http_code} %{size_download}\n' '<実在の imageUrl>'`
      が **200 かつ PNG を返すこと**(Referer/UA でサーバー取得がブロックされる可能性=本計画最大の前提)。
      **崩れた場合は本計画を中止し設計変更**(候補: UA/Referer 付与の可否確認 → それでも不可なら「共有画像はキャラ画像なし(placeholder)で確定」へ縮退)

## 2. スコープ

### 作るもの
1. **`server/img-proxy/`**(本リポ内・VPS へ手動配置): 小型 HTTP サービス
   - `GET /img/charimages/{path}` → upstream `https://market-static.msu.io/msu/platform/charimages/{path}` を代理取得
   - **ホスト・パス prefix 固定**(任意URL転送は不可=オープンプロキシ/SSRF 防止)。`{path}` は `[A-Za-z0-9=_-]+\.png` のみ許可・`..` 拒否・長さ上限 512
   - レスポンス: `image/png` + `Access-Control-Allow-Origin: https://lulumi-tools.com` + `Cache-Control: public, max-age=86400`
   - **fallback**: upstream 4xx/5xx/timeout(5s)/1MB 超 → **200 で同梱 placeholder.png**(180×180・汎用シルエット、ヘッダ同上、`X-Img-Fallback: 1` 付与)。呼び出し側の canvas 処理を絶対に落とさない
   - **ディスクキャッシュ**: key=sha256(path)、TTL 7日(transient URL は日次で変わるため長期保持は無意味)、容量上限 500MB(超過時は古い順に削除)
   - 配置: systemd unit + caddy から `api.lulumi-tools.com/img/*` を localhost:<port> へ reverse_proxy
2. **web 側の接続(最小)**: 純関数 `toShareProxyUrl(imageUrl)`(`market-static.msu.io/msu/platform/charimages/` 始まりのみ `https://api.lulumi-tools.com/img/charimages/<path>` へ変換、それ以外は null)+ **共有画像生成経路のみ**で使用(`<img crossOrigin="anonymous">`)。定数 `SHARE_IMAGE_PROXY_BASE` で無効化可能に

### 変わってよいもの
- 共有画像生成経路のキャラ画像取得元 / `server/` 新規ディレクトリ

### 変わってはいけないもの
- **通常表示の `character.imageUrl` 直リンク**(VPS 帯域と可用性をサイト本体に波及させない=LULU-040 不変条件)
- bot 全域 / `.github/**` / 既存UI・localStorage / v2シャード形式
- **VPS 停止時もサイト本体と共有機能自体は動く**(キャラ画像だけ placeholder になる)

## 3. 未決(発注前にユーザー確認)

1. **サーバー実装スタック**: 推奨=Python+FastAPI+uvicorn(bot と言語統一・依存2個)。代替=Flask / Node。gear sim catalog_server と同居構成のため同スタックに寄せる選択も可
2. placeholder のデザイン(暫定: 紺地 #0f172a+緑 #34d399 の汎用シルエット、ゲーム素材不使用=LULU-018 の og.png と同方針)

## 4. 受け入れ基準(数値)

| # | 項目 | 基準 |
|---|------|------|
| 1 | CORS | `curl -sI 'https://api.lulumi-tools.com/img/charimages/<実在path>.png'` に `access-control-allow-origin: https://lulumi-tools.com` |
| 2 | 実体 | 同 GET が 200 / `content-type: image/png` / 直取得と同一バイト |
| 3 | 速度 | コールド ≤3s、キャッシュヒット ≤300ms(リモート計測) |
| 4 | fallback | 存在しない path → **200** + placeholder + `X-Img-Fallback: 1` |
| 5 | 遮断 | `/img/charimages/../etc/passwd`・`.jpg`・許可外文字 → 4xx(upstream へ到達しない) |
| 6 | 本命 | ローカル dev の共有画像生成で **canvas 非汚染=`toBlob()` 成功**、キャラ画像入り PNG が得られる |
| 7 | 回帰 | `npm run build` 成功・既存テスト全緑・通常表示のネットワークに api.lulumi-tools.com への請求 0 件 |

## 5. 停止条件

- パイロットラン失敗(§1)/ upstream がプロキシ経由取得を恒常拒否
- 画像が常態的に 1MB 超、または通常表示にプロキシが必要になる設計圧力が出た(スコープ再定義へ)
- systemd/caddy に触れない事情が VPS 側で発覚

## 6. 検証コマンド

```
# サーバー単体(VPS 上)
curl -sI https://api.lulumi-tools.com/img/charimages/<実在>.png   # 基準1,2
curl -s -o /dev/null -w '%{time_total}\n' <同URL>                 # 2回目=基準3
curl -sI https://api.lulumi-tools.com/img/charimages/xxxx.png      # 基準4
# web(ローカル)
cd exp_ranking/web && npm run test && npm run build                # 基準7
run_local_dev.bat → 共有画像生成 → PNG 保存確認                    # 基準6
```

## 7. ロールバック

- web: `SHARE_IMAGE_PROXY_BASE = null` の1行 revert → 従来どおり placeholder で共有画像生成(機能は生存)
- サーバー: `systemctl stop img-proxy` のみ。サイト本体無傷(LULU-040)

## 8. 完了報告テンプレ

- コミット一覧(web / server 別)と touched files
- 受け入れ基準 1〜7 の実測値(コマンド出力貼付)
- パイロットランの結果(実施日時・HTTP code・サイズ)
- 逸脱・保留事項(あれば選択肢付き)
