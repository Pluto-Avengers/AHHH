"""The ROUTER: decides which skill a request needs."""

import json
import re

from .prompts import ROUTER_INSTRUCTIONS


class SkillRouter:
    PREFERENCE_WORDS = re.compile(
        r"fast|quick|short|long|rock|smooth|flat|easy|easi|safe|high|low|steep|gentle|varied|divers|scenic|prefer|"
        r"radiat|dose|shield|exposure|cosmic",
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

    def _skill_name(self, request):
        points, _ = request.reader.points(request.message)
        coords = sum(1 for p in points if p.station is None)
        if coords >= 2:
            return "NAVIGATION"  # two coordinates: no doubt, no need to ask the model
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
