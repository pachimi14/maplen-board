# T12 P6 実行手順書 — git 履歴書き換え(db.gz の除去とサイズ回収)

> **force push を伴うためユーザー専権**(LULU-009)。統括が準備・検証を行い、**push は必ずユーザーが実行**する。
> 作成: 2026-07-27(P3 実装中に準備)。前提が変わったら更新すること。

## 0. 現況の実測(基準値)

| 項目 | 値 | 取得コマンド |
|---|---|---|
| リモートサイズ | **3,512,299 KB(≈3.35 GiB)** | `gh api repos/pachimi14/maplen-board --jq '.size'` |
| ローカル `.git` loose | **4.47 GiB** | `git count-objects -vH` |
| ローカル `.git` pack | 470.54 MiB | 同上 |
| 増加速度 | 約 200 MB/日(**P3 で停止**) | — |
| 目標 | **< 400 MB**(計画 §4 基準7) | — |
| リモート未マージブランチ | **0本** | `git branch -r --no-merged origin/main` |
| ローカル既マージ(削除可) | **25本** | `git branch --merged origin/main` |
| ローカル未マージ | **3本**(`dq/repair-p-dq-2`・`t12/p3-stop-bleeding`・`t2/url-state`) | `git branch --no-merged origin/main` |
| worktree | **4つ**(下記) | `git worktree list` |

**worktree 一覧**
- `C:/Users/pachi/Desktop/msu ranking`(メイン)
- `C:/tmp/lulumi-tm-integration` — **Task Manager はマージ・公開済みなので破棄可**
- `C:/tmp/msu-ranking-navigator-db-only`
- `C:/Users/pachi/Desktop/msu ranking/.claude/worktrees/agent-ab73e1b109e55dd54`

## 1. 実行前の前提条件

> ### 🎯 最重要原則: **P6 は1回で終わらせる**
> `P6 → P4 → また履歴整理` になると **force push をもう一度**やることになる。**P3/P4/P5 をすべて終えてから P6 に入る**。これがツール選定より重要。

**開始条件チェックリスト(全部満たすまで開始しない・ユーザー指定 2026-07-27)**

- [ ] **P3(出血停止)完了・本番反映済**(db.gz の新規コミットが止まっている)
- [ ] **P4(v1廃止)完了**
- [ ] **P5(ローカルbat確認)完了**
- [x] **P5.5(Google Drive 世代バックアップ)完了**(2026-08-17 クローズ = LULU-112)(`docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md` §8。Release が完全DBの唯一の保存先になる P6 の前に、独立した退避先を確立しておく)
  - [x] **Google Drive への日次バックアップが実装済み**(PR #26 / 2026-08-13 本番稼働開始)
  - [x] **連続3回以上成功**(2026-08-15〜08-17 に **7 run 連続成功**。要件3を超過)
  - [x] **直近7日保持ポリシーが実証済み**(合成テストで7日/8日境界・最低世代数ガードを実証。**本番でも同一UTC日の重複排除による実削除が作動**: run `31987342633` で「保持ポリシーにより1件の古い世代を削除しました」。※経過日数(8日以上)による削除は世代が溜まる 2026-08-23 頃に自然発生する見込み=watch)
  - [x] **Release DB と Google Drive DB の内容一致を確認済み**(2026-08-17 のドリルで **SHA-256 バイト完全一致** + 統計6項目一致)
  - [x] **Google Drive から実際にDBを復元する手順を実証済み**(`docs/T12_P5_5_RESTORE_GUIDE.md` §6 に実施記録。2026-08-17 合格)
- [ ] **GitHub Actions 停止済**(3 workflow を disable = §3 Step 1)
- [ ] **実行中の Workflow が 0件**(`gh run list --status in_progress` が空)
- [ ] **working tree clean**(`git status` に未コミット変更なし)
- [ ] **bundle 作成済**(§3 Step 0)
- [ ] **`git gc` 実施済**(§3 Step 0.5)
- [ ] **`git fsck` 成功**(書換前の健全性確認)
- [ ] in-flight の PR が 0、**未マージのリモートブランチが 0**(現状 ✅)
- [ ] 未マージのローカルブランチを消化または破棄
- [ ] **ツールの準備完了**(§2)

## 2. ツールの準備(要ユーザー判断)

`git filter-repo` は**未インストール**。以下から選ぶ:

| 案 | 内容 | 評価 |
|---|---|---|
| **A(推奨)** | `git-filter-repo` の**単一ファイル**を取得して PATH に置く(pure Python・MIT・システムへ恒久インストールしない) | 公式推奨ツール。高速・安全。**依存を残さない** |
| B | `pip install git-filter-repo` | 同じツール。環境に恒久インストールされる |
| C | `git filter-branch --index-filter` | 標準同梱だが**非推奨・非常に低速**(数千コミット×3.5GB)。最後の手段 |

**決定 = A**(ユーザー裁定 2026-07-27)。理由: Python 環境を汚さない / pip 依存が残らない / GitHub 公式も推奨 / **終わったら削除できる**。

## 2.5 実行順序(ユーザー確定 2026-07-27)

```
P3 完了・本番観測
  ↓
P4 完了
  ↓
P5 完了
  ↓
全worktree・ブランチ棚卸し
  ↓
必要な未完成作業へ backup ref 付与     ← bundle は ref 到達分しか保存しない
  ↓
bundle 作成                            (Step 0)
  ↓
git gc（--prune=now なし）             (Step 0.5)
  ↓
git fsck --full
  ↓
CI 停止・実行中 run 0件 確認            (Step 1)
  ↓
ranking.db.gz を通常コミットで追跡解除・push  (Step 3.5)
  ↓
filter-repo                            (Step 4)
  ↓
内容・履歴・テスト検証                  (Step 5)
  ↓
force push                             (Step 6・ユーザー)
  ↓
CI 再開                                (Step 7)
```

## 3. 手順

### Step 0 — バックアップ(**最重要・省略禁止**)

> ⚠ **bundle が保存するのは「ref から到達できる履歴」だけ**。未コミットファイルや、どこからも参照されていない dangling commit は**保証されない**。だから **bundle の前に参照を付ける**。

**0-a. bundle 前の確認(順序厳守)**
```bash
# 1) 全 worktree に追跡変更が無いこと
git worktree list
for w in <各worktreeパス>; do git -C "$w" status --short | grep -v '^??'; done   # 出力が空であること

# 2) 未追跡ファイルの一覧を記録(bundle に入らないため)
git status --short | grep '^??' > C:/tmp/PRE-P6-untracked.txt
#    必要なものは別途コピーして退避する

# 3) 残したい作業コミットに一時バックアップ ref を付ける
#    (中断した作業の dangling commit・reflog にしか無いコミット等)
git reflog --date=iso | head -50          # 拾うべきものが無いか目視
git branch backup/<名前> <hash>            # 必要な分だけ
git tag    backup/<名前> <hash>            # ブランチでもタグでも可
```

**0-b. bundle 作成**
```bash
git bundle create C:/tmp/maplen-board-PRE-P6.bundle --all
git bundle verify C:/tmp/maplen-board-PRE-P6.bundle

# 復元の起点とツリーハッシュを記録(Step 5 の照合に使う)
git rev-parse main > C:/tmp/maplen-board-PRE-P6-main.txt
git rev-parse main:exp_ranking/web main:exp_ranking/bot > C:/tmp/PRE-P6-trees.txt
```
> **リモート(GitHub)も事実上のバックアップ**だが force push 後は上書きされる。**バンドルが唯一の完全な退避先**。検証完了まで削除しない。

### Step 0.5 — ローカル gc(quick win・履歴不変)

> ### ⚠ **`--prune=now` と `--aggressive` は使わない**(ユーザー指定 2026-07-27)
> **P6 前の gc は通常の `git gc` を使用する。**
> `--prune=now` は**どの ref からも参照されていないオブジェクトを即時削除**するため、以下を巻き添えにしうる:
> - **中断した作業の dangling commit**(実際に P3 で中断が発生している)
> - **reflog にしか残っていないコミット**
> - **削除直後のブランチの復旧材料**
> - 一時的に参照が外れたオブジェクト
>
> `--aggressive` も不要 — **非常に時間がかかる割に、直後の P6 で履歴を書き換えるため効果が無駄になる**。

```bash
git gc                    # ← これで十分。loose は pack にまとまる
git count-objects -vH     # 効果の確認
git fsck --full           # 健全性の確認
```
> 履歴を変えない純粋な最適化。**P3 完了後に P6 とは独立で実施可**。

### Step 1 — CI を一時停止(**必須**)
pages/navigator が**1日3〜4回 main に直コミット**するため、書換中に走ると衝突する。
```bash
gh workflow disable "MapleN Board Pages"
gh workflow disable "MapleN Board Navigator"
gh workflow disable "Lulumi Tools Ranking Retry"
gh workflow list   # 3つが disabled_manually になっていることを確認
```
> **忘れると再開手順(Step 7)で必ず戻すこと。** 朝の取得が止まるので、**書換は同日中に完了させる**。

### Step 2 — worktree の退避
```bash
git worktree list
git worktree remove --force C:/tmp/lulumi-tm-integration            # TMはマージ・公開済み
git worktree remove --force C:/tmp/msu-ranking-navigator-db-only
git worktree remove --force ".claude/worktrees/agent-ab73e1b109e55dd54"
git worktree prune
git worktree list   # メインのみになること
```

### Step 3 — 不要ブランチの削除(書換対象を減らす)
```bash
# 既マージのローカル(25本)
git branch --merged origin/main | grep -vE '^\*|main' | xargs -r git branch -d
# 未マージの残骸(要確認のうえ)
git branch -D dq/repair-p-dq-2 t2/url-state    # 役目終了。t12/p3 は消化済みか確認
# リモートの既マージ(14本)
git branch -r --merged origin/main | grep -vE 'origin/main|HEAD' | sed 's|origin/||' | xargs -r -n1 git push origin --delete
```

### Step 3.5 — **db.gz をツリーから削除して通常 push**(force 不要)
> **なぜ必要か**: Step 6 の「`git diff origin/main HEAD` が空」を成立させるため。`filter-repo` は**tip のツリーからも db.gz を消す**ので、tip にファイルが残ったまま書き換えると差分が「db.gz 削除」として出てしまい、**「履歴だけ変わり内容は同一」を検証できない**。先にツリーから消して push しておけば、**書換は純粋に履歴だけの操作**になる。

```bash
git rm --cached exp_ranking/bot/data/ranking.db.gz
# .gitignore に追記(復活防止)
echo "exp_ranking/bot/data/ranking.db.gz" >> exp_ranking/bot/.gitignore
git add exp_ranking/bot/.gitignore
git commit -m "chore: stop tracking ranking.db.gz (Release is the durable layer) [skip ci]"
git push origin main            # 通常 push(force 不要)
```
**前提**: P3 が反映済みで **Release からの復元が実運用で成功している**こと(db.gz を読む経路がもう無い)。

### Step 4 — 履歴から db.gz を除去
```bash
# 対象パス(過去に使われた両方を指定)
git filter-repo --force \
  --path exp_ranking/bot/data/ranking.db.gz \
  --path exp_ranking/bot/data/ranking.db \
  --invert-paths
```
> `filter-repo` は安全のため `origin` remote を外す。**Step 6 で再設定**する。

### Step 5 — 検証(**force push の前に全部通す**)
```bash
# a) サイズ
#    ★ここでの --prune=now は「意図的」: 書き換えで参照が外れた旧 db.gz を捨てるのが目的。
#      Step 0.5 の quick win gc とは目的が逆なので混同しないこと。
#      安全な理由 = 旧履歴は Step 0 の bundle に完全退避済み(未取得なら実行禁止)。
git gc --prune=now && git count-objects -vH        # 目標 < 400MB

# b) db.gz が履歴から消えたか(0 であること)
git rev-list --objects --all | grep -c 'ranking\.db\.gz' || echo 0

# c) ★オブジェクト整合性(書換直後の破損検出)
git fsck --full                                     # エラー・dangling以外の異常が無いこと

# d) ★コード木が壊れていないこと(ツリーハッシュが書換前と一致)
git rev-parse HEAD:exp_ranking/web                  # 書換前に記録した値と比較
git rev-parse HEAD:exp_ranking/bot                  # 同上(Step 3.5 済みなら db.gz は元から不在)
#   ※ 書換前の値は Step 0 の直後に記録しておくこと:
#      git rev-parse main:exp_ranking/web main:exp_ranking/bot > C:/tmp/PRE-P6-trees.txt

# e) 最新コミットの内容が壊れていない
git log --oneline -5
git status
cd exp_ranking/bot && python -m pytest              # 全緑
cd ../web && npm ci && npm run build                # 成功
```
**判定**: (b)=0 / **(c) fsck 成功** / (d) 一致 / (e) 全緑 のすべてを満たすまで **push しない**。

### Step 6 — force push(**ユーザーが実行**)

**★ push 直前の最終確認(これが空でなければ push しない)**
```bash
git remote add origin https://github.com/pachimi14/maplen-board.git   # filter-repo が外すため再設定
git fetch origin

# 「履歴だけ変わり、内容は全く同じ」の証明 — 出力が空であること
git diff origin/main HEAD
```
> Step 3.5 を済ませていれば**完全に空**になる。**1行でも差分が出たら中止**し、原因を特定する(内容が変わっている=書換が意図を超えている)。

```bash
# ★1: plain --force を2回に分けてはいけない。main だけ成功してタグが失敗すると、
#     旧タグが旧履歴を到達可能に保ち「サイズが減らない」P6 最悪の中間状態になる。
#     --atomic なら両方成功か両方失敗のどちらかになる。
# ★2: `git push --force --tags origin` は絶対に使わない(旧版の本書にあった誤り)。
#     backup/pre-p6/* 等のローカル保全タグまで公開され、main に無いオブジェクトを
#     remote に残す。push する ref は main と db-store だけを明示指定する。
# ★3: --force-with-lease に「検証時のリモートSHA」を明示し、検証後にリモートが
#     動いていたら push が拒否されるようにする。
#     期待SHA は書換前に控えておく: gh api repos/<owner>/<repo>/commits/main --jq .sha
#                                   git ls-remote --tags origin db-store
git push --atomic --force-with-lease=refs/heads/main:<検証時のリモートmainのSHA> --force-with-lease=refs/tags/db-store:<検証時のリモートdb-storeのSHA> origin refs/heads/main:refs/heads/main refs/tags/db-store:refs/tags/db-store
```

> **`db-store` タグも必ず同時に更新する**(2026-08-17 の実施で判明した必須事項)。
> Release `db-store` のタグが旧コミットを指したままだと、**旧履歴が到達可能なまま
> 残り GitHub の GC 対象外**になり、リモートのサイズは永久に減らない。
> Release の**アセットは Release オブジェクトに属する**ため、タグ参照を移動しても
> アセットは消えない(実施後に `state: uploaded`・サイズ・更新時刻の不変を実測確認)。
> なお db.gz のみを変更していた旧コミットは filter-repo が空コミットとして刈るため、
> タグは**生き残った直近の祖先へ再マップ**される(仕様どおりの挙動)。

> **push 後に必ず `git reflog expire --expire=now --all && git gc --prune=now`**
> (2026-08-17 の実施で判明)。書換後に一度でも `git fetch` してしまうと旧履歴が
> ローカルへ戻る。それを消しても **reflog が旧 main を掴み続けるため gc だけでは
> 減らない**。実測: 48MiB → (fetch) → 3.39GiB → (gc のみ) → 3.35GiB →
> (reflog expire + gc) → **48.34MiB**。
> なお**書換後の検証で `git fetch` は使わないこと**(旧履歴3.3GBを再取得してしまう)。
> 内容同一性は **ルートツリーSHA の照合**で足りる:
> `gh api repos/<owner>/<repo>/commits/main --jq .commit.tree.sha` と
> `git rev-parse HEAD^{tree}` の一致。diff より厳密で、転送も発生しない。

### Step 7 — 復旧(worktree・CI)
```bash
# CI 再開(忘れ厳禁)
gh workflow enable "MapleN Board Pages"
gh workflow enable "MapleN Board Navigator"
gh workflow enable "Lulumi Tools Ranking Retry"
gh workflow list

# 必要な worktree のみ作り直す(不要なら作らない)
```

### Step 8 — 事後検証
- [ ] `gh workflow run "maplen-board-pages.yml"` を1回手動実行 → **全 job success**
- [ ] **Release `db-store` から復元できている**(ログ確認。db.gz は履歴から消えたので Release が唯一の永続層)
- [ ] **本番 v2 が無変化**(`snapshotCount`/`snapshotDays`/主要キャラの gain が書換前と一致)
- [ ] `gh api repos/pachimi14/maplen-board --jq '.size'` を記録(**§4 の注意点参照**)
- [ ] 数日後、db.gz の新規コミットが 0 であることを再確認

## 4. 既知の注意点(重要)

1. **GitHub 側のサイズは即座に減らない**。force push 後も**到達不能オブジェクトが GitHub 側に残る**ため `gh api .size` はしばらく大きいまま。GitHub の GC は自動だが時期は不定。**急ぐ場合は GitHub Support に GC 依頼**が必要。
   → **受け入れ基準の測り方**: 「**書換後のローカルリポが < 400MB**」を一次判定にし、リモートの縮小は**事後確認(遅延あり)**として扱う。
2. **全員が clone をやり直す必要がある**(履歴が変わるため)。この作業は実質1人運用なので影響は自分の環境のみ。
3. **書換は同日中に完了**させる(CI を止めている間は朝の取得が止まる)。
4. **P3 が未反映のまま書換すると即座に再肥大**する。順序厳守。
5. `filter-repo` は `origin` を外す仕様 — Step 6 で再設定を忘れない。

## 5. ロールバック

```bash
# バンドルから完全復元
git clone C:/tmp/maplen-board-PRE-P6.bundle restored-repo
cd restored-repo && git log --oneline -3     # Step 0 で記録したハッシュと一致するか
# 必要なら restored-repo から origin へ force push で巻き戻す
```
- **force push 前**なら: `filter-repo` の結果を捨てて再 clone すれば済む(リモートは無傷)。
- **force push 後**なら: 上記バンドルから復元し、再度 force push。**バンドルは検証完了まで削除しない**。

## 6. 完了条件

> **2026-08-17 実施・完了**(記録 = DECISION_LOG **LULU-113**)。実測値は下記。

- [x] 書換後の**ローカルリポ < 400MB** → **3.35 GiB → 48.34 MiB**
- [x] 履歴に `ranking.db.gz` の blob が **0件** → main 履歴 **109個 → 0個**
      (別途1個が `refs/codex/turn-diffs/...` に残存。filter-repo は tree を指す ref を
       扱えず skip する。**push 対象外なのでリモートには無影響**)
- [x] **web/bot のコード木が書換前と一致**(ツリーハッシュ)
      → web `7719a11d…` / bot `1e643255…` 一致。さらに**ルートツリー `62b79602…` が
        リモート main と完全一致** = 内容が1バイトも変わっていないことの証明
- [x] pytest 全緑・web ビルド成功 → bot **234 passed, 1 skipped** / web build ✓
- [x] CI 再開後の run が **全 job success**、**Release から復元**できている
      → run `32001217557` で build/deploy/commit-db/backup-gdrive 全 success、
        **`release-db-restored=True`(293,720,064 バイト)**、guard は
        `basis: v2_public=79 release=79` の二重実基準で作動
- [x] **本番 v2 が無変化** → `latest=2026-08-16 / count=8550 / days=79`(書換前と同一)
- [ ] db.gz の新規コミットが **0/日**(P3 の効果が持続) → **数日後に再確認**(watch)
- [x] DECISION_LOG 更新(実測 before/after・GitHub 側 GC の状況) → LULU-113

### 実施後に判明した重要事項(次回や類似作業のために)

1. **リモートのサイズは減らない**(実測 3,514,447 KB → 3,514,544 KB でむしろ微増)。
   原因は §4-1 の「GC が遅延する」だけではなく、**`refs/pull/*/head` が31本あり
   旧コミットを到達可能に保っている**こと。これは **GitHub 管理の ref で利用者は
   削除できない**。**リモートを実際に縮小するには GitHub Support への GC 依頼が必須**
   (「遅延」ではなく「依頼しない限り永久に減らない」と理解すべき)。
2. 本書 Step 6 に **`git push --force --tags origin` という危険な記述があった**
   (2026-08-17 に修正)。実行していれば `backup/pre-p6/*` 26本が公開されていた。
3. 書換後の検証で **`git fetch` を使ってはいけない**(旧履歴3.3GBを再取得する)。
   実際に踏み、`reflog expire` + `gc --prune=now` で回収した(Step 6 の注記参照)。
