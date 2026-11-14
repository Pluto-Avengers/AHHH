"""Stitch the NASA Mars Trek Viking MDIM 2.1 colour mosaic (the same tiles the Map page uses)
into one equirectangular image for the home-page globe.

Usage:  python scripts/export_globe_texture.py [zoom]
Zoom 3 gives 16 x 8 tiles of 256 px = 4096 x 2048. Output: public/textures/mars.jpg
"""
import io
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

TILES = (
    "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/"
    "1.0.0/default/default028mm/{z}/{y}/{x}.jpg"
)
OUT = Path(__file__).resolve().parent.parent / "public" / "textures" / "mars.jpg"


def fetch(z, y, x):
    req = urllib.request.Request(TILES.format(z=z, y=y, x=x), headers={"User-Agent": "mars-globe-export"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return y, x, Image.open(io.BytesIO(r.read())).convert("RGB")


def main():
    z = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    cols, rows = 2 ** (z + 1), 2 ** z  # EPSG:4326 tiling: twice as wide as tall
    img = Image.new("RGB", (cols * 256, rows * 256))
    with ThreadPoolExecutor(8) as pool:
        for y, x, tile in pool.map(lambda t: fetch(z, *t), [(y, x) for y in range(rows) for x in range(cols)]):
            img.paste(tile, (x * 256, y * 256))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, quality=85, optimize=True, progressive=True)
    print(f"wrote {OUT} ({img.width}x{img.height}, {OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
