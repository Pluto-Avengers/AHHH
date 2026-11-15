"""Compass directions in a request: "500 m west", "head north-northeast", "bearing 250°",
"as far east as you can". Martial turns them into a destination on the map."""

import math
import re
from dataclasses import dataclass
from typing import Optional

BASE = {"north": 0.0, "east": 90.0, "south": 180.0, "west": 270.0}
ABBREVIATIONS = {
    "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
    "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
}
COMPASS_NAMES = (
    "north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
    "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest",
)


def mean_bearing(*degrees):
    """Average of compass bearings (on the circle: north-northwest is between north and northwest)."""
    x = sum(math.sin(math.radians(d)) for d in degrees)
    y = sum(math.cos(math.radians(d)) for d in degrees)
    return math.degrees(math.atan2(x, y)) % 360


@dataclass
class DirectionCue:
    bearing: float  # degrees, 0 = north, 90 = east
    distance_m: Optional[float]  # None when the request gives no distance
    to_edge: bool  # "as far as you can", "to the edge of the map"

    WORDS = re.compile(
        r"\b((?:north|south|east|west)(?:[\s-]?(?:north|south|east|west)){0,2})(?:wards?|erly|ern)?\b",
        re.IGNORECASE,
    )
    # Abbreviations only right after a movement word, so "18.4 N, 77.4 E" is not a direction
    SHORT = re.compile(r"\b(?:go|head|walk|move|travel|due|towards?|to\s+the)\s+(NNE|NNW|ENE|ESE|SSE|SSW|WSW|WNW|NE|NW|SE|SW|N|S|E|W)\b")
    BEARING = re.compile(r"\b(?:heading|bearing|azimuth|course)\s*(?:of\s*)?(\d{1,3}(?:\.\d+)?)\s*(?:°|deg(?:rees)?)?", re.IGNORECASE)
    DISTANCE = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|m|met(?:er|re)s?)\b", re.IGNORECASE)
    EDGE = re.compile(
        r"\bas far(?:\s+\w+)?\s+as\s+(?:possible|you can|it goes|the map goes|i can)|\b(?:edge|end) of the map\b|"
        r"\ball the way\b|\buntil the (?:edge|end)\b",
        re.IGNORECASE,
    )

    @property
    def name(self):
        """The direction in words ("west", "north-northeast")."""
        return COMPASS_NAMES[round(self.bearing / 22.5) % 16]

    @classmethod
    def parse(cls, text):
        """The direction a request asks to go in, or None."""
        bearing = cls._bearing(text)
        if bearing is None:
            return None
        d = cls.DISTANCE.search(text)
        distance = None
        if d:
            distance = float(d.group(1)) * (1000 if d.group(2).lower().startswith("k") else 1)
        return cls(bearing=bearing, distance_m=distance, to_edge=bool(cls.EDGE.search(text)))

    @classmethod
    def mentions_direction(cls, text):
        return cls._bearing(text) is not None

    @classmethod
    def _bearing(cls, text):
        m = cls.BEARING.search(text)
        if m and float(m.group(1)) <= 360:
            return float(m.group(1)) % 360
        m = cls.WORDS.search(text)
        if m:
            parts = re.findall(r"north|south|east|west", m.group(1).lower())
            if len(parts) == 1:
                return BASE[parts[0]]
            pair = parts[-2:]
            # a valid pair has one of north/south and one of east/west ("northwest", not "north south")
            if {pair[0] in ("north", "south"), pair[1] in ("north", "south")} != {True, False}:
                return BASE[parts[0]]
            two = mean_bearing(BASE[pair[0]], BASE[pair[1]])
            return two if len(parts) == 2 else mean_bearing(BASE[parts[0]], two)  # north-northwest
        m = cls.SHORT.search(text)
        if m:
            return float(ABBREVIATIONS[m.group(1)])
        return None
