"""Generate static SEO image assets for maplen-board (lulumi-tools.com).

Dev-only tool. NOT run by `npm run build` or the Pages workflow — the
generated files are committed to `public/` and copied as-is at build time.

Outputs (written to exp_ranking/web/public/):
  - favicon.ico          (16/32/48 multi-size ICO)
  - apple-touch-icon.png (180x180)
  - og.png               (1200x630)

Design: generic rounded-square mark with the letter "L" (Lulumi Tools),
no official game assets / no Nexon logo. Colors and layout are fixed
constants so re-running this script produces byte-identical output
(no randomness, no timestamps).

Requires Pillow (dev dependency only, not part of the npm/web build):
  pip install Pillow

Usage:
  python scripts/generate-seo-assets.py
(run from exp_ranking/web/)
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Fixed brand constants (deterministic — do not derive from time/random)
# ---------------------------------------------------------------------------

BG_COLOR = (15, 23, 42)  # #0f172a (slate-950, matches theme-color)
ACCENT_COLOR = (251, 191, 36)  # #fbbf24 (amber-400)
WHITE = (255, 255, 255)
MUTED = (148, 163, 184)  # #94a3b8 (slate-400)

BRAND_MARK_LETTER = "L"
BRAND_TITLE = "Lulumi Tools"
BRAND_SUBTITLE = "MapleStory N EXP Ranking"
BRAND_TAGLINE = "Daily / Weekly / Monthly EXP Rankings"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(WEB_ROOT, "public")

# Fixed system font paths (Windows). Deterministic fallback chain — if none
# of these exist, Pillow's built-in bitmap font is used (still deterministic,
# just visually plain).
FONT_CANDIDATES_BOLD = [
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
]
FONT_CANDIDATES_REGULAR = [
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
]


def _load_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for path in candidates:
        if os.path.isfile(path):
            return ImageFont.truetype(path, size)
    # Deterministic fallback: Pillow's built-in bitmap font (fixed size).
    return ImageFont.load_default()


def _draw_centered_text(draw: ImageDraw.ImageDraw, xy, text, font, fill):
    """Draw text centered on the given (x, y) point."""
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = xy[0] - w / 2 - bbox[0]
    y = xy[1] - h / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=fill)


def _draw_brand_mark(size: int) -> Image.Image:
    """Rounded-square dark background with the amber 'L' mark, centered."""
    img = Image.new("RGB", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)
    radius = round(size * 0.22)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG_COLOR)
    font = _load_font(FONT_CANDIDATES_BOLD, round(size * 0.62))
    _draw_centered_text(
        draw,
        (size / 2, size / 2 + size * 0.03),
        BRAND_MARK_LETTER,
        font,
        ACCENT_COLOR,
    )
    return img


def generate_favicon_ico() -> str:
    base = _draw_brand_mark(256)
    out_path = os.path.join(PUBLIC_DIR, "favicon.ico")
    base.save(out_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    return out_path


def generate_apple_touch_icon() -> str:
    # Apple applies its own corner mask, so use a plain (non-rounded) square.
    size = 180
    img = Image.new("RGB", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)
    font = _load_font(FONT_CANDIDATES_BOLD, round(size * 0.62))
    _draw_centered_text(
        draw, (size / 2, size / 2 + size * 0.03), BRAND_MARK_LETTER, font, ACCENT_COLOR
    )
    out_path = os.path.join(PUBLIC_DIR, "apple-touch-icon.png")
    img.save(out_path, format="PNG")
    return out_path


def generate_og_image() -> str:
    width, height = 1200, 630
    img = Image.new("RGB", (width, height), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Brand mark on the left.
    mark_size = 260
    mark = _draw_brand_mark(mark_size)
    mark_pos = (90, (height - mark_size) // 2)
    img.paste(mark, mark_pos)

    # Text block on the right.
    text_x = mark_pos[0] + mark_size + 60
    title_font = _load_font(FONT_CANDIDATES_BOLD, 64)
    subtitle_font = _load_font(FONT_CANDIDATES_BOLD, 46)
    tagline_font = _load_font(FONT_CANDIDATES_REGULAR, 30)

    draw.text((text_x, 210), BRAND_TITLE, font=title_font, fill=WHITE)
    draw.text((text_x, 300), BRAND_SUBTITLE, font=subtitle_font, fill=ACCENT_COLOR)
    draw.text((text_x, 372), BRAND_TAGLINE, font=tagline_font, fill=MUTED)

    out_path = os.path.join(PUBLIC_DIR, "og.png")
    img.save(out_path, format="PNG")
    return out_path


def main() -> None:
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    paths = [
        generate_favicon_ico(),
        generate_apple_touch_icon(),
        generate_og_image(),
    ]
    for path in paths:
        print(f"generated: {path}")


if __name__ == "__main__":
    main()
