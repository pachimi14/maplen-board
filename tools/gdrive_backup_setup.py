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
     コマンドライン引数または環境変数から読み込む
  2. ブラウザを開き、本人の Google アカウントで OAuth 同意を行う
  3. drive.file スコープで refresh token を取得する
     （access_type=offline, prompt=consent を明示し、確実に
     refresh token が返るようにする）
  4. 専用フォルダ「Lulumi Tools DB Backup」を作成する（同名フォルダが
     既にこのアプリのスコープから見える場合は新規作成せず、その ID を返す）
  5. refresh token と folder ID を、ラベル付きで別々の行に標準出力へ表示する
  6. token / client secret をファイルへ恒久保存しない
     （InstalledAppFlow が一時ファイルを作る場合は確実に削除する）
  7. 実行ログ・例外メッセージに秘密情報を含めない

このスクリプトが行わないこと:
  - GitHub Secrets への登録（ユーザーが手動で行う）
  - バックアップ本体のアップロード・検証・保持ロジック（次段階で実装）
  - workflow への組み込み

使い方:
  pip install -r requirements-backup-setup.txt
  python tools/gdrive_backup_setup.py --client-id <ID> --client-secret <SECRET>

  クライアント情報は環境変数でも指定できる:
    GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET

前提: Google Cloud 側で以下が完了していること（docs/T12_P5_5_SETUP_GUIDE.md 参照）
  - Google Drive API 有効化
  - OAuth 同意画面の構成（スコープ drive.file、テストユーザー登録済み）
  - OAuth クライアントID（種類: デスクトップ アプリ）の発行
"""

import argparse
import os
import sys

# NOTE: import 時にネットワークアクセスは発生しない。
#       google_auth_oauthlib / googleapiclient は実行時（main 内）で
#       import することで、`--help` 実行時に不要な副作用・依存エラーが
#       出ないようにする。

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
BACKUP_FOLDER_NAME = "Lulumi Tools DB Backup"
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Google Drive バックアップ用の refresh token 取得と "
            "専用フォルダ作成を行う初期設定スクリプト（ローカルで1回だけ実行）。"
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--client-id",
        default=os.environ.get("GDRIVE_CLIENT_ID"),
        help="OAuth クライアントID（デスクトップ アプリ）。未指定時は環境変数 GDRIVE_CLIENT_ID を使用。",
    )
    parser.add_argument(
        "--client-secret",
        default=os.environ.get("GDRIVE_CLIENT_SECRET"),
        help=(
            "OAuth クライアントシークレット。未指定時は環境変数 GDRIVE_CLIENT_SECRET を使用。"
            "（この値は標準出力に表示されません）"
        ),
    )
    return parser.parse_args(argv)


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


def _run_oauth_flow(client_id, client_secret):
    """ブラウザでOAuth同意を行い、drive.file スコープの Credentials を返す。

    refresh token を確実に得るため access_type='offline' / prompt='consent' を明示する。
    InstalledAppFlow はトークンをファイルへ保存しないため、token.json 等は作られない。
    """
    from google_auth_oauthlib.flow import InstalledAppFlow

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

    if not args.client_id or not args.client_secret:
        print(
            "エラー: --client-id / --client-secret を指定するか、"
            "環境変数 GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET を設定してください。",
            file=sys.stderr,
        )
        return 2

    try:
        print("ブラウザで Google アカウントの認証を行います...")
        credentials = _run_oauth_flow(args.client_id, args.client_secret)

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
        _cleanup_stray_token_files()


if __name__ == "__main__":
    sys.exit(main())
