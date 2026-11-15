from abc import ABC, abstractmethod
from dataclasses import dataclass

from backend.martial.request import RequestReader
from backend.terrain.grid import TerrainGrid


@dataclass
class SiteRequest:
    """One request about one landing site, as every skill sees it."""

    site_id: str
    site: dict  # {name, mission}
    grid: TerrainGrid
    reader: RequestReader
    message: str
    client_routes: list  # routes on the user's map: [{id, name, kind, cells}]


class Skill(ABC):
    """One thing Martial can do. Each skill has its own instructions for the model."""

    name: str
    instructions: str

    def __init__(self, llm):
        self.llm = llm

    @abstractmethod
    def run(self, request: SiteRequest) -> dict:
        """The answer for the website: {skill, source, reply, highlight?, route?}.
        Raises AgentError when the request can't be carried out."""
