# IMPL_PLAN_RAFFLE_CALCULATOR — Lucid・Will別ラッフル分配

> 状態: Approved（ユーザー承認済み・実装着手）  
> 作成日: 2026-08-01  
> 承認者: ユーザー  
> 実装ブランチ: codex/raffle-calculator

## 0. 目的と背景

- 北極星への寄与: Lulumi-ToolsをMSUプレイヤー向けツール群へ拡張し、Lucid・Willのラッフル精算を誤混入なく短時間で完了できるようにする。
- 参照する決定: DECISION_LOG LULU-064〜072。
- 参照仕様: docs/SPEC_RAFFLE_CALCULATOR.md。
- 前提監査: docs/SPIKE_RAFFLE_API_ASSUMPTIONS.md。
- 分配はボスごとに完全分離する。LucidではPhantasma Coin、WillではArachno Coinだけを扱い、ドロップ1件ごとの売却総額を取得者へ入力し、ボス間の残高相殺・送金統合を行わない。
- MSU APIキーはGitHub Pages、Git、fixture、ログ、ブラウザ、実装担当用データへ入れない。

## 1. スコープ

### 1.1 触るファイル

既存Web:

- exp_ranking/web/src/App.jsx
- exp_ranking/web/src/components/BoardHeader.jsx
- exp_ranking/web/src/board/useHashRoute.js
- exp_ranking/web/src/board/useHashRoute.test.js
- exp_ranking/web/vitest.config.js
- exp_ranking/web/src/i18n/locales/ja.json
- exp_ranking/web/src/i18n/locales/en.json
- exp_ranking/web/src/i18n/locales/zh-TW.json
- exp_ranking/web/src/i18n/locales/th.json
- exp_ranking/web/src/i18n/locales/vi.json
- exp_ranking/web/src/i18n/locales/es.json

新規Web:

- exp_ranking/web/src/raffle/RaffleCalculatorRoot.jsx
- exp_ranking/web/src/raffle/raffle.css
- exp_ranking/web/src/raffle/domain/settlement.js
- exp_ranking/web/src/raffle/domain/settlement.test.js
- exp_ranking/web/src/raffle/domain/contract.js
- exp_ranking/web/src/raffle/domain/contract.test.js
- exp_ranking/web/src/raffle/storage/raffleStorage.js
- exp_ranking/web/src/raffle/storage/raffleStorage.test.js
- exp_ranking/web/src/raffle/integrations/raffleSource.js
- exp_ranking/web/src/raffle/integrations/raffleSource.test.js
- exp_ranking/web/src/raffle/components/PartyEditor.jsx
- exp_ranking/web/src/raffle/components/BossAndRoundSelector.jsx
- exp_ranking/web/src/raffle/components/PriceEditor.jsx
- exp_ranking/web/src/raffle/components/RaffleProgress.jsx
- exp_ranking/web/src/raffle/components/RaffleResults.jsx
- exp_ranking/web/src/raffle/components/SettlementResults.jsx

新規APIサーバー:

- server/raffle-api/app.py
- server/raffle-api/config.py
- server/raffle-api/contracts.py
- server/raffle-api/job_queue.py
- server/raffle-api/msu_client.py
- server/raffle-api/normalizer.py
- server/raffle-api/cache.py
- server/raffle-api/requirements.txt
- server/raffle-api/requirements-dev.txt
- server/raffle-api/README.md
- server/raffle-api/tests/conftest.py
- server/raffle-api/tests/test_app.py
- server/raffle-api/tests/test_job_queue.py
- server/raffle-api/tests/test_msu_client.py
- server/raffle-api/tests/test_normalizer.py
- server/raffle-api/deploy/raffle-api.service.example
- server/raffle-api/deploy/Caddyfile.example

共有契約fixture・文書:

- testdata/raffle/v1/cases/*.json
- testdata/raffle/v1/README.md
- docs/SPEC_RAFFLE_CALCULATOR.md
- docs/SPIKE_RAFFLE_API_ASSUMPTIONS.md
- docs/DECISION_LOG.md
- docs/IMPL_PLAN_RAFFLE_CALCULATOR.md

実装中にファイル分割が必要になった場合、同じ新規 raffle ディレクトリ内だけは追加可能とする。既存の別領域を触る必要が出た場合は停止する。

### 1.2 触らないもの

- exp_ranking/bot/**
- .github/**
- EXPランキングのJSON形式、ランキング計算、Task Managerデータ形式
- server/img-proxy/** の実装と稼働ポート
- GitHub Pagesの静的配信経路
- MSU APIキーの発行・Live API移行
- Lucid・Will以外の価格入力・分配（抽選済み結果の表示は対象）
- ラッフル参加・抽選実行・マーケット価格取得
- 実データの恒久保存、ユーザーアカウント、wallet署名

## 2. 変わってよいもの・いけないもの

### 2.1 変わってよい

- ヘッダーナビを EXP Ranking / Task Manager / Raffle Calculator の順にする。
- hash routeへ #/raffle を追加する。
- raffle routeではランキング読込完了を待たず、独立画面を表示する。
- maplen-board-raffle-v1 にはPT名とメンバーだけを保存し、開催回と分配設定は保存しない。
- api.lulumi-tools.com の /raffle/v1/* をブラウザから呼ぶ。
- 新VPS上へ画像プロキシと別プロセスの raffle-api 配置資材を追加する。

### 2.2 変わってはいけない

- EXP Ranking、Task Manager、共有画像の表示・保存・ルーティング。
- 既存localStorageキーの内容。
- 通常のランキング表示中に raffle APIを呼ばないこと。
- VPS停止中も静的SPA、EXP Ranking、Task Managerが表示できること。
- APIキー、wallet、生assetKey、生上流レスポンスをログへ残さないこと。
- LucidとWillの価格、残高、送金一覧を同じ計算へ混在させないこと。
- Incompleteクリアを強制計算しないこと。
- UNKNOWNを黙って0価値として扱わないこと。
- 新しいnpm依存関係を追加しないこと。

## 3. 実装設計

### 3.1 段階的な着手

計画承認後、前提監査の未解消事項に触れない次の部分から着手できる。

1. hash route、ヘッダーナビ、ランキング読込ゲートより前のRaffleページ分岐。
2. PT構成だけのlocalStorage、週次開催回算出、契約検証、BigInt分配純粋関数。
3. 合成fixtureだけを使うAPIサーバー骨格、ジョブキュー、レート制御、CORS、エラー契約。
4. API未接続でも表示できる画面とfail-visible状態。

次は匿名化した実API fixtureが確定するまで実装しない。

- prizesとclearInformationの対応付け。
- winCount、Power Crystal、対象コインの本番正規化。
- raffled_at候補探索。
- owner変更・unlink時のwallet解決。
- Live MSU API接続とVPS配備。

### 3.2 Web側の計算権威

分配計算の唯一の正は exp_ranking/web/src/raffle/domain/settlement.js とする。APIサーバーには単価適用、均等分配、送金生成を実装しない。

入力:

- boss: LUCID または WILL
- 同一ボスでユーザーが選択した1件以上の難易度候補をメンバー別に合算したCompleteクリア
- bossNeso、powerCrystalAmount、ascendantNesoは符号なし10進文字列
- dropsは取得者に紐付くCOIN / EQUIPMENTの1件単位
- powerCrystalNesoRateは0以上の有限10進文字列（初期値1）
- saleNesoByDropIdは選択カテゴリのドロップ1件ごとの売却総額
- partyOrderは保存済みの表示順

演算:

- JavaScript BigIntで整数演算する。
- Power Crystalレートは分子・10の累乗の分母へ変換する。
- 変換後に1 NESO未満の端数が出る入力は丸めず、計算停止エラーにする。
- 週1回制約により、選択ボスのCompleteクリア1件だけを計算する。
- 余りはpartyOrderの先頭から1 NESOずつ配る。
- 支払側・受取側の2ポインター照合で送金を生成する。
- mixed boss、Incomplete、UNKNOWN必須分類、未設定価格、安全上限超過は明示エラーとする。

### 3.3 Webルーティングと独立表示

- useHashRouteへ raffle routeを追加し、buildHashとparseHashを往復検証する。
- AppShellはTask Managerと同様、loadingとcharacters.lengthの判定より前にraffle routeを返す。
- BoardProviderのランキング取得が失敗または遅延してもRaffleCalculatorRootを表示する。
- キャラクター名はVPSバックエンドからMSU公式Suggest APIを検索し、大文字小文字を区別しない完全一致候補だけをCharacters APIで確定して追加する。
- Navigator URLからも追加できる。raw asset keyの直接入力欄とランキング候補選択は提供しない。
- headerのRaffle Calculatorは全ロケールで同じ固有名とする。

### 3.4 ブラウザ保存

maplen-board-raffle-v1 のversion 1を使用する。

- 最大10パーティ、各最大6キャラクター。
- assetKeyだけを保存し、historyKeyは asset: + assetKey から導出する。
- 現在の公式開催回はWebが直近の木曜日00:00 UTCとして都度算出し、保存しない。
- 分配項目、Power Crystalレート、ドロップ売却額はボスタブの一時状態とし、保存しない。
- wallet override、生履歴、APIキーも保存しない。
- JSON破損、未知version、quota失敗は既存データを上書きせずfail-visibleにする。

### 3.5 API契約

Caddyのストリーミングbuffer設定に依存しない「ジョブ作成＋ポーリング」を採用する。

- GET /raffle/v1/health
- POST /raffle/v1/characters/search
- POST /raffle/v1/characters/resolve
- POST /raffle/v1/jobs
- GET /raffle/v1/jobs/{opaqueJobId}
- DELETE /raffle/v1/jobs/{opaqueJobId}

assetKeyとwalletはURLやアクセスログへ出さず、POST bodyだけで受け取る。jobIdは推測困難なランダム値とする。

POST /jobs:

- request bodyは16KiB以下。assetKeyはASCII・8〜128文字の形式検証後、公式character resolveで存在確認する。
- memberIdは英数字・underscore・hyphenの1〜64文字だけを受け付ける。
- raffledAtは直近の公式開催回を表す木曜日00:00 UTCのISO 8601とし、公式保持期間内。
- charactersは1〜6件、assetKey重複なし。
- walletOverrideは任意、保存しない。
- 応答は202とjobId。キュー満杯なら429を500ms以内に返す。

GET /jobs/{id}:

- schemaVersion=3、classificationVersion=1。schemaVersion 3で公式討伐人数・履歴参加人数・保存PT分配人数の独立表現を許可する。
- statusは queued / resolving / fetching / normalizing / complete / partial / error / cancelled。
- progressは実際に完了したキャラクター数、総数、現在段階、経過msだけを返す。
- 金額と数量は10進文字列で返し、JavaScript Numberへ変換しない。入力値は最大30桁、レート小数部は最大18桁、計算結果は最大60桁とし、超過時は丸めず明示エラーにする。
- 正規化レスポンスは1MiB以下。超過時は部分切断せずjob errorにする。
- リクエストでボスを選ばず、当該公式開催回の全当選結果を一括取得する。
- `raffleResults`には取得できた全ボスの抽選済み当選を1件ごとに返し、表示専用のその他ボスも欠落させない。
- `clears`には同一公式`partyCount`を持ち、複数履歴では同一難易度のラッフル参加時刻が1時間以内に収まるLucid / Willを、ボスごと最大3件含める。履歴1人から候補化できる。`partyCount`は公式討伐人数、`members`は保存PT全員、`historyMemberIds`は履歴保有者として独立させる。`bossDifficulty`（EASY / NORMAL / HARD）と対応表に一致する`ascendantTier`を必須とし、その他ボスを分配計算へ渡さない。
- 部分失敗は成功分とキャラクター別エラーコードを同時に返す。
- 上流本文、wallet、生assetKeyは返さない。Webが送ったローカルmemberIdで対応付ける。

ジョブ:

- サーバー全体で上流送信ワーカー1個。
- 公式APIリクエスト開始間隔は1,000ms以上。
- job hard timeout 45秒、Web待機上限50秒、poll間隔500ms。
- キュー上限20、完了ジョブ保持上限50件、保持時間5分。
- 同一利用元のjob作成は4回/分・burst 2、resolveは10回/分、pollは180回/分。利用元識別値はメモリ内だけに保持しログへ出さない。
- sandbox上流呼び出しはUTC日次2,700回でfail-closedし、公称3,000回quotaの10%を運用余白として残す。
- client abortまたはDELETE後は未開始上流呼び出しをキャンセルする。
- 生レスポンスをジョブストアへ保持しない。

### 3.6 上流クライアントとキャッシュ

- Python標準urllib、FastAPI、uvicornを使用し、新しいWeb npm依存は追加しない。
- APIキーはMSU_OPEN_API_KEY環境変数だけから読む。値を例示しない。
- 接続・応答タイムアウトを明示し、429はRetry-After優先、なければ1/2/4秒で最大3回。
- 上流状態とJSON形状を検証し、HTMLや不正JSONを正規化へ渡さない。
- キャラクターowner情報は短TTL。成功した公式item metadataはVPS専用SQLiteへ30日・最大10,000件で永続保存し、期限切れは再取得する。
- item metadataは各メンバーの履歴取得直後に未取得itemIdだけを逐次取得する。同一job内の重複取得と失敗再試行を避け、後続履歴の遅延前に長TTLキャッシュを作る。
- 履歴価値キャッシュはwinCountの不変性をfixtureと公式挙動で確認するまで短TTLに留める。
- メモリキャッシュは正規化済み・匿名化可能な値だけを最大32MiBで保持し、超過時はLRUで削除する。item metadataのSQLiteは公開フィールド6項目だけを最大10,000件保存し、APIキー・wallet・assetKey・履歴用テーブルを持たない。
- 失敗、UNKNOWN、wallet mismatch推測を長時間キャッシュしない。

### 3.7 分類とボス分離

- layer/clearの公式フィールドからLUCID/WILLを識別する。
- LUCIDはPhantasma Coinだけ、WILLはArachno CoinだけをCOIN分類する。
- Florin、AbsoLab Coin、Stigma Coin、他のExchange CurrencyはOTHER。
- 公式メタデータで識別できない報酬はUNKNOWN。
- itemIdだけの推測ハードコードは禁止する。匿名化fixtureと公式メタデータの組で分類規則を固定する。
- 異なるbossの履歴は同じclearId、分配設定、計算結果へ入れない。

### 3.8 共有fixture

testdata/raffle/v1/casesに、各ケースを次の組として置く。

- anonymizedUpstreamInput
- expectedNormalizedOutput
- expectedWarnings
- schemaVersion
- classificationVersion

サーバーテストはinputをnormalizerへ通してexpected outputと比較する。Webテストはexpected outputを契約検証と計算入力へ使う。fixtureはテスト時だけファイルとして読み、本番Web bundleへimportしない。

最低ケース:

- Lucid + Phantasma Coin
- Will + Arachno Coin
- Lucid / WillのParty Clearを別々に返し、その他ボスはRaffle Resultsだけへ返す
- Florin等OTHER
- UNKNOWN
- Incomplete
- clearInformations複数
- winCount/receivedCount差
- 空履歴
- 429、timeout、部分失敗
- raffledAt混在と、木曜日00:00 UTC以外のリクエスト拒否
- wallet override
- 1 NESO未満のPower Crystal換算端数

## 4. 受け入れ基準（数値）

| # | 基準 | 目標値 | 測定方法 |
|---|---|---:|---|
| 1 | Webルート | #/raffle往復100%、未知route回帰0 | Vitest useHashRoute |
| 2 | ランキング非依存 | ranking fetch失敗中もRaffle見出し表示 | ローカルでdata取得を失敗させ確認 |
| 3 | ボス分離 | mixed-boss fixtureの混入・相殺0件 | settlement/normalizer tests |
| 4 | 金額保存 | 分配前後差0 NESO、送金後残高全員0 | 1〜6人の表形式テスト |
| 5 | 端数 | 1 NESO未満の丸め0件、全件明示エラー | settlement tests |
| 6 | 不完全データ | Incomplete自動計算0件、UNKNOWN警告欠落0件 | fixture tests |
| 7 | レート制限 | 上流開始間隔の最小値1,000ms以上 | fake clock queue test |
| 8 | 通常性能 | 未キャッシュ6人job 30秒以内 | fake upstream 13〜15呼出しとVPS実測 |
| 9 | timeout | server 45秒以内、Web 50秒以内 | fake timeout + Web abort test |
| 10 | queue | 上限20、満杯時429を500ms以内 | API test |
| 11 | 進捗 | 推測人数0、実完了人数と一致100% | job contract test |
| 12 | 悪用防止 | job 4回/分、poll 180回/分、上流2,700回/日でfail-closed | fake clock API test |
| 13 | スキーマ | server/web共有fixture全件合格 | pytest + Vitest |
| 14 | Web回帰 | 既存＋新規Vitest全緑 | npm run test |
| 15 | build | production build成功 | npm run build |
| 16 | API回帰 | raffle-api pytest全緑 | python -m pytest server/raffle-api |
| 17 | ロケール | 6/6でキー集合一致 | localeParity + raffle locale test |
| 18 | 秘密漏えい | API-key形式、wallet、生fixture識別子0件 | rg、git diff、build出力走査 |
| 19 | CORS | 本番許可元1件、未許可元ACAOなし | API test + curl |
| 20 | メモリ | raffle-api RSS 128MiB以下、VPS MemAvailable 256MiB以上 | systemctl/curl負荷後の実測 |
| 21 | 他機能通信 | raffle未表示時の/raffle請求0件 | Browser Network確認 |
| 22 | ユーザーゲート | マージ・公開前ローカル確認1回 | ユーザー承認記録 |

## 5. 停止条件

以下に該当したら実装を止め、観測事実・選択肢・推奨案を報告する。

- 計画と実コードの構造差により、既存のraffleディレクトリ外へ予定外の変更が必要。
- prizesとclearInformationを一意に対応付けられない。
- winCountが分配対象数量であると確認できない。
- Power Crystalの公式フィールドまたは分類規則を確定できない。
- Lucid/WillまたはArachno/Phantasmaを公式データで安定識別できない。
- raffled_at候補探索の境界を欠落なく定義できない。
- owner変更・unlink時の空結果を安全に分類できない。
- API利用規約上、VPS中継で利用者へ結果を提供できない。
- BigIntへ変換前の上流数値が既に丸められている。
- 通常6人jobが2回の改善後も30秒を超える。
- 1GB VPSでRSS 128MiBまたはMemAvailable 256MiBの基準を満たせない。
- 新しいnpm依存、外部DB、Redis、別ホストが必要。
- APIキーをクライアント、Git、fixture、ログへ置く必要が生じる。
- 既存VPSサービスまたはCaddy routeと競合する。
- 受け入れ基準の未達が2回の修正で解消しない。

## 6. コミット分割

仕様上、ユーザーのローカル確認前にはコミットしない。確認後、次の単位で各コミットを単独revert可能にする。

1. docs/fixture: 承認済み計画、正規化契約、匿名化fixture。
2. web-domain: BigInt計算、契約検証、ボス別storage、純粋関数テスト。
3. api-core: 設定、上流クライアント、キュー、キャッシュ、合成fixtureテスト。
4. api-normalization: 実API fixtureでLucid/Will正規化。
5. web-route-ui: route、header、Raffle画面、6ロケール。
6. web-api-wire: ジョブ作成、ポーリング、進捗、部分失敗。
7. deploy: systemd/Caddy例、README、運用・ロールバック手順。

各コミットで秘密文字列走査を行い、APIキーを含むファイルはstageしない。

## 7. 検証コマンド

Web:

    cd exp_ranking/web
    npm run test
    npm run build

API:

    python -m pytest server/raffle-api

既存VPSサービス回帰:

    python -m pytest server/img-proxy

差分・秘密:

    git diff -w -- docs exp_ranking/web server/raffle-api testdata/raffle
    rg -n "gw_[0-9a-fA-F]{32,}" docs exp_ranking/web server/raffle-api testdata/raffle
    git status --short

ローカル統合:

    raffle-apiをfixture modeで起動
    Web dev serverから #/raffle を開く
    Lucid、Willを別々に計算
    API停止、429、1人失敗、Incomplete、UNKNOWNを確認
    Browser Networkで通常ページから/raffle請求0件を確認

VPS配備はローカル確認と別承認後にだけ行う。

## 8. ロールバック

- Web: route、header link、RaffleCalculatorRoot importをrevertすると既存2ツールだけへ戻る。
- localStorage: maplen-board-raffle-v1は独立キーのため、Raffle機能をrevertしても既存保存へ影響しない。残存データは削除せず復帰時に再利用できる。
- API: systemctl stop/disable raffle-api。画像プロキシの8781とは別portを使用する。
- Caddy: /raffle/* handleだけを削除してreloadする。GitHub Pagesと/img/*は不変。
- Secret: VPS環境ファイルをサービス停止後に削除またはキーをローテーションする。Gitのrevert対象にしない。
- fixture/contract: schemaVersionを戻さず、未公開なら該当コミットをrevertする。公開後の互換破壊は新versionで行う。
- DB migrationは存在しないため、データベースrollbackは不要。

## 9. 配備と秘密運用

- 実装・単体テストはfixture modeで行い、APIキーを要求しない。
- 本番相当運用前に、会話へ掲載済みsandbox keyをローテーションする。
- VPSでは /etc/lulumi-tools/raffle-api.env などGit外のroot所有0600ファイルへMSU_OPEN_API_KEYを置く。
- systemd unitはEnvironmentFileを参照し、キー値をunit例へ書かない。
- raffle-apiは127.0.0.1:8782でlistenし、画像プロキシ127.0.0.1:8781と分離する。
- Caddyは /raffle/* だけをraffle-apiへ転送する。
- 本番CORSはhttps://lulumi-tools.comだけ。localhostは開発環境変数でのみ追加する。
- access logはassetKeyやwalletを含むbodyを記録しない。アプリログもrequestId、状態、時間、cache hitだけとする。
- 配備前後にVPSのMemAvailable、既存img-proxy状態、port競合を確認する。

## 10. 完了報告テンプレ

- 実施ファイル:
- 未コミット差分の要約:
- 受け入れ基準1〜28の実測値:
- Web test/build:
- API pytest:
- 共有fixture件数:
- 6人job実測秒:
- 上流開始間隔の最小値:
- RSS / VPS MemAvailable:
- 秘密文字列走査:
- ローカル確認手順:
- 停止条件または残課題:
- ユーザー確認後のコミット候補:
## 11. 着手前ベースライン（2026-08-01）

- Web: 33 test files、297 tests passed、1.12秒。
- 既存img-proxy: 18 tests passed、0.28秒。
- 初回sandbox実行はesbuild子プロセスとpytest一時ディレクトリへの権限拒否で停止した。通常権限で同一テストを再実行し、コード変更なしで全通過したため製品回帰ではない。
- Raffle実装後は少なくともこの297件＋18件を維持し、新規Raffleテストを追加する。
## 12. 実装進捗（2026-08-02）

承認済みのローカル実装と実API統合を完了した。VPS配備、Git commit/pushはユーザーのローカル確認と別承認まで行わない。

- `#/raffle`、ヘッダーナビ、ランキング読込ゲートから独立した画面。
- PT作成、公式Navigator完全一致名前検索、Navigator URL解決、直近木曜00:00 UTCのPT一括読込。
- 選択キャラの全当選を1履歴ずつ表示。分配用Party Clearは同一公式`partyCount`かつラッフル参加時刻の幅1時間以内を満たすLucid/Willを同一開催回の難易度別候補として返す。公式討伐人数・履歴参加人数・保存PT分配人数は独立して表示し、不一致時は候補ごとの明示確認を計算ゲートとする。履歴がない保存PTメンバーも獲得0で分配対象に含め、同一ボスの複数候補はWebで複数選択・合算できる。
- Decimalによる上流数量検証、公式layer/item metadataによるNESO、Power Crystal、Phantasma/Arachno Coin、Equipment分類。
- BigIntによるボス別1クリア計算、5カテゴリ選択、ドロップ1件ごとの売却総額、パーティ順の余り配分、最終送金生成。Power Crystalは公平価値へ含める一方で送金可能NESOから除外し、PT別の前回持ち越しと今回の支払上限から次回持ち越しを算出する。
- 分配結果UIは概要、選択カテゴリ別合計、メンバー別の履歴有無・当選内訳・分配権利額・支払／受取、実送金表を表示し、最終差額だけでなく計算過程を監査可能にした。コインは数量、装備は公式アイコンと名前ツールチップ、持ち越し有効時は前回／次回持ち越しも表示する。
- ページ構成は上段をパーティ設定・履歴取得、下段を全幅の結果・精算に分離した。デスクトップでは結果領域をほぼ全画面幅で使用し、パーティメンバーは幅に応じて複数列表示する。
- schemaVersion/classificationVersion契約、別開催回除外、UNKNOWN/Incomplete/API warnings/errorsのfail-visible表示。
- fixture/live両モード、単一ワーカー、上限付きジョブ/キャッシュ、UTC日次上流予算、1秒上流開始間隔、一時上流エラー1回再試行、利用元別トークンバケット、厳格CORS。
- systemd/Caddy例と、Git外環境ファイルによる秘密運用手順。

実測:

- Web: 41 test files / 358 tests passed、production build成功。
- raffle-api: 48 tests passed。
- 実API: `pachimi` / `0kn0`の公式名前検索成功。
- 実API UI統合: `0kn0`の`2026-07-30T00:00:00Z`当選17件を表示。Lucid/他ボス/Ascendantを含み、Phantasma Coin、Boss NESO、Power Crystal Couponを公式メタデータで分類。公式アイテム画像27点を表示し、同一報酬をカード内で合算。
- Ascendant UI: 開催回内のAscendant当選を1カードに集約し、提供されたイベント対応表を9ケースのテストへ固定。表示は例として `Eternal - Hard Will`。
- Raffle Results summary: 選択キャラクターの全当選からNESOとPower Crystal額面をBigIntで集計し、同名アイテム合計を初期折り畳みで表示。
- 実API初回job: 約12.3秒。Party Clearsは同一難易度・同一公式`partyCount`の参加履歴を1時間幅でクラスタ化する。保存PT人数との一致は必須にせず、人数不一致はWebの明示確認ゲートで扱う。
- 実PT人数一般化: 保存PT5人の実履歴で`討伐6人・履歴参加5人・分配5人`を表示し、確認前は計算無効、確認後は5人分配（合計86.1M、1人17.22M）まで完了。
- 永続item metadataキャッシュ実測: `0kn0`のコールドjobは13.858秒・成功metadata 11件をSQLiteへ保存。APIプロセス再起動後の同一jobはSQLite再利用により3.094秒で、当選17件・errors 0・`metadata_timeout`なし。
- ブラウザconsole error: 0件。

残作業:

- ユーザーによるローカルUI確認。
- 実際の6人PTでラッフル履歴4人・分配対象6人となるLucid/Will Party Clearと、難易度複数選択時の合算分配をユーザー確認。
- 会話へ掲載済みsandbox keyのローテーション。
- 新VPSのメモリ・ポート確認、秘密ファイル設定、Caddy/systemd配備（別承認が必要）。
- コミット、push、PR（ユーザー確認後）。
- distribution-roster separation: 保存PT全員を分配対象者、難易度別履歴のあるメンバーを獲得情報の提供者として分離する。候補生成は同一開催回・同一ボス難易度・同一公式`partyCount`・参加時刻の幅1時間以内を使い、保存PT人数との一致は要求しない。討伐・履歴・分配人数は各1〜6人で一般化し、完全一致しない候補はWebで明示確認する。同一ボスのHard / Normal等が混在した場合はチェックで1件以上を選び、複数選択時はメンバー別獲得額を合算する。
- Ascendant settlement mapping: 実データでAscendant履歴のclearInformationsが空と判明したため、時刻近傍方式を廃止。公式layer難易度と承認済みTier対応表で一意に結び、Normal Will＋Gloriousの回帰テストと実PT合計を検証する。
- Party Clear context display: API clearへ`bossDifficulty`と`ascendantTier`を追加し、タブと設定見出しを`Normal Will + Glorious Ascendant`形式で表示する。Lucid / Willの全6対応をサーバーとWebのテストで固定する。
