# IMPL_PLAN_T3 — 派生統計モジュール(`src/stats/`)+ Vitest

> 承認者: ユーザー(設計承認 2026-07-14)/ 実装: implementer
> 役割: **T1=データ契約 / T2=URLステート / T3=派生統計を計算 / T4=表示**。T3 は純粋関数のみ。**T3 完成後に T4 へ**。T3 途中で UI は作らない。

## 0. 目的・正の所在

- 目的: ホーム(T4)が表示する自分の成績値(上位率・抜いた/抜かれた・連続記録・自己ベスト内順位・目標との差)を**計算する純粋関数モジュール**を作る。
- **正の所在**:
  - bot 由来の `rank` / `previousRank` / `rankFluctuation` / `jobRank`(+Total)/ `worldRank`(+Total)/ history の `dailyRank` は**読み取り専用。T3 で再計算しない**。
  - 新規 A〜E の派生統計は **`src/stats/` を唯一の正**。同じ計算を `rankingUtils.js` と二重実装しない。既存 `rankingUtils.js` の純粋関数は**再利用・合成**する(移動しない)。
  - 既存関数の能力不足が判明したら、コピーせず**最小限の一般化案を事前提示**(勝手にコピーしない=停止条件)。
- 参照決定: DECISION_LOG LULU-005(historyKey=安定ID)/ LULU-007(新規依存はユーザー承認済=vitest)/ PR-004(fixture 駆動)

## 1. スコープ

### 作成ファイル
- `exp_ranking/web/src/stats/index.js` — 公開API(re-export)
- `exp_ranking/web/src/stats/percentile.js` — A: `calculateTopPercent`
- `exp_ranking/web/src/stats/rankMovement.js` — B: `computePassedAndOvertaken`
- `exp_ranking/web/src/stats/streaks.js` — C: `computePositiveGainStreak` / `computeDailyRankStreak`
- `exp_ranking/web/src/stats/personalBest.js` — D: `computeDailyGainSelfRank`
- `exp_ranking/web/src/stats/goalProgress.js` — E: `computeGoalProgress`
- `exp_ranking/web/src/stats/gainPace.js` — F: `calculateAverageDailyGain`
- `exp_ranking/web/src/stats/*.test.js`(各関数のフィクスチャテスト)
- `exp_ranking/web/vitest.config.js`(または vite.config への test 設定)

### 変更ファイル
- `exp_ranking/web/package.json` — `vitest` を **devDependencies** に追加 + `"test": "vitest run"`(+任意 `"test:watch": "vitest"`)

### 触ってはいけないもの
- `rankingUtils.js`(import で再利用するのみ・**変更しない**)/ 既存コンポーネント / `main.jsx` / `index.html`
- bot / `.github/workflows/**` / vite の本番ビルド設定(base 等)/ CNAME
- 本番バンドル(vitest は devDep のみ・バンドル非包含)

## 2. Vitest 追加内容

- `devDependencies` に `vitest`(のみ)。**本番 `dependencies` に入れない**。`npm run build`(vite build)は vitest を含めない。
- scripts: `"test": "vitest run"`(CI 非対話)+任意 `"test:watch": "vitest"`。
- `vitest.config.js`: `test.environment = "node"`(純粋関数=DOM 不要)、`test.include = ["src/stats/**/*.test.js"]`。vite.config のエイリアス(`@/`)は vitest が読むが、**stats は相対 import に限定**(`@/` 依存を持ち込まない)。
- workflow・Pages・bot へは**変更を加えない**(CI に test ステップは足さない=スコープ外。当面ローカル `npm run test`)。

## 3. 関数ごとの入出力契約

### A. 上位率 — `calculateTopPercent(rank, total)`
- **式**: `topPercent = rank / total * 100`(**丸めない**。表示丸めは T4)。
- 戻り値: `number | null`。**比較不能は例外でなく `null`**。
- 有効条件(これ以外は `null`): `rank`・`total` が有限数 / `total > 0` / `1 <= rank <= total`。
  - null / NaN / 0以下 / `rank > total` → `null`。
- 全体・職業内・サーバー内で**同一関数**を使う(呼び出し側が `(rank, characterCount)` / `(jobRank, jobRankTotal)` / `(worldRank, worldRankTotal)` を渡す)。**順位を再計算しない**。

### B. 抜いた・抜かれた — `computePassedAndOvertaken(target, allCharacters)`
- 意味: **前日→当日の総合レベル順位(`rank`)の交差**。日間増加量順位とは無関係。
- 入力: `target`(本人)、`allCharacters`(summary 配列)。各要素に `historyKey`(安定ID)/ `name` / `rank`(当日レベル順位)/ `previousRank`(前日レベル順位, null 可)。
- **比較可能条件**: `target.previousRank` と相手 `x.previousRank` が**双方 非null**。片方でも null(新規・再入圏・前日欠測)は**除外**。`target.previousRank == null` の場合は両リスト空。
- **historyKey 欠損の扱い**: 同定は `historyKey`(正準ID=LULU-005)。**historyKey が欠損(null/空)のキャラは比較対象から除外**(候補として集計しない)。**名前だけによる代替は行わない**(正準IDが無ければ同定不能=除外)。**対象本人に historyKey が無い場合も例外で落とさず**、`{ passed: [], overtakenBy: [] }`(比較不能)を返す。
- **交差判定式**(相手 x、`x.historyKey !== target.historyKey`):
  - **本人が x を抜いた(passed)**: `x.previousRank < target.previousRank && target.rank < x.rank`(前日 x が上→当日 本人が上)。
  - **本人が x に抜かれた(overtakenBy)**: `target.previousRank < x.previousRank && x.rank < target.rank`。
- 戻り値: `{ passed: Entry[], overtakenBy: Entry[] }`、`Entry = { historyKey, name, previousRank, rank }`(相手の値)。
- **決定的順序**: 各リストを `(rank 昇順, historyKey 昇順)` でソート。`rank` は日次一意(LULU-013 実証)なので安定。**入力順に依存しない**。同一人物判定は `historyKey`(名前に依存しない)。
- 複数人を抜いた場合は**全件**返す(表示件数の間引きは T4)。
- 計算量: `allCharacters` 1パス O(N)。

### C. 連続記録 — streaks(閾値を汎用化)
共通の正規化(両関数で使用):
- `snapshotDate` が有効(`YYYY-MM-DD`)な点のみ対象。
- **決定的整列と重複日の畳み込み(正準規則)**: まず `snapshotDate` 昇順。**同一 `snapshotDate`(重複日)は次の固定キー順で先頭を採用**して1日1点に畳む: ①`dailyGain` 降順(null は末尾)②`dailyRank` 昇順(null は末尾)。これ以外の値でも決まらなければ元入力に依存しないため事実上一意。→ 入力順・逆順・未整列でも同一結果。
- **連続の定義**: 隣接する採用点の `snapshotDate` が**暦日で +1 日**のときのみ継続。差が2日以上(欠測)は連続終了。**配列上で隣接でも日付が飛べば非連続**。

戻り値(両関数): `{ current, longest }`(整数)。`longest` = 全期間の最長連続。
- **`current` の基準(明記)**: `current` は**履歴中の最新確定日(畳み込み後の最大 `snapshotDate`)を終点**とする連続記録:
  - 最新確定日が**条件未達なら `current = 0`**
  - 最新確定日から**1暦日前へ遡り、条件達成 かつ 日付が連続(−1日)である間だけ加算**
  - 最新確定日の**前日に欠測(点が無い)があれば、そこで終了**
  - **端末上の今日・昨日を基準にしない**(あくまで history 内の最新確定日)

- `computePositiveGainStreak(history)`:
  - 各日の条件 = `dailyGain` が有限で `> 0`。null / NaN / `<= 0` は**条件不成立**(連続終了)。
- `computeDailyRankStreak(history, { maxRank })`:
  - 各日の条件 = `dailyRank` が有限整数で `1 <= dailyRank <= maxRank`。null / NaN / 範囲外は**条件不成立**。
  - `maxRank` は**引数**(トップ500固定にしない)。`maxRank` が無効(非正)なら `{ current: 0, longest: 0 }`。
  - T4 は初期表示で `maxRank = 500` を渡す予定(API は汎用)。

### D. 自己ベスト内順位 — `computeDailyGainSelfRank(history, options?)`
- 目的: 指定日(既定=**最新確定スナップショット**)の日間増加が、本人の比較可能履歴内で何位か。
- **基準日**: `options.onDate`(ISO)指定可。既定は **history 内の最大 `snapshotDate`**(端末暦日ではない)。
- **比較可能日**: `dailyGain` が有限数の点(`>= 0`)。null / NaN は除外。
- **競技順位(同値同順)**: `rank = 1 + (対象 gain より厳密に大きい比較可能日の数)`。例 `100,100,90 → 1,1,3`。
- `isTied` = 対象以外に**同一 gain** の比較可能日が存在するか。
- 戻り値: `{ rank, totalComparableDays, gain, isTied }`。
  - 基準日に比較可能な gain が無い → `{ rank: null, totalComparableDays, gain: null, isTied: false }`(比較不能)。
- **決定的**(計数ベース、順序非依存)。

### E. 目標との差 — `computeGoalProgress(character, expTable, goal, { averageDailyGain, todayIso })`
- **T3 の意味論(限定)**: 「**渡された平均日次EXPでの推定到達日**」と「**設定された目標日**」の差。
  - ※「目標設定時の開始EXP基準の計画線」比較は **T4a の保存が要る**ため **T3 では作らない**。
- **平均ペースは T3 で勝手に選ばない**。`averageDailyGain`(1日平均EXP)を**呼び出し側で計算済みの値として明示的に受け取る**(当日増加量/7日平均/30日平均/weeklyGain÷7/全期間平均 のいずれかを goalProgress 内部で暗黙採用しない)。
- 入力: `character` / `expTable` / `goal = { targetLevel, targetDateIso }` / `options = { averageDailyGain, todayIso }`。
  - `averageDailyGain` = 呼び出し側が算出した1日平均EXP(number)。null/未指定/`<= 0` は `insufficientData`。
  - `todayIso` = 基準日(既定は `character.history` の最新確定 `snapshotDate`。端末暦日でない。テスト用に注入可)。
- **平均値を求める純粋関数は別に用意**(下記 F)。T3 の goalProgress の責務は「残りEXP / 目標日までの日数 / 必要日次EXP / **渡された**平均での推定到達日 / 先行・遅れ」に**限定**。
- 計算:
  - `remainingExp = remainingExpToLevel(character, expTable, targetLevel)`(既存再利用)
  - `daysUntilTarget = (targetDateIso − todayIso)` の暦日数
  - `requiredDailyGain = ceil(remainingExp / daysUntilTarget)`(`daysUntilTarget > 0` のとき)
  - `daysToArrive = ceil(remainingExp / averageDailyGain)`(`averageDailyGain > 0` のとき)
  - `estimatedArrivalDate = addDaysToIsoDate(todayIso, daysToArrive)`
  - `daysDelta = daysUntilTarget − daysToArrive`(**正=先行 / 負=遅れ**)
- 戻り値: `{ status, daysDelta, estimatedArrivalDate, targetDate, requiredDailyGain, averageDailyGain, remainingExp, daysUntilTarget }`。
- **status の決定順(先勝ち)**:
  1. `"achieved"` … `character.level >= targetLevel`
  2. `"insufficientData"` … 次のいずれか: `targetLevel` 不正(非数 / `> LEVEL_CAP` / `<= character.level` 以外の矛盾)/ `targetDateIso` 解析不能 / `averageDailyGain` が null または `<= 0`(平均ペース0=推定不能)/ 履歴不足で平均が出せない
  3. 目標日が過去(`daysUntilTarget <= 0`)かつ未達 … 推定到達日は未来なので `daysDelta < 0` → **`"behind"`**(構造値は返す)
  4. `daysDelta > 0` → `"ahead"` / `daysDelta < 0` → `"behind"` / `daysDelta === 0` → `"onTrack"`
- 返り値は**構造化データのみ**(表示文言・色は T4)。

### F. 平均ペース(別純粋関数)— `calculateAverageDailyGain(history, { days, endDate })`
- 目的: goalProgress へ渡す `averageDailyGain` を算出する**独立した純粋関数**(7日固定の暗黙仕様を goalProgress に埋め込まないため分離)。
- 入力: `history` / `{ days, endDate }`。
  - `endDate`(ISO): 既定 = history 内の**最新確定 `snapshotDate`**(端末暦日でない)。無効なら既定に落とす。
  - `days`: 平均対象の**暦日ウィンドウ幅**(例 7)。非正なら `null` を返す。
- **平均期間の定義**: `snapshotDate` が `[endDate − (days−1)暦日, endDate]` に入る点を対象。
- **有効日**: `dailyGain` が有限で `>= 0`。**0増加日は分母・分子に含める**(0を加算=暦日ベースの正直なペース)。`null`/NaN/負は**除外**(分母にも入れない)。
- 平均 = `sum(有効日の dailyGain) / count(有効日)`。有効日 0 → `null`。
- **欠測日**は対象期間に点が無いだけなので分母に入らない(存在する日で平均)。
- 決定的(合計/計数、順序非依存)。重複 `snapshotDate` は C と同じ正規化(§C 共通)で1日1点に畳む。
- 既存 `rankingUtils.averageDailyGainFromHistory`(**last-N 点・正のみ・endDate 非対応**)とは**契約が異なる**(endDate 起点・0含む)。既存関数は既存の詳細/プランナー用途のまま**変更しない**。将来の統合は T3 スコープ外(消費側の挙動リスク回避)。

### 共通(null・欠測・不正値の原則)
- 例外を投げない。比較不能は `null` またはステータスで表す。
- 日付は `YYYY-MM-DD` の暦日で扱い、既存 `addDaysToIsoDate` / `daysUntilJstDate` 系を再利用。
- 全関数**純粋・決定的**(同入力→同出力、入力順非依存、時刻/乱数/localStorage/DOM 非依存。`todayIso` 等の時刻依存は引数注入)。

## 4. 再利用する既存関数(合成・二重実装しない)
`remainingExpToLevel` / `averageDailyGainFromHistory` / `lastHistoryPoints` / `getGainAmount` / `addDaysToIsoDate` / `daysUntilJstDate` / `findBestDailyGain`(D の一般化元・**置換せず参照**)。能力不足なら**最小一般化を事前提示**(停止条件)。

## 5. T3 / T4 の責務境界
- **T3**: 純粋関数。数値・構造化データを返す。**React / fetch / localStorage / UI を持たない**。
- **T4a**: ピン・目標(Lv/日付)・既読の**保存**。T3 への入力(goal 等)を準備。
- **T4b**: T3 の結果を**表示**(丸め・色・文言・並び・件数間引き)。
- T3 完成時点で**画面は不変**(モジュール+テストのみ、消費なし)。

## 6. コミット分割(各コミット単独 revert 可)
1. **Commit 1**: vitest 導入(devDep + `vitest.config.js` + `npm run test`)+ スモークテスト1本(緑確認)。本番ビルド不変
2. **Commit 2**: `percentile.js`(A)+ `rankMovement.js`(B)+ 各テスト
3. **Commit 3**: `streaks.js`(C)+ `personalBest.js`(D)+ 各テスト
4. **Commit 4**: `gainPace.js`(F)+ `goalProgress.js`(E)+ `index.js`(公開API)+ テスト
5. (必要時)Commit 5: JSDoc/整理

各コミット後 `npm run test` と `npm run build` 緑。**`git add -A` 禁止**・個別 add・`git diff -w`。**push しない**。

## 7. 受け入れ条件

| # | 基準 | コマンド |
|---|---|---|
| 1 | vitest 全緑 | `cd exp_ranking/web && npm run test` |
| 2 | 本番ビルド成功・vitest がバンドル非包含 | `npm run build` |
| 3 | **既存 UI が不変**(T3 は何も描画・配線しない) | 目視/差分 |
| 4 | **bot フィールドを再計算していない**(読むだけ)・**正が1箇所** | code-review |
| 5 | **bot・workflow・既存UI・vite本番設定が未変更** | `git diff --name-only`(stats/ 追加 + package.json + vitest.config のみ) |
| 6 | 純粋・決定的(入力順非依存・時刻注入) | テストで担保 |

## 8. テスト一覧(独立した手計算フィクスチャ・実装の写しにしない)

**A calculateTopPercent**: 正常(rank=5,total=100→5)/ rank=total→100 / total=0→null / rank=0以下→null / null・NaN→null / rank>total→null。

**B computePassedAndOvertaken**: 
1. 本人が複数人を抜く(全件・順序 `(rank,historyKey)` 決定的)
2. 抜かれた検出
3. 相手 previousRank=null は除外 / 本人 previousRank=null は両空
4. **入力順シャッフルで結果同一**
5. historyKey で同定(同名別historyKey を混同しない)
6. 交差しない(順位変わらず)→ 空

**C streaks**:
1. 連続プラス日の current/longest
2. **欠測日で連続終了**(日付が飛ぶ)/ 配列隣接でも日付跳躍は非連続
3. 逆順・未整列入力で同一結果
4. 重複 snapshotDate の畳み込み(契約どおり先頭採用)
5. dailyGain null/0/負 の非成立
6. `computeDailyRankStreak`: maxRank 境界(=500 ちょうど含む/501 除外)、dailyRank null/範囲外、maxRank 無効→0/0
7. 最新日が条件不成立→current=0、longest は保持

**D computeDailyGainSelfRank**:
1. 競技順位 `100,100,90→1,1,3`(対象=100 は rank1・isTied true / 対象=90 は rank3・isTied false)
2. onDate 指定 / 既定=最新 snapshotDate
3. 基準日に比較可能 gain 無し→rank null
4. null/NaN 混在は totalComparableDays から除外
5. 順序非依存

**E computeGoalProgress**(`averageDailyGain` は引数で注入):
1. ahead(推定到達が目標日より前)/ behind / onTrack(delta=0)
2. achieved(level>=targetLevel)
3. insufficientData: `averageDailyGain` が null/未指定/`<=0` / targetLevel 不正 / targetDate 解析不能
4. 過去の目標日(daysUntilTarget<=0)未達→behind + 構造値
5. `todayIso`・`averageDailyGain` 注入で決定的(estimatedArrivalDate/daysDelta を手計算値と照合)
6. requiredDailyGain / remainingExp / daysUntilTarget の値照合

**F calculateAverageDailyGain**:
1. 7日ウィンドウ・endDate 既定=最新確定日での平均(手計算照合)
2. **0増加日を含む**(分母に入り平均が下がる)/ null・負は除外
3. 欠測日(点が無い)は分母に入らない
4. endDate 指定 / 無効な endDate は既定に落ちる
5. days 非正→null / 有効日0→null
6. 順序非依存・重複日畳み込み(§C 正規化)

## 9. 停止条件
- 既存 `rankingUtils.js` 関数の能力不足でコピーが必要になりそう → **止めて最小一般化案を提示**
- bot フィールドを再計算しないと成立しない設計差が判明
- スコープ外(rankingUtils 変更 / UI / bot / workflow)の変更が必要

## 10. ロールバック
各コミット単独 revert 可。stats/ は追加のみ・既存から未参照のため、revert してもアプリ挙動は不変(消費は T4)。

## 11. 完了報告テンプレ
- 実施コミット(ハッシュ・件名)
- `npm run test` 結果(件数・全緑)/ `npm run build` 結果
- 各関数の最終シグネチャ(契約どおりか)
- テスト一覧 §8 の結果
- vitest が devDep のみ・バンドル非包含・workflow/bot 不変の確認
- 既存 UI 差分ゼロの確認
- 残課題・watch-item

## 12. 作らないもの(T3 除外 → T4 以降)
- UI・ホーム画面・成績カード(T4b)/ ピン・目標保存・プロファイル層(T4a)
- 既存コンポーネントへの配線・消費 / 表示丸め・色・文言
- 開始EXP基準の計画線比較(T4a 保存が前提)
- SEO・URL・bot 改修・workflow 変更・CI への test ステップ追加
- 既存 `rankingUtils.js` の移動/リファクタ
