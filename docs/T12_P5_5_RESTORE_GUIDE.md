# T12 P5.5 — Google Drive バックアップからの復元手順

> 対象: `docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md` の受け入れ基準 §3-12「復元手順の実証」に対応するドキュメント。
> **復元は手動手順のみ**(§1「今回決めない・やらない」: 自動復元の本番組み込みはしない)。このドキュメントの手順を人間が実行する。
> **秘密情報(refresh token・client secret 等)は誰にも共有しないでください**(統括にも実装担当にも)。

## 0. いつ使うか

Google Drive バックアップは「GitHub Release `db-store` が誤上書き・誤削除・破損した場合」の世代退避です(§0 の3層表)。**通常運用では使いません**。以下のいずれかが起きたときにのみ使う想定です。

- Release Asset (`db-store` タグの `ranking.db.gz`)が消えた、または壊れた(gzip 展開できない/SQLite として open できない)
- Release Asset の内容が想定より大きく退行している(誤って古い内容で `--clobber` された等)
- Release 自体が誤って削除された

**先に確認すること**: Release Asset 自体が本当に壊れているか(`gh release view db-store` / `gh release download db-store --pattern ranking.db.gz`)。壊れていなければ Drive からの復元は不要です(Release が正、§0)。

## 1. 前提

- あなたが Google Drive バックアップの OAuth 設定を行った本人の Google アカウントでログインできること(`docs/T12_P5_5_SETUP_GUIDE.md` で使ったアカウント)
- `gh` CLI がローカルにインストール済みで、対象リポジトリへの `contents: write` 権限があること(Release Asset を書き戻すため)
- Python 3.12 + `exp_ranking/bot/requirements.txt` がインストール済み(gzip 展開・SQLite 検証・Release アップロードに使う)

## 2. 手順A(推奨): Google Drive の Web UI からダウンロードして復元する

`drive.file` スコープはあくまで「API 経由でアプリがアクセスできる範囲」の制限であり、**あなた自身が Google Drive の Web UI(drive.google.com)でファイルを見る分には制限されません**(バックアップ用フォルダ「`Lulumi Tools DB Backup`」はあなたの My Drive 内にあるので、通常のファイルと同じように見えます)。スクリプトも認証情報も不要な、最もシンプルな経路です。

### 2-1. 復元したい世代を選ぶ
1. https://drive.google.com/ を開き、マイドライブの「`Lulumi Tools DB Backup`」フォルダを開く
2. ファイル名は `ranking-db-<YYYY-MM-DD>T<HHMMSS>Z-run-<run_id>.db.gz` の形式(§2.3)。**日付は UTC**(JST ではない点に注意)
3. 復元したい日付・時刻のファイルを選び、ダウンロードする(直近7日分程度が残っている前提、§2.4)

### 2-2. ダウンロードしたファイルを検証する

いきなり Release へ書き戻さず、まず手元で健全性を確認する。リポジトリの `exp_ranking/bot` ディレクトリで:

```bash
cd exp_ranking/bot
python -c "
import gzip
import sqlite3
from pathlib import Path

gz_path = Path('/path/to/downloaded/ranking-db-....db.gz')  # ダウンロードしたファイルに置き換える
db_path = Path('restored_from_drive.db')

with gzip.open(gz_path, 'rb') as src, open(db_path, 'wb') as dst:
    dst.write(src.read())

with sqlite3.connect(db_path) as conn:
    rows = conn.execute('SELECT COUNT(*) FROM ranking_snapshot').fetchone()[0]
    days = conn.execute('SELECT COUNT(DISTINCT snapshot_date) FROM ranking_snapshot').fetchone()[0]
    latest = conn.execute('SELECT MAX(snapshot_date) FROM ranking_snapshot').fetchone()[0]
print(f'rows={rows} snapshot_days={days} latest_date={latest}')
"
```

- `rows` / `snapshot_days` / `latest_date` が期待どおりの規模(直近の運用実績と比べて桁が大きく違わない、`latest_date` が復元したい日付に近い)であることを目視確認する。異常に小さい・0件であれば、そのファイルではなく別の世代を試す。

### 2-3. Release Asset として書き戻す

**この操作は現在の Release Asset を上書きします**(`--clobber`)。壊れている・失われている Release を復旧する場面でのみ実行する。

```bash
cd exp_ranking/bot
gzip -c restored_from_drive.db > ranking.restored.db.gz  # 展開済みDBを再度gzip化
gh release upload db-store ranking.restored.db.gz --clobber
```

- Release Asset の名前は `ranking.db.gz` 固定(`release_store.DB_STORE_ASSET_NAME`)なので、`gh release upload` 実行前に `ranking.restored.db.gz` をそのファイル名にリネームするか、`--clobber` のアップロード先ファイル名を `ranking.db.gz` に揃えること。例:

  ```bash
  mv ranking.restored.db.gz ranking.db.gz
  gh release upload db-store ranking.db.gz --clobber
  ```

### 2-4. 復元を確認する

1. `gh release download db-store --pattern ranking.db.gz -O /tmp/verify.db.gz --clobber` で再取得し、2-2 と同じ検証(gzip展開→SQLite open→行数/日数/最新日)を行う。書き戻した内容と一致することを確認する。
2. 次回の workflow run(`workflow_dispatch` で手動実行してもよい)で、`Restore ranking database from Release` ステップのログに `release-db-restored=true` と `release-db-bytes=...` が出ること、以降の `main.py` 実行が正常終了することを確認する。
3. 公開データ(v2シャード・Pages)が復元前後で退行していないか、`lulumi-tools.com` の該当キャラ・ランキングを目視確認する。

## 3. 手順B(代替): コマンドラインから Drive API 経由でダウンロードする

Web UI が使えない場合、`gdrive_backup.py` の関数(commit1)をそのまま再利用してコマンドラインから取得することもできる。**refresh token 等の秘密情報を扱うため、実行はローカルPCでのみ行うこと**(CI 上で実行しない)。

```bash
cd exp_ranking/bot
python -c "
import getpass
import gdrive_backup as gd

client_id = input('GDRIVE_CLIENT_ID: ')
client_secret = getpass.getpass('GDRIVE_CLIENT_SECRET (非表示): ')
refresh_token = getpass.getpass('GDRIVE_REFRESH_TOKEN (非表示): ')
folder_id = input('GDRIVE_BACKUP_FOLDER_ID: ')

service = gd.build_drive_service(client_id, client_secret, refresh_token)
files = gd.list_backups(service, folder_id)
for f in sorted(files, key=lambda x: x.get('name', '')):
    print(f.get('name'), f.get('id'), f.get('size'))

# 上の一覧から復元したいファイルの id を選んでダウンロード
file_id = input('ダウンロードする file id: ')
gd.download_backup(service, file_id, 'downloaded.db.gz')
print('saved to downloaded.db.gz')
"
```

- 値はどこにも保存されない(その場で入力・メモリ上のみ)。ダウンロード後は手順A の 2-2 以降(検証 → Release へ書き戻し)と同じ。
- `GDRIVE_CLIENT_ID` / `GDRIVE_BACKUP_FOLDER_ID` は秘密ではないが、`GDRIVE_CLIENT_SECRET` / `GDRIVE_REFRESH_TOKEN` は秘密情報。ターミナル履歴に残らないよう `getpass` を使っている(コマンドライン引数では渡さない)。

## 4. トラブルシューティング

| 症状 | 対応 |
|---|---|
| Drive フォルダに想定より世代が少ない | 保持ポリシーは直近7 UTC日分(§2.4)。それ以前の世代は既に削除されている可能性が高い。より古い復元が必要な場合は v2 シャード(era復元、LULU-062②)を検討する |
| ダウンロードしたファイルが gzip として展開できない | 別の世代を試す。同じ症状が続く場合は Drive 側の破損の可能性があるため、より古い世代・v2 シャードへフォールバックする |
| `gh release upload --clobber` が失敗する | `contents: write` 権限があるか、認証(`gh auth status`)を確認する |
| 復元後も workflow が `release-db-restored=false` を報告する | Asset 名が `ranking.db.gz` になっているか(2-3 参照)、`gh release view db-store` でタグ自体が存在するかを確認する |

## 5. このドキュメントの位置づけ

- 本ドキュメントは手順書であり、**自動復元をトリガーするものではない**(§1)。実行は常に人間が判断して行う。
- 復元ドリル自体(実際に Drive からダウンロードし、DB として開けることを確認する一連の作業)は、受け入れ基準 §3-12・§8 の P6 開始条件チェックリストに対応する。**2026-08-17 に実施・合格済み**(下記 §6)。

## 6. 復元ドリルの実施記録(2026-08-17)

**対象**: `ranking-db-2026-08-17T021549Z-run-31987342633.db.gz`(run `31987342633` = Navigator が作成した世代)

**手順**: 本書 §2「手順A(Web UI からダウンロード)」を、**ユーザーがサブアカウントの Drive Web UI から実際にダウンロード**して実施。統括が受領ファイルを検証した。

| # | 検証 | 結果 |
|---|---|---|
| D1 | ダウンロード実体の SHA-256 が **CI ログの記録値と一致** | ✅ `4829e002a844af24338380e6a597fa274d38982bc6d40a23bf3d15f39793c5db` / size 67,057,127 バイト(CI 記録と完全一致) |
| D2 | **gzip 展開可能** | ✅ 293,720,064 バイトへ展開 |
| D3 | **SQLite として open 可能・健全** | ✅ `PRAGMA integrity_check = ok`。テーブル4種(`app_meta`/`character_meta`/`ranking_snapshot`/`sqlite_sequence`)を確認 |
| D4 | **本番 Release Asset(`db-store`)とバイト完全一致** | ✅ 両者の SHA-256 が同一 = **Drive 世代は Release の完全な複製**。したがって復元は「この実体を Release へ書き戻す」だけで足りる |
| D5 | **統計の突合**(復元DB vs 本番 Release DB) | ✅ **全6項目一致**: 総行数 563,043 / snapshot_days 79 / 最新日 2026-08-16 / 最新日の行数 8,550 / `character_meta` 8,550 / worldId 充填 8,550 |

**結論**: Drive に退避した世代から**本番 DB を復元できることを実証**した。D4 でバイト完全一致が示されたため、§2-3 の「Release へ書き戻す」手順は本ドリルでは**実行していない**(本番の正常な Release Asset を同一内容で上書きする操作になり、実施しても状態が変わらず、失敗時のみリスクがあるため)。書き戻しコマンド自体は §2-3 に記載のとおり `gh release upload db-store ranking.db.gz --clobber` で、T12 P3 以降の CI が毎日実行している経路と同一である。
