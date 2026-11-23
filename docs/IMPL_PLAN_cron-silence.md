# IMPL_PLAN_cron-silence — 403 環境で必ず失敗する GitHub cron を静音化し、PC 定時実行の dispatch を待たせない

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー(2026-11-23「cronを止める」) / 実装: implementer
> **本計画は「取得スケジュールの変更」= ユーザー専権事項であり、承認済み。** 承認範囲は
> **Pages の cron 4本と Retry の cron 5本**。Navigator の cron 1本は**本計画のスコープ外**(§1)。

## 0. 目的と背景

- 北極星への寄与: PC が取った当日データの**公開が待たされない**。毎朝 JST 10:00 までに
  サイトが当日分になることを構造的に守る(体感 = 「朝見れば今日の分がある」)。
- 参照する決定: DECISION_LOG **LULU-151**(PC 定時実行を主系に) / **LULU-150**(公式 403 の原因と範囲) /
  **LULU-139**(本計画が静音化する cron 冗長化そのものの決定) / `docs/IMPL_PLAN_local-daily-fetch.md`
- 背景(実測):
  - 公式ランキング API は **データセンター IP に 403**(GitHub ランナー・VPS ともに。LULU-150/151)。
    よって `schedule` 起動の Pages run は **100% 失敗する**。
  - Pages の cron は JST 5:07 に起動し **JST 9:05 まで待機しながら `concurrency: maplen-board-pages` を占有**する
    (`cancel-in-progress: false`)。PC が ~09:35 に投げる `workflow_dispatch` は**キューで待たされるか、
    後続 dispatch に差し替えられてキャンセルされる**。
  - Retry の cron は当日分が DB に 1000行未満なら **`force_fetch=true` で Pages を dispatch** する。
    403 の間はこれが**無駄な失敗 run を作り、同じ concurrency group を占有する**。
  - `daily_fetch.py` は再 dispatch(最大2回)で耐えるが、**耐えることと待たないことは別**。

## 1. スコープ

- 触るファイル(この2つだけ):
  - `.github/workflows/maplen-board-pages.yml` — `on.schedule` の cron 4本
  - `.github/workflows/lulumi-ranking-retry.yml` — `on.schedule` の cron 5本
- 触らないもの(明示):
  - `.github/workflows/maplen-board-navigator.yml` — **スコープ外**。cron `0 1 * * *`(JST 10:00)は
    同じ concurrency group を共有し Release へも書くが、**ユーザーの承認範囲外**であり、
    別判断として統括がユーザーに提示する(§2.4 に論点のみ記録)。
  - 両ワークフローの `on.push` / `on.workflow_dispatch` / `on.workflow_run` / `concurrency` /
    `permissions` / `timeout-minutes` / `jobs` 以下のすべての step と env
  - bot のコード一切(`main.py` の取得ロジック = LULU-004 不触)、`production.env`、`daily_fetch.py`、
    `ops/*`、web 側一切、`requirements.txt` / `package.json`

## 2. 変わってよいもの・いけないもの

### 2.1 変わってよい

- Pages / Retry が **`schedule` イベントで起動しなくなる**こと。
- Retry の `workflow_run`(Pages の `conclusion == 'failure' && event == 'schedule'`)経路が
  **到達不能になる**こと — Pages に schedule run が存在しなくなるため。これは**意図した副作用**であり、
  `if:` 式自体は変更しない(式を変えると復旧時の差分が増える)。

### 2.2 変わってはいけない

- `workflow_dispatch` の入力定義(`force_fetch` / `wait_for_update` の名前・型・既定値)。
  `daily_fetch.py` が `-f force_fetch=false -f wait_for_update=false` で叩くため。
- `on.push`(`exp_ranking/**` 等)の挙動。
- `concurrency.group` / `cancel-in-progress` / `permissions` / `timeout-minutes: 330`。
- `Fetch ranking and export JSON` step の `env` ブロック**全体**
  (`test_production_env_parity.py` がこの step をパースして `production.env` と突き合わせている。
  **1行でも触れたらこのテストの意味が変わる**)。
- YAML の構文的妥当性(`on.schedule` を空リストにして残してはならない。空の `schedule:` は
  GitHub のスキーマ違反になりうる)。

### 2.3 実装方法(削除ではなくコメントアウト)

cron 行は **削除せずコメントアウト**する。理由:

1. **復旧がワンアクションになる**。公式 API が復旧したら「`#` を外す」だけで LULU-139 の成果
   (4本化・24時間分散)がそのまま戻る。git 履歴から再導出する必要がない。
2. **根拠コメントが行に張り付いたまま残る**。LULU-109/LULU-139 で実測から導いた
   「20:07Z より前には増やせない」「分値7で混雑ピーク回避」という制約は、cron 行を消すと
   コメントだけが浮いて意味を失う(= 将来 cron を書き直す人が同じ失敗をする)。
3. `schedule:` キー自体も**まとめてコメントアウト**する(空リストを残さない)。

各ワークフローのコメントアウト部分の**直前**に、以下の形の復旧条件ヘッダを1つだけ入れる
(文言はこのとおり、日付・エントリIDも含めて):

```
  # === 静音化中(DECISION_LOG LULU-152、2026-11-23)===
  # 公式ランキング API がデータセンター IP に 403 を返すため(LULU-150)、schedule 起動の
  # run は 100% 失敗し、かつ JST 9:05 まで待機して concurrency group を占有して
  # PC 定時実行(LULU-151)の workflow_dispatch を待たせる。よって cron を一時停止する。
  # 復旧手順: 公式 API が GitHub ランナーから 200 を返すことを確認したら、下の `schedule:`
  # ブロックの `#` を外すだけで LULU-139 の冗長化(Pages 4本 / Retry 5本)がそのまま戻る。
  # 取得スケジュールの変更はユーザー専権事項 — 復旧も必ずユーザーの指示を待つ。
```

### 2.4 Navigator cron(スコープ外・統括がユーザーに提示する論点のみ)

実装担当は**触らない**。記録のみ:
`maplen-board-navigator.yml` の cron `0 1 * * *`(JST 10:00)は ① concurrency group
`maplen-board-pages` を共有し ② 末尾で Release へ `--clobber` upload する。PC の Release 書込が
Navigator の DL より後・upload より前に挟まると、その日のデータが Release から消える経路がある
(`sync_db_to_release` は DL 時点の Release との union をアップロードするため)。なお Navigator は
Pages 成功時に `workflow_run` で必ず走るので、この cron は「Pages が走らなかった日の保険」であり
PC 主系では常に冗長。判断はユーザー。

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | 両ワークフローの有効 cron 本数 | **0本**(Pages 0 / Retry 0) | `python -c` で YAML を読み `on.schedule` の有無と件数を出す(下記 §6) |
| 2 | YAML がパース可能 | 2ファイルとも成功 | §6 のパースコマンドが例外を出さない |
| 3 | `workflow_dispatch` 入力 | `force_fetch` / `wait_for_update` が両方存在し型 `boolean` | §6 のパース出力 |
| 4 | 実質差分の範囲 | **2ファイル・`on.schedule` 周辺のみ**。追加/削除されるのは cron 行とコメント行だけ | `git diff -w -- .github/workflows/maplen-board-pages.yml .github/workflows/lulumi-ranking-retry.yml` を全文確認 |
| 5 | 他ファイルの差分 | **0ファイル** | `git status --porcelain` が上記2ファイル + 本計画書以外を出さない |
| 6 | bot テスト | **259 passed / 1 skipped**(現状と同数) | `cd exp_ranking/bot && python -m pytest -q` |
| 7 | web ビルド | 成功 | `cd exp_ranking/web && npm run build` |
| 8 | Navigator ワークフロー | **差分0行** | `git diff -- .github/workflows/maplen-board-navigator.yml` が空 |

## 4. 停止条件

以下に該当したら**止めて選択肢+推奨付きで統括に報告**する:

- `on.schedule` をコメントアウトすると YAML がパースできない / GitHub のスキーマ上
  他のキーまで触らざるを得ない構造になっている
- 基準6のテスト数が 259/1 と一致しない(= スコープ外に影響している)
- `Fetch ranking and export JSON` step の env ブロックに触る必要が生じた
- Navigator を触らないと基準が満たせないと判断した場合(**勝手に触らない**)
- `git push` が必要だと判断した場合(**push はユーザー専権。実装担当は push しない**)

## 5. コミット分割

**1コミットのみ**。2ファイルの `on.schedule` は「静音化」という単一の関心事であり、
片方だけ適用した中間状態(Pages だけ止めて Retry が force_fetch を投げ続ける)は
**意図しない挙動を持つ**ため分けない。単独 revert でそのまま全面復旧できる。

1. `ops(ci): silence Pages/Retry cron while official API 403s (LULU-152)`

## 6. 検証コマンド

```
cd "C:\Users\pachi\Desktop\msu ranking"

# 基準1・2・3: 有効 cron 本数と dispatch 入力(PyYAML が無ければ行パーサで可)
python - <<'PY'
import re, pathlib
for p in [".github/workflows/maplen-board-pages.yml",
          ".github/workflows/lulumi-ranking-retry.yml",
          ".github/workflows/maplen-board-navigator.yml"]:
    text = pathlib.Path(p).read_text(encoding="utf-8")
    active = [l for l in text.splitlines()
              if re.match(r"^\s*-\s*cron:", l)]
    print(p, "active_cron =", len(active), active)
    print("  dispatch inputs:", re.findall(r"^\s{6}(\w+):\s*$", text, re.M))
PY

cd exp_ranking/bot && python -m pytest -q
cd ../web && npm run build

cd "C:\Users\pachi\Desktop\msu ranking"
git diff -w -- .github/workflows/maplen-board-pages.yml .github/workflows/lulumi-ranking-retry.yml
git diff -- .github/workflows/maplen-board-navigator.yml   # 空であること
git status --porcelain
```

**`git add -A` は禁止**。触ったファイルのみ個別 add。

## 7. ロールバック

- `git revert <commit>` で cron 4本 + 5本がそのまま復活する。bot・web・step の env に差分が
  無いため、revert の副作用は「schedule 起動が戻る」だけ。
- 本計画はローカル commit のみ(push しない)。**push 前であれば本番の挙動は何も変わらない**
  — 本計画の効果が本番に出るのはユーザーが push した後。この非対称性を完了報告に明記すること。

## 8. 完了報告テンプレ

- 実施コミット(ハッシュ):
- 受け入れ基準の実測値(表の全8行):
- `git diff -w` の全文(cron 行とコメント行以外が含まれていないこと):
- 残課題・watch-item:
