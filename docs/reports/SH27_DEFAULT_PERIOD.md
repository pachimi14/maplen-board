# SH-27 — 期間の既定を 30日にする

実施: 2026-08-06 / 実装担当

**ユーザー指示**: 期間のデフォルトは30日にして。

## 1. 変更

`SfHistoryRoot` の期間タブ初期状態が、これまで `useState("150D")`
(文字列直書き)だった。

`exp_ranking/web/src/sfhistory/domain/series.js` に

- `DEFAULT_PERIOD = "30D"`(SH-26 の `DEFAULT_INITIAL_ITEM_ID` と同じ流儀:
  コンポーネント内直書きではなく名前付き定数)

を追加し、`SfHistoryRoot.jsx` の `useState("150D")` を
`useState(DEFAULT_PERIOD)` に置き換えた。

`PERIOD_KEYS` / `PERIOD_DAYS` の中身(選択肢)・`sliceByPeriod` のアルゴリズム
は無変更。

## 2. ★ヒートマップ不変の確認

`WeekdayHeatmap` は `SfHistoryRoot.jsx:224` で **常に `fullSeries`**(期間タブで
スライスされていない全期間 ≈150日ぶんの系列)を渡されている
(`periodSeries` ではない)。`WeekdayHeatmap` コンポーネント自体も `period`
state を一切参照しない(design §3-2 の元設計どおり、SH-11 で確立済み・今回
無変更)。

したがって今回の変更(期間タブの**初期値**を変えただけ)は、ヒートマップへ渡す
`series` の中身に一切影響しない — `sliceByPeriod` はチャート/統計カード用の
`periodSeries` だけに使われ、`fullSeries` の生成経路には関与しない
(コード上、期間 state を消費するのは `periodSeries` の `useMemo` 内の
`sliceByPeriod(fullSeries, period)` 呼び出しのみで、`fullSeries` 自体・
`WeekdayHeatmap` への配線はこの呼び出しの外)。停止条件1(ヒートマップが期間に
連動する)には該当しない。

## 3. 受け入れ基準

- **(a)** 初期表示の期間は `DEFAULT_PERIOD = "30D"`。`useState(DEFAULT_PERIOD)`
  により、タブの選択状態(`PeriodTabs` は `period` state をそのまま受け取り
  ハイライトする、既存コンポーネント無変更)も 30日で開く
- **(b)** 初期表示の点数: `sliceByPeriod` は 4h バケット × 30日 =
  **180点**(既存テスト `series.test.js` の
  `it.each([["30D", 30 * 6], ...])` が `30 * 6 = 180` を固定済み。実系列が
  180点未満しかない場合は `sliceByPeriod` の仕様どおりある分だけ返す=無変更)
- **(c)** `series.test.js` に
  `DEFAULT_PERIOD is 30D and is a member of PERIOD_KEYS` を追加し、
  `expect(DEFAULT_PERIOD).toBe("30D")` と
  `expect(PERIOD_KEYS).toContain(DEFAULT_PERIOD)` の両方を固定
- **(d)** 上記§2のとおりコード配線を確認: `WeekdayHeatmap` は `fullSeries`
  のみを受け取り `period` を参照しないため、既定を 150D→30D に変えても
  ヒートマップのセルの中央値・n は1ビットも変わらない
- **(e)** 期間タブの切替: `PeriodTabs`/`setPeriod`/`sliceByPeriod` の実装・
  呼び出し方は今回無変更。7D/30D/90D/150D 全キーとも既存どおり動作する
- **(f)** `npm run test`: **43 files / 451 tests 全緑**(SH-27 追加の1件を含む)。
  `npm run build`: 成功(6.54s、既存の chunk サイズ警告のみ、エラーなし)。
  `git diff -- server/` 出力なし(差分ゼロ)
- **(g)** SH-7〜SH-26 のテストは今回のスイート実行にすべて含まれ全緑
  (個別に削除・改変していない)
