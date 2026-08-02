# Lulumi Tools Raffle API

GitHub Pages上のRaffle Calculatorから呼ぶ、秘密情報を持つVPS側APIです。Webへは正規化済みデータだけを返し、MSU Open API key、wallet、生の上流レスポンスを返却・記録しません。assetKeyは正規化したキャラクター検索・解決結果の内部識別子としてだけ返し、ログには記録しません。

## 現在の実装状態

合成fixtureモードに加え、公式Navigatorの完全一致名前検索とMSU Open APIの実履歴正規化を実装済みです。履歴は指定した木曜00:00 UTCと完全一致する開催回だけを採用し、全ボスの当選結果を表示します。分配用Party Clearは、保存PT人数と公式`partyCount`が一致し、複数人PTでは同一Lucid/Will難易度のラッフル参加時刻が2人以上・幅1時間以内に収まる履歴群だけを候補として返します。6人討伐で4人だけ参加した場合も、4人の`partyCount=6`と時刻条件が一致すれば、未参加2人を獲得0として保存PT6人の分配対象へ含めます。同一ボスの複数難易度はWeb側で1件以上を選択し、複数選択時は合算します。Power Crystal、Arachno Coin、Phantasma Coin、装備は公式アイテムメタデータで分類します。メタデータは各メンバーの履歴取得直後に新規itemIdだけを取得・長期キャッシュし、後続メンバーの遅延で先行分まで`metadata_timeout`になることを防ぎます。Ascendant NESOとPower Crystalはボス難易度に対応するAscendant Tier（例: Normal Will＝Glorious）から取得し、キー・wallet・生レスポンスはWebへ返しません。

## ローカル起動

```powershell
python -m pip install -r requirements-dev.txt
$env:RAFFLE_API_FIXTURE_MODE='1'
$env:RAFFLE_API_ALLOWED_ORIGINS='http://localhost:5173'
python -m uvicorn app:app --host 127.0.0.1 --port 8782
```


実APIで起動する場合は、Git外の秘密ファイルから`MSU_OPEN_API_KEY`をプロセス環境へ設定し、`RAFFLE_API_FIXTURE_MODE`を設定しません。ローカル開発用ファイルの推奨先は`C:\Users\<user>\.lulumi-tools\raffle-api.env`です。値をコマンド履歴、`.env`（repo内）、Webビルドへコピーしないでください。
## アイテムmetadataキャッシュ

検索順はメモリ、SQLite、MSU APIです。成功した正規化済みmetadataだけを30日間保存し、最大10,000件を超えると古い行から削除します。失敗、UNKNOWN、APIキー、wallet、assetKey、ラッフル履歴は保存しません。

ローカルの既定保存先はOSのユーザーキャッシュ領域です。`RAFFLE_API_ITEM_CACHE_DB`で明示変更でき、`off`で無効化できます。保存期間は`RAFFLE_API_ITEM_CACHE_TTL_DAYS`（1～90日、既定30日）です。本番service exampleは`StateDirectory`で作成した`/var/lib/lulumi-tools-raffle-api/item-metadata.sqlite3`だけを書き込み可能にします。`GET /raffle/v1/health`の`persistentItemCache`で初期化成否を確認できます。
API:

- `GET /raffle/v1/health`
- `POST /raffle/v1/characters/search`
- `POST /raffle/v1/characters/resolve`
- `POST /raffle/v1/jobs`
- `GET /raffle/v1/jobs/{jobId}`
- `DELETE /raffle/v1/jobs/{jobId}`

テストはこのディレクトリで `pytest -q` を実行します。

## 本番秘密情報

キーはGit外のroot所有0600ファイル `/etc/lulumi-tools/raffle-api.env` にだけ置きます。

```text
# MSU_OPEN_API_KEY is set here only; never copy its value into the repository.
RAFFLE_API_ALLOWED_ORIGINS=https://lulumi-tools.com
```

会話へ掲載済みのsandbox keyは本番相当運用前にローテーションします。systemd unit、Caddy設定、Webビルド、fixture、ログにキー値を書きません。

## 配備

`deploy/raffle-api.service.example` は127.0.0.1:8782で起動します。`deploy/Caddyfile.example` の `/raffle/*` handleだけを既存の `api.lulumi-tools.com` site blockへ統合してください。既存 `/img/*` とGitHub Pages経路は変更しません。

配備前に、ポート競合、既存img-proxy、`MemAvailable >= 256 MiB`を確認します。ローカルユーザー確認と別途配備承認を得るまでVPSへ反映しません。

## ロールバック

Caddyの`/raffle/*` handleを削除してreloadし、`raffle-api.service`をstop/disableします。画像プロキシと静的サイトは独立しているため影響しません。