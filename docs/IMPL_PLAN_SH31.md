# IMPL_PLAN_SH31 — 曖昧さの無いゾーンだけ略称(JST / KST)で表示する

前提: SH-30 完了・統括検収済。**ユーザー指示 2026-08-06**:
> チャートの日付表示について、UTC+9 ではなく JST と表記したい

統括が3案を提示し、**ユーザーが A(小さな対応表)を選択**。

## 0. 変更は1関数だけ

`exp_ranking/web/src/sfhistory/domain/format.js` の **`formatTimeZoneLabel` のみ**。

呼び出し元は2箇所で、**どちらもこの関数の戻り値をそのまま表示している**:

| 呼び出し元 | 用途 |
|---|---|
| `format.js#formatTooltipDateLocal` | チャートのツールチップ・ローカル時刻行 |
| `components/WeekdayHeatmap.jsx:94` | ヒートマップ列見出しのゾーン注記 |

∴ **この2箇所の表示が同時に変わるのが正**(片方だけ変わってはいけない)。

## 1. 変更内容

### 1-1 現状

```js
// Asia/Tokyo -> "UTC+9" / America/New_York -> "UTC-4" / Not/AZone -> "Not/AZone"
```
`Intl` の `shortOffset` を引いて `GMT` を `UTC` に置換している。

### 1-2 変更後

**対応表に載っているゾーンだけ略称を返す。載っていなければ現行の挙動を1ビットも変えない。**

```
Asia/Tokyo  -> "JST"
Asia/Seoul  -> "KST"
それ以外     -> 現行どおり("UTC+9" / "UTC-4" / 解決不能なら IANA 名)
```

### 1-3 ★対応表に何を入れないか(この判断をコメントに残す)

**JST / KST の2つだけ。**理由は2つとも満たすゾーンだけを入れるという規則:

1. **夏時間が無い** — 略称が季節で変わらないので静的な表で嘘にならない
2. **略称が世界で一意** — 他の時間帯と衝突しない

∴ **以下は意図的に入れない**(コメントで明示すること):

| 略称 | 衝突 |
|---|---|
| `CST` | 中国標準時 / 米国中部標準時 / キューバ標準時 |
| `IST` | インド / イスラエル / アイルランド |
| `EST` `PST` 等 | 夏時間で `EDT` `PDT` に変わる(静的な表では嘘になる) |

> **なぜ Intl に任せないのか**(これもコメントに残す): `timeZoneName: "short"` は
> **書式化ロケールに依存**する。統括の実測では `Asia/Tokyo` は `ja` ロケールでのみ `JST` を返し、
> `en` / `ko` / `es` / `th` / `vi` / `zh-TW` では `GMT+9` を返す。
> **閲覧者の UI 言語と、閲覧者が住んでいるタイムゾーンは別物**なので、
> 「日本にいるが英語UIで見ている」利用者に `UTC+9` を出すのは一貫しない。
> ∴ **UI 言語に依存しない対応表**にする。

### 1-4 IANA の旧称(エイリアス)

ブラウザが `Asia/Tokyo` ではなく旧称 `Japan`(または `ROK`)を返す環境がありうる。

- **まず実測すること**: `Intl.DateTimeFormat(undefined, { timeZone: "Japan" }).resolvedOptions().timeZone`
  が `Asia/Tokyo` に正規化されるかを Node で確認し、**結果を報告に書く**
- 正規化される → **正規化を通してから表を引く**(表は正典名だけで済む)
- 正規化されない → **旧称も表に足す**
- **どちらを選んだかを報告に書く**(黙って決めない)

## 2. スコープ

**変更してよい**:
- `exp_ranking/web/src/sfhistory/domain/format.js`(**`formatTimeZoneLabel` と、その直上の定数・コメントのみ**)
- `exp_ranking/web/src/sfhistory/domain/format.test.js`
- `docs/reports/SH31_ZONE_ABBREVIATION.md`

**触らないもの**(1つでも触れたら停止):
- **`format.js` の他の export すべて**(`localTimeZone` / `formatTooltipDate` /
  `formatTooltipDateLocal` / `formatLocalClockTime` / `formatCompactNeso` /
  `formatBucketRange` / `formatClockTime` / `utcDateTimeParts` …)
- **`WeekdayHeatmap.jsx` / `SfHistoryChart.jsx`**(呼び出し方は変えない。**戻り値だけが変わる**)
- **`i18n/locales/*.json`**(**ゾーン略称は翻訳しない**。全言語同じ文字列)
- **ヒートマップの集計**(`weekdayStats.js`。UTC 基準・木曜起点)
- `server/` 配下すべて / **4h テーブル** / `starforce.js`
- SH-7〜SH-30 の性質すべて
- `src/App.jsx` / `src/board/` / `src/pages/` / `src/components/` / `src/taskManager/`
- `package.json` / **VPS** / **元ツリー** / **`C:\Users\pachi\Desktop\maplenEnhancebot`(読み取りすら不要)**

## 3. 受け入れ基準(すべてテストで固定)

- **(a)** `formatTimeZoneLabel("Asia/Tokyo", <任意の日付>)` === **`"JST"`**
- **(b)** `formatTimeZoneLabel("Asia/Seoul", <任意の日付>)` === **`"KST"`**
- **(c) ★夏時間で変わらない**: (a)(b) が **1月の日付でも8月の日付でも同じ文字列**
- **(d) ★現行の挙動が保たれる**(既存テストを消さずに通す):
  - `"UTC"` → `"UTC"`
  - `"America/New_York"`(2026-08-04) → `"UTC-4"` ← **略称化しない**
  - `"Not/AZone"` → `"Not/AZone"`
- **(e)** `"Asia/Shanghai"` → **`"UTC+8"`**(`CST` にしない。§1-3 の規則がテストで固定される)
- **(f)** `"Asia/Kolkata"` → **`"UTC+5:30"`**(`IST` にしない)
- **(g)** 引数省略時に例外を投げない(`formatTimeZoneLabel()` が文字列を返す)
- **(h) 2箇所同時**: `formatTooltipDateLocal("2026-08-05T12:00:00Z", { timeZone: "Asia/Tokyo" })` が
  **`JST` を含む**(= ツールチップ側にも反映されている)ことをテストで固定
- **(i)** §1-4 の実測結果を報告に記載。旧称の扱いがテストで固定されている
- **(j)** `npm run test` 全緑 / `npm run build` 成功 / **`server/` の差分ゼロ** / **`src/i18n/` の差分ゼロ**
- **(k)** SH-7〜SH-30 の性質維持(UTC が主で残る・ヒートマップのセル不変・破線1点・意味色 など)

### 3-1 ★UTC は消えない(確認事項)

SH-29 §2-1 の「正直さの要求」は生きている。
**ツールチップは UTC 行が主、ローカル行が従の2重表示のまま**。
ヒートマップも **UTC 併記のまま**。**本変更は従の行の末尾の文字列だけを変える。**

## 4. 停止条件

1. **(d) が崩れる**(略称化のために既存ゾーンの戻り値が変わる)
2. **(h) を満たすために `formatTooltipDateLocal` 本体を変えないといけない**
   → 止めて報告(呼び出し元は変えない設計のはず)
3. §2 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 5. コミット

- **ローカルコミット1本**。**単独 revert 可**。
- **`git push` は行わない。** **`git add -A` 禁止**(触ったファイルのみ個別 add)。

## 6. 完了報告テンプレ

```
## SH-31 完了報告
- コミット: <hash>
- (a)(b) JST / KST
- (c) ★1月/8月で不変
- (d) ★現行挙動の保持(UTC / America/New_York / Not/AZone)
- (e)(f) CST / IST にしないことの固定
- (g) 引数省略
- (h) ★ツールチップ側への反映
- (i) ★IANA 旧称の実測結果と、選んだ扱い
- (j) npm test / build / server 差分ゼロ / i18n 差分ゼロ
- (k) SH-7〜SH-30 の性質維持
```
