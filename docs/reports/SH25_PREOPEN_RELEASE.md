# SH-25 — 身内向けプレオープン公開(VPS)

実施: 2026-08-05 / **統括が実施**(本番機への操作。SH-6 と同じ手順)
**ユーザー裁定**: この VPS 版を**プレオープン**として使い、フィードバックを反映してから本番公開へ進む。

## 1. 公開先

```
https://sf.lulumi-tools.com/#/starforce
```

- DNS: `sf` A → `163.44.118.206`(ユーザーが追加)
- TLS: Caddy が自動取得(`ssl_verify_result: 0`)
- **アクセス制限は掛けない**(「リンクを張らないだけ」= GS-267 と同じ考え方)。
  **∴ URL は事実上インターネットに出るので、公開品質基準はそのまま適用する。**
  「身内向けだから」を精度の言い訳にしない

## 2. 構成

```
sf.lulumi-tools.com          Caddy file_server → /home/botuser/apps/lulumi-tools-sf-web/current
                             (releases/<日時> への symlink。lt-taskmanager と同じ流儀)
api.lulumi-tools.com/sf-history/*   既存の sf-history サービス(127.0.0.1:8785)
```

**本体(lulumi-tools.com)には一切影響しない。**push していないので、
公開ナビに「SF履歴」は現れない。

## 3. ★VPS 版だけナビの他リンクを絶対 URL に(SH-24)

`useRankingBoard.js` がランキングデータを**相対パス**で取るため、
VPS 版で `EXP Ranking` / `Task Manager` を押すと 404 になる。
∴ **ビルド時 `VITE_SITE_BASE_URL` を設定して本体への絶対 URL にした**。

```
LULUMI TOOLS / EXP Ranking → https://lulumi-tools.com/#/
Task Manager               → https://lulumi-tools.com/#/dashboard
SF履歴                     → #/starforce   (同一オリジンのまま)
```

**既定ビルド(env 未設定)は byte 単位で不変**なので、将来 push しても本体は壊れない。

## 4. 反映した内容

| # | 項目 | 実測 |
|---|---|---|
| 1 | 画面の転送 | 1.8MB / `releases/20260805-144356` → `current` |
| 2 | Caddy | 末尾に site block 追加のみ。`validate` = Valid → `reload`。**既存4経路 回帰ゼロ** |
| 3 | CORS | `Access-Control-Allow-Origin: https://sf.lulumi-tools.com` |
| 4 | API コード | SH-23 まで反映。**上流 = openapi.msu.io**(起動ログで確認) |
| 5 | DB | 370MB 転送。**バイト数・integrity・hourly 2,428,285・4h 621,240・30装備すべて一致** |
| 6 | API キー | `/etc/lulumi-tools/sf-history.env`(root・**0600**)。**stdin 経由で渡しコマンド履歴に残さず** |

## 5. 自動で更新されるもの / されないもの

| | 自動か |
|---|---|
| **価格データ**(1時間足取得 → 4時間足再導出) | ✅ `sf-history-update.timer` が **1日6回**(01,05,09,13,17,21:43 JST・`Persistent=true`) |
| **現在価格** | ✅ 公式 Open API を都度取得(5分キャッシュ) |
| **画面(SPA)** | ❌ **手動**。UI を直したら毎回ビルド+転送が要る |

### 5-1 画面を更新する手順(フィードバック反映のたびに必要)

```bash
cd exp_ranking/web
VITE_SITE_BASE_URL=https://lulumi-tools.com npm run build
# dist を releases/<日時> へ転送し、current の symlink を張り替える
```

**GitHub Pages のような push 自動反映はされない。**
その代わり**本体サイトに影響しない**という、今回の狙いどおりの構成である。

## 6. プレオープン中の運用

1. 身内が `https://sf.lulumi-tools.com/#/starforce` を使う
2. フィードバックを受ける
3. スライスとして実装 → 統括が検収 → **画面を再ビルドして転送**
4. 十分に固まったら**本番公開**(= push して Pages に載せ、本体ナビに SF履歴 が現れる)

**本番公開は別判断**。そのとき初めて `lulumi-tools.com` 本体に導線が出る。

## 7. ロールバック

| 対象 | 戻し方 |
|---|---|
| 画面 | `current` の symlink を前の `releases/<日時>` に戻す |
| Caddy | `/etc/caddy/Caddyfile.bak-20260805-sfweb` に戻して `validate` → `reload` |
| API コード | 前のコミットを転送し直して `systemctl restart sf-history` |
| DB | `/tmp/sf_old_backup.sqlite` を戻す(**一時領域なので、長期保持が要るなら移動**) |
| キー | `/etc/lulumi-tools/sf-history.env` から `MSU_OPEN_API_KEY` を消すと**自動でレガシー上流にフォールバック**(画面は壊れない) |
