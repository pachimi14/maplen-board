# IMPL_PLAN_T7_IMG_PROXY — 共有画像用キャラ画像プロキシ(VPS)+ web 接続

状態: **ドラフト(ユーザー承認待ち・未発注)** / 作成 2026-07-16 / 根拠: LULU-040〜042(§8 共有インフラ)

## 0. 背景と目的

T7 共有画像はブラウザ生成が完成済みだが、キャラ画像(`https://market-static.msu.io/msu/platform/charimages/transient/<b64>.png`、180×180 PNG)が CORS 非対応のため canvas が汚染され `toBlob()` が失敗する。VPS 上の画像プロキシが CORS ヘッダ付きで代理取得し、共有画像にキャラ画像を含められるようにする。**画像レイアウト生成はブラウザのまま**(プロキシは取得・キャッシュ・fallback のみ)。

## 1. 前提(着手前に完了しているべきもの)

- [ ] **LULU-042 の HTTPS 基盤**: DNS `api.lulumi-tools.com` A レコード + caddy(推奨、Let's Encrypt 自動)or nginx+certbot — **ユーザー手作業**
- [x] **パイロットラン(PR-013 準拠・実装前に必ず実施)= 成功(2026-07-16 ユーザー実施)**: 素の curl(UA/Referer 付与なし)で `HTTP 200 / 4036 bytes / image/png`、`file` 判定 `PNG image data, 180 x 180, 8-bit/color RGBA`。**前提成立・本計画は発注可能状態**。元の要求: VPS から
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

## 9. 改訂1(2026-07-16・統括裁定): スコープ縮小 — 「サーバー + 純関数まで」

実装担当(Codex)の停止報告により前提誤りが判明: 共有画像生成経路は未コミットのスパイク(`t7/share-image-spike` 作業ツリー)にのみ存在し、**origin/main には存在しない**。よって本発注のスコープを以下に縮小する。

- **やる**: `server/img-proxy/**` 全部(計画書 §2-1 どおり)+ web 側は `toShareProxyUrl` 純関数とその単体テストのみ(どこからも import しない=バンドル非混入・UI 不変)
- **やらない(後続タスク T7-wire へ分離)**: 共有画像生成経路への接続・`<img crossOrigin>` 配線。T7 本体(スパイクの正式実装)が main に入った後、接続だけの小 PR で行う
- **受け入れ基準 #6 の代替**: 共有経路 E2E の代わりに、**使い捨て検証ハーネス**(`server/img-proxy/tools/canvas-taint-check.html` 等、本番バンドル外)でプロキシ経由画像を canvas に描画し `toBlob()` が成功することを確認(=CORS ヘッダが canvas 用途に実際に有効である証明)。localhost の uvicorn 相手でよい(その場合 ACAO は dev origin 向け設定で計測し、本番値との差を報告に明記)
- **受け入れ基準 #7 の「通常表示ネットワーク 0 件」**: 純関数が未 import であることの grep/バンドル確認で代替
- 他の基準(1〜5)・厳守事項・停止条件は不変

理由: サーバーは独立価値があり T7 本体到着時に即接続できる。UI 本体を本発注で作るのは 1PR=1関心事違反(選択肢2を却下)。全停止(選択肢3)はサーバーの独立価値を捨てるだけで得るものがない。

## 10. 改訂2(2026-07-16・ユーザー指示): T7全体へスコープ拡大・一括実装・最終検収方式

トークン事情により、改訂1の縮小を撤回し **T7全体(プロキシ+共有画像UI本体+接続)を同一ブランチ `t7/img-proxy` で一括実装**する。統括の検収は完了報告後に1回のみ(問題があれば翌週修正タスク化)。実装担当は**軽微な仕様判断で停止しない**(最も単純な解釈で進め、判断一覧を完了報告に記載)。停止するのは次の場合のみ: 下記以外の新規 npm 依存が必要 / bot・`.github/**` に触る必要 / データモデル・v2シャードに触る必要。

### スコープ追加(§2 に加えて)
- **共有画像UI本体**: 参照実装=`C:\Users\pachi\Desktop\msu ranking\exp_ranking\web\tools\t7-spike\`(**read-only の設計リファレンス**。同 worktree は触らない・コミットしない)。スパイクのレイアウト・生成ロジックを本番品質で `src/` へ移植する
- 詳細ページ(`#/character/:historyKey`)に「画像を共有」導線 → **ブラウザで PNG 生成**(html-to-image)→ ①クリップボードコピー(不可環境はダウンロード fallback)②PNG ダウンロード ③X intent(テキスト+キャラURL)
- キャラ画像は `toShareProxyUrl` でプロキシ経由(`crossOrigin="anonymous"`)。**プロキシ不達/失敗時は placeholder で生成継続**(共有機能自体は死なない)
- **npm 依存は `html-to-image@^1.11.13` のみ追加許可**(スパイクで実証済み・ユーザー承認済み)。それ以外は停止
- `SHARE_IMAGE_PROXY_BASE` は設定1箇所(dev=localhost / 本番=`https://api.lulumi-tools.com`)。サーバーの ACAO は本番オリジン+dev origin(localhost)を許可リスト方式で

### 受け入れ基準(改訂1の #6/#7 代替を撤回し、全体版に差し替え)
| # | 基準 |
|---|------|
| 6 | ローカル dev(uvicorn 併走)で共有画像生成→ **canvas 非汚染・`toBlob()` 成功・キャラ画像入り PNG** ≤3s |
| 7 | プロキシ停止状態でも共有画像生成が placeholder で成功(エラーで固まらない) |
| 8 | クリップボードコピー or ダウンロード fallback が実動 / X intent の URL・テキスト正 |
| 9 | UI文言は 6ロケール同時追加・パリティ一致 |
| 10 | 既存テスト全緑+新規テスト(toShareProxyUrl・共有テキスト組立等の純関数)/ `npm run build` 成功 |
| 11 | **共有操作をしない限り** api.lulumi-tools.com への請求 0 件(通常表示不変) |
- サーバー側基準 1〜5(§4)は不変。完了報告テンプレ(§8)+「軽微判断の一覧」を添付

### 検収(統括・翌週)
test/build・`git diff -w` 全ファイル・uvicorn 併走で基準 6/7/8/11 の実機確認。不合格項目は翌週の修正タスクへ。
