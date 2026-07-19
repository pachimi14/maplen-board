# T7a 技術スパイク: 共有画像生成

作成日: 2026-07-15
ブランチ: `t7/share-image-spike`
起点: `origin/main` `7168f4f`

このスパイクは T7 本実装ではありません。`CharacterDetail` / `App` / bot / workflow / データ契約には配線していません。`html-to-image@^1.11.13` は一時的なdependencyとして追加しています。

## 目的

`docs/IMPL_PLAN_T7.md` の未解決リスクを実ブラウザで確認する。

1. `html-to-image` で固定サイズRechartsを含む1600x900 PNGを安定生成できるか。
2. `market-static.msu.io` のキャラ画像を共有画像へ含められるか。失敗時にplaceholderで確実に生成を継続できるか。

## 作成・変更ファイル

```text
exp_ranking/web/package.json
exp_ranking/web/package-lock.json
exp_ranking/web/tools/t7-spike/README.md
exp_ranking/web/tools/t7-spike/index.html
exp_ranking/web/tools/t7-spike/main.jsx
docs/T7_TECH_SPIKE.md
docs/t7-spike-samples/t7-spike-fetch-data-url.png
docs/t7-spike-samples/t7-spike-placeholder-option.png
docs/t7-spike-samples/t7-spike-no-image.png
docs/t7-spike-samples/chrome-headless-page.png
docs/t7-spike-samples/edge-headless-page.png
```

既存の `docs/IMPL_PLAN_T7.md` は今回の実測結果で修正候補が明確になったが、このスパイクでは直接編集していない。

## 一時依存差分

```diff
+ "html-to-image": "^1.11.13"
```

`package-lock.json` では `html-to-image@1.11.13` が追加された。ライセンスはMIT。runtime dependencyは追加されていない。

## スパイク内容

`exp_ranking/web/tools/t7-spike/` にViteで開ける独立ページを作成した。

URL:

```text
http://127.0.0.1:5197/tools/t7-spike/
http://127.0.0.1:5197/tools/t7-spike/?autorun=1
```

カード内容:

- 1600x900固定
- ダーク背景
- `Lulumi Tools` / `lulumi-tools.com`
- 実データのキャラ名・職業・サーバー・Lv・EXP%
- Daily / Weekly / Monthly
- 固定 `width` / `height` のRecharts棒グラフと折れ線グラフ
- 日本語、タイ語、繁体字テキスト
- 長いキャラ名表示チェック
- 画像モード切替

Recharts設定:

- `ResponsiveContainer` 不使用
- 固定 `width` / `height`
- `isAnimationActive={false}`
- Tooltipなし
- `document.fonts.ready` 後に生成

## 実測環境

- Vite dev server: `http://127.0.0.1:5197/`
- Codex内ブラウザ: 実測値取得、コンソールログ確認、PNG data URL保存
- Chrome: `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` headless screenshotで表示確認
- Edge: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` headless screenshotで表示確認

Chrome/Edge headless の `--dump-dom` はこの環境ではstdoutを返さなかったため、数値取得はCodex内ブラウザで行い、Chrome/Edgeでは自動実行後ページのscreenshot保存で視覚確認した。

## キャラ画像検証結果

対象画像配信元:

```text
https://market-static.msu.io/msu/platform/charimages/transient/...
```

HTTPヘッダ確認:

- `Content-Type: image/png`
- `Server: AmazonS3`
- `Via: CloudFront`
- `Vary: Origin`
- `Access-Control-Allow-Origin` は返らない
- `x-amz-expiration` に `TTL-90days-msu/platform/charimages/transient`

方式別結果:

| 方式 | PNG生成 | コンソール/エラー | Canvas taint | キャラ画像が写ったか | fallback |
|---|---|---|---|---|---|
| 通常の外部 `<img src>` | 失敗 | `html-to-image` 側で `Failed to fetch` / `[object Event]` | Canvas生成前に失敗 | いいえ | なし |
| `<img crossOrigin="anonymous">` | 失敗 | `html-to-image` 側で `Failed to fetch` / `[object Event]` | Canvas生成前に失敗 | いいえ | なし |
| `fetch(imageUrl, { mode: "cors" }) -> Blob/Data URL` | PNG自体は成功 | `TypeError: Failed to fetch` | なし | いいえ。fetch失敗表示 | fetch失敗表示で継続 |
| `html-to-image` の `imagePlaceholder` | 成功 | `Failed to fetch` 警告のみ | なし | いいえ | placeholderへ正常fallback |
| キャラ画像完全除外 | 成功 | なし | なし | なし | 不要 |

結論: `market-static.msu.io` のキャラ画像は、現在の静的SPAだけでは共有PNGへ直接含められない。T7初版はキャラ画像なし、またはplaceholderを正式仕様にする必要がある。

## 5回連続生成結果

最終測定値:

| mode | 結果 | 生成時間 | PNGサイズ | 寸法 | 備考 |
|---|---|---:|---:|---|---|
| external-img | 5/5失敗 | - | - | - | 外部画像fetch失敗 |
| anonymous-img | 5/5失敗 | - | - | - | CORS画像として取得不可 |
| fetch-data-url | 5/5成功 | 37-50 ms | 236,840 bytes | 1600x900 | fetchは毎回 `TypeError: Failed to fetch`。画像は含まれない |
| placeholder-option | 5/5成功 | 38-110 ms | 240,807 bytes | 1600x900 | placeholder正常fallback |
| no-image | 5/5成功 | 38-53 ms | 237,198 bytes | 1600x900 | 安定 |

Codex内ブラウザでは `getImageData(0,0,1,1)` が成功し、成功モードではtaintは発生しなかった。

## 出力PNG

```text
docs/t7-spike-samples/t7-spike-fetch-data-url.png      1600x900
docs/t7-spike-samples/t7-spike-placeholder-option.png  1600x900
docs/t7-spike-samples/t7-spike-no-image.png            1600x900
```

Chrome/Edge headless視覚確認:

```text
docs/t7-spike-samples/chrome-headless-page.png  1600x1200
docs/t7-spike-samples/edge-headless-page.png    1600x1200
```

注意: キャラ画像ありPNGは生成できなかったため存在しない。通常外部画像とanonymous画像はどちらも失敗した。

## Recharts検証結果

固定サイズのRechartsはPNG内で描画できた。

確認できたこと:

- 棒グラフ、折れ線、軸、ラベルは表示される。
- Tooltipは含めていないため不要UIは写らない。
- `ResponsiveContainer` を使わない固定サイズ構成は安定。
- 1600x900内に基本情報 + 2グラフは収まる。
- 日本語・タイ語・繁体字は表示された。
- 長いキャラ名は `overflow-wrap: anywhere` で収まった。

## Chrome / Edge 結果

Chrome/Edgeはheadless screenshotで自動実行後ページを表示確認した。どちらもページ表示、グラフ表示、テキスト表示、placeholder/no-image表示は確認できた。

この環境ではChrome/EdgeからDOM結果をstdoutで取得できなかったため、5回連続生成の数値はCodex内ブラウザの測定を採用する。T7本実装前には、通常のChrome/Edge DevToolsで同じページを開き、Consoleと生成PNGを手動でも確認することを推奨する。

## 判定

T7本実装へ進める。ただし条件付き。

進めてよい理由:

- `html-to-image` + 固定サイズRecharts + 1600x900 PNG生成は安定。
- placeholder/no-imageなら5回連続で成功。
- 文字、グラフ、レイアウトは共有カードとして現実的。

必須条件:

- 初版でMSUキャラ画像を直接入れる仕様にしない。
- 画像枠はplaceholder、または画像なしを正式fallbackにする。
- 外部画像を含めたい場合は、将来別タスクで画像キャッシュまたはCORS対応を設計する。これはbot/workflow/データ契約変更を伴う可能性があるためT7初版外。

## 停止条件との照合

| 停止条件 | 判定 |
|---|---|
| placeholderでもPNG生成が不安定 | 該当せず。5/5成功 |
| Rechartsが欠ける | 該当せず |
| 日本語またはタイ語等が正常描画されない | 該当せず |
| 1600x900に現実的に収まらない | 該当せず |
| Chrome/Edgeの一方で安定しない | 数値自動取得は未完了だが、headless表示確認は両方成功 |
| キャラ画像を含められず、placeholderの品質も不足 | キャラ画像は含められない。placeholder品質は初版共有用途として最低限可。デザイン改善は必要 |

## `IMPL_PLAN_T7.md`で修正が必要な箇所

修正推奨:

1. CORS検証結果を「不可寄り」から「通常外部img / anonymous / fetch data URL は不可」に更新する。
2. 初版スコープの「キャラクター画像」は「placeholderまたは画像なし」に変更する。
3. `html-to-image` 生成フローに「外部画像を入れない、または `imagePlaceholder` を必ず指定する」を明記する。
4. 受け入れ条件から「キャラ画像が写る」を外し、「画像取得失敗時にplaceholder/no-imageで成功する」を主条件にする。
5. 将来拡張として「キャラ画像キャッシュ」はT7初版外、T6/OGまたは別タスク扱いにする。

## 本実装時の注意

- `html-to-image` は `dynamic import()` で読み込み、通常初期bundleに載せない。
- 共有カードには外部 `<img>` を直接入れない。
- 画像を使う場合は同一originのplaceholder data URLか静的assetに限定する。
- グラフは固定サイズ、animation off、Tooltipなし。
- 生成中は二重実行を禁止する。
- 本番UIへの配線は別ブランチ/別実装で行う。