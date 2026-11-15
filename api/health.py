"""Vercel Function for GET /api/health: is the agent up, and is a language model behind it?"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # project root, so 'backend' imports

from backend.martial import MartialAgent  # noqa: E402
from backend.server import AgentRequestHandler  # noqa: E402


class handler(AgentRequestHandler):  # noqa: N801  (Vercel looks for this name)
    agent = MartialAgent()

    def do_GET(self):  # noqa: N802
        self.path = "/api/health"
        super().do_GET()
