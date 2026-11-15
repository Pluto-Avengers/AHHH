"""Reading the website's data files (public/sites/<id>/*, public/storms.json).

Locally they are read from public/. A Vercel Function doesn't get the public/ folder, but the website
serves the same files, so there they are downloaded from it. The website's address comes from the
environment here, and from each request's own address in api/agent.py.
"""

import os
import urllib.request
from pathlib import Path

PUBLIC_DIR = Path(__file__).resolve().parent.parent.parent / "public"
WEBSITE_URLS = []  # where to download a file that isn't on disk, e.g. https://example.vercel.app


def add_website_url(url):
    """Registers the address of a copy of the website (its /sites and /storms.json are downloaded)."""
    url = (url or "").strip().rstrip("/")
    if url.endswith("/sites"):  # MPS_SITES_URL used to name the sites folder itself
        url = url[: -len("/sites")]
    if url and url not in WEBSITE_URLS:
        WEBSITE_URLS.append(url)


add_website_url(os.environ.get("MPS_WEBSITE_URL") or os.environ.get("MPS_SITES_URL"))
if os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"):
    add_website_url(f"https://{os.environ['VERCEL_PROJECT_PRODUCTION_URL']}")


def read_public_file(path, local=None):
    """The bytes of public/<path> (e.g. "sites/gale/terrain.json"): from `local` (default: public/<path>)
    when it is on disk, otherwise downloaded from the website. Raises OSError if neither works."""
    local = Path(local) if local else PUBLIC_DIR / path
    if local.exists():
        return local.read_bytes()
    problem = FileNotFoundError(f"{local} is not on disk and no website address is known to download it from")
    for base in WEBSITE_URLS:
        try:
            request = urllib.request.Request(f"{base}/{path}", headers={"User-Agent": "martial-backend"})
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.read()
        except OSError as e:  # unreachable or not found: try the next address
            problem = OSError(f"Could not download {path} from {base}: {e}")
    raise problem
