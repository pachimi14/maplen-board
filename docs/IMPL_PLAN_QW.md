# IMPL_PLAN_QW — v1 フォールバック除去 + 明確なエラー表示(web のみ)

> クイックウィン。承認者: ユーザー(スコープ確定 2026-07-14)/ 実装: implementer
> 前提訂正の経緯: DECISION_LOG **LULU-015**(v1 の完全廃止=配信停止は T12 に合流。QW は web のみ)

## 0. 目的と背景

- 北極星への寄与: v2 取得失敗時に旧 v1(62MB)へ黙ってフォールバックして**欠陥を隠す**経路を断ち、利用者に**明確なエラー**を出す(v2 リグレッションを隠さない/モバイルで 62MB を掴ませない)。
- 参照決定: LULU-006(v1 廃止方向)/ LULU-015(QW スコープ)/ LULU-007(i18n 6言語)
- スコープ確定(ユーザー): v1 フォールバック削除 / v2 失敗時に v1 を取得しない / 明確なエラー表示 / 文言は6言語(**既存キーが揃っているため追加不要・配線のみ**)/ **v1 の生成・Pages配信・bot 復旧用途は維持** / **main.py・workflow は変更しない**

## 1. スコープ

### 触るファイル(web のみ)
- `exp_ranking/web/src/board/useRankingBoard.js` — 取得候補から v1 を削除
- `exp_ranking/web/src/App.jsx`(`AppShell`)— 失敗時のエラー表示を明確化
- `exp_ranking/web/src/components/BoardHeader.jsx` — 生の `loadError` 文字列描画(未翻訳)を除去

### 触ってはいけないもの
- `main.py` / bot 一式 / `.github/workflows/**`(=v1 の生成・配信・DB復旧は現状維持。LULU-015)
- 旧 `data/rankings.json` 自体(削除しない・配信も止めない)
- i18n: **新規キー追加は不要**(`app.loadErrorTitle`/`app.loadErrorHint` は6言語に既存)。既存キーの文言は変更しない

## 2. 変更内容(具体)

1. **v1 フォールバック削除**(`useRankingBoard.js:206`):
   ```
   const candidates = ["data/v2/rankings.json", "data/rankings.json"];
   ```
   → v2 のみに:
   ```
   const candidates = ["data/v2/rankings.json"];
   ```
   ループ構造は維持してよい(候補1件でも動く=最小差分)。v2 が ok でない/`characters` が配列でない場合は従来どおり catch → `setLoadError("unavailable")` → `characters=[]`。**v1 を取得しない**。

2. **明確なエラー表示**(`App.jsx` の `AppShell`、`!characters.length` 画面):
   現状 `loadError ? t("app.updateNotice") : (noDataTitle/noDataHint)` の**エラー分岐を差し替え**、`loadError` 時は明確なエラーを出す:
   ```
   {loadError ? (
     <>
       <p className="font-semibold">{t("app.loadErrorTitle")}</p>
       <p className="text-sm text-slate-400 mt-1">{t("app.loadErrorHint")}</p>
     </>
   ) : (
     <>
       <p className="font-semibold">{t("app.noDataTitle")}</p>
       <p className="text-sm text-slate-400 mt-1">{t("app.noDataHint")}</p>
     </>
   )}
   ```
   (`updateNotice` は「更新中」の曖昧表現なので失敗表示には使わない。`updateNotice` キー自体は削除しない=他用途があれば残す)

3. **生 loadError 文字列の除去**(`BoardHeader.jsx:14`):
   `{loadError ? <p ...>{loadError}</p> : null}` は未翻訳の生文字列("unavailable")を描画する。v2 のみになると loadError 時は `characters` 空でヘッダー自体が描画されない(=死経路)ため、**この行を削除**(生文字列の漏れを断つ)。他の表示・レイアウトは不変。

## 3. 変わってよい・いけない

- 変わってよい(意図した挙動変更): v2 失敗時の表示が「更新中」→「明確なエラー(loadErrorTitle/Hint)」に。v2 失敗時に v1 を**取得しなくなる**
- 変わってはいけない: v2 が正常配信されている通常時の表示・挙動(一覧・詳細・フィルタ等すべて)。i18n 既存キーの文言。BoardHeader のレイアウト(loadError 行以外)

## 4. 受け入れ基準

| # | 基準 | 目標 | 測定 |
|---|------|------|------|
| 1 | ビルド | 成功 | `cd exp_ranking/web && npm run build` |
| 2 | 通常時(v2あり) | 現状どおり全機能動作 | ローカル dev で目視 |
| 3 | v2 失敗時 | **v1 を取得しない**(Network に `data/rankings.json` へのリクエストが出ない)+ 明確なエラー表示 | dev で `public/data/v2` を一時退避 → Network タブ + 画面 |
| 4 | 新規 Console Error | 0(現状比増加なし) | dev コンソール |
| 5 | 6言語 | エラー文言が各言語で翻訳表示(生キー/生"unavailable"漏れなし) | 言語切替で spot check |

## 5. 停止条件

- v1 を候補から外すと通常時の取得が壊れる構造が判明(想定外)
- エラー分岐の差し替えで既存の no-data(正常な空)表示が壊れる
- スコープ外(main.py/workflow/bot)の変更が必要になった

## 6. コミット分割

1. v1 フォールバック削除(`useRankingBoard.js`)
2. エラー表示の明確化(`App.jsx`)+ 生文字列除去(`BoardHeader.jsx`)

各コミット後 `npm run build` 成功を確認。`git add -A` 禁止・個別 add・`git diff -w`。

## 7. 検証コマンド

```
cd exp_ranking/web && npm run build
# ローカル: run_local_dev.bat 相当 or npm run dev。v2失敗時検証は public/data/v2 を一時退避
git diff -w -- exp_ranking/web/src/board/useRankingBoard.js exp_ranking/web/src/App.jsx exp_ranking/web/src/components/BoardHeader.jsx
```

## 8. ロールバック

- 各コミット単独 revert 可。v1 配信は維持しているため、revert すれば従来のフォールバック挙動へ即戻せる。

## 9. 完了報告テンプレ

- 実施コミット(ハッシュ・件名)
- 受け入れ基準の実測(ビルド、v2失敗時に v1 リクエストが出ないこと、エラー表示、6言語 spot check、コンソール)
- 残課題・watch-item
