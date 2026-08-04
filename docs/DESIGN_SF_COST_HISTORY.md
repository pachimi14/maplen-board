# DESIGN_SF_COST_HISTORY — スターフォース強化費用の履歴チャート(設計正典)

状態: **⬜ 承認待ち**(統括起草 2026-08-05・architecture-review 経由)
ブランチ: `feat/sf-cost-history` / DECISION_LOG 採番は追記時に確定(現在 LULU-063 まで)

> **改訂 r2**: 初版は「デプロイ=GitHub Pages 静的のみ」(CLAUDE.md 5行目)を前提に静的JSON配信で設計したが、
> **実際には `api.lulumi-tools.com` が稼働中**(Caddy → FastAPI、本リポ `server/img-proxy/` が前例)。
> ユーザーの指摘により全面改訂。**CLAUDE.md 5行目は API 層の実態を反映していない**(§17 で是正案)。

---

## 1. 目的(一文)

**MapleStory N の主要装備について「今この強化をするのは過去と比べて高いのか安いのか」を、ユーザーが自分の強化範囲を指定して確認できるようにする。**

北極星への寄与: 本リポの北極星は「ランキングを毎朝の習慣に変え、検索/SNS から人を連れてくる」。
本ツールは**ランキングとは独立の第2の入口**であり、「強化費用 履歴」「スターフォース 相場」系の検索需要を拾う **SEO 導線**(T5 の基盤に乗る)と、raffle / task manager と同様の**再訪動機**として寄与する。
**ランキング側の設計・データモデルには一切干渉しない**ことを本設計の絶対条件とする。

---

## 2. 前提の確定(実測済み / 要検証の区別)

| # | 前提 | 状態 |
|---|------|------|
| P1 | 公式 1時間足 API `dynamicpricing/enhance-price/history` が直近150日を返す | **真・実測済**(SH-1 M3: 最古 `2026-03-08T01:00:00Z` = **149.7日前**。1リクエストで **3510点**が一括、ページング無し) |
| P2 | `endPrice` の単位が latest API の `closePrice / price_divisor`(1e18)と一致する | **真・実測済**(SH-1 M1: `closePrice / endPrice = 1e18`、itemUpgrade 0/10/17/21 で**相対ばらつき 1.28e-16**。統括が生サンプルから独立再計算して一致) |
| P3 | `sumEnhanceCnt=0` の時間帯にも `endPrice` が存在する | **真・実測済**(SH-1 M5: 3510行中 3111行が `sumEnhanceCnt=0`、**そのうち 3111行(100%)に非null `endPrice`**) |
| P4 | `itemUpgrade` を省略して全星を1リクエストで取れるか | **偽・実測済**(SH-1 M2: 省略時は `itemUpgrade=0` と同一応答)。∴ **リクエスト数は 616 で確定**(§5.3) |
| P11 | `period=2` が1時間足 | **真・実測済**(SH-1 M7: `date` 間隔の最頻値 3600秒。欠損 2.3%) |
| P12 | 有効な `itemUpgrade` は 0..22 | **実測済**(SH-1 M4: `latest` は 0..22 の23段階すべてに `closePrice`。`history` は 22 まで実データ、23/24 は 200 で空、**25 は HTTP 500**) |
| P13 | `minTimestamp` / `maxTimestamp` の単位は**秒** | **実測済**(SH-1。設計書に未記載だった) |
| P5 | Expected 計算の 900 点は **32ms**(既存エンジン無改変・Node/V8 実測) | **実測済** |
| P6 | `expectedStarforceCostExact` は **import ゼロの純粋算術**(約310行) | **実測済**(starforce.ts 冒頭) |
| P7 | maplenEnhancebot の parity fixture が 14装備 × 全 span の `expected` を保持 | **実測済**(`tools/parity/sf_fixtures/*.percentiles.json`) |
| P8 | **`api.lulumi-tools.com` = Caddy + FastAPI(systemd)の VPS。`/img/*` は本リポ `server/img-proxy/`** | **実測済**(Caddyfile.example / README) |
| P9 | web は **JavaScript(.jsx/.js)+ vitest**、recharts 2.15.3 導入済(新規依存不要) | **実測済**(package.json) |
| P10 | **VPS の空き容量・RAM・実 Caddyfile・空きポート** | **要検証**(**SH-1b**。SH-1 の計画書に含めていなかった=統括の起票漏れ) |
| P14 | **☆20/21/22 の `closePrice` が完全同一値**(`2711584243397000000000000`)。☆19 はそれより高い(価格が単調でない) | **要検証**(SH-2)。**§9.2 参照** |

**P2 は 1e18 で確定した**(SH-1 M1)。∴ 保存時に `endPrice` をそのまま入れれば NESO 単位になり、
maplenEnhancebot の `closePrice / price_divisor` と同じ土俵に乗る。**換算をどこにも書かない**のが正しい。

---

## 3. 正の所在(source of truth)

| 領域 | 正 | 備考 |
|------|-----|------|
| 価格の外部一次情報 | 公式 `enhance-price/history` の `endPrice` | 加工しない。取得値をそのまま hourly に保存 |
| **1時間足** | VPS `data/sf_price_history.sqlite` の `sf_price_history_hourly` | **これが履歴の正** |
| **4時間足** | hourly からの決定的導出 | 再生成でいつでも作り直せる=正ではない |
| **現在価格** | 公式 `enhance-price/latest`(サーバーが短TTLでプロキシ) | **履歴DBには入れない**(§6) |
| **Expected 計算式** | **maplenEnhancebot `packages/engine/src/starforce.ts`** | 本リポは**移植先であって正ではない**(§8) |
| 対象装備リスト | maplenEnhancebot `priority_equipment.py` の priority 代表群 | 本リポには取得時点のスナップショットを持つ(§7) |
| 決定の正 | `docs/DECISION_LOG.md` | |

**正が2箇所に住まないための最重要点**: Expected の計算式と装備リストは**どちらも他リポが正**。本リポはコピーを持つが、**コピーであることを機械検証する**(§8・§7)。

---

## 4. 計算 / データの仕分け

| 成果物 | ユーザー入力に依存 | 定期変化 | 判定 |
|--------|---------------------|----------|------|
| 1時間足の価格 | 非依存 | する(毎時) | **データ**。VPS の定期ジョブが取る |
| 4時間足の価格 | 非依存 | する | **データ**(hourly からの導出) |
| 現在価格 | 非依存 | する(常時) | **データ**。サーバーが公式から都度取得+短TTL |
| Expected 費用の履歴 | **依存**(開始星・目標星) | — | **計算**。ブラウザで都度(P5 より 32ms) |
| 期間平均・高値・安値・percentile | 依存 | — | **計算**。Expected 配列からその場で |

∴ **サーバーに Expected を保存しない**という原案の判断は正しい。装備 × 開始星 × 目標星 = 28 × 253 = 7,084 系列を事前計算・配信するのは無駄であり、計算方式を変えるたび全再生成になる。
**計算をブラウザに置く方針は VPS があっても変えない** — VPS を安く保ち、計算方式の変更をデプロイ不要にするため。

---

## 5. アーキテクチャ

```
公式 API                         公式 API
enhance-price/history            enhance-price/latest
(1時間足・150日)                  (現在価格)
      │                                │
      │ ① 初回バックフィル(手元PC)       │
      │ ② 4時間ごと差分(VPS systemd timer)│ ④ 都度・短TTLキャッシュ
      ▼                                ▼
  ┌─────────── VPS (api.lulumi-tools.com) ───────────┐
  │  sf_price_history.sqlite   ── hourly が正         │
  │        │ ③ 決定的導出                             │
  │        ▼                                         │
  │   4時間足テーブル                                  │
  │        │                                         │
  │   FastAPI (server/sf-history/) : 127.0.0.1:87xx  │
  │   Caddy  handle /sf-history/*                    │
  └──────────────────────────────────────────────────┘
      │ GET /sf-history/prices?itemId=   (4h・150日、gzip)
      │ GET /sf-history/latest?itemId=   (現在価格)
      ▼
  ブラウザ (lulumi-tools.com / Pages)
      │ ⑤ ユーザーが装備・開始星・目標星を指定
      │   Expected を最大900点その場で計算(32ms・同期)
      ▼
  チャート / 期間平均 / 高値 / 安値 / percentile / 現在値
```

### 5.1 新サービスは img-proxy の流儀をそのまま踏襲する

`server/sf-history/` を新設し、**`server/img-proxy/` と同じ構成**にする(前例を発明し直さない):

```
server/sf-history/
  app.py                    FastAPI
  db.py                     SQLite 読み出し
  fetcher.py                公式 API 取得(history / latest)
  aggregate.py              hourly → 4h の決定的導出
  requirements.txt / requirements-dev.txt
  README.md                 ローカル起動手順・環境変数・パス一覧
  deploy/
    Caddyfile.example       handle /sf-history/* → 127.0.0.1:87xx
    sf-history.service.example
    sf-history-fetch.service.example / .timer.example   ← 4時間ごと
  tests/                    pytest(オフライン・公式APIを叩かない)
  scripts/
    backfill.py             初回バックフィル(手元PCで実行・再開可能)
    rebuild_4h.py           4h 再生成
```

**★ VPS 上の実 Caddyfile には `/raffle/*` `/exp/live/*` 等、他リポ由来の route が既にある**
(本リポの `Caddyfile.example` は `/img/*` しか書いておらず**リポ内の例に過ぎない**)。
∴ **route 追加は実機の Caddyfile を確認してから**。ポート番号も実機の使用状況を見て決める(8781 が img-proxy)。

### 5.2 定期実行(原案 §16 が有効に戻る)

VPS の systemd timer で **4時間ごと**。Pages のデプロイ周期(1日1回)とは**完全に無関係**になる。
既存ジョブとの衝突を避けるため、`OnCalendar=*-*-* 01,05,09,13,17,21:43:00` + `Persistent=true` + `RandomizedDelaySec=120`。

**★ maplenEnhancebot OPS-1 の教訓を先に適用**: 常駐プロセスで `sleep` させない。
**ワンショット + timer**(常駐は TTL 無しキャッシュを抱えて RSS 245MiB / スワップ 1.1GiB を起こした前例がある)。計算結果は SQLite にあるのでプロセスが死んでも失うものは無い。

差分取得は**最終保存時刻の8時間前〜現在**を毎回取り、UPSERT する(API 側の遅延・一時欠損・後から修正された値に耐える)。

### 5.3 取得の実行場所(**ユーザー確定 2026-08-05**)

| 取得 | 規模 | 実行場所 |
|------|------|----------|
| **初回バックフィル(150日分)** | **616リクエスト**(28装備×22段階。**P4=偽で確定**)× 各3510点 | **メインPC** ← ユーザー確定 |
| 4時間ごとの差分 | **616リクエスト** × 直近8時間窓(1件あたり数点) | VPS(systemd timer) |
| 現在価格 `latest` | 1リクエスト / TTL 60秒 | VPS(アクセス都度) |

**大量取得を VPS にやらせない。** 初回バックフィルは手元PCで完結させ、完成した SQLite を転送する。

**★ P4=偽により、差分取得も 616 リクエストになる**(1リクエスト = 1装備 × 1星)。
間隔1秒なら1回の差分に **10分以上**かかる。**レスポンス自体は小さい**(8時間窓=数点)ので帯域は問題ないが、
**所要時間とリクエスト数の見積りは 616 側で計算すること**。SH-3 で並列数と間隔を実測して決める
(間隔の調整は基準内なら事後承認可。**429 を出さないことが絶対基準**)。

> 差分取得もメインPCで回したい場合は運用モデルが変わる(PCが4時間ごとに起動している必要+PC→VPS の
> 反映経路が要る)。**本設計は「初回=PC / 差分=VPS」を採る**。変更するなら SH-3 着手前に。

### 5.3.1 初回バックフィルの転送

手元PCで実行し(§13 SH-2)、完成した SQLite を VPS へ転送する(原案 §19 が有効に戻る):

```bash
scp data/sf_price_history.sqlite  <vps>:~/sf-history/data/sf_price_history.sqlite.new
# VPS 側
sqlite3 data/sf_price_history.sqlite.new "PRAGMA integrity_check;"
sqlite3 data/sf_price_history.sqlite.new "SELECT COUNT(*) FROM sf_price_history_hourly;"
mv data/sf_price_history.sqlite.new data/sf_price_history.sqlite
systemctl restart sf-history
```

**データ量**: 28装備 × 22段階 × 3600時間 ≈ **2,217,600 行 ≈ 150〜200MB**。
VPS の空き容量は **P10 で要確認**。足りない場合の縮小案(採用は SH-1 の実測後):
**VPS には 4h 全量 + hourly 直近30日ローリング**(≈50MB)、hourly 全量は手元が正本。
差分取得が必要とするのは直近8時間分だけなので、日常運用は縮小案でも成立する。
**まずは全量を置く案を推奨**(正が1箇所で単純)。

---

## 6. 現在価格のリアルタイム取得

**ブラウザから `msu.io` を直接叩かない。** 理由:
1. **CORS** — 公式 API が lulumi-tools.com からのブラウザ呼び出しを許す保証がない
2. **レート制限** — 訪問者数がそのまま公式へのリクエスト数になる。**サーバーで畳めば1回で済む**
3. **ユーザーの IP が公式に晒される** — 本ツールの利用が個々のユーザーの通信として記録される
4. **前例** — `img-proxy` がまさに「公式(market-static.msu.io)を直接叩かせず、サーバーが取って配る」ためのサービス

∴ **`GET /sf-history/latest?itemId=`** を新設し、サーバーが公式 `enhance-price/latest` を取得して返す。

- **TTL 60秒**のプロセス内キャッシュ(同一 itemId への同時アクセスは1リクエストに畳む)
- 上流失敗時は **404/503 を返し、履歴の最終確定足で代替しない**(古い値を「現在値」として出すのは約束と請求の不一致)。UI は「現在価格を取得できません」と明示する
- 取得した現在価格は **履歴DBに書かない**(hourly の正は history API。2つの経路が同じテーブルに書くと正が割れる)

### 6.1 現在価格と確定足の混ぜ方(意味論)

- **統計(期間平均・高値・安値・percentile)は確定足のみで計算する**
- **現在値は別枠**で表示し、「現在値 vs 期間統計」を比較させる

これは目的(「今は高いか安いか」)にそのまま合致し、かつ **§9 の「進行中の区間は確定しない」と整合**する。
現在値を確定足の配列に混ぜると percentile の分母が実行のたびに変わり、再現しない数字になる。

---

## 7. 対象装備リスト

原案の28件リテラルは**2つ目の正**になる。maplenEnhancebot 側で GS-263 のような網の手入れが起きるたび乖離する。
∴ **`server/sf-history/data/sf_history_items.json`** に「取得元コミット + 生成日 + 代表itemId + グループ内全itemId + 表示名」を持つ**スナップショット**として置き、maplenEnhancebot の `load_priority_representative_item_ids()` / `build_priority_item_to_representative_map()` から**生成する**(手で書かない)。

**★ 代表 itemId は enhance-price グループ代表であって装備名ではない。**
SF 価格はグループ内で共有される。リストに `AbsoLab Mage Gloves` だけ出すと、**AbsoLab Warrior Gloves を着ている人は自分の装備を見つけられない**(価格は同一なのに)。
∴ **検索対象はグループ内の全 itemId、取得・表示は代表**。上記 JSON に全 itemId を持つのはこのため。

除外は原案どおり `1113282`(Noble Ifia's Ring)/ `1122254`(Mechanator Pendant)。**除外理由を JSON に残す**(黙って消すと後任が再発明する)。

---

## 8. Expected 計算式をどう持ち込むか(**最重要の設計判断**)

`expectedStarforceCostExact` は maplenEnhancebot の **TypeScript**。本リポの web は**素の JavaScript**。

| 案 | 内容 | 利点 | 欠点 | 判定 |
|---|---|---|---|---|
| A | 仕様から JS で再実装 | 依存なし | **2つ目の正**・検証なし | **却下** |
| **B** | **型注釈を落とした1ファイルを vendor + 越境 golden テスト** | 正は maplenEnhancebot のまま / 同期面に機械検証が付く / **新規 npm 依存ゼロ** | engine 更新時は手動同期 | **採用** |
| C | `@gearsim/engine` を npm publish | 正式・自動追随 | **新規 npm 依存=ユーザー専権事項** + リリース運用が増える | 却下(今は過剰) |
| D | ビルド済み `gear-sim-calc.js`(218KB)を丸ごと vendor | ビット同一 | 本ページに不要な gear エンジン全部を載せる | 却下 |

> **サーバー側で計算する案**も VPS があるので可能だが採用しない。①実測32msでブラウザで足りる ②訪問者数がそのまま VPS の CPU になる ③計算方式の変更にデプロイが要る ④maplenEnhancebot の「計算はブラウザ、サーバはデータ」(GS-003)と揃う。

### 8.1 B の具体

- `exp_ranking/web/src/sfhistory/starforce.js` — `starforce.ts` から**型注釈のみを除去**した機械的変換。ロジックは1行も変えない。冒頭に**出典コミットハッシュ**と「**このファイルは移植物であり正ではない。変更は maplenEnhancebot 側から**」を明記
- `exp_ranking/web/src/sfhistory/__fixtures__/sf_expected.json` — maplenEnhancebot の `tools/parity/sf_fixtures/*.prices.json` + `*.percentiles.json` から **14装備 × 全 span の (prices, span, expected)** を抽出
- `starforce.test.js`(vitest)— 全 fixture について照合

**合格条件: 相対誤差 ≤ 1e-12**(原案の 1e-9 より厳しくてよい。同一アルゴリズム・同一演算順序の移植なので実質ビット一致が期待できる。1e-9 だと本当の劣化を見逃す)。

これで「検証なき同期面は却下」を満たす。**越境 golden がタダで手に入るのは P7 のおかげ**。

### 8.2 計算ポリシーは既定値と一致している(新規実装ゼロ)

| 本設計のポリシー | `expectedStarforceCostExact` の既定引数 |
|---|---|
| スターキャッチ あり | `withoutStarCatch ?? false` |
| チャンスタイム あり | `useChanceTime ?? true` |
| チャンスタイムの keep を失敗回数に含めない | `chanceTimeCountsKeep ?? false` |
| 破壊防止 なし | `safeguardStars ?? []` |

∴ **引数を渡さず呼ぶだけ**。ポリシーバージョンは `starcatch-chancetime-no-safeguard-v1` として UI に明示する。

### 8.3 作らないリスト(実測による削除)

P5(900点 = 32ms)により、原案の以下は**作らない**:

- **Web Worker**(原案 §11.4)— 目標1秒に対し30倍の余裕。スマホが10倍遅くても 320ms
- **計算キャンセル / リクエストID**(§11.5)— 32ms に競合状態は起きない
- **メモリキャッシュ**(§11.6)— 再計算のほうが安い
- **「期間変更時は再計算しない」最適化**(§11.1)— 常に全再計算でよい。状態が1つ消える

---

## 9. 4時間足の規約(原案の食い違いを解消)

- 区間: UTC の `00,04,08,12,16,20` 始まり
- 代表値: **区間内で最後に存在する時刻の `endPrice`**
- **ラベルは区間開始時刻**(原案 §8 は区間終了、§10.2 の例は区間開始で食い違っていた。**開始に統一**)
  - 例: `00:00–03:59` の足 → ラベル `00:00`、値は `03:00` の `endPrice`
  - UI のツールチップも区間開始時刻を表示し、「4時間足(区間終値)」と注記する
- **進行中の区間は確定しない**。ジョブ実行時点で未完了の区間は 4h に出さない(出すと途中値が最終値として固定される)。進行中の動きは §6 の現在価格が担う

### 9.1 欠損

原案「22星のうち1つでも欠けたら欠損」は**不正確**。必要な星は範囲依存で、19→21 でもブームで☆10 に戻るため 10..20 が要る。
∴ 欠損判定は **`requiredPriceStars(startStar, targetStar)`**(starforce.ts:83・§8 で一緒に vendor)が返す集合が揃うかで行う。
揃わない時点は **`null`**(補間・前方補完はしない=「無い数字を発明しない」)。チャートは線を切る。

### 9.2 ★☆20/21/22 の同値問題(SH-1 の生データから統括が検出・**SH-2 の必須確認項目**)

SH-1 の `latest` 応答で、**☆20 / ☆21 / ☆22 の `closePrice` が完全に同一値**だった:

```
☆17: 3,951,165.611808     ☆20: 2,711,584.243397
☆18: 3,692,919.493389     ☆21: 2,711,584.243397   ← 同値
☆19: 2,969,830.361816     ☆22: 2,711,584.243397   ← 同値
```

**価格が☆17 を頂点に単調でなく、高星側で 3つ揃って同値**。これが
(a) 動的価格の実挙動(需要が薄く下限に張り付いている)なのか
(b) API 側のクランプ/既定値なのか
は SH-1 の1装備・1時点だけでは判定できない。

**なぜ重要か**: 本ツールの主用途である **19→21・21→22 という最も高額な区間**が、まさにこの3星に依存する。
(b) だった場合、チャートは「実際には動いている費用」を平坦に見せることになる(=**約束と請求の不一致**)。

**∴ SH-2 の受け入れ基準に入れる**: 全28装備の150日分を取得したのち、
**☆20/☆21/☆22 の `endPrice` 系列が時系列で完全一致するか**を装備ごとに集計して報告する。

- 全装備・全時点で一致 → (b) の疑いが濃い。**公開前にユーザー裁定**(注記を出すか、高星区間の扱いを変えるか)
- 装備・時点によって分岐する → (a)。実データとして素直に扱ってよい

**判定が付くまで、高星区間について「これが実費用である」と断定する UI 文言を書かない。**

---

## 10. API

```
GET /sf-history/equipment            装備一覧(代表itemId + 表示名 + グループ内全itemId)
GET /sf-history/prices?itemId=       4時間足・最大150日
GET /sf-history/latest?itemId=       現在価格(公式プロキシ・TTL 60s)
GET /sf-history/health               稼働確認(img-proxy に倣う)
```

`prices` レスポンス:
```json
{ "itemId": 1382265, "interval": "4h", "labelIs": "bucketStart",
  "startDate": "...", "endDate": "...", "priceVersion": "...",
  "upgradeCount": 22,
  "points": [{ "date": "2026-03-08T00:00:00Z", "prices": [12345.12, null, ...] }] }
```

`prices[0]` = ☆0→1、`prices[21]` = ☆21→22。欠損は `null`。
最大 900点 × 22値 ≈ raw 250KB。**gzip/Brotli を有効化**して実効 60〜80KB(**SH-3 で実測**)。
CORS は `https://lulumi-tools.com` に限定(img-proxy の `IMG_PROXY_ALLOWED_ORIGINS` と同じ流儀)。

---

## 11. UI

- **配置**: `exp_ranking/web/src/sfhistory/`(既存 `src/raffle/` `src/taskManager/` と同じ流儀)。API 呼び出しは `integrations/` に分離(raffle/taskManager の `*Source.js` と同型・`VITE_SF_HISTORY_API_BASE` で上書き可能に)
- **チャート**: **recharts**(導入済・新規依存ゼロ)。LineChart + ReferenceLine(期間平均)+ 高値/安値マーカー
- **i18n**: 追加文言は **ja/en/es/th/vi/zh-TW の6ロケール全部に同時追加**(CLAUDE.md 規約)
- **表示**: Expected のみ。**p50/p70/p90 は出さない**(§12)
- **サマリー**: Current(現在価格由来)/ Period Average / Period High / Period Low / Current Position(percentile)
- **評価表現**: 「今強化すべき」等の**断定的推薦はしない**。`83rd percentile in selected period` のような客観指標のみ
- **計算条件の明示**: スターキャッチON / チャンスタイムON / 破壊防止OFF / イベント補正なし / 指標=期待値 / 足=4時間 / 履歴の最終更新時刻 / 現在価格の取得時刻
- **デザイン**: lulumi-tools の既存トーン。金融チャート寄り・装飾控えめ

---

## 12. p50/p70/p90 を出さない理由(「初期実装だから」ではない)

maplenEnhancebot の `analyticStarforceCostPercentiles` は **`p90 = expected × 1.85`** という固定係数の経験則で、docstring 自身が "Rough" と明記(向こうの **GS-269 ⬜ 未決**)。
drop/boom の無い span はこの経験則経路、ある span だけが DP 由来の実分位。∴ **同じ画面に「実分位」と「経験則」が混在する**。

「無い数字を発明しない」に反するため **Expected 単独に絞る**。これは初期実装の都合ではなく**恒久判断**であり、向こうの GS-269 が閉じるまで再検討しない。

**副次的な利点**: 本ページは **ΔCP を出さない**ため、maplenEnhancebot 側で未解決の GS-254(starforceGain 乖離)/ GS-242(セット効果)の影響を**構造的に受けない**。∴ あちらのロードマップ公開保留(GS-266)とは独立に、lulumi-tools 本体で公開できる。

---

## 13. スライス分割

| スライス | 内容 | 主な受け入れ基準 | 停止条件 |
|---|---|---|---|
| ~~**SH-1** 調査~~ | 1装備で公式 API を実測 | — | — | **✅ 完了・統括検収済**(`22f7bc8`)。P1/P2/P3/P11/P12/P13 確定、**P4=偽**。報告書=`docs/reports/SH1_API_PROBE.md` |
| **SH-1b** VPS 調査 | VPS の空き容量・RAM・**実 Caddyfile の route 一覧**・空きポート・systemd の流儀。**測るだけ** | P10 が実測値で決着 | 既存サービスの設定を1文字でも変更する必要が出た |
| **SH-2** 取得基盤 | SQLite スキーマ + 再開可能バックフィル + 装備リスト生成(§7)。**手元PCで完結** | 全28装備の hourly を保存・中断後に再開できる・欠損率を数値で報告・**§9.2 の☆20/21/22 同値判定を全装備で集計して報告** | データ量/時間が見積りの10倍 / **§9.2 が (b) だった場合は統括へ報告して裁定を待つ** |
| **SH-3** サービス | `server/sf-history/` FastAPI(3エンドポイント + health)+ 4h 導出 + pytest。**まだ VPS に置かない** | `prices` の **応答 ≤ 500ms**・gzip 実効 **≤ 100KB**・pytest 全緑(オフライン) | img-proxy の構成から逸脱しないと作れない |
| **SH-4** 計算移植 | §8 の vendor + 越境 golden(vitest) | **14 fixture 全 span で相対誤差 ≤ 1e-12** | fixture が1本でも合わない |
| **SH-5** 画面 | recharts チャート + 6ロケール + サマリー + 現在価格 + 計算条件表示 | 900点の再計算 **≤ 200ms**・`npm run build` 緑・`npm run test` 緑 | 新規 npm 依存が必要になった(=ユーザー専権) |
| **SH-6** 本番投入 | VPS へ DB 転送 + systemd service/timer + Caddy route + ログローテーション | integrity_check OK・timer が4時間ごとに発火・**既存 `/img/*` `/raffle/*` `/exp/live/*` が無影響** | 既存 route に影響が出た |

**SH-4 は SH-1〜3 と独立**(公式 API に依存しない)ため並行可能。ただし
[[no-concurrent-implementers-one-worktree]] に従い、**同一ワークツリーで実装担当を2人走らせない**。
**SH-6 は VPS 反映=ユーザー専権**。実装担当は準備まで、実行はユーザーの明示指示で。

---

## 14. 全スライス共通の「変わってはいけない」

- **ランキング側に一切干渉しない**: `main.py` の取得ロジック / v2シャード形式 / `release_store` / `snapshot_guard` / Pages ワークフロー
- **既存 API サービスに一切干渉しない**: `/img/*`(img-proxy)/ `/raffle/*` / `/exp/live/*` / `/notification/*`。**Caddy は route 追加のみ**
- **`exp_ranking/web/src/` の既存機能**(board / stats / profile / raffle / taskManager)
- **新規 npm 依存の追加は禁止**(ユーザー専権)。recharts / vitest の既存版で完結させる
- `git add -A` 禁止・触ったファイルのみ個別 add + `git diff -w`
- **`git push` / VPS 反映はユーザーの明示指示を待つ**

---

## 15. 未決事項

- **U1 ⬜ VPS の容量方針**(§5.3)— 全量150〜200MB を置く[推奨] / 4h + hourly 直近30日に縮小。**SH-1b の実測後に確定**
- **U6 ⬜ ☆20/21/22 の同値**(§9.2)— (a) 実挙動 / (b) API のクランプ。**SH-2 の集計後にユーザー裁定**。
  最も高額な 19→21・21→22 区間の表示に直結するため、判定前に高星区間を断定する UI 文言を書かない
- **U2 ⬜ ルーティングと URL**(`/sf-cost-history`? `/starforce`?)— T2(url-state)/ T5(SEO)の規約に合わせる。SEO 導線として意味のある URL を選ぶ
- **U3 ⬜ 装備リストの更新運用** — maplenEnhancebot 側で priority が変わったとき、本リポのスナップショットをいつ・誰が再生成するか(手動でよいが、**手順を決めておかないと静かに古くなる**)
- **U4 ⬜ 現在価格の TTL 60秒**は暫定。訪問者数と公式 API の許容度を見て調整(基準内の調整は事後承認可)
- ~~U5 SH-1 のテスト設計レビュー要否~~ — **解決**(省略して実施・結果は受け入れ基準を全項目充足)

### 15.1 統括の誤り(判断原則#6)

**設計書 §13 は SH-1 のスコープに P10(VPS調査)を含めていたが、統括が書いた `IMPL_PLAN_SH1.md` には
P10 の測定項目も成果物も1つも入っていなかった。** 実装担当が完了報告でこの食い違いを検出して申し送った。
∴ VPS 調査は未実施。**SH-1b として独立起票**(実装担当の推奨A を採用。理由=SH-1 のスコープを汚さず、
VPS 実測の抜け漏れを可視化できる)。**設計書とスライス計画書の間でスコープが食い違う**のは統括の起票ミスであり、
今後は計画書を書いたあとに設計書 §13 の当該行と1対1で突き合わせる。

---

## 16. DECISION_LOG 追記案(承認後に反映)

```
- **LULU-0xx ✅ スターフォース強化費用 履歴チャートを新設**(設計正典=docs/DESIGN_SF_COST_HISTORY.md)。
  ランキングとは独立の第2の入口(SEO 導線 + 再訪動機)。公式 dynamicpricing の1時間足を150日分 VPS に保存し、
  4時間足に集約して配信。**現在価格は公式 latest をサーバーが短TTLでプロキシ**(ブラウザから公式を直接
  叩かせない=img-proxy と同じ理由: CORS/レート制限/ユーザーIP)。**Expected 費用はブラウザで都度計算**
  (実測 900点=32ms)。
  - **api.lulumi-tools.com に4つ目のサービスを足す**(既存 /img/* /raffle/* /exp/live/* に route 追加のみ)。
    構成は `server/img-proxy/` の流儀を踏襲(FastAPI + systemd + Caddy + オフライン pytest)。
    定期取得は **ワンショット + timer**(常駐は maplenEnhancebot OPS-1 でスワップ 1.1GiB を起こした前例)。
  - **計算式は移植であって正ではない**: maplenEnhancebot `packages/engine/src/starforce.ts` が正。
    型注釈を落として vendor し、**向こうの parity fixture 14装備×全 span を越境 golden として
    vitest で照合**(相対誤差 ≤ 1e-12)。検証なき同期面は作らない。
  - **Expected のみ・分位は出さない**: 向こうの GS-269(analytic 分位は経験則スケーリング)が未決で、
    実分位と経験則が同じ見た目で混在するため。「無い数字を発明しない」。恒久判断。
  - **ΔCP を出さない**ため、向こうの GS-254/GS-242 の影響を構造的に受けず、lulumi-tools 本体で公開できる。
  - **Worker/キャンセル/キャッシュは作らない**(実測32msで不要=作らないリスト)。
  - **★統括の誤り(判断原則#6)**: 初版設計を「デプロイ=Pages 静的のみ」(CLAUDE.md 5行目)を根拠に
    静的JSON配信で書いたが、**実際には api.lulumi-tools.com が稼働中**だった。ユーザーの指摘で全面改訂。
    CLAUDE.md は bot/web の記述であって API 層を含んでいない(§17 で是正)。
```

---

## 17. 付随して直すべきこと(本設計のスコープ外・別途起票)

**`CLAUDE.md` 5行目のスタック記述が API 層を欠いている**:

> 現状: `デプロイ=GitHub Pages 静的のみ(カスタムドメイン lulumi-tools.com)`
> 実態: それに加えて **`api.lulumi-tools.com` = VPS 上の Caddy + FastAPI 群**(`/img/*` は本リポ
> `server/img-proxy/`、`/raffle/*` `/exp/live/*` `/notification/*` は別リポ)

この1行のせいで統括が設計を1回丸ごと誤った。**正の記述が古いと、それを読む全員が同じ誤りをする。**
CLAUDE.md の「正の一覧」表にも API 層の行が無い。**セッション冒頭に読む文書ほど、古さのコストが大きい。**
