"""Reads what a request names: coordinates, stations, and destinations that aren't on the map."""

import re
from typing import NamedTuple, Optional

from backend.terrain import Coordinates


class Point(NamedTuple):
    """A place named in a request."""

    label: str  # its coordinates, as written in replies
    row: float
    col: float
    station: Optional[str]  # the station's name, or None for plain coordinates


class RequestReader:
    COORD_PAIR = re.compile(
        r"(?<![\d.])(-?\d+(?:\.\d+)?)\s*°?\s*(?:([NS])(?![A-Za-z]))?"  # latitude, optional N/S
        r"(?:\s*[,;/]\s*|\s+)"  # separator
        r"(-?\d+(?:\.\d+)?)\s*°?\s*(?:([EW])(?![A-Za-z]))?",  # longitude, optional E/W
        re.IGNORECASE,
    )
    STATION_WORDS = re.compile(r"\blanding\b|\b(?:science\s+)?stop\s*(\d+)\b", re.IGNORECASE)

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

    def __init__(self, grid):
        self.grid = grid

    def points(self, text):
        """Points named in the request, in the order written: coordinates, 'landing', 'stop N' or a
        station's name. Returns (list of Point, list of out-of-map coordinates)."""
        found = self._coordinates(text) + self._station_words(text) + self._station_names(text)
        outside = [label for _, label in self._outside(text)]
        found.sort(key=lambda p: p[0])
        # "Spirit landing site" matches both by name and by "landing": keep one
        found = [p for k, p in enumerate(found) if not (k and p[1].station and p[1].station == found[k - 1][1].station)]
        return [p for _, p in found], outside

    def off_map_destination(self, message):
        """The destination the user asked for, if it isn't a place on this landing-site map; else None."""
        m = self.DESTINATION_PHRASE.search(message)
        if not m:
            return None
        # "to X from Y": only X is the destination
        dest = re.split(r"\s+\bfrom\b\s+", m.group(1).strip(), maxsplit=1, flags=re.IGNORECASE)[0]
        points, _ = self.points(dest)
        if points or self.DESCRIBED_PLACE.search(dest):
            return None
        return dest[:60].strip(" ,;:")

    # ---- the kinds of point ---------------------------------------------------------------------
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
                found.append((at, Point(Coordinates.point(lat, lon), r, c, None)))
        return found

    def _outside(self, text):
        return [
            (at, Coordinates.point(lat, lon))
            for at, lat, lon in self._coordinate_matches(text)
            if not self.grid.contains(lat, lon)
        ]

    def station_point(self, s):
        """A station as a Point."""
        return Point(Coordinates.point(s["lat"], s["lon"]), *s["rc"], s["name"])

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
