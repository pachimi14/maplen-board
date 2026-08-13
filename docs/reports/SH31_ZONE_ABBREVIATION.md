# SH-31 完了報告 -- 曖昧さの無いゾーンだけ略称(JST / KST)で表示する

計画: `docs/IMPL_PLAN_SH31.md`。前提: SH-30 完了・統括検収済。実施日: 2026-08-06。
ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。
ユーザー指示 2026-08-06: 「チャートの日付表示について、UTC+9 ではなく JST と表記したい」→
統括が3案提示、**ユーザーが A(小さな対応表)を選択**。

## コミット

`git add -A` は不使用。触った3ファイル(`format.js` / `format.test.js` / 本報告)のみ個別 `git add`。
コミットハッシュは本コミット反映後に追記(ローカル1本、単独 revert 可、**push なし**)。

## 変更内容

`exp_ranking/web/src/sfhistory/domain/format.js` の `formatTimeZoneLabel`(と直上の
`ZONE_ABBREVIATIONS` 定数)のみ変更。対応表に載っているゾーンだけ略称を返し、
載っていなければ従来どおり `Intl` の `shortOffset`("UTC+9" 形式)または生の IANA 名を返す。

```js
const ZONE_ABBREVIATIONS = {
  "Asia/Tokyo": "JST",
  "Asia/Seoul": "KST",
};
```

対応表には **JST / KST の2つだけ**を入れた。判断規則(2つとも満たすゾーンだけを入れる):

1. **夏時間が無い** -- 略称が季節で変わらないので静的な表で嘘にならない
2. **略称が世界で一意** -- 他の時間帯と衝突しない(`CST` は中国/米国中部/キューバ、`IST` は
   インド/イスラエル/アイルランドと衝突するため、意図的に入れていない)

`Intl` の `timeZoneName: "short"` に任せなかった理由: 統括実測で `Asia/Tokyo` は `ja` ロケール
でのみ `JST` を返し、`en`/`ko`/`es`/`th`/`vi`/`zh-TW` では `GMT+9` を返す。閲覧者の UI 言語と
居住タイムゾーンは別物なので、UI 言語に依存しない静的な対応表にした(`i18n/locales/*.json` は
未改変 -- 全言語で同じ文字列)。

## 呼び出し元(2箇所同時に反映)

| 呼び出し元 | 用途 | 反映確認 |
|---|---|---|
| `format.js#formatTooltipDateLocal` | チャートのツールチップ・ローカル時刻行 | テストで固定(下記 (h)) |
| `components/WeekdayHeatmap.jsx:94` | ヒートマップ列見出しのゾーン注記 | `formatTimeZoneLabel()` を引数無しで呼ぶのみ・呼び出し方は無変更。戻り値だけが変わる(コードは触っていない) |

両呼び出し元とも `formatTimeZoneLabel` の戻り値をそのまま表示に使っているため、この1関数の
変更だけで両方に同時反映される(計画 §0 の設計どおり)。

## 受け入れ基準の実測

すべて `format.test.js` にテストとして固定済み。実行結果は「検証コマンド」節参照。

- **(a)(b)** `formatTimeZoneLabel("Asia/Tokyo", ...)` === `"JST"` / `formatTimeZoneLabel("Asia/Seoul", ...)` === `"KST"`
- **(c) ★1月/8月で不変**: `Asia/Tokyo`/`Asia/Seoul` を 2026-01-15 と 2026-08-15 の両方で検証、
  どちらも同じ文字列(`JST`/`KST`)。対応表が季節に依存しない静的値である以上、当然この基準を満たす。
- **(d) ★現行挙動の保持**: `"UTC"` → `"UTC"` / `"America/New_York"`(2026-08-04)→ `"UTC-4"`(略称化しない)
  / `"Not/AZone"` → `"Not/AZone"` の3ケースとも既存テストのまま通過。
- **(e)(f)** `"Asia/Shanghai"` → `"UTC+8"`(`CST` にしない)/ `"Asia/Kolkata"` → `"UTC+5:30"`(`IST` にしない)
- **(g)** `formatTimeZoneLabel()`(引数省略)が例外を投げず文字列を返すことをテストで確認
- **(h) ★2箇所同時**: `formatTooltipDateLocal("2026-08-05T12:00:00Z", { timeZone: "Asia/Tokyo" })` の
  戻り値が `"JST"` を含むことをテストで固定(`formatTooltipDateLocal` 自体は無改変 -- 内部で呼んでいる
  `formatTimeZoneLabel` の戻り値が変わっただけ)
- **(i)** 下記「IANA 旧称の実測」参照
- **(j)** `npm run test` 全緑(478 tests / 43 files) / `npm run build` 成功 / `server/` 差分ゼロ
  (※後述の注記あり) / `src/i18n/` 差分ゼロ
- **(k)** SH-7〜SH-30 の性質維持: UTC がツールチップ・ヒートマップの主表示のまま(ローカル行は従の
  ままで、変わったのはその行の末尾の文字列だけ)。ヒートマップのセル集計(`weekdayStats.js`)・
  破線・意味色は本変更で一切触っていない(コードから未改変を確認済み)。

## (i) ★IANA 旧称(エイリアス)の実測結果

計画 §1-4 の指示どおり、コミット前に実測した。

```
$ node --version
v22.21.0

$ node -e "console.log(Intl.DateTimeFormat(undefined, { timeZone: 'Japan' }).resolvedOptions().timeZone)"
Asia/Tokyo

$ node -e "console.log(Intl.DateTimeFormat(undefined, { timeZone: 'ROK' }).resolvedOptions().timeZone)"
Asia/Seoul
```

**両方とも正規化される**(`Japan` → `Asia/Tokyo`、`ROK` → `Asia/Seoul`)。

∴ **選んだ扱い**: 正規化を通してから表を引く。`formatTimeZoneLabel` 内で
`new Intl.DateTimeFormat(undefined, { timeZone: tz }).resolvedOptions().timeZone` を一度呼び、
その正規化結果(`canonical`)で `ZONE_ABBREVIATIONS` を引く。表自体は正典名(`Asia/Tokyo` /
`Asia/Seoul`)だけを持ち、旧称は表に足していない。正規化に失敗する(=`Intl` が解決できない)
ゾーン名では `canonical` を元の `tz` のまま通し、既存のオフセット分岐(またはその失敗時の生名
フォールバック)に委ねる -- この経路は SH-31 以前と1ビットも変えていない。

`format.test.js` に旧称のテストを追加して固定:
- `formatTimeZoneLabel("Japan", ...)` === `"JST"`
- `formatTimeZoneLabel("ROK", ...)` === `"KST"`

## (j) 検証コマンドの実行結果

```
$ cd exp_ranking/web && npm run test -- --run
 Test Files  43 passed (43)
      Tests  478 passed (478)
   Duration  1.24s

$ npm run build
✓ 2379 modules transformed.
✓ built in 6.46s
（チャンクサイズ警告は本変更と無関係の既存事象）
```

`git diff -w -- server/` : **差分あり、ただし SH-31 由来ではない**。`server/sf-history/data/sf_history_items.json`
の `generatedAt` タイムスタンプと `maxStar` フィールドが、本スライス着手**前**からワークツリー上で
未コミットのまま変更されていた(定期データ更新ジョブ由来と見られる)。SH-31 はこのファイルを
一切開いておらず、`git add` もしていない -- コミットには含まれない。統括への申し送り事項として
記載する(本計画のスコープ外・停止条件には該当しない: 計画が touch を禁じているのは「触った
場合」で、この変更は本スライスの作業前から存在していた)。

`git diff -w -- src/i18n/` : 差分ゼロ。

## 停止条件チェック

1. (d) は崩れていない(既存3ケースとも従来値のまま)。
2. (h) は `formatTooltipDateLocal` 本体を1行も変えずに満たせた(内部で呼ぶ `formatTimeZoneLabel`
   の戻り値が変わっただけ)。
3. 「触らないもの」リストのいずれにも触れていない。新規依存も無し。

該当なし。実装は計画どおり完了。
