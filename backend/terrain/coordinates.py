"""How coordinates are written in every reply: 4 decimals with N/S and E/W (e.g. 18.4447° N, 77.4508° E)."""


class Coordinates:
    @staticmethod
    def lat(lat):
        return f"{abs(lat):.4f}° {'N' if lat >= 0 else 'S'}"

    @staticmethod
    def lon(lon):
        return f"{abs(lon):.4f}° {'E' if lon >= 0 else 'W'}"

    @classmethod
    def point(cls, lat, lon):
        return f"{cls.lat(lat)}, {cls.lon(lon)}"

    @classmethod
    def cell(cls, grid, i):
        """Coordinates of one grid cell."""
        return cls.point(*grid.cell_latlon(i))
