"""Martial, the Mars Positioning System navigation agent.

The agent has a router and two skills, each with its own instructions (see prompts.py):

    ROUTER                    decides which skill a request needs
    SKILL 1  NAVIGATION       a formal step-by-step procedure between two points on the map
    SKILL 2  ROUTE PREFERENCE picks and highlights the map route that best fits what the user wants

Martial never invents terrain. Every coordinate, heading, distance and elevation it writes comes from
the landing-site map (backend/terrain reads the same data the website draws) and is handed to the
model inside a MAP DATA block.
"""

from backend.terrain import site_catalog

from .cues import DirectionCue
from .errors import AgentError, NeedsInfo
from .llm import OllamaClient
from .request import RequestReader
from .router import SkillRouter
from .skills import NavigationSkill, RoutePreferenceSkill, SiteRequest


class MartialAgent:
    def __init__(self, llm=None, sites=site_catalog):
        self.llm = llm or OllamaClient()
        self.sites = sites
        skills = [NavigationSkill(self.llm), RoutePreferenceSkill(self.llm)]
        self.router = SkillRouter(self.llm, {s.name: s for s in skills})

    @property
    def model(self):
        return self.llm.model

    def status(self):
        """Is Ollama running, and is the model installed?"""
        return self.llm.status()

    def ask(self, site_id, message, client_routes=None, storm=False, pin=None, pending=None):
        """Answers one request about a landing site. Returns a dict for the website (see backend/server.py).
        storm: the site's dust storm is shown on the map, so every route must go around it.
        pin: {lat, lon} of the point the user pinned on the map ("from my pin", "to here").
        pending: the follow-up question Martial asked last ({message, need, choices}); `message` is
        then the user's answer, and the original request is carried out with it.

        When something is missing or ambiguous, the reply is a question instead:
        {"skill": "CLARIFY", "reply": question, "choices": [...], "pending": {...}}."""
        message = (message or "").strip()
        if not message:
            raise AgentError("Ask me for directions between two points, or describe the route you want.")
        grid = self.sites.grid(site_id, storm=storm)
        reader = RequestReader(grid, client_routes, pin)
        if pending and pending.get("message"):
            message = self._answer(reader, pending, message)
        request = SiteRequest(
            site_id=site_id,
            site=self.sites.info(site_id),
            grid=grid,
            reader=reader,
            message=message,
            client_routes=client_routes,
        )
        try:
            self._check_stops_are_clear(reader, message)
            dest = reader.off_map_destination(message)
            if dest:  # the Moon, Earth, another landing site...: refuse before any route is chosen
                raise AgentError(self._not_on_map(request.site, dest, reader.known_places()))
            return self.router.choose(request).run(request)
        except NeedsInfo as q:
            return {
                "skill": "CLARIFY",
                "source": "map",
                "reply": q.question,
                "choices": q.choices,
                "pending": {"message": message, "need": q.need, "choices": q.choices},
            }

    @staticmethod
    def _check_stops_are_clear(reader, message):
        """"Stop 1" with no route named, when routes on the map have a stop 1: ask which route."""
        numbers = sorted(set(reader.bare_stop_numbers(message)))
        if not numbers:
            return
        routes = [r for r in reader.route_book.routes if any(reader.route_book._numbered_stop(r.get("stops") or [], n) for n in numbers)]
        if not routes:
            return  # no route has those stops: let the request explain itself (the site's science stops)
        stops = " and ".join(f"stop {n}" for n in numbers)
        raise NeedsInfo(
            f"Which route's {stops} do you mean? Several routes on the map have stops, so tell me which one.",
            [r["name"] for r in routes],
            need="route",
        )

    @staticmethod
    def _answer(reader, pending, answer):
        """The original request completed with the user's answer to Martial's question.
        An answer that is a whole new request (it names places of its own) replaces it."""
        original, need, choices = pending["message"], pending.get("need"), pending.get("choices") or []
        if need == "route":
            route = reader.route_book.route_from_answer(answer, choices)
            if route:
                return reader.route_book.attach_route(original, route["name"])
            points, _ = reader.points(answer)
            if not points and DirectionCue.parse(answer) is None:
                return original  # not a route, and not a new request either: ask again
        elif need == "distance":
            if DirectionCue.DISTANCE.search(answer) or DirectionCue.EDGE.search(answer):
                return f"{original} {answer}"
        elif need == "places":
            points, _ = reader.points(answer)
            return answer if len(points) >= 2 else f"{original} {answer}"
        return answer

    @staticmethod
    def _not_on_map(site, dest, places):
        return (
            f"“{dest}” is not on the {site['name']} map, so a route there is not feasible. "
            f"I can only plan surface routes to places on this map: {places}. Please point to a destination that is actually on the map, or describe the kind of route you want (fastest, longest, rockiest, least rocky, highest, lowest, flattest, safest, most varied)."
        )
