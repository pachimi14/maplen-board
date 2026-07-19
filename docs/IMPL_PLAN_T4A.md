# IMPL_PLAN_T4A — プロファイル保存層(`maplen-board-profile-v1`)

> 承認者: ユーザー(方針承認 2026-07-14)/ 実装: implementer
> 役割: T4a=**保存層**(ピン・目標を historyKey で保存 + 画面内の唯一の正)。T4b=表示層(別PR、T4a マージ後)。
> **T4a マージ時点で利用者向け画面は不変**(Provider をアプリへ配線しない)。

## 0. 目的・正の所在・境界

- 目的: 「自分のキャラ(ピン、主/サブ最大3体)」と「キャラ別目標(Lv/日付)」を **historyKey ベース**(改名耐性・LULU-005)で localStorage に保存し、**画面内の状態を1箇所(ProfileProvider)に集約**する。
- **正の所在**: プロファイルの正 = localStorage `maplen-board-profile-v1` + そのメモリ状態(ProfileProvider が唯一保持)。統計計算はしない(T3 を呼ぶのは T4b)。
- **既存 favorites/groups(`msu_exp_ranking_*`)は一切変更しない**(別キー・別モジュール・別concept。LULU-024)。
- 参照: DECISION_LOG **LULU-024**(方針)・LULU-005(historyKey)・LULU-007(新規依存)・LULU-008(新規命名 `maplen-board-*`)

## 1. スコープ

### 作成ファイル
- `exp_ranking/web/src/profile/profile.js` — 純粋: 定数・スキーマ・正規化・load/save・変換ヘルパ(pin/unpin/setPrimary/setGoal/clearGoal)
- `exp_ranking/web/src/profile/ProfileContext.jsx` — `ProfileProvider` + `useProfile`(唯一の状態・save-then-commit・別タブ同期)
- `exp_ranking/web/src/profile/profile.test.js` — 純粋関数のフィクスチャテスト(vitest)

### 触ってはいけないもの
- `favorites.js` / `useFavorites.js` / `groups.js` / `useGroups.js` / `msu_exp_ranking_*` キー(**不変**)
- 既存コンポーネント / `App.jsx`(**T4a では Provider を配線しない=UI不変**)
- bot / workflow / vite本番設定 / 既存 i18n(T4a は UI 文言を持たない=**i18n 追加なし**。名称・見出しは T4b)
- **新規 npm 依存を追加しない**(vitest は導入済。React 統合テスト用の jsdom/testing-library は**追加しない**=下記§9 参照)

## 2. スキーマ(`maplen-board-profile-v1`)

```json
{
  "version": 1,
  "primaryHistoryKey": "asset:CHAR_A",
  "pinnedHistoryKeys": ["asset:CHAR_A", "asset:CHAR_B"],
  "goals": {
    "asset:CHAR_A": { "targetLevel": 250, "targetDateIso": "2026-09-01" }
  }
}
```
- 定数: `PROFILE_KEY = "maplen-board-profile-v1"` / `PROFILE_VERSION = 1` / `MAX_PINS = 3` / `MIN_TARGET_LEVEL = 225` / `LEVEL_CAP = 275`(rankingUtils と一致)。
- `DEFAULT_PROFILE = { version: 1, primaryHistoryKey: null, pinnedHistoryKeys: [], goals: {} }`。

## 3. 正規化 `normalizeProfile(raw)`(読み込み時 + **書き込み前**の両方で必ず適用)

規則(いずれも例外を投げない):
1. `raw` が object でない/`version !== 1` → `DEFAULT_PROFILE`(将来は v1→vN 移行関数を足す形。今は v1 のみ)。
2. `pinnedHistoryKeys`: 非空文字列のみ抽出 → **重複除去(初出順)** → **`MAX_PINS=3` に末尾切り捨て**。
3. `primaryHistoryKey`: 非空文字列かつ `pinnedHistoryKeys` に含まれる場合のみ有効。外れていれば **`pinnedHistoryKeys[0] ?? null`** に補正。
4. `goals`: キーが非空文字列のエントリのみ。各値(§2.1 の目標正規化)を満たすもののみ残す。**満たさない/不完全な目標は落とす**(他の正常な目標は保持)。**ピンされていない historyKey の目標も保持**(自動削除しない)。
5. 未知フィールドは除去(goal 内の未知フィールドも除去)。

### 2.1 目標(goal)の最低保証形式(保存層で固定)
- `targetLevel`: **有限の整数**かつ**ゲーム有効範囲内**(`MIN_TARGET_LEVEL=225` 〜 `LEVEL_CAP=275`)。範囲外/非整数/非数は不正。
- `targetDateIso`: **厳密な `YYYY-MM-DD`** かつ**実在する暦日**(`2026-02-30` 等は拒否=parse して構成要素が一致することを確認)。
- **両方が有効なときのみ保存**(片方だけの不完全 goal は保存しない)。goal 内の**未知フィールドは除去**。
- ※「現在レベル以下か / 過去日付か」等の**意味判定は T4a では行わない**(現在キャラ情報を持たないため)=T4b/T3 の責務。

### 正規化 前 → 後(例)
**前**(破損・重複・上限超・primary不整合・不正goal):
```json
{ "version": 1, "primaryHistoryKey": "asset:X",
  "pinnedHistoryKeys": ["asset:A","asset:A","asset:B","asset:C","asset:D", ""],
  "goals": { "asset:A": { "targetLevel": 250, "targetDateIso": "2026-09-01" },
             "asset:B": { "targetLevel": "bad", "targetDateIso": "2026-09-01" } } }
```
**後**(dedupe・3体切り捨て・primary→先頭・不正goal除去):
```json
{ "version": 1, "primaryHistoryKey": "asset:A",
  "pinnedHistoryKeys": ["asset:A","asset:B","asset:C"],
  "goals": { "asset:A": { "targetLevel": 250, "targetDateIso": "2026-09-01" } } }
```

## 4. テスト可能な構造(3層分離)+ 純粋API・結果形式

**関心を3層に分離**(ProfileProvider に localStorage 操作と変換を直書きしない):
- **(a) 純粋なプロフィール操作**(profile.js、localStorage 非依存)
- **(b) storage への読み書き**(差し替え可能なアダプター)
- **(c) React state への反映**(ProfileContext)

### storage アダプター(テスト時に差し替え可能)
- `createProfileStorage(backend = window.localStorage)` を用意し、`backend.getItem/setItem` を使う小さなラッパ。テストでは in-memory / 例外を投げる mock backend を注入して、save 成功/失敗・読み直しを**自動テスト可能**にする。
- `readProfile(storage): { profile, status }`:
  - `status ∈ { "ok", "missing", "corrupt", "unsupportedVersion", "storageError" }` で**理由を判別**(状態を混同しない):
    - `missing`: キー無し(getItem が null)→ `DEFAULT_PROFILE`
    - `corrupt`: JSON.parse 失敗/構造不正 → `DEFAULT_PROFILE`
    - `unsupportedVersion`: `version !== 1` → **安全な `DEFAULT_PROFILE` を返すが自動保存はしない**(§5)
    - `storageError`: getItem 自体が例外 → `DEFAULT_PROFILE`
    - `ok`: 正常(空プロフィールが保存済みも `ok`)。取得値は `normalizeProfile` 適用
- `writeProfile(storage, profile): { ok: boolean }` — `normalizeProfile` 後に setItem を try/catch。成功 `{ok:true}` / 失敗(QuotaExceededError 等)`{ok:false}`。**失敗時に既存 localStorage 値を削除しない**。
- **storage イベント解釈も純粋関数**: `interpretStorageEvent(event): { profile, status } | null`(§5 の contract)。

### 純粋変換ヘルパ(profile.js・localStorage 非依存・新プロファイル+コードを返す)
`addPin` / `removePin` / `setPrimaryPin` / `setGoalIn` / `clearGoalIn`。各 `{ profile, code }`:
- `addPin`: `code ∈ { added, alreadyPinned, limitReached, invalidKey }`。invalidKey=historyKey 非空文字列でない / limitReached=既に3体(**自動削除しない**)
- `removePin`: `{ removed, notPinned, invalidKey }`。主を外したら **primary=残り先頭**(無ければ null)。**goals 非削除**
- `setPrimaryPin`: `{ set, notPinned, invalidKey }`(pinned 内のみ)
- `setGoalIn`: `{ set, invalidKey, invalidGoal }`。§2.1 検証NGは `invalidGoal` で**既存目標を消さず** profile 不変
- `clearGoalIn`: `{ cleared, noGoal, invalidKey }`

### API 結果の共通形式(ProfileContext のミューテーションが返す)
**すべて同一形式** `{ ok: boolean, code: string, profile: Profile }`(現在の profile を必ず同梱)。操作別 code:
| 操作 | code |
|---|---|
| `pin` | `ok \| alreadyPinned \| limitReached \| invalidKey \| saveFailed \| unsupportedVersion` |
| `unpin` | `ok \| notPinned \| invalidKey \| saveFailed \| unsupportedVersion` |
| `setPrimary` | `ok \| notPinned \| invalidKey \| saveFailed \| unsupportedVersion` |
| `setGoal` | `ok \| invalidKey \| invalidGoal \| saveFailed \| unsupportedVersion` |
| `clearGoal` | `ok \| noGoal \| invalidKey \| saveFailed \| unsupportedVersion` |
- `saveFailed`: writeProfile が `{ok:false}`(永続化失敗)→ **state 未確定**(§5 save-then-commit)
- `unsupportedVersion`: 未対応 version をロード中は**ミューテーションを原則拒否**し、保存もしない(将来 migration が必要=code で返す)
- T4b はこの `code` で利用者向け文言を決める(文字列/boolean が操作ごとにばらけない)

## 5. ProfileProvider / Context / useProfile の責務(状態の単一の正)

- **`ProfileProvider`** が **localStorage の読み書きと唯一の state** を保持(`useState`)。子は `useProfile()` で**同じ状態**を使う。
- 初期化: マウント時 `loadProfile()` → state。
- 初期化: `readProfile(storage)` → `{ profile, status }` を state に保持(status も保持)。
- **未対応 version の非破壊(§追加条件3)**: ロード status が `unsupportedVersion` のとき、**空プロフィールへは"表示上"フォールバックするが自動保存しない**(Provider 初期化だけで未知 version データを空で**上書きしない**)。この状態では**ミューテーションを原則拒否**し `{ ok:false, code:"unsupportedVersion", profile }` を返す(明示的ユーザー操作でも黙って上書きしない=将来 migration が必要)。**未知 version データを黙って破壊しない**。
- **save-then-commit(保存失敗契約)**: 各ミューテーションは
  1. 純粋変換ヘルパで次プロファイル+code を計算(code が ok 系でなければ保存せず `{ ok:false, code, profile(現状) }` を返す)
  2. `writeProfile(storage, next)` を実行
  3. **`ok===true` のときだけ `setState(next)`**(永続化失敗した操作は確定しない)、失敗なら state 維持 + `{ ok:false, code:"saveFailed", profile(現状) }`
  4. **console warning だけで成功扱いにしない**。T4b はこの `ok:false`+code を利用者へ表示できる。
- **同一タブ**の pin/unpin/目標変更は上記経路で state 更新 → **全利用箇所へ即時反映**(localStorage だけ書き換えて他コンポーネントが更新されない状態を作らない)。**同一タブ更新は storage イベントに依存しない**。
- **別タブ同期(storage イベント契約・§追加条件4)**: `window` の `storage` を購読し、純粋関数 `interpretStorageEvent(event)` に委譲:
  - **`event.key === "maplen-board-profile-v1"` の場合のみ処理**(旧 favorites/groups キーには**反応しない**)
  - **`event.newValue === null`**(別タブで削除)→ **空プロフィール**へ反映
  - **壊れた newValue** → corrupt として安全に扱い**画面を落とさない**(空/現状維持)
  - **同一内容**(解釈結果が現 state と等価)→ **不要な setState をしない**
  - Provider 破棄時に **listener を解除**
- **Provider を重複配置しない**(アプリ最上位に1つ)。**T4a では App に配線しない**(未使用=UI不変)。**T4b で一度だけ App 上位に配置**。
- `useProfile()` 公開: `{ profile, status, primaryHistoryKey, pinnedHistoryKeys, isPinned(historyKey), pin, unpin, setPrimary, getGoal(historyKey), setGoal, clearGoal }`。ミューテーションは共通形式 `{ ok, code, profile }` を返す。

## 6. 破損・容量不足・version不一致・別タブ

- **JSON 破損**: `loadProfile` が try/catch → `DEFAULT_PROFILE`。**画面を落とさない**。旧 favorites/groups は触らない。
- **容量不足**: `saveProfile` の `setItem` が QuotaExceededError → `{ok:false}`、既存値保持、state 未更新、呼び出し側へ失敗。
- **version 不一致**: `normalizeProfile` が `DEFAULT` に(将来の移行関数追加余地)。
- **別タブ**: storage イベントで再読込(§5)。
- **初期化だけで旧 favorites/groups を削除しない**(別キー・別モジュール)。

## 7. 不変条件
- `pinnedHistoryKeys` は**一意・最大3**。`primaryHistoryKey` は **null または pinnedHistoryKeys の要素**。
- **4体目追加は拒否**(`limitReached`、自動削除しない)。上限超は**正規化時のみ**末尾切り捨て。
- **historyKey 欠損キャラはピン不可**(`invalidKey`、クラッシュしない)。
- **現在 summary に無いキャラでも保存を即時削除しない**(profile.js は summary を知らない=キーを保持。表示側 T4b で「現在ランキング外」)。目標も自動削除しない。

## 8. テスト一覧(vitest・純粋関数 + 差し替え storage・独立フィクスチャ)
`profile.js` + storage アダプター + `interpretStorageEvent` を対象(いずれも非React・テスト可能):
1. `normalizeProfile`: dedupe / 3体切り捨て / primary→先頭補正 / primary null(空時)/ 不正goal除去(正常goal保持)/ 未知フィールド除去
2. **目標正規化(§2.1)**: targetLevel 非整数/範囲外(224・276)→除去 / targetDateIso 非YYYY-MM-DD・**実在しない日(2026-02-30)**→除去 / 片方欠如の不完全goal→保存しない / goal内未知フィールド除去
3. `readProfile` の **status 区別**: `missing`(キー無)/ `corrupt`(壊れJSON)/ `unsupportedVersion`(version≠1)/ `storageError`(getItem例外・mock)/ `ok`(正常な空プロフィール保存済も ok)。いずれも `profile` は安全な既定/正規化値
4. `writeProfile`: 成功→ok:true・**保存前に normalize** / **setItem 例外(mock backend)→ok:false・既存値不削除**
5. **save-then-commit(非React・関数分離で検証)**: 保存成功時だけ次プロファイル確定 / 保存失敗時は現在維持・既存値不削除 / 読み直した値が normalize される
6. `addPin`: added / alreadyPinned / **limitReached(3体で4体目、profile不変)** / invalidKey(空/欠損)
7. `removePin`: removed / **主削除→次主=残り先頭** / 最後の1体→primary=null / **goal 非削除** / notPinned / invalidKey
8. `setPrimaryPin`: pinned内→set / pinned外→notPinned
9. `setGoalIn`: set / invalidGoal(§2.1)→**既存目標不消失** / invalidKey。達成/過去日の意味判定は**しない**(T4a)
10. `clearGoalIn`: cleared / noGoal / invalidKey
11. **`interpretStorageEvent`(純粋)**: key≠PROFILE_KEY→null(無視)/ 旧favorites/groupsキー→null / newValue=null→空プロフィール / 壊れnewValue→corrupt・落ちない / 正常newValue→normalize
12. **未対応 version 非破壊**: readProfile が unsupportedVersion のとき、変換ヘルパ/保存を通さない(=保存が呼ばれないことを検証)、ミューテーション結果 code=`unsupportedVersion`
13. 結果コードの共通形式 `{ ok, code, profile }` を各操作で検証
14. 前後JSON例(§3)の round-trip

## 9. Provider の検証方針(新規依存を増やさない)
- **ミューテーション・保存失敗・正規化のロジックはすべて純粋関数(profile.js)に置き、vitest で網羅**。`ProfileProvider` は「純粋ヘルパ + save-then-commit + storage リスナ」の**薄い合成**にとどめる。
- React 統合(state 反映・storage イベント)の自動テストには `jsdom` + `@testing-library/react`(新規 devDep)が要るため、**T4a では追加しない**。Provider は**統括のコードレビュー + `npm run build` + T4b 実機**で検証。将来 RTL 導入は別途依存承認。

## 10. コミット分割
1. `profile.js`(定数・スキーマ・normalize・load/save・変換ヘルパ)+ `profile.test.js`
2. `ProfileContext.jsx`(ProfileProvider + useProfile + storage 同期)※**App 未配線**
3. (必要時)整理・JSDoc

各コミット後 `npm run test` と `npm run build` 緑。**`git add -A` 禁止**・個別 add・`git diff -w`。**push しない**。

## 11. 受け入れ条件
| # | 基準 | 手段 |
|---|---|---|
| 1 | vitest 全緑(既存48 + T4a 追加) | `npm run test` |
| 2 | 本番ビルド成功・ProfileProvider は**未配線=bundle 未混入**(ツリーシェイク) | `npm run build` + grep |
| 3 | **UI 不変**(利用者向け画面に変化なし) | 目視/差分 |
| 4 | 既存 favorites/groups(`msu_exp_ranking_*`)・お気に入りUI**不変** | `git diff`(favorites/groups 系ファイル差分ゼロ) |
| 5 | **新規依存なし**(jsdom/testing-library 追加なし) | package.json diff |
| 6 | bot・workflow 不変 | 差分確認 |
| 7 | 保存失敗が成功扱いにならない(save-then-commit) | テスト#3 |

## 12. 停止条件 / ロールバック / 完了報告
- 停止条件: 状態単一の正を Provider で成立できない構造差 / 既存 favorites/groups に触れないと成立しない / スコープ外変更が必要。
- ロールバック: 各コミット単独 revert 可。未配線のため revert してもアプリ挙動不変。
- 完了報告(以下を必ず含める):
  - 作成・変更ファイル一覧
  - `npm run test` の**件数と結果**(既存48+T4a)/ `npm run build` 結果
  - **各操作(pin/unpin/setPrimary/setGoal/clearGoal)の結果コード一覧**(実装での code 集合)
  - **保存成功/失敗の代表テスト**(mock backend で ok:true / setItem 例外→ok:false・既存値不削除)
  - **JSON破損・未知version・storageError の代表テスト**(readProfile の status 区別)
  - **storage イベント処理の検証結果**(`interpretStorageEvent`: 対象key限定・newValue=null→空・壊れnewValue非落ち・旧キー無視)
  - **既存 favorites/groups キー(`msu_exp_ranking_*`)に一切触れていないこと**(該当ファイル差分ゼロ)
  - **ProfileProvider が既存アプリに未配線で UI 不変**であること(bundle 未混入)
  - watch-item

## 13. 作らないもの(T4a 除外 → T4b)
- サマリーカード・T3 統計の表示・目標設定 UI・ピン登録導線(すべて T4b)
- Provider の App への配線(T4b で1回だけ)
- ユーザー向け名称・見出しの i18n(T4b。ja「マイキャラ」/ en「My Characters」、カード見出し ja「今日の成績」/ en「Today's Summary」+他4言語自然訳)
- 既存 favorites/groups の移行・統合(独立後続タスク=DECISION_LOG §7)
- bot / workflow / SEO / URL 変更
