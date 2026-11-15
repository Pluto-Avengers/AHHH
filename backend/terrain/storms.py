"""Dust storms: areas a route must not enter (public/storms.json, shared with the website).

The storms are simulated planning scenarios, not observed weather. Each is an outline of
latitude/longitude points; a grid cell is inside when its centre is inside the outline. The website
(src/core/DustStorm.js) uses the same test, so both plan the same routes around it.
"""

import json
from pathlib import Path

from .files import read_public_file

STORMS_FILE = Path(__file__).resolve().parent.parent.parent / "public" / "storms.json"


class DustStorm:
    def __init__(self, site_id, name, polygon):
        self.site_id = site_id
        self.name = name
        self.polygon = polygon  # [[lat, lon], ...]

    @classmethod
    def load_all(cls, path=STORMS_FILE):
        """{site id: DustStorm} for every site that has one (none if the file is missing)."""
        try:  # from disk, or downloaded from the website when hosted (see files.py)
            data = json.loads(read_public_file("storms.json", path).decode("utf-8"))
        except (OSError, ValueError):
            return {}
        return {sid: cls(sid, s["name"], s["polygon"]) for sid, s in data.get("storms", {}).items()}

    def outline_rc(self, grid):
        """The outline in grid (row, col) coordinates, same formula as TerrainGrid.gridAt in JS."""
        return [
            ((grid.north - lat) / (grid.north - grid.south) * grid.rows, (lon - grid.west) / (grid.east - grid.west) * grid.cols)
            for lat, lon in self.polygon
        ]

    def mask(self, grid):
        """bytearray, 1 for cells whose centre (r, c) is inside the storm."""
        pts = self.outline_rc(grid)
        out = bytearray(grid.rows * grid.cols)
        r_lo = max(0, int(min(p[0] for p in pts)))
        r_hi = min(grid.rows - 1, int(max(p[0] for p in pts)) + 1)
        c_lo = max(0, int(min(p[1] for p in pts)))
        c_hi = min(grid.cols - 1, int(max(p[1] for p in pts)) + 1)
        n = len(pts)
        for r in range(r_lo, r_hi + 1):
            for c in range(c_lo, c_hi + 1):
                inside = False
                j = n - 1
                for i in range(n):
                    yi, xi = pts[i]
                    yj, xj = pts[j]
                    if (yi > r) != (yj > r) and c < (xj - xi) * (r - yi) / (yj - yi) + xi:
                        inside = not inside
                    j = i
                if inside:
                    out[r * grid.cols + c] = 1
        return out
