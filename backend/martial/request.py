"""Reads what a request names: coordinates, stations, places on the routes on the user's map, the
user's pinned point, and destinations that aren't on the map."""

import re
from typing import NamedTuple, Optional

from backend.terrain import Coordinates

from .cues import DirectionCue
from .errors import AgentError


class Point(NamedTuple):
    """A place named in a request."""

    label: str  # its coordinates, as written in replies
    row: float
    col: float
    station: Optional[str]  # its name ("Twin Peaks", "the end of Your route 1"), or None for plain coordinates
    kind: str = "station"  # 'station' | 'coords' | 'route' (a place on a route on the map) | 'pin'


class RouteBook:
    """The routes on the user's map, and how a request can name a place on one:
    "the end of Your route 1", "stop 2 on my route", "the recommended traverse's start",
    "halfway along Curiosity's drive", "the start of Martial's route"."""

    START = r"start(?:ing point)?|beginning|departure(?: point)?|first point|origin"
    END = r"end(?: ?point)?|destination|finish|last point|final stop"
    MIDDLE = r"middle|midpoint|halfway(?: point)?|half ?way"
    NUMBERED = r"(?:stop|point|waypoint)\s*(\d+)"

    def __init__(self, grid, routes):
        self.grid = grid
        self.routes = [r for r in routes or [] if len(r.get("cells") or []) > 1]
        self._aliases = [(alias, r) for r in self.routes for alias in self._aliases_for(r)]
        self._aliases.sort(key=lambda a: -len(a[0]))  # longest first: "your route 12" before "your route 1"

    def _aliases_for(self, route):
        """Ways a user may write this route's name (lower case)."""
        name = route.get("name", "").strip()
        plain = re.sub(r"\s*\(.*?\)", "", name).strip().lower()
        out = {name.lower(), plain}
        kind = route.get("kind")
        if kind == "recommended":
            out |= {"recommended traverse", "recommended route", "recommended path", "the recommended"}
        elif kind == "reference":
            out |= {"rover drive", "rover's drive", "rover route", "rover path"}
        if route.get("agent") or name.lower().startswith("martial"):
            out |= {"martial's route", "martial route", "martial's path", "your route from martial"}
        m = re.match(r"your route (\d+)$", plain)
        if m:
            out |= {f"my route {m.group(1)}", f"route {m.group(1)}", f"custom route {m.group(1)}"}
        return {a for a in out if len(a) > 3}

    def _latest_own_route(self):
        own = [r for r in self.routes if r.get("kind") == "custom" and not r.get("agent")]
        return own[-1] if own else None

    def _alias_pattern(self):
        aliases = [re.escape(a) for a, _ in self._aliases] + [r"my route", r"your route", r"my own route"]
        return "(?:the\\s+)?(?P<route>" + "|".join(aliases) + ")"

    def matches(self, text):
        """[(start, end, Point)] for every place on a route the text names."""
        if not self.routes:
            return []
        route = self._alias_pattern()
        part = f"(?P<part>{self.START}|{self.END}|{self.MIDDLE}|{self.NUMBERED})"
        patterns = [
            re.compile(rf"\b(?:the\s+)?{part}\s+(?:of|on|in|along|for|from)\s+{route}\b", re.IGNORECASE),
            re.compile(rf"\b{route}(?:'s)?\s+{part}\b", re.IGNORECASE),
        ]
        found, taken = [], []
        for rx in patterns:
            for m in rx.finditer(text):
                if any(a < m.end() and m.start() < b for a, b in taken):
                    continue
                point = self._point(m.group("route"), m.group("part"))
                if point:
                    found.append((m.start(), m.end(), point))
                    taken.append((m.start(), m.end()))
        return found

    def _route_named(self, written):
        w = written.lower().strip()
        for alias, r in self._aliases:
            if alias == w:
                return r
        if w in ("my route", "your route", "my own route"):
            return self._latest_own_route()
        return None

    def _point(self, written_route, written_part):
        route = self._route_named(written_route)
        if not route:
            return None
        cells, stops = route["cells"], route.get("stops") or []
        p = written_part.lower()
        name = route.get("name", "the route")
        if re.fullmatch(self.START, p):
            cell, label = (stops[0].get("cell") if stops else None) or cells[0], f"the start of {name}"
        elif re.fullmatch(self.END, p):
            cell, label = (stops[-1].get("cell") if stops else None) or cells[-1], f"the end of {name}"
        elif re.fullmatch(self.MIDDLE, p):
            cell, label = cells[len(cells) // 2], f"halfway along {name}"
        else:
            n = int(re.search(r"\d+", p).group())
            stop = self._numbered_stop(stops, n)
            if not stop or stop.get("cell") is None:
                have = ", ".join(s.get("name", "") for s in stops) or "no named stops"
                raise AgentError(f"{name} has no stop {n}. Its stops are: {have}.")
            cell, label = stop["cell"], f"{stop['name']} on {name}"
        r, c = self.grid.rc(int(cell))
        lat, lon = self.grid.cell_latlon(int(cell))
        return Point(Coordinates.point(lat, lon), r, c, label, "route")

    # ---- when a request says "stop 2" without saying which route -----------------------------------
    def routes_with_stop(self, n):
        """Routes on the map that have a stop numbered n."""
        return [r for r in self.routes if self._numbered_stop(r.get("stops") or [], n)]

    def route_from_answer(self, answer, choices):
        """The route a follow-up answer picks: its name ("Your route 1", "the recommended one"),
        or its place in the list of choices ("1", "the second one", "last")."""
        text = answer.strip().lower()
        for alias, r in self._aliases:
            if alias in text:
                return r
        if re.search(r"\b(?:my|mine|my own)\b", text) and self._latest_own_route():
            return self._latest_own_route()
        ordinals = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "last": len(choices)}
        m = re.fullmatch(r"(?:option\s*|number\s*|#)?(\d+)\.?", text)
        k = int(m.group(1)) if m else next((v for w, v in ordinals.items() if re.search(rf"\b{w}\b", text)), None)
        if k and 0 < k <= len(choices):
            return next((r for r in self.routes if r.get("name") == choices[k - 1]), None)
        return next((r for r in self.routes if r.get("name", "").lower() in text), None)

    @staticmethod
    def attach_route(text, route_name):
        """Rewrites every "stop N" that names no route as "stop N on <route>"."""
        return re.sub(
            r"\b(?:science\s+)?stop\s*(\d+)\b(?!\s+(?:of|on|in|along|for)\b)",
            lambda m: f"stop {m.group(1)} on {route_name}",
            text,
            flags=re.IGNORECASE,
        )

    @staticmethod
    def _numbered_stop(stops, n):
        """'stop 2' / 'point 2': the stop named that way, else the n-th stop after the start."""
        for s in stops:
            if re.match(rf"(?:stop|point)\s*{n}\b", s.get("name", ""), re.IGNORECASE):
                return s
        # Only count stops by position when none of them is numbered by name
        numbered = any(re.match(r"(?:stop|point)\s*\d", s.get("name", ""), re.IGNORECASE) for s in stops)
        return stops[n] if not numbered and 0 < n < len(stops) else None


class RequestReader:
    COORD_PAIR = re.compile(
        r"(?<![\d.])(-?\d+(?:\.\d+)?)\s*°?\s*(?:([NS])(?![A-Za-z]))?"  # latitude, optional N/S
        r"(?:\s*[,;/]\s*|\s+)"  # separator
        r"(-?\d+(?:\.\d+)?)\s*°?\s*(?:([EW])(?![A-Za-z]))?",  # longitude, optional E/W
        re.IGNORECASE,
    )
    STATION_WORDS = re.compile(r"\blanding\b|\b(?:science\s+)?stop\s*(\d+)\b", re.IGNORECASE)
    # The point the user pinned on the map (clicked, or found with the coordinate search)
    PIN_WORDS = re.compile(
        r"\b(?:(?:my|the|this|that)\s+)?(?:pin(?:ned)?(?:\s+(?:point|spot|location))?|"
        r"(?:marked|selected|clicked)\s+(?:point|spot|location)|this\s+(?:point|spot)|here)\b",
        re.IGNORECASE,
    )

    # "get to / go to / directions to / route to ... X": X is where the user wants to end up.
    DESTINATION_PHRASE = re.compile(
        r"\b(?:get(?:ting)?|go(?:ing)?|travel(?:l?ing)?|walk(?:ing)?|driv(?:e|ing)|head(?:ing)?|navigat(?:e|ing)|"
        r"directions?|route|path|way|take\s+me|bring\s+me|fly(?:ing)?|move|commute|trip|journey|reach)\b"
        r"[^?!]*?\b(?:to|towards?)\s+(.+?)\s*(?:[?!]|\.(?:\s|$)|$)",
        re.IGNORECASE,
    )
    # A destination described by its character ("the highest point", "somewhere smooth") is valid:
    # the route-preference skill picks a real place on the map for it.
    DESCRIBED_PLACE = re.compile(
        r"\b(?:fast|quick|short|long|rock|rough|smooth|flat|easy|easi|safe|high|low|steep|gentle|varied|divers|"
        r"scenic|summit|top|peak|view|deep|bottom|valley|basin|point|spot|somewhere|anywhere|place|area|location|"
        r"shield|shelter|radiat)",
        re.IGNORECASE,
    )

    def __init__(self, grid, routes=None, pin=None):
        """routes: the routes on the user's map ({id, name, kind, cells, stops: [{name, cell}]});
        pin: {lat, lon} of the point the user pinned, if any."""
        self.grid = grid
        self.route_book = RouteBook(grid, routes)
        self.pin = pin if pin and grid.contains(pin.get("lat", 999), pin.get("lon", 999)) else None

    def points(self, text):
        """Points named in the request, in the order written: places on routes, the pin, coordinates,
        'landing', 'stop N' or a station's name. Returns (list of Point, list of out-of-map coordinates)."""
        placed, outside = self.placed_points(text)
        return [p for _, p in placed], outside

    def endpoints(self, text):
        """(departure, destination) Points of a request (either may be None). "from X" marks the
        departure and "to Y" the destination, whatever order they are written in; otherwise the
        first place named is the departure and the last the destination."""
        placed, _ = self.placed_points(text)
        if not placed:
            return None, None
        role = {}
        for at, p in placed:
            before = text[max(0, at - 16) : at].lower()
            if re.search(r"\bfrom\s+$", before):
                role[at] = "from"
            elif re.search(r"\b(?:to|towards?|reach|at)\s+$", before):
                role[at] = "to"
        dep = next((p for at, p in placed if role.get(at) == "from"), None)
        dst = next((p for at, p in reversed(placed) if role.get(at) == "to"), None)
        rest = [p for at, p in placed if p is not dep and p is not dst]
        if len(placed) == 1:
            return (dep, None) if dep else (None, placed[0][1])
        dep = dep or (rest.pop(0) if rest else None)
        dst = dst or (rest.pop() if rest else None)
        return dep, dst

    def placed_points(self, text):
        """Like points(), with each point's position in the text: ([(position, Point)], outside)."""
        claimed = self.route_book.matches(text) + self._pin(text)
        spans = [(a, b) for a, b, _ in claimed]
        free = lambda at: not any(a <= at < b for a, b in spans)  # noqa: E731
        found = [(a, p) for a, _, p in claimed]
        found += [f for f in self._coordinates(text) + self._station_words(text) + self._station_names(text) if free(f[0])]
        outside = [label for at, label in self._outside(text) if free(at)]
        found.sort(key=lambda p: p[0])
        # "Spirit landing site" matches both by name and by "landing": keep one
        found = [p for k, p in enumerate(found) if not (k and p[1].station and p[1].station == found[k - 1][1].station)]
        return found, outside

    def off_map_destination(self, message):
        """The destination the user asked for, if it isn't a place on this landing-site map; else None."""
        m = self.DESTINATION_PHRASE.search(message)
        if not m:
            return None
        # "to X from Y": only X is the destination
        dest = re.split(r"\s+\bfrom\b\s+", m.group(1).strip(), maxsplit=1, flags=re.IGNORECASE)[0]
        points, _ = self.points(dest)
        if points or self.DESCRIBED_PLACE.search(dest) or DirectionCue.mentions_direction(dest):  # "to the west"
            return None
        return dest[:60].strip(" ,;:")

    def bare_stop_numbers(self, text):
        """Stop numbers written without saying which route ("go from stop 1 to stop 2"), when the map
        has routes the user could mean. "science stop N" always means the site's science stop."""
        if not self.route_book.routes:
            return []
        taken = [(a, b) for a, b, _ in self.route_book.matches(text)]
        out = []
        for m in re.finditer(r"\b(science\s+)?stop\s*(\d+)\b", text, re.IGNORECASE):
            if m.group(1) or any(a <= m.start() < b for a, b in taken):
                continue
            out.append(int(m.group(2)))
        return out

    def text_without_places(self, text):
        """The request with the places it names blanked out (so "Victoria crater (north rim)" or a
        route called "west loop" is not read as a compass direction)."""
        spans = [(a, b) for a, b, _ in self.route_book.matches(text) + self._pin(text)]
        lowered = text.lower()
        for s in self.grid.stations:
            name = s["name"].lower()
            at = lowered.find(name)
            if at >= 0:
                spans.append((at, at + len(name)))
        for r in self.route_book.routes:
            name = r.get("name", "").lower()
            at = lowered.find(name) if name else -1
            if at >= 0:
                spans.append((at, at + len(name)))
        out = list(text)
        for a, b in spans:
            out[a:b] = " " * (b - a)
        return "".join(out)

    def known_places(self):
        """A short list of what can be named, for help messages."""
        names = ["landing site"] + [f"stop {k}" for k in range(1, len(self.grid.stations))]
        if self.route_book.routes:
            names.append(f"the start or end of a route on your map (like \"the end of {self.route_book.routes[-1]['name']}\")")
        if self.pin:
            names.append("your pinned point")
        return ", ".join(names)

    # ---- the kinds of point ---------------------------------------------------------------------
    def _pin(self, text):
        if not self.pin:
            return []
        lat, lon = self.pin["lat"], self.pin["lon"]
        r, c = self.grid.latlon_to_rc(lat, lon)
        point = Point(Coordinates.point(lat, lon), r, c, "your pinned point", "pin")
        return [(m.start(), m.end(), point) for m in self.PIN_WORDS.finditer(text)]

    def _coordinate_matches(self, text):
        """(position in text, lat, lon) of every valid coordinate pair."""
        for m in self.COORD_PAIR.finditer(text):
            lat_s, ns, lon_s, ew = m.groups()
            lat, lon = float(lat_s), float(lon_s)
            if ns and ns.upper() == "S":
                lat = -abs(lat)
            if ew and ew.upper() == "W":
                lon = -abs(lon)
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                yield m.start(), lat, lon

    def _coordinates(self, text):
        found = []
        for at, lat, lon in self._coordinate_matches(text):
            if self.grid.contains(lat, lon):
                r, c = self.grid.latlon_to_rc(lat, lon)
                found.append((at, Point(Coordinates.point(lat, lon), r, c, None, "coords")))
        return found

    def _outside(self, text):
        return [
            (at, Coordinates.point(lat, lon))
            for at, lat, lon in self._coordinate_matches(text)
            if not self.grid.contains(lat, lon)
        ]

    def station_point(self, s):
        """A station as a Point."""
        return Point(Coordinates.point(s["lat"], s["lon"]), *s["rc"], s["name"], "station")

    def _station_words(self, text):
        stations = self.grid.stations
        found = []
        for m in self.STATION_WORDS.finditer(text):
            k = int(m.group(1)) if m.group(1) else 0
            if k < len(stations):
                found.append((m.start(), self.station_point(stations[k])))
        return found

    def _station_names(self, text):
        """Stations by name too ("Twin Peaks", "Victoria crater"), without any "(…)" note."""
        lowered = text.lower()
        found = []
        for s in self.grid.stations:
            name = re.sub(r"\s*\(.*?\)", "", s["name"]).strip().lower()
            at = lowered.find(name) if len(name) > 3 else -1
            if at >= 0:
                found.append((at, self.station_point(s)))
        return found
