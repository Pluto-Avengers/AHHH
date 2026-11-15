"""
Write public/storms.json: a simulated dust storm at some landing sites, for route planning practice.

Each storm sits across the longest leg of the site's recommended traverse, away from every stop,
so routes have to go around it. The outlines are made up (an irregular blob), not observed weather.

Run (from this repo, in the `mars` conda env):  python scripts/make_storms.py
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.terrain import site_catalog  # noqa: E402
from backend.terrain.storms import DustStorm, STORMS_FILE  # noqa: E402

SITES = ("gale", "gusev", "meridiani", "elysium")


class StormMaker:
    VERTICES = 36
    MIN_RADIUS_M = 180
    MAX_RADIUS_M = 650

    def __init__(self, site_id, seed):
        self.site_id = site_id
        self.grid = site_catalog.grid(site_id)
        self.seed = seed

    def make(self):
        grid = self.grid
        planned = grid.plan([s["rc"] for s in grid.stations])
        cells, stops = planned["cells"], planned["stopCells"]
        # The longest leg between two stops, and the point halfway along it
        idx = [cells.index(c) for c in stops]
        a, b = max(zip(idx, idx[1:]), key=lambda p: p[1] - p[0])
        mid_r, mid_c = grid.rc(cells[(a + b) // 2])
        leg_m = math.hypot((grid.rc(cells[b])[0] - grid.rc(cells[a])[0]) * grid.ch, (grid.rc(cells[b])[1] - grid.rc(cells[a])[1]) * grid.cw)
        radius = min(self.MAX_RADIUS_M, max(self.MIN_RADIUS_M, leg_m * 0.16))

        for shrink in (1.0, 0.85, 0.7, 0.55):
            storm = DustStorm(self.site_id, "simulated dust storm", self._outline(mid_r, mid_c, radius * shrink))
            if self._clear_of_stops(storm) and self._route_still_possible(storm):
                return storm, radius * shrink
        raise RuntimeError(f"{self.site_id}: no storm size leaves the stops reachable")

    def _outline(self, r0, c0, radius_m):
        """An irregular blob of lat/lon points around grid point (r0, c0)."""
        grid = self.grid
        p1, p2, p3 = self.seed * 1.7, self.seed * 2.9, self.seed * 0.6
        stretch, tilt = 1.35, self.seed * 0.8
        pts = []
        for k in range(self.VERTICES):
            t = 2 * math.pi * k / self.VERTICES
            wobble = 1 + 0.16 * math.sin(2 * t + p1) + 0.09 * math.sin(3 * t + p2) + 0.05 * math.sin(5 * t + p3)
            x, y = math.cos(t) * stretch * wobble, math.sin(t) * wobble / stretch
            x, y = x * math.cos(tilt) - y * math.sin(tilt), x * math.sin(tilt) + y * math.cos(tilt)
            r = r0 - y * radius_m / grid.ch
            c = c0 + x * radius_m / grid.cw
            lat = grid.north - r / grid.rows * (grid.north - grid.south)
            lon = grid.west + c / grid.cols * (grid.east - grid.west)
            pts.append([round(lat, 6), round(lon, 6)])
        return pts

    def _clear_of_stops(self, storm):
        """No stop inside the storm or within 12 cells of it (stops must stay reachable)."""
        mask = storm.mask(self.grid)
        grid = self.grid
        for s in grid.stations:
            r, c = round(s["rc"][0]), round(s["rc"][1])
            for dr in range(-12, 13):
                for dc in range(-12, 13):
                    if grid.in_bounds(r + dr, c + dc) and mask[grid.index(r + dr, c + dc)]:
                        return False
        return True

    def _route_still_possible(self, storm):
        blocked = self.grid.with_blocked(storm.mask(self.grid), storm.name)
        return "error" not in blocked.plan([s["rc"] for s in blocked.stations])


def main():
    storms = {}
    for seed, sid in enumerate(SITES, 1):
        storm, radius = StormMaker(sid, seed).make()
        storms[sid] = {"name": storm.name, "polygon": storm.polygon}
        cells = sum(storm.mask(site_catalog.grid(sid)))
        print(f"{sid}: radius about {radius:.0f} m, {cells} cells closed")
    STORMS_FILE.write_text(
        json.dumps(
            {
                "note": "Simulated dust storms for route-planning practice (scripts/make_storms.py), not observed weather.",
                "storms": storms,
            },
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"wrote {STORMS_FILE}")


if __name__ == "__main__":
    main()
