"""Vercel Function for POST /api/agent: the Martial agent, hosted with the website.

Locally the same agent is served by `python -m backend.server` (the Vite dev server forwards /api
to it). On Vercel there is no Ollama, so Martial answers from the map data.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # project root, so 'backend' imports

from backend.martial.agent import MartialAgent  # noqa: E402
from backend.server import AgentRequestHandler  # noqa: E402
from backend.terrain.grid import add_site_url  # noqa: E402


class handler(AgentRequestHandler):  # noqa: N801  (Vercel looks for this name)
    agent = MartialAgent()

    def do_POST(self):  # noqa: N802
        # The function doesn't get public/sites, so the terrain is downloaded from this same website
        host = self.headers.get("x-forwarded-host") or self.headers.get("host")
        if host:
            add_site_url(f"{self.headers.get('x-forwarded-proto') or 'https'}://{host}/sites")
        self.path = "/api/agent"
        super().do_POST()
