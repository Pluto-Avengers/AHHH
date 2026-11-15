"""Map data for the Martial agent.

Reads the same landing-site terrain the website shows (public/sites/<id>/, made by
scripts/export_sites.py) and runs the same least-cost routing as src/map/router.js, so every
number the agent uses comes from the map: coordinates, distances, headings, elevations and slopes.
"""

import heapq
import json
import math
from array import array
from functools import lru_cache
from pathlib import Path

SITES_DIR = Path(__file__).resolve().parent.parent / "public" / "sites"
# Same sites as src/map/sites.js.
SITE_INFO = {
    "jezero": {"name": "Jezero Crater", "mission": "Perseverance landed 2021"},
    "gale": {"name": "Gale Crater", "mission": "Curiosity landed 2012"},
    "gusev": {"name": "Gusev Crater", "mission": "Spirit landed 2004"},
    "meridiani": {"name": "Meridiani Planum", "mission": "Opportunity landed 2004"},
}
SITE_IDS = tuple(SITE_INFO)

MAX_SLOPE = 25  # degrees: steeper is unsafe for a suited astronaut (same as router.js)
HAZARD_SLOPE = 15  # degrees: ground the map tints amber; reported to the astronaut
SLOPE_WEIGHT = 6
NO_DATA = 255
LEVEL_TOLERANCE_M = 3  # a leg that rises or falls less than this is LEVEL
DIRS = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))


class Grid:
    """One landing site's terrain: elevation (m) and slope (deg) per cell, row 0 = north."""

    def __init__(self, site_id):
        folder = SITES_DIR / site_id
        terrain = json.loads((folder / "terrain.json").read_text(encoding="utf-8"))
        self.id = site_id
        self.rows = terrain["rows"]
        self.cols = terrain["cols"]
        self.cw, self.ch = terrain["cell_m"]
        (self.south, self.west), (self.north, self.east) = terrain["bounds"]
        self.stations = terrain["stations"]
        self.reference = terrain.get("reference")
        self.height = array("f")
        self.height.frombytes((folder / "height.bin").read_bytes())
        self.slope = (folder / "slope.bin").read_bytes()

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
        return f"{fmt_lat(self.south)} to {fmt_lat(self.north)}, {fmt_lon(self.west)} to {fmt_lon(self.east)}"

    # ---- routing (port of src/map/router.js) -----------------------------------------------
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

    def find_path(self, start, goal, slope_weight=SLOPE_WEIGHT):
        """A* between two cell indices over passable ground. Returns a list of cells, or None."""
        rows, cols, cw, ch, slope = self.rows, self.cols, self.cw, self.ch, self.slope
        steps = [math.hypot(dr * ch, dc * cw) for dr, dc in DIRS]
        gr, gc = divmod(goal, cols)
        mult = [1 + slope_weight * (s / MAX_SLOPE) ** 2 for s in range(256)]
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
            gi = g[i]
            for k, (dr, dc) in enumerate(DIRS):
                nr, nc = r + dr, c + dc
                if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                    continue
                j = nr * cols + nc
                if j in closed or not self.passable(j):
                    continue
                cost = gi + steps[k] * (mi + mult[slope[j]]) / 2
                if cost < g.get(j, math.inf):
                    g[j] = cost
                    came[j] = i
                    heapq.heappush(heap, (cost + math.hypot((nr - gr) * ch, (nc - gc) * cw), j))
        if goal not in g:
            return None
        path = [goal]
        while path[-1] != start:
            path.append(came[path[-1]])
        return path[::-1]

    def plan(self, waypoints, slope_weight=SLOPE_WEIGHT):
        """Route through (row, col) waypoints in order. Returns {cells, stopCells} or {error}."""
        snapped = [self.snap(r, c) for r, c in waypoints]
        if None in snapped:
            k = snapped.index(None)
            return {"error": f"Point {k + 1} is on terrain that is too steep or has no map data."}
        cells = [snapped[0]]
        for k in range(1, len(snapped)):
            if snapped[k] == snapped[k - 1]:
                continue
            leg = self.find_path(snapped[k - 1], snapped[k], slope_weight)
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
        """Distance, climb, slope, roughness and relative heights along a route (like routeStats)."""
        h = self.height
        distance = gain = loss = seconds = rough = 0.0
        slopes = [0 if self.slope[i] == NO_DATA else self.slope[i] for i in cells]
        for k in range(1, len(cells)):
            flat, dz = self.step_m(cells[k - 1], cells[k])
            step = math.hypot(flat, dz)
            distance += step
            gain += max(dz, 0)
            loss += max(-dz, 0)
            seconds += step / walk_speed_ms(dz / flat if flat else 0)
            if k < len(cells) - 1:  # high-frequency bumps: second difference of elevation
                rough += abs(h[cells[k + 1]] - 2 * h[cells[k]] + h[cells[k - 1]])
        start = h[cells[0]]
        return {
            "steps": len(cells) - 1,
            "distance_m": distance,
            "walk_min": seconds / 60,
            "gain_m": gain,
            "loss_m": loss,
            "max_slope": max(slopes),
            "mean_slope": sum(slopes) / len(slopes),
            "roughness_m": rough,
            "highest_rel_m": max(h[i] for i in cells) - start,
            "lowest_rel_m": min(h[i] for i in cells) - start,
        }


def walk_speed_ms(grade):
    """Suited walking speed from grade (Tobler-style, slowed for EVA suits; same as router.js)."""
    return 3.6 * math.exp(-3.5 * abs(grade + 0.05)) / 3.6


@lru_cache(maxsize=None)
def load_grid(site_id):
    if site_id not in SITE_IDS:
        raise ValueError(f"Unknown landing site '{site_id}'. Choose one of: {', '.join(SITE_IDS)}.")
    return Grid(site_id)


def fmt_lat(lat):
    return f"{abs(lat):.4f}° {'N' if lat >= 0 else 'S'}"


def fmt_lon(lon):
    return f"{abs(lon):.4f}° {'E' if lon >= 0 else 'W'}"


def fmt_cell(grid, i):
    lat, lon = grid.cell_latlon(i)
    return f"{fmt_lat(lat)}, {fmt_lon(lon)}"


# ---- Skill 1 data: a route cut into legs -----------------------------------------------------
def split_legs(grid, cells):
    """Cuts a route into 2-6 legs of roughly equal walking distance, each with real map measurements."""
    cum = [0.0]
    for k in range(1, len(cells)):
        flat, dz = grid.step_m(cells[k - 1], cells[k])
        cum.append(cum[-1] + math.hypot(flat, dz))
    total = cum[-1]
    n = max(2, min(6, int(total // 300)))
    n = min(n, len(cells) - 1) or 1
    bounds = [0]
    for j in range(1, n):
        target = total * j / n
        k = next(k for k in range(bounds[-1] + 1, len(cells)) if cum[k] >= target)
        bounds.append(min(k, len(cells) - 2))
    bounds.append(len(cells) - 1)
    bounds = sorted(set(bounds))

    legs = []
    for a, b in zip(bounds, bounds[1:]):
        seg = cells[a : b + 1]
        dz = grid.height[seg[-1]] - grid.height[seg[0]]
        terrain = "LEVEL" if abs(dz) < LEVEL_TOLERANCE_M else ("ASCENT" if dz > 0 else "DESCENT")
        steepest = max(seg, key=lambda i: grid.slope[i])
        hazard = None
        if grid.slope[steepest] > HAZARD_SLOPE:
            k = seg.index(steepest)
            ahead = seg[min(k + 8, len(seg) - 1)]
            hazard = {
                "type": f"steep slope of {grid.slope[steepest]}°",
                "at": fmt_cell(grid, steepest),
                "bypass_heading": round(grid.heading(steepest, ahead)) % 360 if ahead != steepest else None,
            }
        legs.append(
            {
                "heading": round(grid.heading(seg[0], seg[-1])) % 360,
                "distance_m": round(cum[b] - cum[a]),
                "terrain": terrain,
                "elevation_change_m": round(abs(dz)),
                "end": fmt_cell(grid, seg[-1]),
                "hazard": hazard,
            }
        )
    legs[0]["terrain"] = "INITIAL DEPARTURE"
    legs[-1]["terrain"] = "FINAL APPROACH"
    return legs


# ---- Skill 2 data: candidate routes and how they compare ---------------------------------------
def candidate_routes(grid, client_routes, departure_rc=None):
    """Routes the agent may highlight: the ones on the map now, plus safest and most direct paths
    from the departure point to every science stop."""
    out = []
    for r in client_routes or []:
        cells = [int(i) for i in r.get("cells", []) if 0 <= int(i) < grid.rows * grid.cols]
        if len(cells) > 1:
            out.append({"id": r["id"], "name": r.get("name", r["id"]), "cells": cells, "new": False})

    if departure_rc is None:
        start_rc, start_name = grid.stations[0]["rc"], grid.stations[0]["name"]
    else:
        start_rc, start_name = departure_rc, "your departure point"
    for k, s in enumerate(grid.stations):
        if departure_rc is None and k == 0:
            continue
        for kind, weight, label in (("safe", SLOPE_WEIGHT, "safest"), ("direct", 0, "most direct")):
            planned = grid.plan([start_rc, s["rc"]], weight)
            if "error" in planned or len(planned["cells"]) < 2:
                continue
            out.append(
                {
                    "id": f"martial-{grid.id}-{k}-{kind}" + ("" if departure_rc is None else f"-{round(start_rc[0])}-{round(start_rc[1])}"),
                    "name": f"{label.capitalize()} path from {start_name} to {s['name']}",
                    "cells": planned["cells"],
                    "stopCells": planned["stopCells"],
                    "new": True,
                }
            )

    # Drop exact duplicates (the direct and safest paths can coincide on gentle ground).
    seen, unique = set(), []
    for r in out:
        key = tuple(r["cells"])
        if key not in seen:
            seen.add(key)
            unique.append(r)

    for k, r in enumerate(unique, 1):
        r["key"] = f"R{k}"
        r["stats"] = grid.stats(r["cells"])
        end = grid.nearest_station(r["cells"][-1])
        r["destination"] = end["name"] if end else "Unnamed point"
        r["start"] = fmt_cell(grid, r["cells"][0])
        r["end"] = fmt_cell(grid, r["cells"][-1])
    return unique


def characteristic_ranking(routes):
    """Which candidate best fits each dictionary characteristic, computed from the map."""
    def pick(fn, best):
        return best(routes, key=lambda r: fn(r["stats"]))["key"]

    return {
        "fastest": pick(lambda s: s["steps"], min),
        "longest": pick(lambda s: s["steps"], max),
        "rockiest": pick(lambda s: s["roughness_m"], max),
        "least rocky": pick(lambda s: s["roughness_m"], min),
        "highest point": pick(lambda s: s["highest_rel_m"], max),
        "lowest point": pick(lambda s: s["lowest_rel_m"], min),
    }
