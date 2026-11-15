"""The landing sites the agent knows (the same sites as src/data/sites.js)."""

import threading

from .grid import TerrainGrid


class SiteCatalog:
    INFO = {
        "jezero": {"name": "Jezero Crater", "mission": "Perseverance landed 2021"},
        "gale": {"name": "Gale Crater", "mission": "Curiosity landed 2012"},
        "gusev": {"name": "Gusev Crater", "mission": "Spirit landed 2004"},
        "meridiani": {"name": "Meridiani Planum", "mission": "Opportunity landed 2004"},
        "ares": {"name": "Ares Vallis", "mission": "Mars Pathfinder and Sojourner landed 1997"},
        "elysium": {"name": "Elysium Planitia", "mission": "InSight landed 2018"},
        "utopia": {"name": "Utopia Planitia", "mission": "Zhurong landed 2021"},
    }

    def __init__(self):
        self._grids = {}
        self._lock = threading.Lock()  # the server answers requests on several threads

    @property
    def ids(self):
        return tuple(self.INFO)

    def info(self, site_id):
        """{name, mission} of a site."""
        self._check(site_id)
        return self.INFO[site_id]

    def grid(self, site_id):
        """The site's terrain, read from disk once and then kept."""
        self._check(site_id)
        with self._lock:
            if site_id not in self._grids:
                self._grids[site_id] = TerrainGrid(site_id)
            return self._grids[site_id]

    def _check(self, site_id):
        if site_id not in self.INFO:
            raise ValueError(f"Unknown landing site '{site_id}'. Choose one of: {', '.join(self.ids)}.")


site_catalog = SiteCatalog()
