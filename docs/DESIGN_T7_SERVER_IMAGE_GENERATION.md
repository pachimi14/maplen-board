# DESIGN_T7 — キャラ詳細の共有画像生成・X共有（案A: 画像プロキシ + ブラウザ生成）

> 状態: 基本設計（実装計画・PR分割は未着手）/ 承認者: ユーザー（案A採用 2026-07-15）
> 実装・依存追加・VPS変更・commit/push/PR/マージは本書の範囲外。

## 1. 目的
キャラ詳細ページで共有項目を選択 → キャラ画像入りの共有画像（1600×900 PNG）を即時生成 → クリップボードへコピー → X Web Intent を開き Ctrl+V で貼って投稿できる体験を提供する。

## 2. 確定した前提（T7a スパイク結果）
- `html-to-image` で 1600×900 PNG 生成は安定動作（5連続生成成功）
- Recharts は**固定 width/height** なら画像化可能（`ResponsiveContainer` は共有画像用途では使わない）
- `ClipboardItem` + `navigator.clipboard.write` で画像コピー可能（非対応時は PNG 保存フォールバック）
- X Web Intent で投稿文・URL・ハッシュタグの事前入力可能（ローカル画像の自動添付はしない）
- **唯一の障害**: キャラ画像配信元 `market-static.msu.io` が CORS 不許可のためブラウザ内生成に含められない（img / crossOrigin / fetch cors すべて失敗、placeholder は成功）

## 3. 推奨アーキテクチャ（案A）
**画像生成はブラウザで完結**させ、VPS には**キャラ画像の CORS 中継プロキシ（1エンドポイント）だけ**を置く。

- 案B（フルサーバー生成）を採らない理由: 詰まっているのはキャラ画像取得のみ。サーバー生成は Satori（レイアウト全書き直し）or ヘッドレスChrome（重い・同時実行・cleanup 運用）を背負い、React/Tailwind/Recharts 資産を捨てる。数値改ざん防止は共有画像では無意味（画像は編集可能）。OG画像・自動投稿は本件のスコープ外 → 必要になった時にサーバー生成を別途追加すればよい（作らないリスト思考）。

## 4. 責務分担
| 責務 | 担当 |
|---|---|
| 共有項目選択 UI / レイアウトプリセット / プレビュー | フロント |
| データ（summary・history・T3統計・目標） | フロント（board/profile の既存 state をそのまま使用。API 送信なし） |
| 共有画像レンダリング（非表示の固定サイズ DOM → html-to-image） | フロント |
| クリップボードコピー / PNG保存フォールバック / X Intent | フロント |
| **キャラ画像の CORS 中継 + キャッシュ + placeholder** | **VPS プロキシ** |

## 5. プロキシ API 仕様
### エンドポイント
`GET https://api.lulumi-tools.com/charimg/{imagePath}`

- **クライアントは外部 URL 全文を渡さない**。`imageUrl` から抽出した**パス部分のみ**（例 `msu/platform/charimages/transient/<hash>.png`）を渡し、サーバーが固定オリジン `https://market-static.msu.io/` に結合する。
- historyKey 方式（サーバーが rankings.json から imageUrl を引く）は、サーバーにデータ同期を持ち込むため初版では採らない。パス方式で SSRF 面は同等に塞がる。

### SSRF・悪用対策（必須要件）
1. **任意 URL を受け取らない**: 上記のとおりパスのみ + 固定オリジン結合。`..`・絶対URL・スキーム・`%2F%2F` 等はパス正規化後に拒否
2. パスは**許可プレフィックス**（`msu/platform/charimages/` 等の実在パターン）+ 拡張子 `.png` のみ許可（許可リスト方式）
3. アップストリームへの接続は **https の market-static.msu.io のみ**。DNS 解決結果がプライベート/ループバック IP なら拒否
4. **リダイレクトは追わない**（`redirect: "error"` 相当）。3xx は失敗扱い
5. 応答の **Content-Type が image/png（+必要なら image/webp）以外は破棄**
6. **最大サイズ制限**（例 1MB。超過で打ち切り）
7. **接続/読取タイムアウト**（例 各5s）
8. **レート制限**（例 IP あたり 30 req/分。プロキシ全体でアップストリームへの同時接続上限も設定=配信元への過剰アクセス防止）
9. **CORS**: `Access-Control-Allow-Origin` は `https://lulumi-tools.com` と開発用 `http://localhost:5173` のみ
10. **404・失敗・タイムアウト時は 200 + placeholder PNG を返す**（フロントの生成が絶対に止まらない）。placeholder はプロキシ内蔵の静的ファイル

### キャッシュ
- ディスクキャッシュ（キー=正規化パスのハッシュ）。TTL 例 7日 + `Cache-Control: public, max-age=86400`
- キャラ画像 URL は transient（失効あり）だが、共有時に生きていれば十分。**全キャラ永続保存はしない**（初版不要と判断）
- cleanup: TTL 超過分を起動時/日次で削除（ディスク上限例 500MB）

## 6. 画像生成フロー
1. 詳細ページ「共有画像を作成」→ 項目選択（プリセット自動選択 or 手動）
2. フロントが非表示の 1600×900 固定レイアウト DOM を構築。キャラ画像だけ `crossOrigin="anonymous"` でプロキシ URL から読む
3. `html-to-image` で PNG 生成 → プレビュー表示
4. 「コピー」→ ClipboardItem（非対応は PNG 保存）
5. 「Xで共有」→ コピー実行 → X Intent（投稿文+詳細URL+ハッシュタグ）→ 「Ctrl+V で画像を貼り付けてください」と案内

## 7. 採用技術
- フロント: 既存 React 19 / Tailwind 4 / Recharts（固定サイズ）+ `html-to-image`（スパイク済・新規 npm 依存はこの1つ→**追加時に事前確認**）
- プロキシ: **Node.js 素の http/fetch（または Express 等の極小構成）**。画像生成ライブラリ（Playwright/Puppeteer/Satori/Sharp/Pillow）は**不要=比較自体が消滅**

## 8. 最小運用要件（T7 で用意）
- サブドメイン `api.lulumi-tools.com` + HTTPS（Caddy or nginx + Let's Encrypt）
- systemd で常駐（Docker は不要。将来 Gear Simulator 等で必要になったら移行可）
- アクセスログ（パス・結果・所要時間）/ `GET /healthz`
- 上記 §5 のレート制限・タイムアウト・サイズ制限・キャッシュ cleanup
- **将来へ回す**: 認証・DB・OG画像・自動投稿・共通APIゲートウェイ・監視基盤

## 9. 今回決めないこと
UI詳細 / チェックボックス全項目 / プリセット座標 / PR・コミット分割 / 見積 / OG / Discord / X API 自動投稿 / 認証 / Gear Simulator・公式API の設計。

## 10. 未解決リスク
- キャラ画像 URL（transient）の**失効頻度**が不明 → 失効時は placeholder になる。頻発するなら bot 側で画像パスの鮮度を確認する将来課題
- `market-static.msu.io` がサーバー fetch にも UA/リファラ等で制限をかける可能性 → 実装前に VPS から curl で1回確認（それだけ先に検証）
- クリップボード書込はユーザー操作起点でないと拒否されるブラウザがある → ボタン押下ハンドラ内で完結させる設計とする

## 11. 実装計画前にユーザーが決める事項
1. **サブドメイン名**: `api.lulumi-tools.com` でよいか
2. **HTTPS 終端**: Caddy（自動証明書・推奨）か nginx か、既に VPS にあるものに合わせるか
3. **`html-to-image` の npm 依存追加**の承認（規約: 新規依存は事前確認）
4. プリセット4種（基本+増加量+グラフ / 基本+目標+プランナー / 基本+ランキング+記録 / 基本+グラフ2）の初版ラインナップ承認
5. ハッシュタグ・投稿文テンプレの文言（6言語対応の要否含む）
