# IMPL_PLAN_T12_P5.5 — Google Drive 世代バックアップ

> `docs/IMPL_PLAN_T12.md` の **P5.5**(新設)。**P4・P5 完了後、P6(履歴書き換え)の前**に実施する。
> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー / 実装: implementer / 統括が code-review+実測で検収。
> **本書は設計と受け入れ基準のみ。実装・Google Cloud 設定・Secrets 追加・commit・push は未実施。**

## 0. 目的と背景

- **要件を一文で**: **P6 で git 履歴から `ranking.db.gz` を除去する前に、Release とは独立した「完全DBの世代バックアップ」経路を確立する。**
- **なぜ P6 の前か**: P3 で git db.gz を止め、P6 で履歴からも消すと、**完全DBは Release `db-store` の1個だけ**になる。Release の誤上書き・誤削除・破損が起きると**復旧手段が v2シャード(=導出値からの再構成)しか残らない**。P6 は不可逆なので、**その前に独立した退避先を用意する**。
- **既に判明しているリスクの実例**: P3 反映初回で `gh release upload` が 403 で失敗し(権限回帰)、**Release が数十分間更新されない状態**が発生した。Release 単独依存の脆さは実証済み。

### 保存構成(3層の役割分担)

| 層 | 保持内容 | 役割 |
|---|---|---|
| **GitHub Release `db-store`** | **常に最新のDB 1個** | **通常復元の正**(P3 で確立済み) |
| **Google Drive**(本計画) | **日付付きDB・直近7日分** | Release の**誤上書き・誤削除・破損**に対する**世代バックアップ** |
| **v2 シャード** | 公開中の導出データ | **完全DBが全滅した場合の最終手段**(era 厳密復元=LULU-062②) |

## 1. スコープ

**触るもの**
- `.github/workflows/maplen-board-pages.yml` / `maplen-board-navigator.yml` — バックアップジョブの追加
- `exp_ranking/bot/` に新規モジュール(例 `gdrive_backup.py`)+ テスト
- バックアップ専用の依存定義(例 `requirements-backup.txt`。**bot 本体の `requirements.txt` は汚さない**)
- ドキュメント(復元手順)

**触らないもの**
- 取得ロジック(`main.py` の fetch/リトライ/スキップ=**LULU-004**)
- **v2 スキーマ**・web・DBスキーマ・`analysis.py`/`mvp_export.py`
- **Release persist の既存経路**(P3 で確立済み。順序を変えるだけで中身は不変)
- **snapshot guard の判定ロジック**(P3)

**今回決めない・やらない(ユーザー指定)**
- 長期の月次アーカイブ / Google Drive 以外の外部ストレージ / 追加の暗号化方式 / 複数Googleアカウントへの複製 / **自動復元の本番組み込み**(復元は**手動手順のみ**)

## 2. 設計

### 2.1 毎日の処理順(**厳守。削除を先に行わない**)
```
1. ランキングDB更新(fetch → import)
2. snapshot guard 合格            ← 不合格ならここで run 失敗(P3・Pages/Release 更新なし)
3. Release db-store へ保存        ← 失敗なら run 失敗(P3)
4. Google Drive へ日付付きで保存   ← 失敗なら run 失敗・削除は行わない
5. Google Drive 上の新規バックアップを検証 ← 失敗なら run 失敗・削除は行わない
6. 保持期間を超えた古い世代だけ削除 ← ここで初めて削除
```
**実装形**: 新ジョブ `backup-gdrive` を `needs: [build, commit-db]` で追加する。`commit-db`(=Release persist)成功が前提条件になるため、**「Release → Drive」の順序が構造的に保証**される。

### 2.1.1 ジョブ間の DB 受け渡し(**同一DBであることの保証**)

> ⚠ **`needs:` はジョブの実行順序を決めるだけで、ファイルは渡らない**(各ジョブは別マシン・別ワークスペース)。同一DBを保証する手段を明示する。

**採用する経路(ユーザー指定・確定)**: **Release Asset を「唯一の受け渡し媒体」にする**。
```
1. commit-db が Release Asset(db-store/ranking.db.gz)を更新
     └ このとき upload した db.gz の SHA-256 を job output に記録して次ジョブへ渡す
2. backup-gdrive が「その Release Asset をダウンロード」
3. ダウンロードした db.gz の SHA-256 を 1 の記録値と照合   ← 同一DBであることの証明
4. gzip 展開 → SQLite open → snapshot_days / rows / latest date を検証
5. Google Drive へアップロード
6. Drive から再ダウンロードして SHA-256 を検証
7. すべて成功後にのみ 古い世代を削除
```
- **artifact 経由にしない理由**: Release Asset を経由すれば「**Drive に保存したものが Release に入っているものと同一**」が直接証明でき、二重の受け渡し経路(artifact と Release)による乖離の余地が無くなる。
**3 の SHA-256 が一致しなかった場合(Release 競合・確定仕様)**
- **Drive へアップロードしない**
- **古い Drive バックアップを削除しない**
- **ジョブを失敗させる**
- **「Release Asset が別 run で更新された可能性がある」旨をログに明示**(両方の SHA-256・commit-db の run_id・現在の Release アセット更新時刻を併記。**秘密情報は出さない**)

### 2.2 Pages 公開との順序(巻き戻し防止)
- **Drive に保存するDBは、Release Asset から取得した実体**であり、その Release Asset は**その run で公開した v2 を生成したのと同一の `ranking.db`**(§2.1.1 の SHA-256 照合で保証)。したがって **公開データとバックアップは常に同一世代**であり、Drive から復元しても公開済みデータを巻き戻さない。
- **Drive は自動復元経路に一切組み込まない**(復元は手動手順のみ)。したがって Drive の内容が公開経路を上書きすることは起こり得ない。
- Pages deploy が成功しバックアップが失敗した場合は **run を失敗させて可視化**する(公開済みデータに対応する世代が無い状態を検知可能にする)。次の run で同一以降のデータが再バックアップされる。

### 2.3 ファイル名
```
ranking-db-<YYYY-MM-DD>T<HHMMSS>Z-run-<run_id>.db.gz
例) ranking-db-2026-07-29T090500Z-run-30370939192.db.gz
```
- 日付は **UTC**。同日複数 run の衝突を **UTC時刻 + run_id** で回避する。
- **保持単位は原則「1 UTC日あたり1世代」**。同日中に複数成功した場合は**最新の成功分だけを残す**(古い同日世代は §2.4 の保持処理で削除対象)。
  - 補足: pages と navigator の両方でバックアップするため、**同日に複数世代が出るのは正常**。navigator 実行後の世代が最新となり、その日の worldId 同期まで含んだ状態が残る。

### 2.4 保持ポリシー(**安全側に倒す**)
- **直近7 UTC日分を保持**。**8日以上前のみ削除**。
- 削除は **§2.1 の 5(検証)を通過した後にのみ**実行する。
- **アップロード失敗時 → 削除しない**
- **検証失敗時 → 削除しない**
- **削除失敗時 → 新規バックアップは保持したまま、エラーを明示**(warning ではなく可視の失敗として扱う。ただし新規世代の保存は完了しているため、削除の失敗だけで前世代を失うことは無い)
- **常に「新規世代 + 直前の正常世代」以上が残ることを、削除実行前にチェック**する。満たさない削除計画は**実行せず警告**して終了する。

### 2.5 検証(**最低限すべて実施**)
アップロード直後、**Drive から取得し直して**検証する:

| # | 検証 |
|---|---|
| V1 | Google Drive 上に**ファイルが存在**する(API でメタデータ取得可能) |
| V2 | **ファイルサイズが 0 ではない** |
| V3 | **ローカル `db.gz` とサイズが一致** |
| V0 | **Release Asset から取得した db.gz の SHA-256 が、`commit-db` が upload した値と一致**(=同一DBであることの証明。§2.1.1) |
| V4 | **SHA-256 が一致**(Release から取得した実体の値 vs Drive からダウンロードして計算した値) |
| V5 | **gzip 展開可能** |
| V6 | **SQLite として open 可能** |
| V7 | **`snapshot_days` / 総行数 / 最新日 が Release DB と一致**(Release アセットも取得して突合) |

> V4 は Drive API の `md5Checksum` でも一次確認できるが、**SHA-256 の一致確認はダウンロードした実体で行う**(メタデータだけを信用しない)。

### 2.6 認証・秘密情報(**OAuth 2.0 + refresh token 方式**)

> **サービスアカウント方式は採用しない**(ユーザー裁定 2026-07-29)。**サービスアカウントはマイドライブのストレージ容量を持てず**、個人の無料 Google Drive にファイルを保存できない(公式には共有ドライブ、または人間ユーザーとしての OAuth が必要)。本計画は**ユーザー本人の Google アカウントを使う OAuth 2.0 + refresh token** を採用する。

- **初回のみローカルPCで OAuth 同意**を行い、**refresh token を取得**する(§9 の手順)。
- **GitHub Secrets に登録する4項目**:
  - `GDRIVE_CLIENT_ID`
  - `GDRIVE_CLIENT_SECRET`
  - `GDRIVE_REFRESH_TOKEN`
  - `GDRIVE_BACKUP_FOLDER_ID`
- **Actions は refresh token から access token を取得**してアップロードする(ブラウザ同意は CI では発生しない)。
- **認証情報・token をログへ出さない**。環境変数経由でのみ渡し、**例外メッセージ・スタックトレースに含めない**(例外は要約してから出す)。ファイルへ書き出す場合は job 終了時に破棄する。
- **スコープは `drive.file` を使用**(そのアプリが作成したファイルのみにアクセス。ユーザーの Drive 全体を読み書きしない)。
- **バックアップ用フォルダは「初期設定スクリプト自身が作成する」**(ユーザー裁定 2026-07-29)。
  - **理由**: `drive.file` は**アプリが作成した(またはアプリに明示的に開かれた)ファイル/フォルダのみ**を対象とする。**Drive 画面で手動作成したフォルダは同スコープでは操作できない**。スクリプトが作成すれば、そのフォルダとその配下は**同じ OAuth クライアントで継続利用できる**。
  - フォルダ名: **`Lulumi Tools DB Backup`**
  - 以降のアップロードは、この **folder_id を親に指定**して作成する(同スコープで一覧・削除も可能)。

### 2.6.2 初期設定スクリプト(ローカル・1回のみ)
`tools/gdrive_backup_setup.py`(仮)。**役割は以下7点に限定**する:
1. **Desktop OAuth クライアント情報を読み込む**(client_id / client_secret)
2. **ブラウザで本人の Google アカウント認証**を行う
3. **`drive.file` スコープで refresh token を取得**する(`access_type=offline` / `prompt=consent`)
4. **専用バックアップフォルダ `Lulumi Tools DB Backup` を作成**する
5. **画面へ個別に表示**する: **refresh token** / **backup folder ID**
6. **token・client secret をファイルへ恒久保存しない**(`token.json` 等を作らない/作っても即削除)
7. **実行ログや Git 管理下へ秘密情報を残さない**(`.gitignore` 対象・標準出力のみ)

> **OAuth アプリは長期運用前に Production 状態へ変更する前提**(Testing のままだと refresh token が7日で失効しうる)。

### 2.6.1 依存ライブラリ(**公式ライブラリを使用・独自実装しない**)
- **JWT / OAuth のトークン処理を独自実装しない**(ユーザー指定)。
- **本番ジョブに必要な最小構成**:
  - `google-auth` — refresh token → access token の更新(`google.oauth2.credentials.Credentials`)
  - `google-api-python-client` — Drive API v3 の files.create / list / get / delete
  - ※ `google-auth-oauthlib` は**ブラウザ同意を伴う初回のみ**必要。**CI では不要**なので `requirements-backup.txt` には含めず、**ローカルの初回取得手順(§9)でのみ使用**する。
- `requirements-backup.txt` は**バックアップジョブのステップでのみインストール**し、bot 本体の `requirements.txt` は汚さない。

### 2.7 失敗時の扱い(ユーザー指定・確定)

| 事象 | 挙動 |
|---|---|
| Release persist 失敗 | **workflow 失敗**(P3 で確立済み) |
| **Google Drive upload 失敗** | **workflow 失敗**・**古いバックアップは削除しない** |
| **Google Drive 検証失敗** | **workflow 失敗**・**古いバックアップは削除しない** |
| **古いバックアップ削除失敗** | **新規バックアップは保持**・**エラーを明示** |

### 2.8 新規依存(**要ユーザー承認**)
Google のサービスアカウント認証には **RS256 署名**が必要で、Python 標準ライブラリだけでは実装できない。
- 想定: `google-auth`(+ 必要なら `google-api-python-client`)。
- **bot 本体の `requirements.txt` を汚さない**ため、**バックアップ専用の依存ファイル**(例 `requirements-backup.txt`)を用意し、**バックアップジョブのステップでのみインストール**する。ローカル開発・既存 run には影響させない。
- **この依存追加は事前承認事項**として扱う(CLAUDE.md)。

### 2.9 容量・コストの見積り
- 1世代 ≈ **46 MB**(2026-07-28 実測)× 7世代 ≈ **322 MB**(Google Drive 無料枠 15GB に対し十分)
- 通信: upload 46MB + 検証 download 46MB ≈ **92MB/run**。pages+navigator で 1日あたり数回。

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | bot テスト | 全緑 | `cd exp_ranking/bot && python -m pytest` |
| 2 | workflow YAML | 3本とも構文正常 | `yaml.safe_load` |
| 3 | **順序の保証** | Drive 保存は **Release persist 成功後にのみ**実行される(`needs` で構造的に保証) | workflow 定義+実 run ログ |
| 4 | **アップロード成功** | 実 run で Drive にファイルが作成される | Drive API 一覧 |
| 5 | **検証 V1〜V7 全通過** | 7項目すべて成功。**SHA-256 一致**・**Release DB と snapshot_days/rows/最新日が一致** | 実 run ログ |
| 6 | **削除の安全性** | 検証失敗/アップロード失敗を模した条件で **削除が実行されない** | 合成条件テスト |
| 7 | **保持ポリシー** | 8日以上前のみ削除され、**直近7日分が残る**。同日複数世代は**最新のみ残る** | 実データ+合成テスト |
| 8 | **最低世代数の担保** | 「新規 + 直前の正常世代」を下回る削除計画は**実行されない** | 合成条件テスト |
| 9 | **秘密情報の非露出** | ログ・成果物・リポジトリに SA JSON / トークンが**出現 0件** | ログ grep + `git diff` |
| 10 | **既存経路の不変** | Release persist・snapshot guard・v2 シャード・公開データが**不変**(diff 0 / 実 run で挙動同一) | `git diff -w` + 実 run |
| 11 | **連続成功** | **3 run 以上連続で成功**(P6 開始条件) | run 履歴 |
| 12 | **復元手順の実証** | **Drive から取得したDBで復元できる**ことを実際に1回実演し、手順書化 | 手動ドリル+ドキュメント |

## 4. 停止条件

- **秘密情報がログ・成果物に出る経路**を塞げない
- **削除が「検証成功前」に走り得る**設計上の穴が塞げない
- 新規依存(§2.8)の追加が承認されない、または依存が bot 本体に波及せざるを得ない
- **Release persist / snapshot guard / 公開データ**に影響を与えずに実装できない
- Drive API の権限を**フォルダ限定に絞れない**(Drive 全体権限が必要になる)
- 取得ロジック(LULU-004)に触れる必要が生じた

## 5. コミット分割(単独 revert 可)

1. **バックアップモジュール**(`gdrive_backup.py`)+ 単体テスト(**workflow 未配線=挙動不変**)
2. **検証ロジック V1〜V7** + テスト(同上)
3. **保持・削除ロジック**(安全ガード込み)+ テスト(同上)
4. **workflow への配線**(`backup-gdrive` ジョブ追加・`needs: [build, commit-db]`)
5. 復元手順のドキュメント化

> 1〜3 は**未配線なので本番影響ゼロ**。実際に動き出すのは 4 のみ。

## 6. 検証コマンド

```
cd exp_ranking/bot && python -m pytest
python -c "import yaml;[yaml.safe_load(open(f,encoding='utf-8')) for f in ['.github/workflows/maplen-board-pages.yml','.github/workflows/maplen-board-navigator.yml','.github/workflows/lulumi-ranking-retry.yml']]"
git diff -w -- .github/workflows/ exp_ranking/bot/
# 実 run: Drive 上のファイル一覧・SHA-256・Release DB との突合(ログで確認)
```

## 7. ロールバック

- コミット 4(配線)を revert すれば**バックアップジョブが消えるだけ**で、**Release persist・公開・guard は無傷**。
- コミット 1〜3 は未配線のため revert してもしなくても本番影響なし。
- **Drive 上のデータは削除されない**(revert はコードのみ)。

## 8. P6 開始条件への追加(ユーザー指定)

`docs/T12_P6_RUNBOOK.md` の開始条件チェックリストに以下を追加する:

- [ ] **Google Drive への日次バックアップが実装済み**
- [ ] **連続3回以上成功**
- [ ] **直近7日保持ポリシーが実証済み**
- [ ] **Release DB と Google Drive DB の内容一致を確認済み**
- [ ] **Google Drive から実際にDBを復元する手順を実証済み**

## 9. ユーザー作業が必要な事項(実装前に必要)

> 統括・implementer では実施できない。**ユーザーの操作が必要**。**秘密情報は私に共有しないでください**(GitHub Secrets に直接登録)。

### 9-1. Google Cloud 側(ブラウザ)
1. **Google Cloud プロジェクトを作成**(既存があれば流用)
2. **Google Drive API を有効化**
3. **OAuth 同意画面**を構成
   - User Type: **External**(個人アカウントの場合)。公開せず **Testing** のままでよい
   - **テストユーザーにご自身の Google アカウントを追加**
   - スコープに **`https://www.googleapis.com/auth/drive.file`** を追加
   - ※ Testing のままだと **refresh token が7日で失効**する場合があります。**「本番環境に公開(In production)」に切り替えれば失効しません**(審査は `drive.file` のような非機密スコープなら通常不要)。**運用上は In production への切り替えを推奨**します
4. **OAuth クライアントID を作成**
   - 種類: **デスクトップ アプリ**
   - 発行された **クライアントID / クライアントシークレット**を控える

### 9-2. 初期設定スクリプトの実行(ローカルPCで1回だけ)

> **Drive 画面でフォルダを手動作成しないでください。** `drive.file` スコープでは手動作成フォルダを操作できないため、**スクリプトにフォルダを作らせます**。

5. 初回取得にのみ必要なライブラリを入れる(**CI には入れない**)
   ```bash
   pip install -r requirements-backup-setup.txt
   ```
6. **初期設定スクリプトを実行** → ブラウザで本人アカウントの同意 → **refresh token と folder ID が個別に表示される**
   ```bash
   python tools/gdrive_backup_setup.py --client-id <ID> --client-secret <SECRET>
   ```
   - スクリプトが **`Lulumi Tools DB Backup` フォルダを作成**し、その **folder_id** を出力する
   - **token / client secret はファイルに保存されない**(標準出力のみ)

### 9-3. GitHub Secrets への登録(4項目)
7. リポジトリの **Settings → Secrets and variables → Actions** で登録
   | Secret 名 | 値 |
   |---|---|
   | `GDRIVE_CLIENT_ID` | 9-1 で発行したクライアントID |
   | `GDRIVE_CLIENT_SECRET` | 同 クライアントシークレット |
   | `GDRIVE_REFRESH_TOKEN` | **9-2 のスクリプト出力** |
   | `GDRIVE_BACKUP_FOLDER_ID` | **9-2 のスクリプト出力**(`Lulumi Tools DB Backup` の ID) |

### 9-5. 承認事項
10. **新規 Python 依存の承認**(§2.6.1・§2.8)— ✅ **2026-07-29 承認済み**

> **注意**: これらの値は**私(統括)にも実装担当にも共有しないでください**。GitHub Secrets に直接入力すれば、Actions からのみ参照されます。

## 10. 完了報告テンプレ

- 実施コミット(5分割のハッシュ):
- 受け入れ基準の実測値(§3 全12行):
- **検証 V1〜V7 の実 run ログ**(SHA-256 一致・Release DB との突合):
- **削除が走らないこと**の実証(アップロード失敗/検証失敗の合成条件):
- **保持ポリシー**の実証(7日境界・同日複数世代):
- **秘密情報が出ていないこと**の確認方法と結果:
- **復元ドリル**の記録(手順・所要・確認項目):
- `git diff -w` の要点・**未push/本番未反映の明示**:
- 残課題・watch-item(P6 への申し送り):
