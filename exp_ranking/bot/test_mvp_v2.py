from __future__ import annotations

import json
from pathlib import Path

from level_exp import EXP_TABLE_VERSION
from analysis import build_analysis_rows
from models import SnapshotRow
from mvp_export import build_mvp_payload, build_v2_payloads, export_mvp_v2_json


def _snapshots() -> list[SnapshotRow]:
    return [
        SnapshotRow("2026-07-01", 1, 0, "Alpha", "", "", 240, 100, "", "asset-a"),
        SnapshotRow("2026-07-01", 2, 0, "Beta", "", "", 240, 100, "", "asset-b"),
        SnapshotRow("2026-07-02", 1, 0, "Alpha", "", "", 240, 300, "", "asset-a"),
        SnapshotRow("2026-07-02", 2, 0, "Beta", "", "", 240, 200, "", "asset-b"),
    ]


def test_v2_summary_and_shards_preserve_all_histories() -> None:
    snapshots = _snapshots()
    payload = build_mvp_payload(
        snapshots,
        build_analysis_rows(snapshots),
        latest_snapshot_date="2026-07-02",
        history_days=35,
    )
    summary, shards = build_v2_payloads(payload, shard_count=4)

    assert summary["meta"]["dataFormatVersion"] == 2
    assert summary["meta"]["expTableVersion"] == EXP_TABLE_VERSION
    assert summary["meta"]["historyBasePath"] == "history/2026-07-02"
    assert all("history" not in character for character in summary["characters"])
    assert all("historyKey" in character for character in summary["characters"])

    histories = {
        history_key: history
        for shard in shards
        for history_key, history in shard.items()
    }
    assert set(histories) == {"asset:asset-a", "asset:asset-b"}
    assert histories["asset:asset-a"][-1]["dailyRank"] == 1
    assert histories["asset:asset-b"][-1]["dailyRank"] == 2


def test_v2_export_writes_versioned_compact_shards(tmp_path: Path) -> None:
    snapshots = _snapshots()
    payload = build_mvp_payload(
        snapshots,
        build_analysis_rows(snapshots),
        latest_snapshot_date="2026-07-02",
        history_days=35,
    )
    summary_path = export_mvp_v2_json(
        payload,
        tmp_path / "rankings.json",
        shard_count=4,
    )

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert len(list((summary_path.parent / "history" / "2026-07-02").glob("shard-*.json"))) == 4
    assert "\n" not in summary_path.read_text(encoding="utf-8")
    assert summary["meta"]["historyShardCount"] == 4
