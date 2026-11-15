"""SKILL 2: picks and highlights the map route that best fits what the user wants."""

import json
import re
import threading

from backend.martial.errors import AgentError
from backend.martial.prompts import ROUTE_PREFERENCE_INSTRUCTIONS
from backend.terrain.candidates import RouteCandidates

from .base import Skill, SiteRequest


class RoutePreferenceSkill(Skill):
    name = "ROUTE_PREFERENCE"
    instructions = ROUTE_PREFERENCE_INSTRUCTIONS

    KEYWORDS = [  # used only when Ollama is offline or names no valid route
        ("least radiation", r"radiat|dose|shield|exposure|cosmic|sievert"),
        ("least rocky", r"least rock|smooth|flat|easi|easy|gentle|safe|calm"),
        ("rockiest", r"rock|rough|bump|divers|varied|variety"),
        ("fastest", r"fast|quick|short|direct|minimum"),
        ("longest", r"long|scenic|maximum"),
        ("highest point", r"high|summit|top|climb|view"),
        ("lowest point", r"low|deep|bottom|valley|basin"),
    ]

    def __init__(self, llm):
        super().__init__(llm)
        self._missions = 0  # each answer is numbered MISSION 1, 2, ...
        self._lock = threading.Lock()

    def _next_mission(self, site):
        with self._lock:
            self._missions += 1
            return f"MISSION {self._missions} ({site['name'].upper()})"

    def run(self, request: SiteRequest):
        grid, site, message = request.grid, request.site, request.message
        points, _ = request.reader.points(message)
        departure = (points[0].row, points[0].col) if points and points[0].station is None else None
        candidates = RouteCandidates(grid)
        routes = candidates.build(request.client_routes, departure)
        if not routes:
            raise AgentError("The map has no safe routes from that point. Try a departure closer to the landing site.")
        ranking = candidates.ranking(routes)
        mission = self._next_mission(site)

        data = {
            "landing_site": site["name"],
            "mission": mission,
            "routes": [self._table_row(r) for r in routes],
            "best_match_by_characteristic": ranking,
        }
        prompt = f"{message}\n\nMAP DATA\n{json.dumps(data, indent=1, ensure_ascii=False)}"

        by_key = {r["key"]: r for r in routes}
        try:
            reply, source = self.llm.chat(self.instructions, prompt), "ollama"
            m = re.search(r"HIGHLIGHTED ROUTE:\s*\**\s*(R\d+)", reply, re.IGNORECASE)
            chosen = by_key.get(m.group(1).upper()) if m else None
        except Exception:  # noqa: BLE001
            reply, source, chosen = None, "map", None

        if chosen is None:
            trait = next((t for t, rx in self.KEYWORDS if re.search(rx, message, re.IGNORECASE)), "least rocky")
            chosen = by_key[ranking[trait]]
            if reply:  # the model answered but named no valid route: keep the map's choice, consistently
                source = "map"
            reply = self._map_reply(mission, chosen, trait)
        else:
            reply = self._model_reply(mission, chosen, reply, message)

        result = {"skill": self.name, "source": source, "reply": reply, "highlight": chosen["id"]}
        if chosen["new"]:
            result["route"] = {
                "id": chosen["id"],
                "name": f"Martial: {chosen['name']}",
                "description": f"Chosen by Martial for: {message.strip()[:120]}",
                "cells": chosen["cells"],
                "stopCells": chosen["stopCells"],
                "stops": [{"name": "Departure"}, {"name": chosen["destination"]}],
            }
        return result

    @staticmethod
    def _table_row(r):
        """One candidate as the model sees it in MAP DATA."""
        s = r["stats"]
        return {
            "key": r["key"],
            "name": r["name"],
            "departure": r["start"],
            "destination": r["destination"],
            "destination_coordinates": r["end"],
            "steps": s["steps"],
            "distance_m": round(s["distance_m"]),
            "walk_min": round(s["walk_min"]),
            "radiation_dose_ugy": round(s["dose_ugy"], 1),
            "open_sky_percent": round(s["mean_sky_view"] * 100, 1),
            "climb_m": round(s["gain_m"]),
            "descent_m": round(s["loss_m"]),
            "max_slope_deg": s["max_slope"],
            "mean_slope_deg": round(s["mean_slope"], 1),
            "roughness_m": round(s["roughness_m"], 1),
            "highest_above_departure_m": round(s["highest_rel_m"], 1),
            "lowest_below_departure_m": round(s["lowest_rel_m"], 1),
        }

    @staticmethod
    def _header(mission, chosen, requirements):
        return [
            "MARS SURFACE PREFERRED ROUTES",
            f"MISSION: {mission} | DESTINATION: {chosen['destination']}",
            f"DEPARTURE COORDINATES: {chosen['start']}",
            f"DESTINATION COORDINATES: {chosen['end']}",
            f"ROUTE REQUIREMENTS: {requirements}",
            f"HIGHLIGHTED ROUTE: {chosen['key']}: {chosen['name']}",
        ]

    def _map_reply(self, mission, chosen, trait):
        """The answer written from the map alone."""
        s = chosen["stats"]
        reason = (
            f"REASON: Best {trait} route on the map: {s['steps']} steps, {s['distance_m']:.0f} m, "
            f"roughness {s['roughness_m']:.1f} m, highest +{s['highest_rel_m']:.0f} m, lowest {s['lowest_rel_m']:.0f} m, "
            f"radiation dose about {s['dose_ugy']:.1f} µGy."
        )
        return "\n".join(self._header(mission, chosen, trait) + [reason])

    def _model_reply(self, mission, chosen, reply, message):
        """Keeps the model's requirements and reason, but takes every header value from the map."""
        def field(name):
            m = re.search(rf"^{name}:\s*(.+)$", reply, re.MULTILINE | re.IGNORECASE)
            return m.group(1).strip() if m else None

        reason = field("REASON") or "Best match on the map for your request."
        requirements = field("ROUTE REQUIREMENTS") or message.strip()
        return "\n".join(self._header(mission, chosen, requirements) + [f"REASON: {reason}"])
