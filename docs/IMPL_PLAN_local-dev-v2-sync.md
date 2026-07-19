# IMPL_PLAN — ローカル dev の v2 同期対応(run_local_dev.bat を使えるように)

> 承認者: ユーザー(2026-07-14)/ 実装: implementer / 参照: DECISION_LOG LULU-020・LULU-015・LULU-006
> **dev ツールのみ**。main.py・本番パイプライン・web src・workflow には触れない。

## 0. 目的

QW 以降アプリは v2 のみを使う(v1 フォールバック撤去)。しかし `sync_rankings_from_pages.py` は v1 を取得しローカル v2 を削除するため、通常の `run_local_dev.bat` がエラー画面になる。sync を **v2 同期**に作り替えて `run_local_dev.bat` を通常運用で使えるようにする。

## 1. スコープ

### 触るファイル
- `exp_ranking/bot/sync_rankings_from_pages.py` — v2 summary + 全シャード取得に作り替え
- `run_local_dev.bat` — `--no-sync` の存在チェックを v2 summary に変更
- `run_local_preview.bat` — 同上(同じ v1 依存があるため併せて修正)

### 触ってはいけないもの
- `main.py` / 本番取得・エクスポート・復旧ロジック / `.github/workflows/**` / `mvp_export.py` / web `src/` / 本番の v1 生成・配信(T12 まで維持)
- 既存の bot テスト対象ロジック(このスクリプトは本番パイプライン外の dev ツール)

## 2. 実装内容

### 2.1 `sync_rankings_from_pages.py`(v2 化)
- 既定 URL を **v2 summary** `https://lulumi-tools.com/data/v2/rankings.json` に
- 出力先 `exp_ranking/web/public/data/v2/rankings.json`
- summary を取得・保存後、その `meta.historyBasePath`(例 `history/2026-07-13`)と `meta.historyShardCount`(例 64)を読み、**全シャード** `.../data/v2/<historyBasePath>/shard-NN.json`(NN=2桁ゼロ埋め, 0..count-1)を取得 → `public/data/v2/<historyBasePath>/shard-NN.json` に保存
- **古い日付の history ディレクトリを掃除**(`public/data/v2/history/` 配下の、今回取得した basePath 以外の日付ディレクトリを削除)して蓄積を防ぐ
- **v1 取得と「v2 削除」ロジックは撤去**(旧コードの v1 ダウンロード・v2 rmtree を削除)
- エラー処理: summary 取得失敗は `return 1`(明確なエラー)。個別シャード失敗は warning を出して継続し、末尾に「取得 ok/fail 数」を表示。`--url`/`-o` の argparse は維持してよい(既定を v2 に)
- `demoGains` 警告など既存の有用な出力は維持
- ネットワークは `requests`(既存依存)。逐次取得で可(進捗を軽く print)

### 2.2 `run_local_dev.bat`
- `set "JSON=...\public\data\rankings.json"`(v1)を **`...\public\data\v2\rankings.json`**(v2 summary)に変更
- `--no-sync` の存在チェック(`if not exist "%JSON%"`)が v2 summary を見るようにする
- 通常起動(sync あり)は sync スクリプト(v2 化済み)を呼ぶだけなので他は不変。echo 文言の「rankings.json」表記は必要に応じて調整可

### 2.3 `run_local_preview.bat`
- 同じ v1 参照(`JSON=...rankings.json`・存在チェック)を v2 summary に変更

## 3. 変わってよい・いけないもの

- 変わってよい: ローカル同期が v1→v2 になる / bat の存在チェック対象
- 変わってはいけない: 本番配信・生成、main.py、web の挙動、workflow。**vite の dev/preview 起動方法・ポート(5173/4173)は不変**

## 4. 受け入れ基準

| # | 基準 | 測定 |
|---|------|------|
| 1 | sync 実行で v2 一式が揃う | `python exp_ranking/bot/sync_rankings_from_pages.py` → `public/data/v2/rankings.json` + `<basePath>/shard-00..63.json` が生成、古い日付 dir が残らない |
| 2 | 通常 `run_local_dev.bat`(sync あり)でアプリが正常表示 | 起動 → http://localhost:5173/ で一覧が出る(**エラー画面にならない**)・キャラ詳細の履歴チャートが出る |
| 3 | `run_local_dev.bat --no-sync` も動く | v2 summary 存在チェックを通過し起動 |
| 4 | v1 を要求しない | v1 `rankings.json` が無くても sync・起動が成功 |
| 5 | bot テスト非回帰 | `cd exp_ranking/bot && python -m pytest`(このスクリプトは対象外だが import 破損等がないこと) |

## 5. 停止条件

- v2 summary/シャードの取得が本番 URL 構成と合わない(パス規則が想定と違う)
- スコープ外(main.py/workflow/mvp_export)の変更が必要になった

## 6. コミット分割

1. `sync_rankings_from_pages.py` の v2 化
2. `run_local_dev.bat` / `run_local_preview.bat` の v2 参照化

各コミット後、可能なら sync を実走させて確認。`git add -A` 禁止・個別 add・`git diff -w`。**push しない**。

## 7. 検証コマンド

```
python exp_ranking/bot/sync_rankings_from_pages.py    # v2 一式が揃うか
ls exp_ranking/web/public/data/v2/rankings.json
find exp_ranking/web/public/data/v2/history -name "shard-*.json" | wc -l   # = historyShardCount
cd exp_ranking/bot && python -m pytest
# 通常 run_local_dev.bat で起動しエラー画面にならないこと(統括が実機確認)
git diff -w -- exp_ranking/bot/sync_rankings_from_pages.py run_local_dev.bat run_local_preview.bat
```

## 8. ロールバック

- 各コミット単独 revert 可。dev ツールのみのため本番・アプリに非影響。

## 9. 完了報告テンプレ

- 実施コミット(ハッシュ・件名)
- sync 実走結果(summary + シャード数 = historyShardCount、古い dir 掃除の確認)
- v1 不要でも成功することの確認
- pytest 結果
- 統括の実機確認向け watch-item(通常 run_local_dev.bat 起動)
