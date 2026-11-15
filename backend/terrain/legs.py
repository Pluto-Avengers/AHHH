"""Skill 1 data: a route cut into legs, each with real map measurements."""

import math

from .coordinates import Coordinates
from .grid import HAZARD_SLOPE, NO_DATA

LEVEL_TOLERANCE_M = 3  # a leg that rises or falls less than this is LEVEL


class LegPlanner:
    MIN_LEGS = 3  # always, so every procedure has middle legs that state their elevation change
    MAX_LEGS = 6
    LEG_LENGTH_M = 300  # about one leg per this many meters, between MIN_LEGS and MAX_LEGS

    def __init__(self, grid):
        self.grid = grid

    def split(self, cells):
        """Cuts a route into legs of roughly equal walking distance."""
        cum = self._cumulative_distance(cells)
        bounds = self._leg_bounds(cum, len(cells))
        legs = [self._leg(cells[a : b + 1], cum[b] - cum[a]) for a, b in zip(bounds, bounds[1:])]
        legs[0]["terrain"] = "INITIAL DEPARTURE"
        legs[-1]["terrain"] = "FINAL APPROACH"
        return legs

    def _cumulative_distance(self, cells):
        cum = [0.0]
        for k in range(1, len(cells)):
            flat, dz = self.grid.step_m(cells[k - 1], cells[k])
            cum.append(cum[-1] + math.hypot(flat, dz))
        return cum

    def _leg_bounds(self, cum, n_cells):
        """Indices where the legs start and end."""
        total = cum[-1]
        n = max(self.MIN_LEGS, min(self.MAX_LEGS, int(total // self.LEG_LENGTH_M)))
        n = min(n, n_cells - 1) or 1
        bounds = [0]
        for j in range(1, n):
            target = total * j / n
            k = next(k for k in range(bounds[-1] + 1, n_cells) if cum[k] >= target)
            bounds.append(min(k, n_cells - 2))
        bounds.append(n_cells - 1)
        return sorted(set(bounds))

    def _leg(self, seg, distance_m):
        grid = self.grid
        dz = grid.height[seg[-1]] - grid.height[seg[0]]
        terrain = "LEVEL" if abs(dz) < LEVEL_TOLERANCE_M else ("ASCENT" if dz > 0 else "DESCENT")
        return {
            "heading": round(grid.heading(seg[0], seg[-1])) % 360,
            "distance_m": round(distance_m),
            "terrain": terrain,
            "trend": terrain,  # LEVEL / ASCENT / DESCENT, kept for the first and last legs too
            "elevation_change_m": round(abs(dz)),
            "end": Coordinates.cell(grid, seg[-1]),
            "hazard": self._hazard(seg),
        }

    def _hazard(self, seg):
        """The steepest ground on the leg, if it is steep enough to warn about, with a bypass heading."""
        grid = self.grid
        steepest = max(seg, key=lambda i: 0 if grid.slope[i] == NO_DATA else grid.slope[i])
        if grid.slope[steepest] <= HAZARD_SLOPE or grid.slope[steepest] == NO_DATA:
            return None
        k = seg.index(steepest)
        ahead = seg[min(k + 8, len(seg) - 1)]
        return {
            "type": f"steep slope of {grid.slope[steepest]}°",
            "at": Coordinates.cell(grid, steepest),
            "bypass_heading": round(grid.heading(steepest, ahead)) % 360 if ahead != steepest else None,
        }
