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

OUT = Path(__file__).resolve().parent.parent / "public" / "textures" / "mars.jpg"


class GlobeTextureExporter:
    TILES = (
        "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/"
        "1.0.0/default/default028mm/{z}/{y}/{x}.jpg"
    )
    TILE_PX = 256

    def __init__(self, zoom=3, out=OUT):
        self.zoom = zoom
        self.out = Path(out)
        self.cols, self.rows = 2 ** (zoom + 1), 2 ** zoom  # EPSG:4326 tiling: twice as wide as tall

    def export(self):
        size = self.TILE_PX
        img = Image.new("RGB", (self.cols * size, self.rows * size))
        cells = [(y, x) for y in range(self.rows) for x in range(self.cols)]
        with ThreadPoolExecutor(8) as pool:
            for y, x, tile in pool.map(lambda yx: self._fetch(*yx), cells):
                img.paste(tile, (x * size, y * size))
        self.out.parent.mkdir(parents=True, exist_ok=True)
        img.save(self.out, quality=85, optimize=True, progressive=True)
        print(f"wrote {self.out} ({img.width}x{img.height}, {self.out.stat().st_size // 1024} KB)")

    def _fetch(self, y, x):
        url = self.TILES.format(z=self.zoom, y=y, x=x)
        req = urllib.request.Request(url, headers={"User-Agent": "mars-globe-export"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return y, x, Image.open(io.BytesIO(r.read())).convert("RGB")


if __name__ == "__main__":
    GlobeTextureExporter(int(sys.argv[1]) if len(sys.argv) > 1 else 3).export()
