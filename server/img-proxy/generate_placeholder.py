from __future__ import annotations

import struct
import zlib
from pathlib import Path


WIDTH = 180
HEIGHT = 180
BACKGROUND = (15, 23, 42, 255)  # #0f172a
ACCENT = (52, 211, 153, 255)  # #34d399
ACCENT_DIM = (31, 123, 103, 255)


def _chunk(kind: bytes, data: bytes) -> bytes:
    payload = kind + data
    return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)


def _inside_ellipse(x: int, y: int, cx: int, cy: int, rx: int, ry: int) -> bool:
    return ((x - cx) * (x - cx)) * (ry * ry) + ((y - cy) * (y - cy)) * (rx * rx) <= (rx * rx) * (ry * ry)


def build_placeholder_png() -> bytes:
    rows: list[bytes] = []
    for y in range(HEIGHT):
        row = bytearray([0])
        for x in range(WIDTH):
            color = BACKGROUND
            if _inside_ellipse(x, y, 90, 72, 35, 35):
                color = ACCENT
            if _inside_ellipse(x, y, 90, 136, 58, 42):
                color = ACCENT_DIM
            if _inside_ellipse(x, y, 90, 132, 43, 31):
                color = ACCENT
            if _inside_ellipse(x, y, 76, 66, 5, 5) or _inside_ellipse(x, y, 104, 66, 5, 5):
                color = BACKGROUND
            row.extend(color)
        rows.append(bytes(row))

    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(raw, 9)) + _chunk(b"IEND", b"")


def main() -> None:
    output = Path(__file__).resolve().parent / "assets" / "placeholder.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(build_placeholder_png())
    print(output)


if __name__ == "__main__":
    main()
