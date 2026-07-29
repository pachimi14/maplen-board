#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Google Drive バックアップ初期設定スクリプト（ローカルPCで1回だけ実行する）

目的:
  T12 P5.5 (docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md) で使う
  Google Drive への日次バックアップに必要な、以下2点を取得する。
    1. refresh token（drive.file スコープ）
    2. バックアップ専用フォルダ「Lulumi Tools DB Backup」の folder ID

このスクリプトが行うこと（これ以外は行わない）:
  1. Desktop OAuth クライアント情報（client_id / client_secret）を
     コマンドライン引数・非表示入力（getpass）・環境変数・
     client_secret_*.json ファイルのいずれかから読み込む
     （client secret はコマンドライン引数では受け付けない。
     シェル履歴やプロセス一覧に残るため）
  2. ブラウザを開き、本人の Google アカウントで OAuth 同意を行う
  3. drive.file スコープで refresh token を取得する
     （access_type=offline, prompt=consent を明示し、確実に
     refresh token が返るようにする）
  4. 専用フォルダ「Lulumi Tools DB Backup」を作成する（同名フォルダが
     既にこのアプリのスコープから見える場合は新規作成せず、その ID を返す）
  5. refresh token と folder ID を、ラベル付きで別々の行に標準出力へ表示する
     （refresh token 表示時は共有禁止・commit禁止の警告を併記する）
  6. token / client secret をファイルへ恒久保存しない
     （InstalledAppFlow が一時ファイルを作る場合は確実に削除する）
  7. 実行ログ・例外メッセージに秘密情報を含めない
  8. CI 環境（GITHUB_ACTIONS / CI 環境変数）での実行を拒否する
     （このスクリプトはローカル専用。refresh token を CI 上で表示しない）

このスクリプトが行わないこと:
  - GitHub Secrets への登録（ユーザーが手動で行う）
  - バックアップ本体のアップロード・検証・保持ロジック（次段階で実装）
  - workflow への組み込み

使い方（第一候補・推奨）:
  pip install -r requirements-backup-setup.txt
  python tools/gdrive_backup_setup.py --client-id <ID>
  # client secret の入力を求められるので、非表示のまま貼り付ける

使い方（Google Cloud が配布する client_secret_*.json をそのまま使う場合）:
  python tools/gdrive_backup_setup.py --client-secrets-file <path/to/client_secret_....json>

  クライアントIDは環境変数でも指定できる: GDRIVE_CLIENT_ID
  client secret を環境変数で渡すことも可能だが（GDRIVE_CLIENT_SECRET）、
  シェル履歴に残らない getpass での入力を第一手段として推奨する。

前提: Google Cloud 側で以下が完了していること（docs/T12_P5_5_SETUP_GUIDE.md 参照）
  - Google Drive API 有効化
  - OAuth 同意画面の構成（スコープ drive.file、テストユーザー登録済み）
  - OAuth クライアントID（種類: デスクトップ アプリ）の発行
"""

import argparse
import getpass
import os
import sys

# NOTE: import 時にネットワークアクセスは発生しない。
#       google_auth_oauthlib / googleapiclient は実行時（main 内）で
#       import することで、`--help` 実行時に不要な副作用・依存エラーが
#       出ないようにする。

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
BACKUP_FOLDER_NAME = "Lulumi Tools DB Backup"
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

REFRESH_TOKEN_WARNING = (
    "警告: refresh token は秘密情報です。第三者と共有せず、"
    "Git にコミットしたり、チャット・チケット等に貼り付けたりしないでください。"
    "GitHub Secrets への登録にのみ使用してください。"
)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Google Drive バックアップ用の refresh token 取得と "
            "専用フォルダ作成を行う初期設定スクリプト（ローカルで1回だけ実行）。"
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
        # allow_abbrev=False: 略記マッチにより --client-secret が
        # --client-secrets-file の省略形として誤って受理されるのを防ぐ
        # （--client-secret は廃止済みで、明示的に未定義でなければならない）。
        allow_abbrev=False,
    )
    parser.add_argument(
        "--client-id",
        default=os.environ.get("GDRIVE_CLIENT_ID"),
        help=(
            "OAuth クライアントID（デスクトップ アプリ）。未指定時は環境変数 GDRIVE_CLIENT_ID を使用。"
            "--client-secrets-file を指定する場合は不要。"
        ),
    )
    parser.add_argument(
        "--client-secrets-file",
        default=None,
        metavar="PATH",
        help=(
            "Google Cloud が発行する client_secret_*.json のパス。"
            "指定した場合はこのファイルの内容のみで認証し、--client-id / getpass 入力は不要になる。"
            "このファイル自体はスクリプトが作成・削除・改変しない（パスのみを扱い、中身をログに出さない）。"
        ),
    )
    # NOTE: --client-secret は意図的に定義しない。
    #       コマンドライン引数はシェル履歴・`ps` のプロセス一覧に残るため、
    #       client secret の入力手段としては使わない
    #       （getpass での非表示入力 / --client-secrets-file / 環境変数のみ許可）。
    #       誤って --client-secret を渡した場合は argparse が
    #       「unrecognized arguments」としてエラー終了する。
    return parser.parse_args(argv)


def _is_ci_environment():
    """CI（GitHub Actions 等）上での実行かどうかを判定する。

    このスクリプトはローカル専用（refresh token を画面表示するため）。
    CI 上での実行・表示は許可しない。
    """
    return bool(os.environ.get("GITHUB_ACTIONS") or os.environ.get("CI"))


def _resolve_client_secret_interactively():
    """client secret を環境変数、無ければ getpass の非表示入力で取得する。

    コマンドライン引数では受け付けない（シェル履歴・プロセス一覧への漏えい防止）。
    """
    env_secret = os.environ.get("GDRIVE_CLIENT_SECRET")
    if env_secret:
        return env_secret
    return getpass.getpass(
        "Client secret を入力してください（画面には表示されません）: "
    )


def _build_client_config(client_id, client_secret):
    """InstalledAppFlow に渡すクライアント設定（メモリ上のみ・ファイル化しない）。"""
    return {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }


def _run_oauth_flow(client_id=None, client_secret=None, client_secrets_file=None):
    """ブラウザでOAuth同意を行い、drive.file スコープの Credentials を返す。

    refresh token を確実に得るため access_type='offline' / prompt='consent' を明示する。
    InstalledAppFlow はトークンをファイルへ保存しないため、token.json 等は作られない。

    client_secrets_file が指定されていればそれを最優先で使い、
    そうでなければ client_id / client_secret から構築したメモリ上の設定を使う。
    """
    from google_auth_oauthlib.flow import InstalledAppFlow

    if client_secrets_file:
        flow = InstalledAppFlow.from_client_secrets_file(
            client_secrets_file, scopes=SCOPES
        )
    else:
        client_config = _build_client_config(client_id, client_secret)
        flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)

    credentials = flow.run_local_server(
        port=0,
        access_type="offline",
        prompt="consent",
    )
    return credentials


def _find_or_create_backup_folder(credentials):
    """専用フォルダを検索し、無ければ作成して folder_id を返す（冪等）。"""
    from googleapiclient.discovery import build

    service = build("drive", "v3", credentials=credentials, cache_discovery=False)

    query = (
        f"mimeType='{FOLDER_MIME_TYPE}' and name='{BACKUP_FOLDER_NAME}' "
        "and trashed=false"
    )
    response = service.files().list(
        q=query,
        spaces="drive",
        fields="files(id, name)",
        pageSize=10,
    ).execute()

    existing_files = response.get("files", [])
    if existing_files:
        # 既存フォルダを再利用する（再実行で増殖させない）
        return existing_files[0]["id"], False

    file_metadata = {
        "name": BACKUP_FOLDER_NAME,
        "mimeType": FOLDER_MIME_TYPE,
    }
    created = service.files().create(body=file_metadata, fields="id").execute()
    return created["id"], True


def _cleanup_stray_token_files():
    """InstalledAppFlow がカレントディレクトリ等に token.json 等を作った場合に備え、
    既知のファイル名を確実に削除する（本スクリプトの通常経路では作られない想定）。
    """
    stray_candidates = ["token.json", "credentials.json"]
    for name in stray_candidates:
        if os.path.exists(name):
            try:
                os.remove(name)
            except OSError:
                # 削除に失敗しても、ここでは経過を要約のみ表示し詳細（パス等）は出さない
                print(
                    f"[警告] 一時ファイル {name} の削除に失敗しました。手動で削除してください。",
                    file=sys.stderr,
                )


def main(argv=None):
    args = parse_args(argv)

    if _is_ci_environment():
        print(
            "エラー: このスクリプトはローカル専用です。"
            "CI（GitHub Actions 等、GITHUB_ACTIONS または CI 環境変数が設定された環境）"
            "での実行は許可されていません。"
            "refresh token はローカルPCで取得し、GitHub Secrets に手動登録してください。",
            file=sys.stderr,
        )
        return 3

    client_id = None
    client_secret = None
    client_secrets_file = args.client_secrets_file

    if not client_secrets_file:
        client_id = args.client_id
        if not client_id:
            print(
                "エラー: --client-id を指定するか環境変数 GDRIVE_CLIENT_ID を設定するか、"
                "--client-secrets-file でファイルを指定してください。",
                file=sys.stderr,
            )
            return 2

        client_secret = _resolve_client_secret_interactively()
        if not client_secret:
            print("エラー: client secret が入力されませんでした。", file=sys.stderr)
            return 2

    try:
        print("ブラウザで Google アカウントの認証を行います...")
        credentials = _run_oauth_flow(
            client_id=client_id,
            client_secret=client_secret,
            client_secrets_file=client_secrets_file,
        )

        if not credentials.refresh_token:
            print(
                "エラー: refresh token を取得できませんでした。"
                "Google アカウントの「サードパーティ アプリのアクセス権」で本アプリの"
                "アクセスを一度取り消してから再実行してください"
                "（同意画面が再表示されず refresh token が発行されないことがあります）。",
                file=sys.stderr,
            )
            return 1

        print("専用バックアップフォルダを確認・作成しています...")
        folder_id, created = _find_or_create_backup_folder(credentials)

        print("")
        print("=== 取得結果（この値を控えて GitHub Secrets に登録してください） ===")
        print(f"refresh_token: {credentials.refresh_token}")
        print(REFRESH_TOKEN_WARNING)
        print(f"backup_folder_id: {folder_id}")
        print("")
        if created:
            print(f"フォルダ「{BACKUP_FOLDER_NAME}」を新規作成しました。")
        else:
            print(f"既存のフォルダ「{BACKUP_FOLDER_NAME}」を再利用しました（新規作成なし）。")

        return 0
    except Exception as exc:  # noqa: BLE001 - 秘密情報をトレースに出さないため要約する
        print(
            f"エラー: 初期設定に失敗しました（{type(exc).__name__}）。"
            "詳細はクライアントシークレット等の秘密情報を含む可能性があるため要約のみ表示します。",
            file=sys.stderr,
        )
        return 1
    finally:
        # ローカル変数の参照を早めに手放す（ベストエフォート。GC 上の確実な消去は保証しない）
        client_secret = None
        _cleanup_stray_token_files()


if __name__ == "__main__":
    sys.exit(main())
