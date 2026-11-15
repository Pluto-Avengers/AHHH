"""One landing site's terrain and the least-cost routing over it.

Reads the same terrain the website shows (public/sites/<id>/, made by scripts/export_sites.py) and runs
the same routing as src/core/TerrainGrid.js, so every number the agent uses comes from the map:
coordinates, distances, headings, elevations and slopes.
"""

import heapq
import json
import math
import os
import urllib.request
from array import array
from pathlib import Path

from .coordinates import Coordinates

SITES_DIR = Path(__file__).resolve().parent.parent.parent / "public" / "sites"

# Where to download a site's terrain when public/sites isn't on disk. A Vercel Function doesn't get the
# public/ folder, but the website serves the same files at /sites/<id>/. Filled from the environment
# here, and from the request's own address by api/agent.py.
SITE_URLS = []


def add_site_url(url):
    """Registers a base address that serves the site folders, e.g. https://example.vercel.app/sites."""
    url = (url or "").strip().rstrip("/")
    if url and url not in SITE_URLS:
        SITE_URLS.append(url)


add_site_url(os.environ.get("MPS_SITES_URL"))
if os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"):
    add_site_url(f"https://{os.environ['VERCEL_PROJECT_PRODUCTION_URL']}/sites")


def read_site_file(site_id, name, sites_dir=SITES_DIR):
    """A site file's bytes: from disk when it is there, otherwise downloaded from the website."""
    path = Path(sites_dir) / site_id / name
    if path.exists():
        return path.read_bytes()
    problem = FileNotFoundError(f"{path} is not on disk and no website address is known to download it from")
    for base in SITE_URLS:
        try:
            request = urllib.request.Request(f"{base}/{site_id}/{name}", headers={"User-Agent": "martial-backend"})
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.read()
        except OSError as e:  # unreachable or not found: try the next address
            problem = OSError(f"Could not download {name} for {site_id} from {base}: {e}")
    raise problem

MAX_SLOPE = 25  # degrees: steeper is unsafe for a suited astronaut (same as TerrainGrid.js)
HAZARD_SLOPE = 15  # degrees: ground the map tints amber; reported to the astronaut
SLOPE_WEIGHT = 6
RADIATION_WEIGHT = 1  # ground where terrain blocks part of the sky (and its cosmic rays) costs less
NO_DATA = 255
# Surface dose rate under open sky: 0.21 mGy a day (Curiosity RAD, Gale crater; Hassler et al. 2014), in µGy/s
OPEN_SKY_DOSE_UGY_S = 210 / 86400
_RADIATION_FACTORS = {}  # radiation weight -> factor per sky.bin value
DIRS = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))


def sky_fraction(v):
    """Open-sky fraction 0..1 from a sky.bin value (no data counts as open sky)."""
    return 1.0 if v == NO_DATA else v / 254


def radiation_factors(weight):
    """Cost factor per sky.bin value: 1 - weight * (1 - sky view)."""
    return [max(0.05, 1 - weight * (1 - sky_fraction(v))) for v in range(256)]


class TerrainGrid:
    """Elevation (m), slope (deg) and sky view per cell, row 0 = north."""

    def __init__(self, site_id, sites_dir=SITES_DIR):
        terrain = json.loads(read_site_file(site_id, "terrain.json", sites_dir).decode("utf-8"))
        self.id = site_id
        self.rows = terrain["rows"]
        self.cols = terrain["cols"]
        self.cw, self.ch = terrain["cell_m"]
        (self.south, self.west), (self.north, self.east) = terrain["bounds"]
        self.stations = terrain["stations"]
        self.reference = terrain.get("reference")
        self.height = array("f")
        self.height.frombytes(read_site_file(site_id, "height.bin", sites_dir))
        self.slope = read_site_file(site_id, "slope.bin", sites_dir)
        cells = self.rows * self.cols
        if len(self.height) != cells or len(self.slope) != cells:
            raise OSError(f"The terrain files for {site_id} are incomplete or the wrong size.")
        try:  # radiation shielding; missing = open sky everywhere
            self.sky = read_site_file(site_id, "sky.bin", sites_dir)
        except OSError:
            self.sky = b""
        if len(self.sky) != len(self.slope):
            self.sky = bytes([254]) * len(self.slope)
        self._least = {}  # radiation weight -> cheapest radiation factor on the site

    @staticmethod
    def walk_speed_ms(grade):
        """Suited walking speed from grade (Tobler-style, slowed for EVA suits; same as TerrainGrid.js)."""
        return 3.6 * math.exp(-3.5 * abs(grade + 0.05)) / 3.6

    # ---- cells and coordinates -------------------------------------------------------------
    def index(self, r, c):
        return r * self.cols + c

    def rc(self, i):
        return divmod(i, self.cols)

    def in_bounds(self, r, c):
        return 0 <= r < self.rows and 0 <= c < self.cols

    def passable(self, i):
        s = self.slope[i]
        return s != NO_DATA and s <= MAX_SLOPE

    def latlon_to_rc(self, lat, lon):
        r = (self.north - lat) / (self.north - self.south) * self.rows
        c = (lon - self.west) / (self.east - self.west) * self.cols
        return r, c

    def cell_latlon(self, i):
        r, c = self.rc(i)
        lat = self.north - r / self.rows * (self.north - self.south)
        lon = self.west + c / self.cols * (self.east - self.west)
        return lat, lon

    def contains(self, lat, lon, margin=0.002):
        return (self.south - margin <= lat <= self.north + margin) and (self.west - margin <= lon <= self.east + margin)

    def bounds_text(self):
        return (
            f"{Coordinates.lat(self.south)} to {Coordinates.lat(self.north)}, "
            f"{Coordinates.lon(self.west)} to {Coordinates.lon(self.east)}"
        )

    # ---- routing (same as src/core/TerrainGrid.js) -----------------------------------------
    def snap(self, r, c, radius=8):
        """Nearest passable cell to (r, c), or None."""
        r, c = round(r), round(c)
        best, best_d = None, math.inf
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                nr, nc = r + dr, c + dc
                if not self.in_bounds(nr, nc):
                    continue
                i = self.index(nr, nc)
                d = dr * dr + dc * dc
                if d < best_d and self.passable(i):
                    best, best_d = i, d
        return best

    def sky_view(self, i):
        """Fraction of the sky (0..1) open above cell i; lower means more radiation shielding."""
        return sky_fraction(self.sky[i])

    def _least_factor(self, weight, rad):
        """Cheapest radiation factor on passable ground (keeps the A* estimate from overshooting)."""
        if weight not in self._least:
            values = {self.sky[i] for i in range(len(self.slope)) if self.passable(i)}
            self._least[weight] = min([1] + [rad[v] for v in values])
        return self._least[weight]

    def find_path(self, start, goal, slope_weight=SLOPE_WEIGHT, radiation_weight=RADIATION_WEIGHT):
        """A* between two cell indices over passable ground. Returns a list of cells, or None.
        Same cost as src/core/TerrainGrid.js: meters × slope factor × radiation factor."""
        rows, cols, cw, ch, slope, sky = self.rows, self.cols, self.cw, self.ch, self.slope, self.sky
        steps = [math.hypot(dr * ch, dc * cw) for dr, dc in DIRS]
        gr, gc = divmod(goal, cols)
        mult = [1 + slope_weight * (s / MAX_SLOPE) ** 2 for s in range(256)]
        rad = _RADIATION_FACTORS.setdefault(radiation_weight, radiation_factors(radiation_weight))
        least = self._least_factor(radiation_weight, rad)
        g = {start: 0.0}
        came = {}
        closed = set()
        heap = [(0.0, start)]
        while heap:
            _, i = heapq.heappop(heap)
            if i == goal:
                break
            if i in closed:
                continue
            closed.add(i)
            r, c = divmod(i, cols)
            mi = mult[slope[i]]
            ri = rad[sky[i]]
            gi = g[i]
            for k, (dr, dc) in enumerate(DIRS):
                nr, nc = r + dr, c + dc
                if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                    continue
                j = nr * cols + nc
                if j in closed or not self.passable(j):
                    continue
                cost = gi + steps[k] * (mi + mult[slope[j]]) / 2 * (ri + rad[sky[j]]) / 2
                if cost < g.get(j, math.inf):
                    g[j] = cost
                    came[j] = i
                    heapq.heappush(heap, (cost + math.hypot((nr - gr) * ch, (nc - gc) * cw) * least, j))
        if goal not in g:
            return None
        path = [goal]
        while path[-1] != start:
            path.append(came[path[-1]])
        return path[::-1]

    def plan(self, waypoints, slope_weight=SLOPE_WEIGHT, radiation_weight=RADIATION_WEIGHT):
        """Route through (row, col) waypoints in order. Returns {cells, stopCells} or {error}."""
        snapped = [self.snap(r, c) for r, c in waypoints]
        if None in snapped:
            k = snapped.index(None)
            return {"error": f"Point {k + 1} is on terrain that is too steep or has no map data."}
        cells = [snapped[0]]
        for k in range(1, len(snapped)):
            if snapped[k] == snapped[k - 1]:
                continue
            leg = self.find_path(snapped[k - 1], snapped[k], slope_weight, radiation_weight)
            if not leg:
                return {"error": f"The map shows no safe path (all slopes under {MAX_SLOPE}°) between points {k} and {k + 1}."}
            cells.extend(leg[1:])
        return {"cells": cells, "stopCells": snapped}

    # ---- measurements ----------------------------------------------------------------------
    def step_m(self, a, b):
        """Flat distance and elevation change between two cells."""
        ar, ac = self.rc(a)
        br, bc = self.rc(b)
        flat = math.hypot((br - ar) * self.ch, (bc - ac) * self.cw)
        return flat, self.height[b] - self.height[a]

    def heading(self, a, b):
        """Compass heading in degrees (0 = north, 90 = east) from cell a to cell b."""
        ar, ac = self.rc(a)
        br, bc = self.rc(b)
        return math.degrees(math.atan2((bc - ac) * self.cw, -(br - ar) * self.ch)) % 360

    def nearest_station(self, i, within_m=150):
        r, c = self.rc(i)
        best, best_d = None, within_m
        for s in self.stations:
            d = math.hypot((s["rc"][0] - r) * self.ch, (s["rc"][1] - c) * self.cw)
            if d <= best_d:
                best, best_d = s, d
        return best

    def stats(self, cells):
        """Distance, climb, slope, roughness, radiation dose and relative heights along a route (like routeStats).
        dose_ugy: time at each step × the open-sky dose rate × the fraction of sky open there."""
        h = self.height
        distance = gain = loss = seconds = rough = dose = 0.0
        slopes = [0 if self.slope[i] == NO_DATA else self.slope[i] for i in cells]
        for k in range(1, len(cells)):
            flat, dz = self.step_m(cells[k - 1], cells[k])
            step = math.hypot(flat, dz)
            distance += step
            gain += max(dz, 0)
            loss += max(-dz, 0)
            time = step / self.walk_speed_ms(dz / flat if flat else 0)
            seconds += time
            dose += time * OPEN_SKY_DOSE_UGY_S * self.sky_view(cells[k])
            if k < len(cells) - 1:  # high-frequency bumps: second difference of elevation
                rough += abs(h[cells[k + 1]] - 2 * h[cells[k]] + h[cells[k - 1]])
        start = h[cells[0]]
        return {
            "steps": len(cells) - 1,
            "distance_m": distance,
            "walk_min": seconds / 60,
            "dose_ugy": dose,
            "mean_sky_view": sum(self.sky_view(i) for i in cells) / len(cells),
            "gain_m": gain,
            "loss_m": loss,
            "max_slope": max(slopes),
            "mean_slope": sum(slopes) / len(slopes),
            "roughness_m": rough,
            "highest_rel_m": max(h[i] for i in cells) - start,
            "lowest_rel_m": min(h[i] for i in cells) - start,
        }
