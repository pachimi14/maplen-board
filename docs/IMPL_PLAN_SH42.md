# IMPL_PLAN_SH42 — タブ再編 / 装備の引き継ぎ / 見出しの削除

前提: SH-41 完了(未 push)。**作業ツリー**: `C:\Users\pachi\Desktop\msu ranking`(`main`)。

**ユーザー指示 2026-08-22**:
> タブを **Enhance History / New Equipment** とし、さらにその中で **SF と Cube をタブで選択**できるようにしたい。
> このとき、**対象の装備はリセットせず引き継ぎたい**
> (切り替える際はほとんどの場合目的の装備を開いており、リセットされると検索し直しになるため)。
> また、SF History を開いた時の **Enhance History という見出しタイトルは不要**。

**本スライスは構造とナビゲーションのみ。キューブの重ね描きは次スライス(SH-43)。**

## 1. A — タブの2階層化

```
現在:  [SF History] [New Equipment] [Cube Prices]      ← 3つ横並び
変更後: [Enhance History] [New Equipment]              ← 上位
          └ [SF] [Cube]                                ← Enhance History の中
```

- **★ルートを変えない**(公開済み URL):
  - `#/starforce` = Enhance History / SF
  - `#/starforce/cube-prices` = Enhance History / Cube
  - `#/starforce/discovery` = New Equipment
- **上位タブ `Enhance History` は、SF と Cube のどちらにいても選択状態**になること
- **現在地が2階層とも一目で分かる**こと(`aria-current` / `aria-selected` を適切に)
- タブ名は**6ロケールとも英語のまま**(既存方針。SH-30)

## 2. B — ★装備の引き継ぎ

**SF ⇄ Cube を切り替えても、選択中の装備が保持される。**

- **ユーザーの理由をそのまま実装意図とする**: 切り替え時にリセットされると、
  **同じ装備を検索し直す**ことになる
- **New Equipment との間でも保持してよい**が、**New Equipment は監視対象の3件しか無い**ので、
  **保持した装備がそちらに無い場合は従来どおりの初期選択にフォールバック**すること
  (**画面が壊れない**。SH-26 の性質)
- **保持の手段は実装担当の裁量**。ただし:
  - **URL を変えない**(クエリを足す場合も、**既存 URL がそのまま動く**こと)
  - **リロードをまたぐ必要は無い**(タブ切り替えの間だけ保てばよい)
  - **`#/starforce` を直接開いたときの初期選択は従来どおり**(SH-26: Arcane Umbra Staff)
- **星範囲・期間タブ・キューブ種の選択も引き継げるなら引き継ぐ**(裁量)。
  **ただし装備の引き継ぎを壊さないこと**が優先

## 3. C — 見出しの削除

`SfHistoryRoot.jsx:229` の `<h1>{t("sfhistory.pageTitle")}</h1>` を**要素ごと削除**。

- **タブに `Enhance History` と出るので重複**(New Equipment / Cube Prices で既に同じ整理をした)
- **未使用になったロケールキーを6ロケールとも削除**する
- **説明文は残す**

## 4. スコープ

**変更してよい**:
- `exp_ranking/web/src/sfhistory/`(`SfHistoryTabs.jsx` / 各 Root / 共有状態)
- `exp_ranking/web/src/board/useHashRoute.js`(**必要な場合のみ・既存分岐は変えない**)
- `exp_ranking/web/src/App.jsx`(**分岐の配線のみ**)
- `exp_ranking/web/src/i18n/locales/*.json` — **6ロケール同時**
- `exp_ranking/web/src/sfhistory/sfhistory.css`
- 各テスト / `docs/reports/SH42_*.md`

**触らないもの**(1つでも触れたら停止):
- **`server/` 配下すべて**
- **既存3ルートの文字列**
- **`starforce.js`** / **統計の道具**(`series.js` / `weekdayStats.js` / `chartColumns.js`)
- **チャート・ヒートマップの描画規則**(破線・現在セルの枠・網掛け)
- **契約テストの厳格さ**(`contract.test.js` を緩めない)
- `src/pages/` / `src/components/` / `src/taskManager/` / **raffle 関連すべて**
- `package.json` / **VPS**

## 5. 受け入れ基準

- **(a)** 上位タブが **`Enhance History` / `New Equipment`** の2つ
- **(b)** `Enhance History` の中に **`SF` / `Cube`** の下位タブ
- **(c) ★ルートが3つとも不変**(`#/starforce` / `#/starforce/cube-prices` / `#/starforce/discovery`)
- **(d) ★SF ⇄ Cube で装備が保持される**。**実機で確認して報告**
  (例: Arcane Umbra Staff を選んで Cube に切り替え → 同じ装備のままであること)
- **(e)** New Equipment に無い装備を持ったまま New Equipment に行っても**壊れない**
- **(f)** `#/starforce` を直接開いたときの初期選択が**従来どおり**(SH-26)
- **(g)** SF ページに **`Enhance History` の見出しが出ない**。説明文は残る
- **(h)** 未使用ロケールキーが残っていない(6ロケールのキー数一致)
- **(i)** 375px で**ページ本体が横スクロールしない**(2階層のタブを含めて)
- **(j)** `npm run test` 全緑 / `npm run build` 成功 / **`server/` の差分ゼロ**
- **(k) ★既存機能の回帰ゼロ**: SF の統計・チャート・ヒートマップ、New Equipment、
  Cube Prices の表示が**すべて従来どおり**

## 6. 停止条件

1. **ルートを変えないと2階層タブが実現できない**
2. **装備の引き継ぎを入れると初期選択(SH-26)が壊れる**
3. §4 の「触らないもの」に触る必要が生じた / 新規依存が必要になった

## 7. コミット

- **A / B / C を別コミット**。**`git push` 禁止**。**`git add -A` 禁止**。

## 8. 完了報告テンプレ

```
## SH-42 完了報告
- コミット: <hash>(A/B/C 各1行)
- (a)(b) 2階層タブ
- (c) ★ルート不変
- (d) ★装備の引き継ぎ(実機確認)
- (e)(f) フォールバック / 初期選択
- (g)(h) 見出し削除 / ロケール
- (i) 375px
- (j) test / build / server 差分ゼロ
- (k) ★回帰ゼロ
```
