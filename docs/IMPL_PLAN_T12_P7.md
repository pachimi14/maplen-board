# IMPL_PLAN_T12_P7 — T12 最終掃除(シード機構の撤去・後片付け・T12 クローズ)

> 1計画書=1縦切りテーマ(PR-001)。**T12 の最終フェーズ**。本計画の完了をもって T12 全体をクローズする。
> 承認者: ユーザー / 実装: implementer / 統括が code-review + 実測で検収。
> 前提: P1〜P6 完了(LULU-060 / 063 / 112 / **113**)。

## 0. 目的と背景

- **北極星への寄与**: 直接の寄与は無い。**「消える問題への投資はしない」を徹底し、T12 で役目を終えた機構を残さない**ことで、次の担当(将来の自分)が誤って触る余地を消す。
- **参照する決定**: LULU-063(P7 候補の記録)/ LULU-113(P6 完了と残 watch)。

### なぜ今やるか(実測に基づく期限)

`data/seed/rankings_seed.json` が持つのは **2026-05-31 と 06-01 の2日分のみ**(5,575キャラ・11,122スナップショット・5.6MB)。両日とも既に本番 DB にあるため現状の import は 0行。しかし **`SNAPSHOT_RETENTION_DAYS=90` の期限が 2026-08-29 / 08-30** に来る。

その後は「**retention が消す日付を毎 run 入れ直しては消される**」無意味なチャーンになる。**8/29 より前に撤去するのが自然**。

## 1. スコープ

**触るもの**
- `.github/workflows/maplen-board-pages.yml` — `IMPORT_SNAPSHOTS_JSON` の削除
- `exp_ranking/bot/config.py` — シード関連設定(`resolve_snapshot_import_path` 等)
- `exp_ranking/bot/main.py` — シード import の呼び出し(528行付近)
- `exp_ranking/bot/sqlite_storage.py` — `import_snapshots_from_mvp_json`(659行)と関連コメント
- `exp_ranking/bot/analysis.py` — 当該関数に言及するコメント(37行付近)
- `exp_ranking/bot/data/seed/`(`rankings_seed.json` 5.6MB + `README.md`)の削除
- `README.md` — シード節(26行付近)の削除
- `scripts/archive/bat/run_import_snapshots_from_json.bat` — 退避済み bat の削除
- 関連テスト

**触らないもの**
- **取得ロジック・リトライ・スキップ判定(LULU-004)**
- Release 永続化 / snapshot guard / v2 シャード復旧 / backup-gdrive(P5.5)
- 公開データ契約(`data/v2/rankings.json` + shards)・UI
- **`refs/codex/*`**(§4 で扱う。実装担当は触らない)

## 2. 設計

### 2.1 シード機構の撤去(本体)

**撤去して安全な根拠**(P4 時点では「v1 とは別のコールドスタート用シード機構」として残置した = LULU-063 ③):

1. **復旧チェーンが確立済み**: `cache → Release db-store → v2シャード → cold start`。**P6 後の初 run で `release-db-restored=True`(293,720,064 バイト)を実測**(LULU-113)
2. **v2シャード復旧が era 対応済みで過大復元ゼロ**(LULU-062 B': 374,121/374,121 ビット完全一致)
3. **Google Drive 世代バックアップが独立層として稼働**(LULU-112。復元ドリル合格)
4. シードの2日分は**既に DB にあり、2週間後に retention で消える**(§0)

→ **シードが救う障害シナリオは既に3層で覆われており、残す理由が無い。**

### 2.2 v1 廃止案内 JSON の去就(**要ユーザー裁定**)

`https://lulumi-tools.com/data/rankings.json` は現在 **HTTP 200 / 145バイト**の廃止案内 JSON(`deprecated`/`replacement`/`retiredAt: 2026-07-30`)。

| 案 | 内容 | 評価 |
|---|---|---|
| **A(推奨)** | **そのまま残す** | 145バイトのコストしかなく、旧 URL を叩く外部に退役を明示できる。**誠実side**。維持費が実質ゼロなので「消す判断」に急ぐ理由が無い |
| B | 削除して 404 にする | 掃除としては綺麗だが、得るものが 145バイトだけ |

**推奨 = A(現状維持)。本計画では触らない**(判断だけ DECISION_LOG に記録して P7 の宿題から外す)。

### 2.3 3 workflow の整合確認(棚卸し)

P3〜P6 で 3 workflow を繰り返し変更したため、**不要になった step / env / キャッシュキーが残っていないか**を機械的に確認する。

- `pages` / `navigator` / `retry` の全 env を列挙し、**参照されていないもの**を洗い出す
- キャッシュキーの構成要素が実態と合っているか
- **発見しても、撤去は「明らかに未参照」と実証できたものだけ**。疑わしいものは報告して残す(停止条件)

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | bot テスト | 全緑(**現状 234 passed, 1 skipped** から機能テストが減らない。シード削除に伴うテスト削除は許容し、内訳を報告) | `cd exp_ranking/bot && python -m pytest` |
| 2 | web ビルド | 成功 | `cd exp_ranking/web && npm run build` |
| 3 | workflow YAML | 3本とも構文正常 | `yaml.safe_load` |
| 4 | **シード参照の消滅** | `IMPORT_SNAPSHOTS_JSON` / `rankings_seed.json` / `import_snapshots_from_mvp_json` の参照が **DECISION_LOG(履歴記録)を除き 0件** | `grep -rn` |
| 5 | **リポジトリの縮小** | `rankings_seed.json` 削除により追跡ファイル総量が **約5.6MB 減** | `git diff --stat` |
| 6 | **取得ロジック不触(LULU-004)** | `main.py` の fetch/retry/skip 判定に **差分 0** | `git diff -w -- exp_ranking/bot/main.py` を目視 |
| 7 | **既存経路の不変** | Release persist・snapshot guard・v2シャード復旧・backup-gdrive に **差分 0** | `git diff -w` |
| 8 | **本番反映後**: run 全緑 | 全 job success・`release-db-restored=True` | run ログ |
| 9 | **本番反映後**: データ不変 | `latestSnapshotDate` / `characterCount` / `snapshotDays` が反映前後で整合(日次増加分を除き退行なし) | 公開 v2 |
| 10 | **本番反映後**: 復旧チェーン | シード撤去後も **cold start 経路が v2シャードで成立**する(合成テストで実証。本番での意図的破壊はしない) | 単体/統合テスト |

## 4. 実装担当のスコープ外(統括・ユーザーが扱う後片付け)

> 以下は**コード変更ではない**ため実装担当は触らない。P7 の完了報告(DECISION_LOG)には含める。

### 4.1 GitHub Support への GC 依頼 — **必須ではない(推奨 = 依頼しない)**

**実測**: リモート 3,514,544 KB。P6 後も減っていない。原因は `refs/pull/*/head` が31本あり旧コミットを到達可能に保っているため(**GitHub 管理 ref で利用者は削除できない**)。

**しかし実害がほぼ無い**ことを確認した:

| 観点 | 影響 |
|---|---|
| **clone のコスト** | **無し**。既定 refspec は `+refs/heads/*:refs/remotes/origin/*` で **PR refs は取得されない**。新規 clone が取るのは書換後の **約48MB** |
| CI(Actions checkout) | 無し(単一ブランチ取得) |
| 課金 | 無し(public リポジトリ) |
| GitHub の容量警告 | 3.35 GiB は警告閾値(5GB)未満 |
| **リポジトリの増加** | **停止済み**(P3。これが T12 の本来の目的で、達成済み) |

→ **「見た目の数字」以外に損失が無いため必須ではない**。5GB に近づいたら再検討する watch-item として DECISION_LOG に残す。依頼する場合は Support に「history rewrite 後の GC と PR refs の整理」を要請する。

### 4.2 `refs/codex/*` の扱い — **調査完了。B のみ削除を推奨**

Codex(別ツール)が turn ごとに作るチェックポイント ref。**2本あり、性質が正反対**だった:

| ref | 作成 | 内容 | main に無い blob | 判定 |
|---|---|---|---|---|
| **A** `…/1786947086966/…` | **2026-08-17 15:34**(P6 作業中) | tree `8fa2d9d` / 541ファイル | **0個** | **触らない**。生かしている実体がゼロなので、**削除してもサイズは1バイトも減らない**。今日のセッションのものであり、消す理由も利得も無い |
| **B** `…/1786591356150/…` | **2026-08-13 12:22**(4日前) | tree `28caf09` / 353ファイル | **54個** | **削除を推奨**。うち **`ranking.db.gz` が 45.3 MiB** で、**ローカル48.34MiBのほぼ全て**がこれ。P6 で履歴から消したまさにその実体を、4日前のチェックポイントが1つだけ生かしている |

**B を消すと**: ローカルが **48.34 MiB → 約3MB** になる見込み。
**B を消すリスク**: Codex が 2026-08-13 のそのターンの差分表示・復元をできなくなる(4日前の完了済みセッション)。**リポジトリの履歴・コードには一切影響しない**(ref を消すだけで、main からの到達性は変わらない)。
**再発リスク**: 無い。P6 Step 3.5 で **db.gz は追跡対象から外れた**ため、今後のチェックポイントに db.gz は入らない(A が実際に 0個であることが実証)。

```bash
# 実行はユーザー承認後。B のみを名指しで削除する
git update-ref -d "refs/codex/turn-diffs/checkpoints/a94ffe31.../e45f0c46.../1786591356150/8e5d8a2d-..."
git reflog expire --expire=now --all && git gc --prune=now
```

### 4.3 bundle と backup タグ — **放置でよい(ユーザー裁定)**

- `C:/tmp/maplen-board-PRE-P6.bundle`(3.4GB): **ローカルディスクを 3.4GB 占有する以外の害は無い**。P6 前の完全な履歴の唯一の整理された退避先。**放置を裁定**(ユーザー、2026-08-17)
- `backup/pre-p6/*` タグ26個: **main に無い 177 オブジェクト**のみ。**push していないのでリモートには無影響**。放置してよい
- ⚠ **`C:/tmp` は OS やクリーンアップツールが消す可能性がある場所**。長期保管の意図があるなら別の場所へ移すこと(判断はユーザー)

### 4.4 孤立ディレクトリ

`C:/Users/pachi/Desktop/msu-ranking-sfhist` — git の worktree 登録は解除済み。**main の複製で固有データは無い**(`HANDOFF_PROMPT.md` 等が main の追跡ファイルであることを確認済み)。削除可。

### 4.5 P6 完了条件の最後の1項目

**db.gz の新規コミットが 0/日**であることを **2026-08-20 頃に再確認**する(P3 効果の持続確認)。

## 5. 停止条件

- **シード撤去により復旧チェーンのどこかが成立しなくなる**と判明した → 停止・報告
- `import_snapshots_from_mvp_json` の削除が**シード以外の経路から参照されている**ことが判明した(P4 で残置した理由がまだ生きている)
- 取得ロジック(LULU-004)に触れる必要が生じた
- workflow の棚卸しで「未参照か判断できない」env / step が出た → **撤去せず報告**
- スコープ外のファイルを触る必要が生じた

## 6. コミット分割(単独 revert 可)

1. **シード import の無効化**(workflow から `IMPORT_SNAPSHOTS_JSON` を削除)= **挙動変更の入口。単独 revert で即座に戻せる**
2. **コード撤去**(`main.py` 呼び出し → `config.py` → `sqlite_storage.py` の関数本体 → `analysis.py` のコメント)+ テスト調整
3. **データとドキュメントの削除**(`data/seed/` 一式・`README.md` の該当節・退避 bat)
4. **3 workflow の棚卸し結果**(撤去できるものがあれば。無ければコミットしない)

## 7. 検証コマンド

```
cd exp_ranking/bot && python -m pytest
cd ../web && npm run build
python -c "import yaml;[yaml.safe_load(open(f,encoding='utf-8')) for f in ['.github/workflows/maplen-board-pages.yml','.github/workflows/maplen-board-navigator.yml','.github/workflows/lulumi-ranking-retry.yml']]"
grep -rn 'IMPORT_SNAPSHOTS_JSON\|rankings_seed\|import_snapshots_from_mvp_json' --include='*.py' --include='*.yml' --include='*.md' --include='*.bat' . | grep -v node_modules | grep -v DECISION_LOG
git diff -w -- exp_ranking/bot/main.py
git diff -w --stat
```

**改行コードノイズ混入禁止**: `git add -A` は使わず、触ったファイルのみ個別 add。

## 8. ロールバック

- コミット1(workflow の env 削除)を revert すれば**シード import が復活**する。ただしコミット3で JSON 本体を消しているため、**完全復旧にはコミット3も revert が必要**。
- **データ破壊の経路が存在しない**: シードは「DB に無い日付だけを補完する」追加専用の機構で、削除しても既存行には触れない。
- 最悪ケースでも、シードの2日分は **2026-08-29/30 に retention で消える運命**であり、失うものは無い。

## 9. 完了報告テンプレ

- 実施コミット(4分割のハッシュ):
- 受け入れ基準 §3 の実測値(1〜7。8〜10 は本番反映後に統括が実測):
- **`git diff -w` による LULU-004 不触の証明**:
- bot pytest の passed 件数と、削除したテストの内訳:
- **未push・本番未反映の明示**:
- 残課題・watch-item:

## 10. T12 クローズ条件(本計画の完了 = T12 全体の完了)

- [ ] §3 の受け入れ基準 1〜10 をすべて達成
- [ ] §4 の後片付け項目について**方針が DECISION_LOG に記録**されている(実行の有無を問わない)
- [ ] **T12 の受け入れ基準(`docs/IMPL_PLAN_T12.md` §5)全9行**の最終状態を実測付きで記録
- [ ] DECISION_LOG に **T12 完了エントリ**を追加(P1〜P7 の総括・before/after・残 watch)
