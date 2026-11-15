"""Back end for the Mars Positioning System: serves the Martial agent to the website.

    python -m backend.server            (from the project root; listens on http://127.0.0.1:8000)

Endpoints
    GET  /api/health   is Ollama running, and is the model installed?
    POST /api/agent    {"site": "jezero", "message": "...", "routes": [{"id", "name", "kind", "cells"}]}
                       -> {"skill", "source", "reply", "highlight"?, "route"?}

The Vite dev server forwards /api here (see vite.config.js), so the site and the agent share one origin.
"""

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so 'backend' imports from any folder

from backend.martial.agent import MartialAgent  # noqa: E402
from backend.martial.errors import AgentError  # noqa: E402

HOST = os.environ.get("MPS_HOST", "127.0.0.1")
PORT = int(os.environ.get("MPS_PORT", "8000"))
MAX_BODY = 5_000_000  # bytes: routes carry their cell lists


class AgentRequestHandler(BaseHTTPRequestHandler):
    """Answers /api requests with the server's MartialAgent."""

    agent: MartialAgent  # set by MartialServer

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802  (CORS preflight when the site is served from another port)
        self._send(204, {})

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") == "/api/health":
            self._send(200, self.agent.status())
        else:
            self._send(404, {"error": "Not found"})

    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") != "/api/agent":
            self._send(404, {"error": "Not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._send(400, {"error": "Send a JSON body with site and message."})
            return
        try:
            body = json.loads(self.rfile.read(length))
            result = self.agent.ask(body.get("site", ""), body.get("message", ""), body.get("routes") or [])
            self._send(200, result)
        except AgentError as e:
            self._send(200, {"skill": None, "source": "map", "reply": str(e)})
        except (ValueError, KeyError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self._send(500, {"error": f"Martial hit a problem: {e}"})

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[martial] {self.address_string()} {fmt % args}\n")


class MartialServer:
    """The HTTP server for the website, with one shared agent."""

    def __init__(self, agent=None, host=HOST, port=PORT):
        self.agent = agent or MartialAgent()
        self.host = host
        self.port = port

    def check_model(self):
        """Warns when Martial will have to answer from map data only."""
        status = self.agent.status()
        model = self.agent.model
        if not status["ollama"]:
            print(f"! Ollama is not reachable ({status.get('error')}). Martial will answer from map data only.")
        elif not status["model_installed"]:
            print(f"! Model '{model}' is not installed. Run: ollama pull {model}")

    def serve(self):
        handler = type("Handler", (AgentRequestHandler,), {"agent": self.agent})
        server = ThreadingHTTPServer((self.host, self.port), handler)
        print(f"Martial back end on http://{self.host}:{self.port}  (model: {self.agent.model})", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def main():
    server = MartialServer()
    server.check_model()
    server.serve()


if __name__ == "__main__":
    main()
