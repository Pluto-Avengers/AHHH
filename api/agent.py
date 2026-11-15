"""Vercel Function for POST /api/agent: the Martial agent, hosted with the website.

Locally the same agent is served by `python -m backend.server` (the Vite dev server forwards /api
to it). On Vercel there is no Ollama, so Martial answers from the map data.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # project root, so 'backend' imports

from backend.martial import MartialAgent  # noqa: E402
from backend.server import AgentRequestHandler  # noqa: E402
from backend.terrain.files import add_website_url  # noqa: E402


class handler(AgentRequestHandler):  # noqa: N801  (Vercel looks for this name)
    agent = MartialAgent()

    def do_POST(self):  # noqa: N802
        # The function doesn't get public/, so the terrain and storms are downloaded from this same website
        host = self.headers.get("x-forwarded-host") or self.headers.get("host")
        if host:
            add_website_url(f"{self.headers.get('x-forwarded-proto') or 'https'}://{host}")
        self.path = "/api/agent"
        super().do_POST()
