"""Build the Open Graph share image from a screenshot.

Facebook, LinkedIn, iMessage and friends want a 1200x630 image (1.91:1). A raw browser
screenshot is never that shape -- a 1885x1030 capture is 1.83:1 -- so something has to
give. This letterboxes rather than crops: the whole screenshot survives, centred on the
page's own dark background, so the strip looks like an extension of the site instead of
a cropped fragment with the day picker or the tab bar sliced off.

    .venv311\\Scripts\\python scripts/make_og_image.py <screenshot.png>

Writes web/public/og.png at exactly the size app/layout.tsx declares. Re-run it whenever
the screenshot changes; the declared dimensions and the file cannot drift apart because
this script is the only thing that writes the file.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

# Must match the width/height in web/app/layout.tsx.
OG_WIDTH, OG_HEIGHT = 1200, 630

# The app's dark-theme page background (--sky-top in web/app/globals.css), so the bars
# added around the screenshot read as part of the design rather than as empty padding.
BACKGROUND = (6, 21, 39)

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = REPO_ROOT / "web" / "public" / "og.png"


def build(source: Path, output: Path = OUTPUT) -> None:
    with Image.open(source) as raw:
        shot = raw.convert("RGB")

    # Scale to fit inside the frame, preserving aspect ratio. `min` (not `max`) is the
    # letterbox: the whole image fits, and the leftover becomes background.
    scale = min(OG_WIDTH / shot.width, OG_HEIGHT / shot.height)
    size = (max(1, round(shot.width * scale)), max(1, round(shot.height * scale)))
    shot = shot.resize(size, Image.LANCZOS)

    canvas = Image.new("RGB", (OG_WIDTH, OG_HEIGHT), BACKGROUND)
    canvas.paste(shot, ((OG_WIDTH - size[0]) // 2, (OG_HEIGHT - size[1]) // 2))

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, "PNG", optimize=True)

    kb = output.stat().st_size / 1024
    print(f"{source.name} {raw.size} -> {output.relative_to(REPO_ROOT)} "
          f"{canvas.size} ({kb:.0f} KB)")
    if kb > 8 * 1024:
        print("  warning: over 8 MB, which some scrapers refuse to fetch")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    source = Path(sys.argv[1])
    if not source.is_file():
        print(f"no such file: {source}")
        return 1
    build(source)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
