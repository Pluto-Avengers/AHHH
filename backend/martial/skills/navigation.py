"""SKILL 1: directions between two points on the map, written like a guide talking the astronaut through it.

Every number (heading, distance, elevation change, hazard, coordinate, time, dose) comes from the
terrain map and is written by this class. The model only adds a personal opening and sign-off, and
those are rejected if they contain any number, so it can't invent a distance or a heading.
"""

import json
import math
import re

from backend.martial.cues import DirectionCue
from backend.martial.errors import AgentError, NeedsInfo
from backend.martial.request import Point
from backend.martial.prompts import NAVIGATION_INSTRUCTIONS
from backend.terrain import MAX_SLOPE, Coordinates, LegPlanner
from backend.terrain.grid import NO_DATA

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
        dep, dst, notes, dep_default = self._endpoints(request)

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
            "storm": grid.blocked_reason if grid.blocked else None,
        }
        trip["why"] = self.why(grid, dep, dst, dep_default, notes, planned, cells, stats)
        opener, signoff, source = self._personal_touch(request.message, trip)
        reply = self.text(trip, opener, signoff)

        return {
            "skill": self.name,
            "source": source,
            "reply": reply,
            "route": {
                "id": f"martial-nav-{cells[0]}-{cells[-1]}" + ("-storm" if grid.blocked else ""),
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
        """(departure, destination, notes) of the request. The destination can be a place or a compass
        direction from the departure ("500 m west of stop 1 on Your route 1"); the departure defaults
        to the landing site. Asks (NeedsInfo) when something it needs is missing."""
        grid, reader, message = request.grid, request.reader, request.message
        dep, dst = reader.endpoints(message)
        _, outside = reader.points(message)
        cue = DirectionCue.parse(reader.text_without_places(message))
        if cue and not (dep and dst):
            start = dep or dst or reader.station_point(grid.stations[0])
            return (*self._toward(grid, reader, start, cue), not (dep or dst))
        defaulted = False
        if dst and not dep:  # only a destination: depart from the landing site
            dep = reader.station_point(grid.stations[0])
            defaulted = True
        if not (dep and dst):
            where = f" ({', '.join(outside)} is outside the mapped area of {request.site['name']}.)" if outside else ""
            raise NeedsInfo(
                "Where would you like to go, and from where? You can name a stop on a route (like "
                f"\"stop 1 on {self._example_route(reader)}\"), your pin, a landmark, coordinates, or a "
                f"direction and distance such as \"500 m west\".{where}",
                need="places",
            )
        return dep, dst, [], defaulted

    @staticmethod
    def _example_route(reader):
        return reader.route_book.routes[-1]["name"] if reader.route_book.routes else "the recommended traverse"

    @staticmethod
    def _toward(grid, reader, start, cue):
        """The destination a compass direction points to, from `start`."""
        start_name = start.station or start.label
        if cue.distance_m is None and not cue.to_edge:
            raise NeedsInfo(
                f"How far {cue.name} of {start_name} should I take you?",
                ["200 m", "500 m", "1 km", "As far as the map goes"],
                need="distance",
            )
        found = grid.point_toward(start.row, start.col, cue.bearing, None if cue.to_edge else cue.distance_m)
        if not found:
            raise AgentError(f"There's no safe ground {cue.name} of {start_name} on this map. Try another direction.")
        r, c = found["rc"]
        lat = grid.north - r / grid.rows * (grid.north - grid.south)
        lon = grid.west + c / grid.cols * (grid.east - grid.west)
        far = NavigationSkill._distance(found["distance_m"])
        name = f"the {cue.name} edge of the map" if cue.to_edge and not found["moved"] else f"{far} {cue.name} of {start_name}"
        notes = []
        if found["clipped"]:
            notes.append(f"The map ends about {far} {cue.name} of {start_name}, so I'm taking you to its edge.")
        if found["moved"] and cue.to_edge:
            notes.append(f"Safe, mapped ground runs out about {far} {cue.name} of {start_name}, so that's as far as I can take you.")
        elif found["moved"]:
            notes.append("The exact spot in that direction isn't safe ground, so I've picked the nearest safe spot on the way.")
        return start, Point(Coordinates.point(lat, lon), r, c, name, "direction"), notes

    @staticmethod
    def _distance(m):
        return f"{m / 1000:.1f} km" if m >= 1000 else f"{max(10, round(m / 10) * 10)} m"

    # ---- why this route: the start, the destination and the path between them ----------------------
    WHY_START = {
        "station": "You asked to start at {name}.",
        "route": "You asked to start at {name}.",
        "pin": "You asked to start from your pinned point.",
        "coords": "You gave these coordinates as the start.",
    }
    WHY_END = {
        "station": "You asked to go to {name}.",
        "route": "You asked to go to {name}.",
        "pin": "You asked to go to your pinned point.",
        "coords": "You gave these coordinates as the destination.",
        "direction": "You asked for {name}.",
    }

    @classmethod
    def why(cls, grid, dep, dst, dep_default, notes, planned, cells, stats):
        """[(label, sentence)]: why the route starts and ends where it does, and why the path runs as it does."""
        start = (
            f"You didn't say where to start, so I used the landing site, {dep.station}, where an EVA begins."
            if dep_default
            else cls.WHY_START.get(dep.kind, "You asked to start here.").format(name=dep.station or dep.label)
        )
        start += cls._snap_note(grid, (dep.row, dep.col), planned["stopCells"][0], "start")
        end = cls.WHY_END.get(dst.kind, "You asked to go here.").format(name=dst.station or dst.label)
        end += "".join(f" {n}" for n in notes)
        end += cls._snap_note(grid, (dst.row, dst.col), planned["stopCells"][-1], "destination")
        return [("STARTING POINT", start), ("DESTINATION", end), ("THE PATH", cls._path_reason(grid, cells, stats))]

    @staticmethod
    def _snap_note(grid, asked_rc, used_cell, what):
        """A note when the route had to start or end a little away from the point asked for."""
        r, c = grid.rc(used_cell)
        moved = math.hypot((r - asked_rc[0]) * grid.ch, (c - asked_rc[1]) * grid.cw)
        if moved < max(grid.cw, grid.ch) * 1.5:
            return ""
        return f" The exact {what} is on ground that isn't safe to walk, so the route uses the nearest safe spot, about {round(moved / 10) * 10:.0f} m away."

    @staticmethod
    def _path_reason(grid, cells, stats):
        """Why the path bends: what a straight line between the same two points would cross."""
        (r0, c0), (r1, c1) = grid.rc(cells[0]), grid.rc(cells[-1])
        straight_m = math.hypot((r1 - r0) * grid.ch, (c1 - c0) * grid.cw)
        steps = max(1, int(math.hypot(r1 - r0, c1 - c0) * 2))
        steep = gaps = storm = 0
        worst = 0
        for k in range(steps + 1):
            r, c = round(r0 + (r1 - r0) * k / steps), round(c0 + (c1 - c0) * k / steps)
            i = grid.index(r, c)
            s = grid.slope[i]
            if s == NO_DATA:
                gaps += 1
                continue
            worst = max(worst, s)
            if s > MAX_SLOPE:
                steep += 1
            if grid.blocked and grid.blocked[i]:
                storm += 1
        reasons = []
        if storm:
            reasons.append(f"the {grid.blocked_reason}")
        if steep:
            reasons.append(f"ground steeper than {MAX_SLOPE}° (up to {worst}°)")
        if gaps:
            reasons.append("gaps in the terrain data")
        length = round(stats["distance_m"])
        longer = (length / straight_m - 1) * 100 if straight_m else 0
        compare = f"It is {length:,} m long, against {round(straight_m):,} m in a straight line"
        compare += f" ({longer:.0f}% longer)." if longer >= 1 else "."
        if reasons:
            said = ", ".join(reasons[:-1]) + (" and " if len(reasons) > 1 else "") + reasons[-1]
            why = f"A straight line would cross {said}, so the route bends around {'them' if len(reasons) > 1 or gaps else 'it'}."
        elif worst > stats["max_slope"] + 1:
            why = f"A straight line would cross slopes up to {worst}°; this path keeps to {stats['max_slope']}° or less."
        elif longer >= 5:
            why = "Nothing on the straight line is unsafe, but the route bends a little to stay on the gentlest ground, which is easier and quicker to walk in a suit."
        else:
            why = "It runs close to a straight line: there is nothing steep to go around."
        sky = stats.get("mean_sky_view", 1)
        shelter = " Where it can, it also keeps to ground sheltered from cosmic radiation by hills and crater walls." if sky < 0.995 else ""
        return f"{why} {compare}{shelter} It always keeps to slopes under {MAX_SLOPE}°."

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
        title = dest.upper().replace(":", " -") if dest else None  # the chat lays out a heading only without colons
        lines = [f"DIRECTIONS TO {title}" if dest else "DIRECTIONS", "", opener, ""]
        lines += [f"FROM: {trip['from_name'][:1].upper()}{trip['from_name'][1:]} · {trip['from']}"]
        lines += [f"GOING TO: {dest or 'Your destination'} · {trip['to']}", ""]
        if trip.get("why"):
            lines += ["WHY THIS ROUTE"] + [f"{label}: {text}" for label, text in trip["why"]] + [""]

        previous = None
        for k, leg in enumerate(legs):
            first, last = k == 0, k == len(legs) - 1
            heading = f"{leg['heading']:03d}° ({cls.compass(leg['heading'])})"
            title = "HEADING OUT" if first else "FINAL STRETCH" if last else LEG_TITLES[leg["terrain"]]
            lines.append(f"LEG {k + 1} - {title}")
            if first:
                lines.append(f"Face {heading} and walk about {leg['distance_m']} m.")
            else:
                turn = cls.turn(leg["heading"] - previous)
                tail = f"for the last {leg['distance_m']} m" if last else f"and keep going for about {leg['distance_m']} m"
                lines.append(f"{turn} {heading} {tail}.")
            # every middle leg warns about its elevation change; the first and last when they climb or drop
            if not first and not last or leg.get("trend", "LEVEL") != "LEVEL":
                lines.append(cls._elevation_note(leg))
            previous = leg["heading"]
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
    def turn(delta):
        """How a change of heading (degrees, + = clockwise) is said: "Bear slightly left to" and the like."""
        delta = (delta + 540) % 360 - 180
        side = "right" if delta > 0 else "left"
        if abs(delta) < 20:
            return "Carry straight on at"
        if abs(delta) < 45:
            return f"Bear slightly {side} to"
        if abs(delta) < 120:
            return f"Turn {side} to"
        return f"Turn sharply {side} to"

    @staticmethod
    def _elevation_note(leg):
        dz = leg["elevation_change_m"]
        trend = leg.get("trend", leg["terrain"])
        if trend == "ASCENT":
            return f"Heads up: this stretch climbs about {dz} m, so take it slow and steady."
        if trend == "DESCENT":
            return f"Heads up: this stretch drops about {dz} m, so watch your footing on the way down."
        if dz == 0:
            return "Heads up: the ground stays level here, with less than a metre of height change."
        return f"Heads up: the ground stays fairly level here, about {dz} m of height change."

    @staticmethod
    def _duration(minutes):
        m = max(1, round(minutes))
        return f"{m} min" if m < 60 else f"{m // 60} h {m % 60:02d} min"
