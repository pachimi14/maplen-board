# T12 P5.5 — Google Drive バックアップ 初期設定手順

> 対象: `docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md` §9 の実行手順を、実際に手を動かせる粒度に展開したもの。
> **この手順はユーザー本人が実施する。**統括・実装担当は代行できない（Google アカウントの本人認証・GitHub Secrets 登録が必要なため）。
> **秘密情報（クライアントシークレット・refresh token 等）は誰にも共有しないでください**（統括にも実装担当にも）。GitHub Secrets に直接入力してください。

この手順で得られるのは以下の4つの値だけです。これらを GitHub Secrets に登録すれば、本段階（ローカル初期設定）の作業は完了です。**この段階では、まだ本番 workflow にバックアップジョブは組み込まれません。**

- `GDRIVE_CLIENT_ID`
- `GDRIVE_CLIENT_SECRET`
- `GDRIVE_REFRESH_TOKEN`
- `GDRIVE_BACKUP_FOLDER_ID`

---

## 1. Google Cloud 側の設定（ブラウザ）

### 1-1. プロジェクトを用意する
1. https://console.cloud.google.com/ を開く（既存プロジェクトがあればそれを流用してよい）
2. 新規プロジェクトを作成する場合は「プロジェクトを選択」→「新しいプロジェクト」

### 1-2. Google Drive API を有効化する
1. 左メニュー「APIとサービス」→「ライブラリ」
2. 「Google Drive API」を検索して開く
3. 「有効にする」をクリック

### 1-3. OAuth 同意画面を構成する
1. 「APIとサービス」→「OAuth 同意画面」
2. User Type: **External**（個人の Google アカウントを使う場合）
3. アプリ名・サポートメールなど必須項目を入力（アプリ名は任意。例: `Lulumi Tools DB Backup`）
4. **公開ステータスは Testing のままでよい**（後述の注意点あり）
5. 「テストユーザー」に**自分自身の Google アカウント**を追加する
6. スコープの設定で **`https://www.googleapis.com/auth/drive.file`** を追加する
   - Drive 全体ではなく「このアプリが作成したファイルのみ」に限定されるスコープ

> **重要な注意点（失効リスク）**: OAuth 同意画面が **Testing** のままだと、発行された refresh token は**7日で失効する**場合があります。日次バックアップという運用性質上、**長期運用に入る前に「本番環境に公開（In production）」へ切り替えることを推奨**します。`drive.file` のような非機密スコープであれば、通常 Google による審査は不要です。

### 1-4. OAuth クライアントID を作成する
1. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアントID」
2. アプリケーションの種類: **デスクトップ アプリ**
3. 名前を付けて作成（例: `gdrive-backup-desktop`）
4. 発行された **クライアントID** と **クライアントシークレット** を控える（この後すぐ使う。ファイルに保存する場合は自分のPC上の一時的な場所にとどめ、リポジトリには絶対に置かない）

---

## 2. ローカルPCでの初期設定スクリプト実行

> **Drive 画面でバックアップ用フォルダを手動作成しないでください。** 本スクリプトが使う `drive.file` スコープは「アプリが作成した（またはアプリに明示的に開かれた）ファイル/フォルダ」のみを操作対象にします。手動で作ったフォルダは同スコープから見えず操作できません。フォルダは必ずスクリプトに作らせます。

### 2-1. 依存ライブラリのインストール
リポジトリのルートで実行する（このライブラリは**ローカル初回のみ**必要。CIには入れない）。

```bash
pip install -r requirements-backup-setup.txt
```

### 2-2. スクリプトの実行

> **`--client-secret` 引数は存在しません（意図的に廃止）。** コマンドライン引数はシェル履歴（`.bash_history` 等）や `ps` のプロセス一覧に残ってしまうため、client secret の入力手段としては使いません。**getpass による非表示入力**を第一手段とし、`client_secret_*.json` ファイルをそのまま渡す方法も使えます。

**方法A（推奨・第一候補）: getpass での非表示入力**

リポジトリのルートで実行する。

```bash
python tools/gdrive_backup_setup.py --client-id <1-4で控えたクライアントID>
```

- `Client secret を入力してください（画面には表示されません）:` と表示されるので、1-4 で控えたクライアントシークレットを貼り付けて Enter を押す。**入力内容は画面に表示されない**（`getpass` による非表示入力）。

**方法B（任意・利便性重視）: client_secret_*.json ファイルをそのまま指定**

Google Cloud の認証情報画面からダウンロードできる `client_secret_....json` のパスをそのまま渡すこともできる（この場合 `--client-id` は不要）。

```bash
python tools/gdrive_backup_setup.py --client-secrets-file "C:/path/to/client_secret_XXXX.json"
```

- このファイル自体はスクリプトが作成・削除・改変することはない。**ダウンロードしたこのファイルをリポジトリに置いたり `git add` したりしないこと**（`.gitignore` に `client_secret*.json` を登録済みだが、リポジトリ外の場所に保管するのがより安全）。

**共通**

- `--client-id` の代わりに環境変数 `GDRIVE_CLIENT_ID` を設定して省略することもできる。client secret も環境変数 `GDRIVE_CLIENT_SECRET` で渡せるが、**シェル履歴に残らない getpass 入力を第一手段として推奨する**。
- 実行するとブラウザが開き、Google アカウントへのサインインと同意画面が表示される。**1-3 でテストユーザーに追加した自分自身のアカウント**でログインし、許可する。
- 同意後、スクリプトが自動的に:
  1. `drive.file` スコープで refresh token を取得する
  2. 専用フォルダ「`Lulumi Tools DB Backup`」を作成する（既に存在する場合は既存フォルダの ID を再利用し、重複作成はしない）
  3. **refresh token** と **backup folder ID** を、ラベル付きで画面に表示する（refresh token には共有禁止・commit禁止の警告文が併記される）
- **本スクリプトは CI（GitHub Actions 等）上では実行できない**（`GITHUB_ACTIONS` または `CI` 環境変数が設定されていると実行を拒否する）。**必ずローカルPCで実行する**。

出力例（値はダミー。実際の値はここに書き写さないこと）:

```
=== 取得結果（この値を控えて GitHub Secrets に登録してください） ===
refresh_token: 1//0xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
警告: refresh token は秘密情報です。第三者と共有せず、Git にコミットしたり、チャット・チケット等に貼り付けたりしないでください。GitHub Secrets への登録にのみ使用してください。
backup_folder_id: 1AbCdEfGhIjKlMnOpQrStUvWxYz
```

- **この値はファイルに保存されません**（標準出力にのみ表示される）。表示された内容をその場でコピーし、次の手順の GitHub Secrets に貼り付ける。
- ターミナルの実行履歴に秘密情報（refresh token）が残る点に注意し、作業後は必要に応じてターミナル履歴をクリアする。client secret はコマンドライン引数として渡していないため、ターミナル履歴には残らない。

---

## 3. GitHub Secrets への登録（4項目）

1. GitHub リポジトリの **Settings → Secrets and variables → Actions** を開く
2. 「New repository secret」で以下4つを登録する

| Secret 名 | 値 |
|---|---|
| `GDRIVE_CLIENT_ID` | 1-4 で発行したクライアントID |
| `GDRIVE_CLIENT_SECRET` | 1-4 で発行したクライアントシークレット |
| `GDRIVE_REFRESH_TOKEN` | 2-2 のスクリプト出力（`refresh_token`） |
| `GDRIVE_BACKUP_FOLDER_ID` | 2-2 のスクリプト出力（`backup_folder_id`） |

---

## 4. 注意事項まとめ

- **秘密情報は誰にも共有しない**。統括アーキテクトにも実装担当にも見せる必要はない。GitHub Secrets に直接入力する。
- **client secret はコマンドライン引数で渡さない**。`--client-secret` 引数は廃止済み。getpass の非表示入力、または `--client-secrets-file` でファイルを直接指定する。
- **Drive 画面でフォルダを手動作成しない**。`drive.file` スコープでは手動作成フォルダを操作できないため、必ずスクリプトに作らせる。
- **本スクリプトはローカル専用**。`GITHUB_ACTIONS` / `CI` 環境変数が設定された環境では実行を拒否する（refresh token を CI 上で表示しないため）。
- **Testing のままだと refresh token が7日で失効しうる**。日次バックアップを継続運用する前に、OAuth 同意画面を「本番環境に公開（In production）」へ切り替えることを推奨する。
- 本手順の完了時点では、**バックアップの本番組み込み（workflow への配線）はまだ行われていない**。GitHub Secrets の登録が完了した後、別コミットで `backup-gdrive` ジョブが追加される（`docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md` §5 コミット4）。
