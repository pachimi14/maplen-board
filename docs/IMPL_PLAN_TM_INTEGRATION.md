# IMPL_PLAN_TM_INTEGRATION — Task ManagerをLulumi-Tools本体SPAへ統合する

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー / 実装: Codex

## 0. 目的と背景

- 北極星への寄与: EXPランキングに加えて、今日のタスク・予定・イベント期限・EXP進捗を同一サイトで確認できる「毎朝開く入口」をLulumi-Tools本体へ追加する。
- 参照する決定: DECISION_LOG LULU-005/007/008/024/040/041/042/052/053、LT-Taskmanager `docs/DECISION_LOG.md` TM-001〜063、`docs/IMPL_PLAN_TM.md` C-1〜C-7。
- 採用方式: 別成果物のiframe/二重SPAではなく、独立版のドメイン・保存・画面コードを `exp_ranking/web` のReact SPAへ移植し、本体router/ProfileContext/I18nContextへ接続する（LULU-053の推奨B）。

## 1. スコープ

### 触るファイル

- `exp_ranking/web/src/board/useHashRoute.js` とテスト: `#/dashboard`・`#/tasks`・`#/schedule` を追加。
- `exp_ranking/web/src/App.jsx`: ランキング画面を既存のまま維持し、TM 3画面を追加合成。
- `exp_ranking/web/src/i18n/locales/{ja,en,es,th,vi,zh-TW}.json`: 新規UIキーを6言語同時追加。
- `exp_ranking/web/src/taskManager/**`: 独立版から移植する純粋関数、storage port、hooks、components、pages、静的テンプレート。
- `exp_ranking/web/src/index.css`: TM専用スタイルを明示的な名前空間内で追加。
- `exp_ranking/web/vitest.config.js`（必要な場合のみ）: 移植テストの検出対象を追加。
- 本計画書および `docs/DECISION_LOG.md`: 統合事実と裁定を追記。

### 触らないもの

- ランキング取得・順位計算・既存ランキング/キャラ詳細/グループ比較の挙動。
- `msu_exp_ranking_*` の既存お気に入り・グループ保存形式。
- GitHub Actions、ランキングDB、bot、VPSのデプロイ設定。
- 独立版LT-Taskmanagerの本番停止・削除。
- 新規npm依存の追加。

## 2. 正の所在と統合境界

- キャラ: 本体 `ProfileContext` / `maplen-board-profile-v1` が正。独立版 `useProfileStore` は移植せず、historyKeyだけを接続する。
- ランキング値: 本体 `BoardContext` が正。TM保存領域へ複製しない。ランキング/VPS障害時もタスク・予定・メモを利用可能にする。
- タスク・予定・Dashboard設定・イベント: 既存 `maplen-board-tasks-v1` / `maplen-board-schedule-v1` / `maplen-board-dashboard-v1` / `maplen-board-events-v1` を同一オリジンで読む。
- 通知・ライブEXP: `https://api.lulumi-tools.com` の既存APIを任意依存として利用する。VPS全落ちでもSPA本体を描画する。
- ルーティング: 本体routerを唯一の正とする。空hash/未知hashは既存ランキング一覧のままとし、独立版側の「Dashboardへ正規化」は本体統合時に採用しない。
- i18n: 本体I18nContextを唯一の正とし、独立版I18nContextは移植しない。

## 3. 変わってよいもの・いけないもの

- 変わってよい:
  - 共通ヘッダーにランキング・Dashboard・タスク管理・スケジュールへの導線が追加される。
  - 上記3ハッシュルートでTM画面が表示される。
  - 同一オリジンの既存 `maplen-board-*` をTM画面が読み書きする。
- 変わってはいけない:
  - `#/`、`#/character/:historyKey`、`#/group` のURL・戻る/進む・query保持・表示結果。
  - ランキングデータが0件/取得失敗でもTMのタスク・予定・メモ画面は表示できること。
  - ProfileContextの最大3体、primary補正、未知version非破壊、save-then-commit契約。
  - API障害がサイト全体の描画失敗へ波及しないこと。
  - 現在の独立版localStorageはオリジンが異なるため自動移行されたように扱わないこと。

## 4. 受け入れ基準（数値で）

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | 本体テスト | 既存+移植テスト100%成功 | `npm test` |
| 2 | 本体ビルド | 1回で成功 | `npm run build` |
| 3 | 既存route回帰 | list/detail/groupの既存routeテスト失敗0件 | `useHashRoute.test.js` |
| 4 | TM route | dashboard/tasks/schedule各1件以上+未知hash=listのテスト成功 | route単体テスト |
| 5 | i18n | 新規キーの6ロケール欠落0件 | カタログ検証テスト |
| 6 | localStorage契約 | TMの書込み先がtasks/schedule/dashboard/events/profileの5キー以外0件 | grep+storageテスト |
| 7 | profile互換 | 独立profile storeの本体bundle混入0件、historyKey以外のキャラ識別0件 | import/コード検査+テスト |
| 8 | API障害耐性 | live EXP/通知APIを失敗させても3画面の描画例外0件 | mock失敗テスト+実機 |
| 9 | 主要表示幅 | 1280×720、390×844の2幅で操作不能な横はみ出し0件 | ローカル実機 |
| 10 | Console | 3画面初回表示・画面切替・戻る進むで新規error 0件 | ブラウザ実機 |

## 5. 停止条件

- 本体ProfileContext契約を変更しないと2キャラ表示を実現できない。
- 既存routeのURL/query/戻る進むを壊さないとTM routeを追加できない。
- 6言語の意味を確定できず、機械的な直訳ではユーザーへの約束を変える文言がある。
- 同一オリジンへ移しただけで別オリジンの試用データが自動移行できる、という前提が必要になる。
- スコープ外のworkflow/VPS/DB変更が必要になる。
- 受け入れ基準の未達が2回の試行で解消しない。

## 6. コミット分割

1. `docs: plan Task Manager integration`: 本計画と移植境界を固定（挙動不変）。
2. `refactor: import Task Manager core`: 純粋関数・保存port・静的データ・テストを移植（既存UI挙動不変）。
3. `feat: add Task Manager routes`: 本体routerへ3routeを追加し、空/未知hash=listを維持。
4. `feat: integrate Task Manager pages`: 本体ProfileContext/BoardContext/I18nContextと画面を接続。
5. `i18n: complete Task Manager locales`: 6言語カタログと完全性テストを追加。
6. `fix: complete Task Manager integration QA`: 2画面幅・API失敗・戻る進むの検収で見つかった統合差分のみ修正。

## 7. 検証コマンド（コミットごと）

```powershell
cd "C:\Users\pachi\Desktop\msu ranking\exp_ranking\web"
npm test
npm run build
git diff -w -- <touched files>
```

最終検収ではローカルdev serverで `#/`、`#/character/:historyKey`、`#/group`、`#/dashboard`、`#/tasks`、`#/schedule` を開き、戻る/進む、API失敗、1280×720、390×844を確認する。

## 8. データ移行

- 独立版と `lulumi-tools.com` は別オリジンなのでlocalStorageは自動移行しない。
- 統合ブランチの機能完成後、独立版のバックアップJSONをエクスポートし、本番同一オリジンで1回インポートする。
- 自動handoffやサーバー保存は本計画に含めない。試用者が増えて手動移行が現実的でなくなった場合だけ別計画にする。

## 9. ロールバック

- コミット2は未配線のため単独revertで既存挙動に影響しない。
- コミット3〜5を逆順revertすれば既存ランキング3routeだけへ戻る。
- 新規 `maplen-board-*` はrevert後も削除せず保持するため、ユーザーデータを失わない。
- APIサービスは静的SPAと独立しており、フロント統合をrevertしても停止不要。

## 10. 完了報告テンプレ

- 実施コミット（ハッシュ）:
- 受け入れ基準の実測値（#1〜#10）:
- 検証コマンド出力の要点:
- C-1〜C-7遵守:
- 独立版データ移行結果:
- 残課題・watch-item:
