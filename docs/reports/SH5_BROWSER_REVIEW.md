# SH-5 ブラウザ検収(統括)

実施: 2026-08-05 / 統括が実際にブラウザで画面を開いて操作した記録。
対象: `4bfd7c8`(P0 修正後)。環境: ローカル API `127.0.0.1:8785` + Vite `localhost:5183`。

## 1. 差し戻した P0(初回検収)

`npm run test` 354 passed・`npm run build` 成功だったが、**ブラウザで開くと画面が真っ白**だった。

```
Uncaught Error: Star range must satisfy 0 <= start < target <= 25
    at validateStarRange        (src/sfhistory/starforce.js:56:11)
    at requiredPriceStars       (src/sfhistory/starforce.js:78:3)
    at computeCurrentExpected   (src/sfhistory/domain/series.js:101:20)
    at                          (src/sfhistory/SfHistoryRoot.jsx:114:12)
```

React がルートごと unmount するため、**ランキング画面も巻き添えで死んだ**
(`#root` の children が 1 → 0。以後ハッシュを戻しても復帰しない)。

**根本原因(実装担当が特定・統括の見立てより一段具体的だった)**:
`defaultPresetForMaxStar()` が `{ startStar, targetStar }` ではなく **`{ from, to }`** を返していた。
このオブジェクトは **truthy なので `if (!range)` の素朴なガードをすり抜け**、
`startStar`/`targetStar` が `undefined` のまま計算関数へ渡っていた。

**なぜ緑をすり抜けたか**: `series.test.js` は domain 関数を**有効な範囲で直接**呼ぶ。
今回の欠陥は「非同期で入る state の**形**」の問題で、純粋関数テストでは原理的に捕まらない。
**`npm run test` 354 passed も `npm run build` 成功も、この欠陥に対しては証拠になっていなかった。**

## 2. 修正の検証(ブラウザ実機)

| 確認項目 | 結果 |
|---|---|
| `#/starforce` が描画される | ✅ `#root` children=1・recharts の line 1本・select 3・button 19 |
| **★`maxStar` ガード**(Dea Sidus Earring / `1032241` / ☆20) | ✅ **開始☆ max=19 / 目標☆ max=20**(21・22 が消える) |
| **目標☆の自動クランプ** | ✅ 装備切替で **22 → 17** に自動修正(不正な範囲で開かない) |
| **プリセットの無効化** | ✅ `20→21` `21→22` `19→21` `0→22` が **disabled** |
| 装備セレクタの上限表示 | ✅ 検索結果に「**☆20まで**」と出る(選ぶ前に分かる) |
| サマリー | ✅ 現在値 57.26M / 期間平均 60.62M / 期間高値 102M / 期間安値 41.51M / **40パーセンタイル** |
| 期間切替(7/30/90/150日) | ✅ 再描画される |
| 計算条件の表示 | ✅ スターキャッチON・チャンスタイムON・破壊防止OFF・イベント補正なし・指標=期待値・足=4時間・履歴の最終更新・現在価格の取得時刻・`starcatch-chancetime-no-safeguard-v1` |
| **既存ルートの回帰** | ✅ `#/starforce` ⇄ `#/` を往復してもアプリが落ちない(children=1 を維持) |

## 3. 統括の誤り(判断原則#6)

検収の途中で「**目標☆に 21/22 が残っている=P0**」と判断しかけたが、**これは私の操作ミス**だった。
検索結果の `<li>` をクリックしており、実際の選択は `<li>` 内の `<button>` にあった。
ネットワークログに `prices?itemId=1032241` が無いことで「選択が反映されていない」と気づいた。
**ネットワークで裏を取らずに報告していれば、実装担当に存在しない欠陥を追わせるところだった。**

## 4. 残す観察(block しない)

- **P3**: dev(StrictMode)で `/sf-history/equipment` が複数回取得される。開発時の二重実行と
  リロードの重なりによるもので、本番ビルドでの実挙動は未確認。**SH-6 後に本番で確認する**
- **暫定訳**: `es / th / vi / zh-TW` の `sfhistory.*` 46キーは**ネイティブレビュー未実施**
  (実装担当の自己申告。ja/en のみ正)。**公開前にユーザー確認が要る**
- スクリーンショットは取得できなかった(Browser ペインが非表示で compositing されないため)。
  DOM・ネットワーク・計算値での検証で代替した
