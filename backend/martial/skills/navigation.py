"""SKILL 1: directions between two points on the map, written like a guide talking the astronaut through it.

Every number (heading, distance, elevation change, hazard, coordinate, time, dose) comes from the
terrain map and is written by this class. The model only adds a personal opening and sign-off, and
those are rejected if they contain any number, so it can't invent a distance or a heading.
"""

import json
import re

from backend.martial.errors import AgentError
from backend.martial.prompts import NAVIGATION_INSTRUCTIONS
from backend.terrain import MAX_SLOPE, LegPlanner

from .base import Skill, SiteRequest

COMPASS = (
    "north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
    "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest",
)
LEG_TITLES = {"LEVEL": "LEVEL GROUND", "ASCENT": "UPHILL", "DESCENT": "DOWNHILL"}
REPLY_SCHEMA = {
    "type": "object",
    "properties": {"opener": {"type": "string"}, "signoff": {"type": "string"}},
    "required": ["opener", "signoff"],
}


class NavigationSkill(Skill):
    name = "NAVIGATION"
    instructions = NAVIGATION_INSTRUCTIONS

    def run(self, request: SiteRequest):
        grid = request.grid
        dep, dst = self._endpoints(request)

        planned = grid.plan([(dep.row, dep.col), (dst.row, dst.col)])
        if "error" in planned:
            raise AgentError(planned["error"])
        cells = planned["cells"]
        if len(cells) < 2:
            raise AgentError("Those two points are on the same spot of the map. Choose a destination farther away.")

        legs = LegPlanner(grid).split(cells)
        end_station = grid.nearest_station(cells[-1])
        dest_name = dst.station or (end_station["name"] if end_station else None)
        stats = grid.stats(cells)
        trip = {
            "from_name": dep.station or "your starting point",
            "from": dep.label,
            "to_name": dest_name,
            "to": dst.label,
            "legs": legs,
            "distance_m": sum(leg["distance_m"] for leg in legs),
            "walk_min": stats["walk_min"],
            "dose_ugy": stats["dose_ugy"],
        }
        opener, signoff, source = self._personal_touch(request.message, trip)
        reply = self.text(trip, opener, signoff)

        return {
            "skill": self.name,
            "source": source,
            "reply": reply,
            "route": {
                "id": f"martial-nav-{cells[0]}-{cells[-1]}",
                "name": f"Martial: to {dest_name or dst.label}",
                "description": f"Directions from {dep.label} to {dst.label}: {len(legs)} legs, "
                f"{trip['distance_m']} m on ground under {MAX_SLOPE}°.",
                "cells": cells,
                "stopCells": planned["stopCells"],
                "stops": [{"name": "Departure"}, {"name": dest_name or "Destination"}],
                "distance_m": round(stats["distance_m"]),
            },
        }

    def _endpoints(self, request):
        """Departure and destination named in the request (departure defaults to the landing site)."""
        grid = request.grid
        points, outside = request.reader.points(request.message)
        if len(points) == 1:  # only a destination: depart from the landing site
            points.insert(0, request.reader.station_point(grid.stations[0]))
        if len(points) < 2:
            where = f" {', '.join(outside)} is outside the mapped area." if outside else ""
            s1 = request.reader.station_point(grid.stations[1])
            raise AgentError(
                "Give me a departure and a destination inside the mapped area of "
                f"{request.site['name']} ({grid.bounds_text()}), as coordinates such as {s1.label}, "
                f"or by name (landing site, stop 1 to stop {len(grid.stations) - 1}).{where}"
            )
        return points[0], points[-1]

    # ---- the personal touch: from the model when it is running, else written here ---------------
    def _personal_touch(self, message, trip):
        """(opener, sign-off, source). The model's lines are used only if they contain no numbers."""
        default_opener, default_signoff = self.default_lines(trip)
        map_data = {
            "from": trip["from_name"],
            "destination_name": trip["to_name"] or "NOT SPECIFIED",
            "legs": [
                {"terrain": leg["terrain"], "steep_ground": bool(leg["hazard"] and leg["hazard"]["bypass_heading"] is not None)}
                for leg in trip["legs"]
            ],
        }
        prompt = f"{message}\n\nMAP DATA\n{json.dumps(map_data, indent=1, ensure_ascii=False)}"
        try:
            out = json.loads(self.llm.chat(self.instructions, prompt, fmt=REPLY_SCHEMA))
        except Exception:  # noqa: BLE001  (Ollama offline, or not JSON)
            return default_opener, default_signoff, "map"
        opener, signoff = out.get("opener"), out.get("signoff")
        if self._usable(opener) and self._usable(signoff):
            return opener.strip(), signoff.strip(), "ollama"
        return default_opener, default_signoff, "map"

    @staticmethod
    def _usable(line):
        """A short line of plain sentences with no digits (every number must come from the map)."""
        return isinstance(line, str) and 0 < len(line.strip()) <= 280 and not re.search(r"\d", line) and "\n" not in line.strip()

    @staticmethod
    def default_lines(trip):
        """A friendly opening and sign-off that fit the walk, when the model isn't available."""
        dest = trip["to_name"] or "your destination"
        middle = [leg["terrain"] for leg in trip["legs"][1:-1]]
        steep = any(leg["hazard"] and leg["hazard"]["bypass_heading"] is not None for leg in trip["legs"])
        if middle and all(t == "LEVEL" for t in middle):
            feel = "It's a nice, mostly level walk"
        elif "ASCENT" in middle and "DESCENT" in middle:
            feel = "There are a few ups and downs on the way"
        elif "ASCENT" in middle:
            feel = "There's a bit of climbing on the way"
        else:
            feel = "It's mostly downhill from here"
        feel += ", and there's a steep patch I'll warn you about." if steep else "."
        opener = f"Okay, let's get you to {dest}. {feel} I'll take you through it one leg at a time."
        signoff = (
            "Keep clear of the steep ground, check in at each point, and you'll be fine."
            if steep
            else "Take it steady, check in at each point, and enjoy the view out there."
        )
        return opener, signoff

    # ---- the directions ---------------------------------------------------------------------------
    @staticmethod
    def compass(heading):
        return COMPASS[round(heading / 22.5) % 16]

    @classmethod
    def text(cls, trip, opener, signoff):
        """The full reply. Upper-case lines are headings and LABEL: value lines are fields (the chat
        lays these out as sections, see src/map/martial/ReplyParser.js); blank lines separate ideas."""
        legs = trip["legs"]
        dest = trip["to_name"]
        lines = [f"DIRECTIONS TO {dest.upper()}" if dest else "DIRECTIONS", "", opener, ""]
        lines += [f"FROM: {trip['from_name'][:1].upper()}{trip['from_name'][1:]} · {trip['from']}"]
        lines += [f"GOING TO: {dest or 'Your destination'} · {trip['to']}", ""]

        for k, leg in enumerate(legs):
            first, last = k == 0, k == len(legs) - 1
            heading = f"{leg['heading']:03d}° ({cls.compass(leg['heading'])})"
            title = "HEADING OUT" if first else "FINAL STRETCH" if last else LEG_TITLES[leg["terrain"]]
            lines.append(f"LEG {k + 1} - {title}")
            if first:
                lines.append(f"Face {heading} and walk about {leg['distance_m']} m.")
            elif last:
                lines.append(f"Turn to {heading} for the last {leg['distance_m']} m.")
            else:
                lines.append(f"Turn to {heading} and keep going for about {leg['distance_m']} m.")
            if not first and not last:  # every middle leg warns about its elevation change
                lines.append(cls._elevation_note(leg))
            hz = leg["hazard"]
            if hz and hz["bypass_heading"] is not None:
                lines.append(
                    f"Careful: there's a {hz['type']} at {hz['at']}. Swing to {hz['bypass_heading']:03d}° "
                    f"({cls.compass(hz['bypass_heading'])}) to get around it."
                )
            if last:
                lines.append(f"{dest or 'Your destination'} is right ahead at {trip['to']}. You've made it!")
            else:
                lines.append(f"Check in at {leg['end']}.")
            lines.append("")

        lines += [
            "TRIP SUMMARY",
            f"DISTANCE: {trip['distance_m']:,} m",
            f"WALKING TIME: about {cls._duration(trip['walk_min'])}",
            f"RADIATION DOSE: about {trip['dose_ugy']:.1f} µGy",
            "",
            signoff,
        ]
        return "\n".join(lines)

    @staticmethod
    def _elevation_note(leg):
        dz = leg["elevation_change_m"]
        if leg["terrain"] == "ASCENT":
            return f"Heads up: this stretch climbs about {dz} m, so take it slow and steady."
        if leg["terrain"] == "DESCENT":
            return f"Heads up: this stretch drops about {dz} m, so watch your footing on the way down."
        if dz == 0:
            return "Heads up: the ground stays level here, with less than a metre of height change."
        return f"Heads up: the ground stays fairly level here, about {dz} m of height change."

    @staticmethod
    def _duration(minutes):
        m = max(1, round(minutes))
        return f"{m} min" if m < 60 else f"{m // 60} h {m % 60:02d} min"
