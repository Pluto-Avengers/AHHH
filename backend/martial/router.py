"""The ROUTER: decides which skill a request needs."""

import json
import re

from .cues import DirectionCue
from .prompts import ROUTER_INSTRUCTIONS


class SkillRouter:
    PREFERENCE_WORDS = re.compile(
        # at the start of a word only: "along" and "below" are not preferences
        r"\b(?:fast|quick|short|long|rock|smooth|flat|easy|easi|safe|high|low|steep|gentle|varied|divers|scenic|prefer|"
        r"radiat|dose|shield|exposure|cosmic)",
        re.IGNORECASE,
    )

    # Two named places and a request to be taken there: directions, without asking the model
    ASKS_FOR_DIRECTIONS = re.compile(r"\b(?:directions?|how (?:do|can|should) i get|take me|guide me|navigate|walk me)\b", re.IGNORECASE)

    # Words that show a request is about getting around the site. A message with none of them (and no
    # place, coordinates or compass direction) isn't something Martial can plan a route for.
    TOPIC_WORDS = re.compile(
        r"\b(?:route|path|trail|travers|way\b|go\b|goes|going|get\b|gets|getting|head|walk|hik|driv|travel|trip|"
        r"journey|mov|reach|visit|explor|tour|stop|waypoint|destination|depart|start|finish|end\b|arriv|leav|"
        r"return|back\b|landing|site|station|crater|rim|ridge|hill|mountain|mesa|butte|valley|canyon|channel|"
        r"delta|dune|sand|rock|boulder|terrain|ground|surface|slope|summit|peak|top\b|bottom|map\b|direction|"
        r"navigat|far\b|near|close|distance|km\b|kilomet|met(?:er|re)s?\b|mile|coordinat|latitude|longitude|"
        r"storm|dust|avoid|sample|science|rover|perseverance|curiosity|spirit|opportunity|pathfinder|sojourner|"
        r"insight|zhurong|where|pin\b|here\b|there\b|elevation|altitude|climb|descen|uphill|downhill|"
        r"left\b|right\b|straight|forward|turn|view|vista|lookout|sight)",
        re.IGNORECASE,
    )

    def __init__(self, llm, skills):
        """skills: {name: Skill}, with "NAVIGATION" and "ROUTE_PREFERENCE"."""
        self.llm = llm
        self.skills = skills

    def choose(self, request):
        """The Skill for this request: certain cases by rule, otherwise the model decides,
        with a keyword rule when Ollama is offline or answers badly."""
        return self.skills[self._skill_name(request)]

    def is_on_topic(self, request):
        """Is the request about routes or getting around the site? ("what did I do today" is not.)"""
        message = request.message
        if any(rx.search(message) for rx in (self.TOPIC_WORDS, self.PREFERENCE_WORDS, self.ASKS_FOR_DIRECTIONS)):
            return True
        points, _ = request.reader.points(message)
        return bool(points) or DirectionCue.mentions_direction(message)

    def _skill_name(self, request):
        points, _ = request.reader.points(request.message)
        coords = sum(1 for p in points if p.station is None)
        if DirectionCue.mentions_direction(request.reader.text_without_places(request.message)):
            return "NAVIGATION"  # "500 m west of stop 1": a destination, by compass direction
        if coords >= 2 or (len(points) >= 2 and self.ASKS_FOR_DIRECTIONS.search(request.message)):
            return "NAVIGATION"  # two coordinates: no doubt, no need to ask the model
        if self.ASKS_FOR_DIRECTIONS.search(request.message) and not self.PREFERENCE_WORDS.search(request.message):
            return "NAVIGATION"  # "directions" with too little to go on: the navigation skill asks for it
        try:
            out = json.loads(self.llm.chat(ROUTER_INSTRUCTIONS, request.message, fmt={
                "type": "object",
                "properties": {"skill": {"type": "string", "enum": list(self.skills)}},
                "required": ["skill"],
            }))
            if out.get("skill") in self.skills:
                return out["skill"]
        except Exception:  # noqa: BLE001  (offline or malformed: fall back to the keyword rule)
            pass
        if self.PREFERENCE_WORDS.search(request.message) or len(points) < 1:
            return "ROUTE_PREFERENCE"
        return "NAVIGATION"
