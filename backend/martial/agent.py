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

from .errors import AgentError
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

    def ask(self, site_id, message, client_routes=None):
        """Answers one request about a landing site. Returns a dict for the website (see backend/server.py)."""
        message = (message or "").strip()
        if not message:
            raise AgentError("Ask me for directions between two points, or describe the route you want.")
        grid = self.sites.grid(site_id)
        request = SiteRequest(
            site_id=site_id,
            site=self.sites.info(site_id),
            grid=grid,
            reader=RequestReader(grid),
            message=message,
            client_routes=client_routes,
        )
        dest = request.reader.off_map_destination(message)
        if dest:  # the Moon, Earth, another landing site...: refuse before any route is chosen
            raise AgentError(self._not_on_map(request.site, dest))
        return self.router.choose(request).run(request)

    @staticmethod
    def _not_on_map(site, dest):
        return (
            f"“{dest}” is not on the {site['name']} map, so a route there is not feasible. "
            "I can only plan surface routes to places on this map: the landing site. Please point to a destination that is actually on the map, or describe the kind of route you want (fastest, longest, rockiest, least rocky, highest, lowest, flattest, safest, most varied)."
        )
