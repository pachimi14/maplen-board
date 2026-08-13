# Raffle API 前提監査

> 状態: 検証完了 / 実APIローカル統合済み（2026-08-02）  
> 取扱い: 匿名化済み。APIキー、wallet address、生レスポンス、生assetKeyを含まない。

## 1. 確定した範囲

- ラッフル結果タブ: 選択開催回で当選した全ボス・全レイヤーを1履歴ずつ表示する。
- 分配対象: 保存PT全員で倒したLucid、Willだけ。
- 対象コイン: LucidはPhantasma Coin、WillはArachno Coin。Florin等は結果表示には残すが分配へ入れない。
- 分配計算: Web側の純粋関数が正。APIは取得・検証・正規化だけを行う。

## 2. 公式API契約の実測

### 名前検索

公式Open APIのSuggestでは`pachimi` / `0kn0`を取得できなかった。公式Navigatorが利用する公開検索`GET /navigator/api/navigator/search?keyword=...`では両名を取得できたため、VPS中継は次の順で解決する。

1. Navigator公開検索で完全一致（大文字小文字を区別しない）を1件選ぶ。
2. 返されたassetKeyを公式Open APIのcharacter detailで再検証する。
3. Webへは表示情報と内部識別用assetKeyだけを返す。walletは返さない。

### ラッフル履歴

`0kn0`へ`2026-07-30T00:00:00Z`を指定した実測では24履歴が返り、そのうち22履歴だけが指定開催回と一致し、2履歴は翌日開催回だった。よってレスポンス全件を信用せず、各`history.raffledAt`を指定回と完全一致で再検証する。

履歴の主要構造:

- `layerId`, `raffledAt`, `state`, `prizes`, `clearInformations`
- prizeのアイテム識別子: `rewardKey.itemId`
- 当選数量: `winCount.value`（`"4.000000"`のような10進文字列）
- clear: `clearedAt`, `partyCount`, `rewardKeys`

数量は浮動小数へ変換せずDecimalで整数性を確認し、整数でない値・負数・非有限値は0扱いで分配へ入れない。

### レイヤーとアイテム

- `POST /v1rc1/msn/layers/static`でboss/contentsと`layerId`を対応付ける。
- `GET /v1rc1/gamemeta/items/{itemId}`の公式名・カテゴリで報酬を分類する。
- Phantasma Coin=`4310218`、Arachno Coin=`4310249`を実名とExchange Currencyカテゴリの組で検証する。
- Power Crystal Couponは公式名の額面（10K/100K/1M/10M）を解釈する。Sealed NodestoneをPower Crystalと誤分類しない。
- 装備は公式tier0=`Equipment`だけを売却額入力対象にする。

## 3. Party Clearの対応規則

保存PT全員について、次のすべてを満たすLucid/Willだけを分配候補として返す。

- 同じ対象開催回。
- 同じボスlayer。
- 全登録メンバーの`clearInformations.partyCount`が一致する。登録人数と同数なら直接採用し、登録2人以上で公式partyCountの方が多い場合は利用者確認候補とする。
- 全員の`clearedAt`が60秒以内で一致。2026-07-30開催回の同一Will討伐で最大約47秒差を実測した。
- ボスは週1回だけのため、候補が各メンバーにつき一意。

Ascendant履歴の`clearInformations`は実データでは空であり、ボスclear時刻では対応付けられない。同一開催回内で公式layerのボス難易度を対応表へ引き、Lucid Easy＝Dawning 2、Lucid Normal＝Mystic、Lucid Hard＝Divine、Will Easy＝Luminous、Will Normal＝Glorious、Will Hard＝Eternalを一意に対応付ける。対象Tierが0件または複数件なら推測せず未対応とする。

- boss履歴のitemId=1: Boss NESO
- 対応Ascendant履歴のitemId=1: Ascendant NESO
- 対応Ascendant履歴のPower Crystal Coupon数量×公式額面: Power Crystal量
- boss履歴の対象コイン・Equipment: ドロップ所有メンバーへ紐付け

## 4. ローカル実測

- `pachimi`: 公式名前検索成功。
- `0kn0`: 公式名前検索成功。
- `0kn0` / `2026-07-30T00:00:00Z`: 当選結果17件をUI表示。
- 表示にはLucid、他ボス、Ascendant Tier Raffleを含む。
- LucidでPhantasma Coin、Boss NESOを確認。AscendantでPower Crystal CouponとNESOを確認。
- 1人PTに対し公式Lucid partyCount=3、Will partyCount=6のためParty Clearsは0件。部分PT判定は登録2人以上からとし、1人だけでは候補にしないことを確認。
- 初回実履歴UI job: 約12.3秒。メタデータキャッシュ後は短縮される。

## 5. セキュリティ

- キーはGit外`C:\Users\<user>\.lulumi-tools\raffle-api.env`からプロセス環境へだけ読み込む。
- Web、fixture、文書、ビルド、レスポンス、ログへキー・wallet・生assetKeyを記録しない。
- 会話本文へ掲載されたsandbox keyは本番運用前に必ずローテーションする。
- 本番は新VPSのroot所有0600環境ファイルを使用し、CORSは`https://lulumi-tools.com`だけを許可する。