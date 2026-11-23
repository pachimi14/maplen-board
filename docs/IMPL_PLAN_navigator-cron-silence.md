# IMPL_PLAN_navigator-cron-silence — Navigator の cron 1本(JST 10:00)を静音化し、Release への `--clobber` 上書き経路を閉じる

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー(2026-11-23「止める」) / 実装: implementer
> **本計画は「取得スケジュールの変更」= ユーザー専権事項であり、承認済み。**
> 承認範囲は **`maplen-board-navigator.yml` の cron 1本のみ**。`LULU-152` で静音化した
> Pages 4本 / Retry 5本は**既に別コミット(`20cb7d7`)で完了済み**であり、本計画では触らない。

## 0. 目的と背景

- 北極星への寄与: PC が取った当日データが **Release から消えない**こと。公開された当日分が
  翌朝も残っていることは「毎朝見れば今日の分がある」の前提そのもの。
- 参照する決定: DECISION_LOG **LULU-152**(cron 静音化・スコープ外項目②としてこの cron を記録)
  / **LULU-151**(PC 定時実行が主系) / **LULU-150**(公式 403) / **T12 P3**(Release Asset が唯一の恒久ストア)
- 背景(実測と構造):
  - Navigator は**公式ランキング API を叩かない**ので、403 の原因でも被害者でもない。
    止める理由は 403 ではなく、**以下2つの構造**。
  - ① **同じ concurrency group を共有する**(`group: maplen-board-pages`,
    `cancel-in-progress: false`)。PC が公開のために投げる `workflow_dispatch` と競合しうる。
    LULU-152 で、この group の占有が実際に dispatch を **41分** 待たせた実測がある。
  - ② **末尾で Release へ `--clobber` upload する**(`Persist ranking.db to Release store`)。
    Navigator は走り始めに Release を復元するため、**PC の Release 書込が「Navigator の復元より後・
    upload より前」に挟まると、Navigator が持っていない当日分が Release から消える**。
    PC 側 `release_store.sync_db_to_release` は union マージだが、union を取る相手は
    **自分がダウンロードした時点の Release** なので、後から上書きされれば守れない。
  - ③ **この cron は PC 主系では常に冗長**。Navigator は Pages 成功時に `workflow_run` で必ず走り、
    PC の公開 dispatch も Pages を起動するため、`workflow_run` 経路だけで毎日起動する。
    cron はその「Pages が走らなかった日」のための保険であり、PC 主系ではその日は存在しない。

## 1. スコープ

- 触るファイル(**この1つだけ**):
  - `.github/workflows/maplen-board-navigator.yml` — `on.schedule`(コメント1行 + `- cron: "0 1 * * *"`)
- 触らないもの(明示):
  - `.github/workflows/maplen-board-pages.yml` / `lulumi-ranking-retry.yml` — **既に静音化済み**。差分0行。
  - Navigator の `on.workflow_run` / `on.workflow_dispatch` / `concurrency` / `permissions` /
    `jobs` 以下のすべての step・env・`if:` 式・`outputs`
  - bot のコード一切(`main.py` の取得ロジック = LULU-004 不触)、`daily_fetch.py`、`ops/*`、
    web 側一切、`requirements.txt` / `package.json`

## 2. 変わってよいもの・いけないもの

### 2.1 変わってよい

- Navigator が **`schedule` イベントで起動しなくなる**こと。
- `build` ジョブの `if:` にある `github.event_name == 'schedule'` 分岐が **到達不能になる**こと。
  これは**意図した副作用**であり、`if:` 式自体は変更しない(式を変えると復旧時の差分が増え、
  Retry で同じ判断をした LULU-152 と不整合になる)。

### 2.2 変わってはいけない

- `on.workflow_run`(`workflows: ["MapleN Board Pages"]` / `types: [completed]` /
  `branches: [main, master]`)の定義。**これが Navigator の主経路**であり、
  ここを壊すと Navigator が毎日走らなくなる。
- `on.workflow_dispatch`(手動救出の入口)。
- `concurrency.group` / `cancel-in-progress` / `permissions`。
- `build` / `commit-db` / `backup-gdrive` の `if:` 式と `needs` と `outputs`。
- `Persist ranking.db to Release store` step(本計画は**この step の挙動ではなく起動契機だけ**を変える)。
- YAML の構文的妥当性。**`schedule:` を空リストにして残してはならない**
  (空の `schedule:` は GitHub のスキーマ違反になりうる)。

### 2.3 実装方法(削除ではなくコメントアウト)

`schedule:` キーごとコメントアウトする。理由は LULU-152 と同じで、**復旧が「`#` を外す」の
1アクションになる**こと、および **`# Backup if Pages workflow_run did not fire (JST 10:00)` という
意図コメントが cron 行に張り付いたまま残る**こと(cron 行を消すとコメントだけが浮いて意味を失う)。

コメントアウトしたブロックの直前に、以下の復旧ヘッダを**この文面のまま**置く:

```
  # === 静音化中(DECISION_LOG LULU-152、2026-11-23)===
  # この cron は Pages の workflow_run が発火しなかった日の保険だが、PC 定時実行(LULU-151)が
  # 主系になった環境では常に冗長で、かつ害がある: (a) `concurrency: maplen-board-pages` を
  # 共有するため PC の公開 dispatch を待たせる (b) 末尾で Release へ `--clobber` upload するため、
  # PC の Release 書込がこの run の復元より後・upload より前に挟まると当日分が Release から消える。
  # 復旧手順: PC 主系をやめて GitHub 側の cron 起動に戻すときに、下の `schedule:` ブロックの
  # `#` を外すだけで元に戻る。
  # 取得スケジュールの変更はユーザー専権事項 — 復旧も必ずユーザーの指示を待つ。
```

> インデントに注意: `on:` 直下のキーと同じ **2スペース**で始めること(`# ===` の前に2スペース)。

## 3. 受け入れ基準(数値。実装担当は全項を自分で実測して報告する)

| # | 基準 | 判定方法 |
|---|---|---|
| 1 | Navigator の**有効 cron が 0本** | `on.schedule` が存在しないこと(下の検証スクリプト) |
| 2 | Pages / Retry の**有効 cron も 0本のまま**(回帰なし) | 同スクリプト |
| 3 | `yaml.safe_load` 成功、`on` キーが **`{workflow_run, workflow_dispatch}` の2つだけ** | 同スクリプト。**空の `schedule:` が残っていないこと**を含む |
| 4 | `on.workflow_run` の `workflows` / `types` / `branches` が**変更前と完全一致** | 同スクリプト |
| 5 | **`git show -w` の変更行のうち、コメント行・`- cron:` 行・`schedule:` 行以外が 0行** | `git diff -w` を目視でなくフィルタで数える |
| 6 | **Pages / Retry / bot / web の差分が 0行** | `git diff --stat` が Navigator 1ファイルのみ |
| 7 | bot のテストが**全緑**(現状 259 passed, 1 skipped) | `python -m pytest` |
| 8 | web build 成功 | `npm run build` |
| 9 | **コミット済み blob の CRLF が 0行** | 下の検証コマンド(作業ツリーは `core.autocrlf=true` で CRLF、index は LF が正) |

## 4. 停止条件(該当したら実装を止めて統括に報告する)

- `on.schedule` をコメントアウトすると YAML として壊れる/`workflow_run` 以下の構造に手を入れる
  必要が出た場合。
- `git diff -w` にコメント行・cron 行・`schedule:` 行**以外**の変更が1行でも現れた場合。
- bot テストが1件でも落ちた場合、web build が失敗した場合。
- Navigator 以外のファイルを変更する必要があると判断した場合。
- **`git push` が必要だと判断した場合**(**push はユーザー専権。実装担当は push しない**)。
- `schedule` 起動を前提にしたコード・テスト(`event_name == 'schedule'` に依存する assert 等)が
  見つかった場合 — **式は変えずに停止報告**すること。

## 5. コミット

**単独コミット1本**。`git add -A` は禁止、`.github/workflows/maplen-board-navigator.yml` のみ個別 add。

```
ops(ci): silence the Navigator JST 10:00 cron while PC fetch is primary (LULU-152)
```

本文に ① 止めた cron 1本 ② 理由(group 共有 + Release `--clobber` の消失経路 + workflow_run で冗長)
③ 復旧は `#` を外す1アクション、を書く。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

## 6. 検証コマンド(実装担当はこの出力を報告に貼る)

```bash
cd "C:/Users/pachi/Desktop/msu ranking"

# 基準 1〜4: 有効 cron 数 と on キー
python - <<'PY'
import yaml
for f in ("maplen-board-navigator","maplen-board-pages","lulumi-ranking-retry"):
    d = yaml.safe_load(open(f".github/workflows/{f}.yml", encoding="utf-8"))
    on = d.get("on", d.get(True))
    sch = (on or {}).get("schedule")
    print(f, "| on keys:", sorted((on or {}).keys()), "| schedule:", sch,
          "| crons:", 0 if not sch else len(sch))
    wr = (on or {}).get("workflow_run")
    if wr: print("   workflow_run:", wr)
PY

# 基準 5: コメント/cron/schedule 以外の変更行が 0 であること
git show -w --format= -- .github/workflows/maplen-board-navigator.yml \
  | grep -E '^[+-]' | grep -v '^[+-][+-]' \
  | grep -vE '^[+-][[:space:]]*#' | grep -vE '^[+-][[:space:]]*- cron:' \
  | grep -vE '^[+-][[:space:]]*schedule:' | cat -A

# 基準 6
git show --stat --format= HEAD

# 基準 9: コミット済み blob の CRLF
git show HEAD:.github/workflows/maplen-board-navigator.yml | grep -c $'\r' || echo "CRLF=0"

# 基準 7
cd exp_ranking/bot && python -m pytest -q

# 基準 8
cd ../web && npm run build
```

## 7. ロールバック

```bash
git revert <commit>
```

単独コミットなので revert 1本で cron が戻る。あるいは `schedule:` ブロックの `#` を外す
(§2.3 の復旧ヘッダがその手順を文書内に持っている)。**本番への影響はユーザーが push した後に初めて出る。**

## 8. 完了報告テンプレ

```
## 実装完了: IMPL_PLAN_navigator-cron-silence
- コミット: <sha> <subject>
- 受け入れ基準: #1〜#9 の実測値を1行ずつ(数値で)
- 検証コマンドの出力: そのまま貼る
- 計画からの逸脱: 無し / 有り(内容と理由)
- 停止条件への該当: 無し / 有り(内容)
```
