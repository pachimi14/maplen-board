from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path


FORMAT_VERSION = 1
DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60
DEFAULT_MAX_ENTRIES = 10_000
MAX_TEXT_LENGTH = 500
MAX_IMAGE_URL_LENGTH = 2_048
ITEM_IMAGE_PREFIX = "https://api-static.msu.io/itemimages/"


class ItemMetadataStore:
    """Bounded server-side cache for normalized public item metadata only."""

    def __init__(
        self,
        path: str | os.PathLike[str],
        *,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        clock=time.time,
    ) -> None:
        self.path = Path(path).expanduser().absolute()
        self.ttl_seconds = max(int(ttl_seconds), 1)
        self.max_entries = max(int(max_entries), 1)
        self.clock = clock
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=2.0)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS item_metadata_cache (
                    item_id INTEGER PRIMARY KEY CHECK (item_id > 0),
                    item_name TEXT NOT NULL,
                    category_label TEXT NOT NULL,
                    tier0 TEXT NOT NULL,
                    tier1 TEXT NOT NULL,
                    image_url TEXT NOT NULL,
                    fetched_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    format_version INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                "DELETE FROM item_metadata_cache WHERE expires_at <= ? OR format_version != ?",
                (self.clock(), FORMAT_VERSION),
            )
        if os.name != "nt":
            os.chmod(self.path, 0o600)

    @staticmethod
    def _normalized(item_id: int, metadata: dict) -> dict | None:
        if not isinstance(item_id, int) or isinstance(item_id, bool) or item_id <= 0:
            return None
        if not isinstance(metadata, dict) or metadata.get("itemId") != item_id:
            return None
        values = {}
        for key in ("itemName", "categoryLabel", "tier0", "tier1", "imageUrl"):
            value = metadata.get(key, "")
            if not isinstance(value, str):
                return None
            limit = MAX_IMAGE_URL_LENGTH if key == "imageUrl" else MAX_TEXT_LENGTH
            if len(value) > limit:
                return None
            values[key] = value
        if not values["itemName"]:
            return None
        if values["imageUrl"] and not values["imageUrl"].startswith(ITEM_IMAGE_PREFIX):
            return None
        return {"itemId": item_id, **values}

    def load(self, item_id: int, *, now: float | None = None) -> tuple[dict, float] | None:
        current = self.clock() if now is None else now
        try:
            with self._lock, self._connect() as connection:
                row = connection.execute(
                    """
                    SELECT item_id, item_name, category_label, tier0, tier1, image_url,
                           expires_at, format_version
                    FROM item_metadata_cache
                    WHERE item_id = ?
                    """,
                    (item_id,),
                ).fetchone()
                if row is None:
                    return None
                if row["expires_at"] <= current or row["format_version"] != FORMAT_VERSION:
                    connection.execute("DELETE FROM item_metadata_cache WHERE item_id = ?", (item_id,))
                    return None
                metadata = {
                    "itemId": row["item_id"],
                    "itemName": row["item_name"],
                    "categoryLabel": row["category_label"],
                    "tier0": row["tier0"],
                    "tier1": row["tier1"],
                    "imageUrl": row["image_url"],
                }
                normalized = self._normalized(item_id, metadata)
                if normalized is None:
                    connection.execute("DELETE FROM item_metadata_cache WHERE item_id = ?", (item_id,))
                    return None
                return normalized, max(0.0, row["expires_at"] - current)
        except (OSError, sqlite3.Error):
            return None

    def save(self, item_id: int, metadata: dict, *, now: float | None = None) -> bool:
        normalized = self._normalized(item_id, metadata)
        if normalized is None:
            return False
        current = self.clock() if now is None else now
        expires_at = current + self.ttl_seconds
        try:
            with self._lock, self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO item_metadata_cache (
                        item_id, item_name, category_label, tier0, tier1, image_url,
                        fetched_at, expires_at, format_version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(item_id) DO UPDATE SET
                        item_name = excluded.item_name,
                        category_label = excluded.category_label,
                        tier0 = excluded.tier0,
                        tier1 = excluded.tier1,
                        image_url = excluded.image_url,
                        fetched_at = excluded.fetched_at,
                        expires_at = excluded.expires_at,
                        format_version = excluded.format_version
                    """,
                    (
                        item_id,
                        normalized["itemName"],
                        normalized["categoryLabel"],
                        normalized["tier0"],
                        normalized["tier1"],
                        normalized["imageUrl"],
                        current,
                        expires_at,
                        FORMAT_VERSION,
                    ),
                )
                connection.execute(
                    """
                    DELETE FROM item_metadata_cache
                    WHERE item_id IN (
                        SELECT item_id FROM item_metadata_cache
                        ORDER BY fetched_at DESC, item_id DESC
                        LIMIT -1 OFFSET ?
                    )
                    """,
                    (self.max_entries,),
                )
            return True
        except (OSError, sqlite3.Error):
            return False

    def count(self) -> int:
        try:
            with self._lock, self._connect() as connection:
                row = connection.execute("SELECT COUNT(*) AS count FROM item_metadata_cache").fetchone()
                return int(row["count"]) if row is not None else 0
        except (OSError, sqlite3.Error):
            return 0