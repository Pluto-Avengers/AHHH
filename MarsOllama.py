"""Martial: the Mars Positioning System navigation agent (Ollama).

The agent lives in backend/martial (MartialAgent, its router and one class per skill) and reads the
landing-site terrain through backend/terrain. This file is the command-line entry point.

Run the API for the website:  python -m backend.server
Try it from a terminal:       python MarsOllama.py jezero "Find me the least rocky route"
"""

import sys

from backend.martial import AgentError, MartialAgent
from backend.terrain import site_catalog


def main(argv):
    if len(argv) < 2:
        print(f'Usage: python MarsOllama.py <{"|".join(site_catalog.ids)}> "your request"')
        return 1
    try:
        out = MartialAgent().ask(argv[0], " ".join(argv[1:]))
    except (AgentError, ValueError) as e:
        print(e)
        return 1
    print(f"[{out['skill']} via {out['source']}]\n")
    print(out["reply"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
