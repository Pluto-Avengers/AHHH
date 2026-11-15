"""The landing sites the agent knows (the same sites as src/data/sites.js)."""

import threading

from .grid import TerrainGrid
from .storms import DustStorm


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
        self._grids = {}  # (site id, storm on?) -> grid
        self._storms = None  # site id -> DustStorm, read on first use (hosted, it is downloaded)
        self._lock = threading.Lock()  # the server answers requests on several threads

    @property
    def storms(self):
        """{site id: DustStorm} for the sites that have one."""
        if not self._storms:  # also tried again if the file couldn't be read yet
            self._storms = DustStorm.load_all()
        return self._storms

    @property
    def ids(self):
        return tuple(self.INFO)

    def info(self, site_id):
        """{name, mission} of a site."""
        self._check(site_id)
        return self.INFO[site_id]

    def grid(self, site_id, storm=False):
        """The site's terrain, read from disk once and then kept. With storm=True (and a storm at the
        site), the storm area is closed to routes."""
        self._check(site_id)
        with self._lock:
            if (site_id, False) not in self._grids:
                self._grids[(site_id, False)] = TerrainGrid(site_id)
            base = self._grids[(site_id, False)]
            dust = self.storms.get(site_id) if storm else None
            if not dust:
                return base
            if (site_id, True) not in self._grids:
                self._grids[(site_id, True)] = base.with_blocked(dust.mask(base), dust.name)
            return self._grids[(site_id, True)]

    def _check(self, site_id):
        if site_id not in self.INFO:
            raise ValueError(f"Unknown landing site '{site_id}'. Choose one of: {', '.join(self.ids)}.")


site_catalog = SiteCatalog()
