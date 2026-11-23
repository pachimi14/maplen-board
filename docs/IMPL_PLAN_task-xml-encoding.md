# IMPL_PLAN_task-xml-encoding — タスク XML の `encoding="UTF-8"` 宣言を外し、README の登録手順を実際に通る形にする

> 1計画書=1縦切りテーマ(PR-001)。発見者: 統括(登録実行時に実測) / 実装: implementer
> **本計画は挙動修正(ドキュメント+登録用アーティファクト)で、bot のコードには一切触れない。**

## 0. 目的と背景

- 北極星への寄与: 毎朝の取得を起動する**定時実行タスクを、書いてある手順どおりに登録できる**こと。
  手順が通らないアーティファクトは、次に環境を作り直すとき(PC 買い替え・OS 再インストール・別PC)に
  同じ時間を溶かす。
- 参照する決定: DECISION_LOG **LULU-151**(PC 定時実行を主系に) / **LULU-152**(cron 全停止でフォールバック0)
- **実測した欠陥**(統括が 2026-11-23 に登録を実行して発見):
  `exp_ranking/bot/ops/LulumiDailyFetch.xml` の1行目 `<?xml version="1.0" encoding="UTF-8"?>` のため、
  **文書化された登録コマンドが失敗する**。
  ```
  schtasks /create /tn LulumiDailyFetch /xml "...\LulumiDailyFetch.xml"
  → ERROR: The task XML is malformed. (1,40):: エンコードを切り替えることができません
  ```
  PowerShell 経路でも同じ:
  ```
  Register-ScheduledTask -TaskName ... -Xml (Get-Content -Raw -Encoding UTF8 ...)
  → The task XML is malformed. (1,40) / HRESULT 0x8004131a
  ```
  原因は Task Scheduler の XML が **UTF-16 前提**(API に渡る文字列は既に Unicode)で、
  `encoding="UTF-8"` の宣言と衝突すること。エラー位置 `(1,40)` は宣言の直後。
- **宣言を外すと通ることを統括が実測済み**: 宣言を除いた文字列を `Register-ScheduledTask` に渡して
  登録成功(`State=Ready` / `NextRunTime=2026/11/24 9:05:00`)。**本番タスクはこの形で現在稼働中**。
  つまり**リポジトリのファイルだけが、動いている実物と食い違っている**状態。

## 1. スコープ

- 触るファイル(**この2つだけ**):
  - `exp_ranking/bot/ops/LulumiDailyFetch.xml` — **1行目の XML 宣言を削除**
  - `exp_ranking/bot/ops/README.md` — 登録手順の修正(§2.3)
- 触らないもの(明示):
  - **登録済みの本番タスク `LulumiDailyFetch`**。これは現在 `Ready` / 次回 2026-11-24 09:05 で
    **明朝の取得を担っている**。**削除・無効化・再登録を一切してはならない**(§4 停止条件)。
  - `exp_ranking/bot/ops/daily_fetch.bat`、`daily_fetch.py`、bot のコード一切、
    `.github/workflows/*`、web 側一切、`production.env`

## 2. 変わってよいもの・いけないもの

### 2.1 変わってよい

- XML ファイルの**1行目(宣言)が無くなる**こと。
- README の登録コマンドと、登録を「user action」と限定していた記述。

### 2.2 変わってはいけない

- XML の **`<Task ...>` 以降が1バイトも変わらないこと**。トリガ3本(09:05 / 13:00 / 20:00)・
  `LogonType=InteractiveToken`・`RunLevel=LeastPrivilege`・`StartWhenAvailable`・`WakeToRun`・
  `MultipleInstancesPolicy=IgnoreNew`・`ExecutionTimeLimit=PT4H`・`Command`・`WorkingDirectory`
  はすべて現状維持。**これらは登録済み実物と一致している値**なので、変えると実物と乖離する。
- README の「Logs and failure signal」「When it fails」節の内容。
- 改行コード: XML は現在 **LF**。これを維持する(`git diff -w` で宣言行以外の差分0)。

### 2.3 実装方法

1. `LulumiDailyFetch.xml` の1行目 `<?xml version="1.0" encoding="UTF-8"?>` と、それに続く改行を**削除**する。
   ファイルは `<Task version="1.4" xmlns="...">` から始まる形になる。
   - **`encoding="UTF-16"` への書き換えではなく削除**を選ぶ理由: このファイルは**ASCII のみ**なので、
     宣言が無ければ `schtasks`(ファイル経路)と `Register-ScheduledTask`(文字列経路)の
     **両方で通る**。UTF-16 に書き換えるとファイル自体を UTF-16LE で保存する必要が生じ、
     git の差分が読めなくなる。
2. `README.md` の `## Register` 節を、**実際に通る手順**に直す。
   - 見出しの `(user action, once; run in a normal terminal)` → `(once; needs no admin rights)`。
     **実測**: `LogonType=InteractiveToken` / `RunLevel=LeastPrivilege` なので
     管理者権限もパスワードも不要(非管理者 `pachi\pachi` で登録成功)。
   - コマンドは `schtasks /create` のままでよい(宣言を外せば通る)。ただし**直後に検収の1行を足す**:
     ```
     Get-ScheduledTask -TaskName LulumiDailyFetch | Format-List State
     Get-ScheduledTaskInfo -TaskName LulumiDailyFetch | Format-List NextRunTime,LastTaskResult
     ```
   - **`encoding="UTF-8"` を書き戻してはならない理由を1行**残す(将来同じ罠を踏まないため)。
     例: `Do not add an <?xml ... encoding="UTF-8"?> declaration: Task Scheduler expects UTF-16 and
     fails with "The task XML is malformed. (1,40)".`

## 3. 受け入れ基準(数値。実装担当は全項を自分で実測して報告する)

| # | 基準 | 判定方法 |
|---|---|---|
| 1 | リポジトリの XML が **`schtasks /create` で実際に通る** | **テスト用の別名**で登録 → exit 0 を確認 → **必ず削除**(下のコマンド) |
| 2 | **本番タスクが無傷** | 検証の前後で `State=Ready` / `NextRunTime=2026/11/24 9:05:00` が不変 |
| 3 | XML の **`<Task` 以降のバイト列が変更前と完全一致** | 下の Python スニペット(**完全一致以外は不合格**) |
| 4 | XML の改行が **LF のまま**(CR 0バイト) | 同スニペット |
| 5 | 差分は **2ファイルのみ**、`git diff --stat` に他が出ない | `git show --stat` |
| 6 | bot のテストが**全緑**(現状 259 passed, 1 skipped) | `python -m pytest` |

## 4. 停止条件(該当したら実装を止めて統括に報告する)

- **本番タスク `LulumiDailyFetch` を削除・無効化・再登録する必要があると判断した場合** —
  明朝の取得を担っているので、**絶対に触らずに停止報告**すること。
- 宣言を削除しても `schtasks /create` が通らない場合(UTF-16LE 化など別案が必要 → 選択肢を添えて停止)。
- 基準 #3 が完全一致にならない場合(宣言以外に手が入った)。
- bot テストが1件でも落ちた場合。
- **`git push` が必要だと判断した場合**(**push はユーザー専権。実装担当は push しない**)。

## 5. コミット

**単独コミット1本**。`git add -A` は禁止、上記2ファイルのみ個別 add。

```
fix(ops): drop the UTF-8 declaration so the task XML actually registers (LULU-151)
```

本文に ① 症状(両経路で `(1,40)` エラー) ② 原因(Task Scheduler は UTF-16 前提) ③ 宣言削除を選んだ理由
④ 本番タスクは無変更、を書く。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

## 6. 検証コマンド(実装担当はこの出力を報告に貼る)

```powershell
# 基準 2(前): 本番タスクのベースライン
Get-ScheduledTask -TaskName LulumiDailyFetch | Format-List State
Get-ScheduledTaskInfo -TaskName LulumiDailyFetch | Format-List NextRunTime,LastTaskResult

# 基準 1: テスト用の別名で登録 -> exit 0 -> 削除(本番には触らない)
schtasks /create /tn LulumiDailyFetchXmlCheck /xml "C:\Users\pachi\Desktop\msu ranking\exp_ranking\bot\ops\LulumiDailyFetch.xml"
"EXIT=$LASTEXITCODE"
schtasks /delete /tn LulumiDailyFetchXmlCheck /f
Get-ScheduledTask -TaskName LulumiDailyFetchXmlCheck -ErrorAction SilentlyContinue  # 何も出ないこと

# 基準 2(後): 本番タスクが不変であること
Get-ScheduledTask -TaskName LulumiDailyFetch | Format-List State
Get-ScheduledTaskInfo -TaskName LulumiDailyFetch | Format-List NextRunTime,LastTaskResult
```

```bash
# 基準 3・4: <Task 以降が完全一致 / CR 0
cd "C:/Users/pachi/Desktop/msu ranking"
python - <<'PY'
import subprocess
new = open("exp_ranking/bot/ops/LulumiDailyFetch.xml","rb").read()
old = subprocess.run(["git","show","HEAD~1:exp_ranking/bot/ops/LulumiDailyFetch.xml"],
                     capture_output=True).stdout
i, j = new.find(b"<Task "), old.find(b"<Task ")
print("body identical:", new[i:] == old[j:])
print("declaration removed:", not new.lstrip().startswith(b"<?xml"))
print("CR bytes:", new.count(b"\r"))
PY

# 基準 5
git show --stat --format= HEAD

# 基準 6
cd exp_ranking/bot && python -m pytest -q
```

## 7. ロールバック

```bash
git revert <commit>
```

**登録済みの本番タスクには影響しない**(タスクは登録時点で OS 側に取り込まれており、
このファイルを読み続けているわけではない)。

## 8. 完了報告テンプレ

```
## 実装完了: IMPL_PLAN_task-xml-encoding
- コミット: <sha> <subject>
- 受け入れ基準: #1〜#6 の実測値を1行ずつ(数値で)
- 検証コマンドの出力: そのまま貼る
- 本番タスクの State / NextRunTime: 検証前と後の両方
- 計画からの逸脱: 無し / 有り(内容と理由)
- 停止条件への該当: 無し / 有り(内容)
```
