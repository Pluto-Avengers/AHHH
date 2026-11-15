"""Skill 2 data: the routes the agent may highlight, and which one best fits each characteristic."""

from .coordinates import Coordinates
from .grid import RADIATION_WEIGHT, SLOPE_WEIGHT

# The paths planned to every stop: (id part, slope weight, radiation weight, name)
PATH_KINDS = (
    ("safe", SLOPE_WEIGHT, RADIATION_WEIGHT, "safest"),
    ("shielded", SLOPE_WEIGHT, 4, "most radiation-shielded"),
    ("direct", 0, 0, "most direct"),
)


class RouteCandidates:
    def __init__(self, grid):
        self.grid = grid

    def build(self, client_routes, departure_rc=None):
        """The routes on the map now, plus safest, most shielded and most direct paths from the departure point
        (the landing site by default) to every science stop. Each gets a key R1, R2, ... and its stats."""
        routes = self._client_routes(client_routes) + self._planned_routes(departure_rc)
        unique = self._without_duplicates(routes)
        for k, r in enumerate(unique, 1):
            self._describe(r, f"R{k}")
        return unique

    @staticmethod
    def ranking(routes):
        """Which candidate best fits each dictionary characteristic, computed from the map."""
        def pick(fn, best):
            return best(routes, key=lambda r: fn(r["stats"]))["key"]

        return {
            "fastest": pick(lambda s: s["steps"], min),
            "longest": pick(lambda s: s["steps"], max),
            "rockiest": pick(lambda s: s["roughness_m"], max),
            "least rocky": pick(lambda s: s["roughness_m"], min),
            "least radiation": pick(lambda s: s["dose_ugy"], min),
            "highest point": pick(lambda s: s["highest_rel_m"], max),
            "lowest point": pick(lambda s: s["lowest_rel_m"], min),
        }

    def _client_routes(self, client_routes):
        n = self.grid.rows * self.grid.cols
        out = []
        for r in client_routes or []:
            cells = [int(i) for i in r.get("cells", []) if 0 <= int(i) < n]
            if len(cells) > 1:
                out.append({"id": r["id"], "name": r.get("name", r["id"]), "cells": cells, "new": False})
        return out

    def _planned_routes(self, departure_rc):
        grid = self.grid
        if departure_rc is None:
            start_rc, start_name = grid.stations[0]["rc"], grid.stations[0]["name"]
        else:
            start_rc, start_name = departure_rc, "your departure point"
        suffix = "" if departure_rc is None else f"-{round(start_rc[0])}-{round(start_rc[1])}"
        out = []
        for k, s in enumerate(grid.stations):
            if departure_rc is None and k == 0:
                continue
            for kind, slope_weight, radiation_weight, label in PATH_KINDS:
                planned = grid.plan([start_rc, s["rc"]], slope_weight, radiation_weight)
                if "error" in planned or len(planned["cells"]) < 2:
                    continue
                out.append(
                    {
                        "id": f"martial-{grid.id}-{k}-{kind}{suffix}",
                        "name": f"{label.capitalize()} path from {start_name} to {s['name']}",
                        "cells": planned["cells"],
                        "stopCells": planned["stopCells"],
                        "new": True,
                    }
                )
        return out

    @staticmethod
    def _without_duplicates(routes):
        """The planned paths can coincide on gentle, open ground."""
        seen, unique = set(), []
        for r in routes:
            key = tuple(r["cells"])
            if key not in seen:
                seen.add(key)
                unique.append(r)
        return unique

    def _describe(self, r, key):
        grid = self.grid
        r["key"] = key
        r["stats"] = grid.stats(r["cells"])
        end = grid.nearest_station(r["cells"][-1])
        r["destination"] = end["name"] if end else "Unnamed point"
        r["start"] = Coordinates.cell(grid, r["cells"][0])
        r["end"] = Coordinates.cell(grid, r["cells"][-1])
