"""Google Drive バックアップの保持・削除ロジック(T12 P5.5, commit3)。

docs/IMPL_PLAN_T12_P5_5_GOOGLE_DRIVE_BACKUP.md §2.3・§2.4 の実装。

このモジュールは**削除の計画だけを立てる**(実際の Drive API 削除呼び出し
(``gdrive_backup.delete_backup``)は行わない)。これにより §2.4 の安全
ガードをネットワークを一切モックせずに単体テストできる。

安全ガード(§2.4「安全側に倒す」)一覧:
    - ファイル名がバックアップ形式(``ranking-db-*.db.gz``、§2.3)に一致しない
      ファイルは、一覧に含まれていても一切対象にしない(解釈しない = 削除
      対象にも保持数にも数えない)。フォルダに想定外のファイルが混在して
      いても誤って触らないための保守的な判断。
    - **8 UTC日以上前(age_days >= 8)のみ**削除候補になる(「直近7日保持・
      8日以上前のみ削除」)。
    - **同日中に複数世代がある場合は最新のみ残す**(§2.3)。この重複排除は
      年齢に関係なく行う(今日アップロードした新規世代と同日の古い世代も
      対象)。
    - 上記2つの削除候補をすべて適用した結果、残る世代数が
      ``min_keep``(既定2 = 「新規世代 + 直前の正常世代」)を下回るなら、
      **削除は一切実行せず**警告を返す(fail safe: 消しすぎるくらいなら
      消さない)。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

import gdrive_backup as gd

RETENTION_DAYS = 7  # "直近7 UTC日分を保持"(§2.4、参考値。実際の判定は下記 DELETE_AGE_DAYS)
DELETE_AGE_DAYS = 8  # "8日以上前のみ削除"(age_days >= この値で削除候補)
MIN_KEEP = 2  # "新規世代 + 直前の正常世代" 以上を残す


@dataclass(frozen=True)
class BackupEntry:
    file_id: str
    name: str
    date: str  # "YYYY-MM-DD" (UTC)
    time: str  # "HHMMSS" (UTC)
    run_id: str

    @property
    def sort_key(self) -> tuple[str, str, str]:
        return (self.date, self.time, self.run_id)


@dataclass(frozen=True)
class RetentionPlan:
    keep: list[BackupEntry]
    delete: list[BackupEntry]
    warning: str | None = None


def parse_entry(file_metadata: dict) -> BackupEntry | None:
    """Drive の ``files().list()``/``files().create()`` メタデータ dict から
    ``BackupEntry`` を作る。ファイル名がバックアップ形式に一致しない、または
    file id が無い場合は ``None``(=対象外)。
    """
    name = file_metadata.get("name") or ""
    parsed = gd.parse_backup_filename(name)
    if parsed is None:
        return None
    file_id = file_metadata.get("id")
    if not file_id:
        return None
    return BackupEntry(
        file_id=file_id,
        name=name,
        date=parsed["date"],
        time=parsed["time"],
        run_id=parsed["run_id"],
    )


def _age_days(entry_date: str, now_utc: datetime) -> int:
    entry_day = date.fromisoformat(entry_date)
    today = now_utc.astimezone(timezone.utc).date()
    return (today - entry_day).days


def plan_retention(
    existing: list[BackupEntry],
    new_entry: BackupEntry,
    *,
    now_utc: datetime,
    delete_age_days: int = DELETE_AGE_DAYS,
    min_keep: int = MIN_KEEP,
) -> RetentionPlan:
    """``existing``(新規アップロード分を含まない、パース済みの現行世代一覧)
    と ``new_entry``(今回アップロードした世代)から削除計画を立てる。

    ``existing`` に ``new_entry`` と同じ ``file_id`` を含めてはいけない
    (呼び出し元が Drive 一覧から新規分を除いてから渡す前提)。
    """
    all_entries = list(existing) + [new_entry]

    # 1) 同日重複排除: 同一 UTC 日に複数世代があれば最新のみ残す。
    by_date: dict[str, list[BackupEntry]] = {}
    for entry in all_entries:
        by_date.setdefault(entry.date, []).append(entry)

    dedup_delete_ids: set[str] = set()
    for entries_on_date in by_date.values():
        if len(entries_on_date) <= 1:
            continue
        newest = max(entries_on_date, key=lambda e: e.sort_key)
        for entry in entries_on_date:
            if entry.file_id != newest.file_id:
                dedup_delete_ids.add(entry.file_id)

    survivors = [e for e in all_entries if e.file_id not in dedup_delete_ids]

    # 2) 経過日数による削除(重複排除後の生存者のみを対象に判定)。
    age_delete_ids = {
        e.file_id for e in survivors if _age_days(e.date, now_utc) >= delete_age_days
    }

    delete_ids = dedup_delete_ids | age_delete_ids
    keep_entries = [e for e in all_entries if e.file_id not in delete_ids]
    delete_entries = [e for e in all_entries if e.file_id in delete_ids]

    # 3) 最低保持数ガード: 削除後に min_keep を下回るなら一切削除しない。
    if len(keep_entries) < min_keep:
        return RetentionPlan(
            keep=all_entries,
            delete=[],
            warning=(
                f"削除計画を実行すると残る世代数が{len(keep_entries)}件"
                f"(最低{min_keep}件必要)になるため、削除を中止しました。"
                f"削除予定だった件数: {len(delete_entries)}件。"
            ),
        )

    return RetentionPlan(keep=keep_entries, delete=delete_entries, warning=None)
