"""
Export each prepared landing site into small static files the Map page loads.

Reads the processed HiRISE layers made by the old project's prepare_sites.py
(<data>/sites/<id>/layers.tif, meta.json, paths.json) and writes, per site:

  public/sites/<id>/terrain.json   grid size, cell size, elevation range, stations, reference path
  public/sites/<id>/height.bin     float32 elevation (m), row-major, north row first
  public/sites/<id>/slope.bin      uint8 slope (deg), 255 = no data
  public/sites/<id>/texture.jpg    shaded-relief texture for the 3D terrain
  public/sites/<id>/sky.bin        uint8 sky-view factor (radiation shielding by terrain), 255 = no data

Run (from this repo, in the `mars` conda env):
  python scripts/export_sites.py ../space-apps/data [site ids...]
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import CRS, Transformer

OUT = Path(__file__).resolve().parent.parent / "public" / "sites"

# Stations for the recommended route at each site.
#   "landmarks": names from meta.json, in visiting order (first one is the landing point)
#   "drive_stops_m": extra stops taken along the real rover drive, at these distances (m) from its start
SITES = {
    "jezero":    {"landmarks": ["Octavia E. Butler Landing"], "drive_stops_m": [1200, 2600, 3800]},
    "gale":      {"landmarks": ["Bradbury Landing"], "drive_stops_m": [900, 2000, 3200]},
    "gusev":     {"landmarks": ["Spirit landing site", "Columbia Hills high point"], "drive_stops_m": []},
    "meridiani": {"landmarks": ["Eagle crater", "Endurance crater", "Victoria crater (north rim)"], "drive_stops_m": []},
    "ares":      {"landmarks": ["Carl Sagan Memorial Station", "Twin Peaks"], "drive_stops_m": []},
    "elysium":   {"landmarks": ["InSight lander", "Nearby high ground"], "drive_stops_m": []},
    "utopia":    {"landmarks": ["Zhurong landing site", "Nearby high ground"], "drive_stops_m": []},
}


class Raster:
    """Array helpers for the export."""

    @staticmethod
    def block_reduce(a, f, fn):
        r, c = (a.shape[0] // f) * f, (a.shape[1] // f) * f
        return fn(a[:r, :c].reshape(r // f, f, c // f, f), axis=(1, 3))

    @staticmethod
    def hillshade(elev, xres, yres, az=315, alt=40):
        dy, dx = np.gradient(elev, yres, xres)
        slope = np.arctan(np.hypot(dx, dy))
        aspect = np.arctan2(-dx, dy)
        az, alt = np.radians(az), np.radians(alt)
        return np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)


class SkyView:
    """How much of the sky each cell sees, the main thing that changes the radiation dose within a site.

    Galactic cosmic rays reach the surface from the whole sky; terrain that rises above the horizon
    (crater walls, hills, valley sides) blocks part of it. The sky-view factor is the usual
    cosine-weighted open-sky fraction: 1 - mean over directions of sin²(horizon angle).
    1 = open plain, lower = more shielded.
    """

    DIRECTIONS = 16
    # Distances (in cells) at which each direction is checked, denser close by.
    STEPS = (1, 2, 3, 4, 6, 8, 11, 16, 22, 32, 45, 64, 90, 128, 180)
    MAX_DISTANCE_M = 2500

    def __init__(self, height, nodata, cell_x_m, cell_y_m):
        self.height = np.where(nodata, np.nan, height).astype("f8")
        self.cw, self.ch = cell_x_m, cell_y_m

    def compute(self):
        """Sky-view factor per cell, 0..1 (NaN where there is no data)."""
        h = self.height
        rows, cols = h.shape
        sin2_sum = np.zeros_like(h)
        for k in range(self.DIRECTIONS):
            a = 2 * np.pi * k / self.DIRECTIONS
            dr, dc = -np.cos(a), np.sin(a)  # north = up (row - 1)
            best = np.zeros_like(h)  # tangent of the horizon angle (0 = flat horizon)
            for step in self.STEPS:
                sr, sc = int(round(dr * step)), int(round(dc * step))
                dist = np.hypot(sr * self.ch, sc * self.cw)
                if dist == 0 or dist > self.MAX_DISTANCE_M:
                    continue
                other = self._shifted(h, sr, sc)
                with np.errstate(invalid="ignore"):
                    tan = (other - h) / dist
                best = np.fmax(best, np.nan_to_num(tan, nan=0.0))
            sin2_sum += best**2 / (1 + best**2)  # sin²(atan(t)) = t² / (1 + t²)
        svf = 1 - sin2_sum / self.DIRECTIONS
        svf[np.isnan(h)] = np.nan
        return svf

    @staticmethod
    def _shifted(a, sr, sc):
        """a moved so out[r, c] = a[r + sr, c + sc], NaN outside the grid (unknown ground blocks nothing)."""
        out = np.full_like(a, np.nan)
        rows, cols = a.shape
        r0, r1 = max(0, -sr), min(rows, rows - sr)
        c0, c1 = max(0, -sc), min(cols, cols - sc)
        if r0 < r1 and c0 < c1:
            out[r0:r1, c0:c1] = a[r0 + sr : r1 + sr, c0 + sc : c1 + sc]
        return out


class SiteExporter:
    """Exports one prepared site: the routing grids, the texture, the stations and the reference drive."""

    GRID_MAX = 400       # longest side of the routing/height grid, in cells
    TEXTURE_MAX = 1600   # longest side of the texture, in pixels
    LOW_COLOR = np.array([120, 62, 38])    # Mars dust, dark lowlands → bright highs
    HIGH_COLOR = np.array([214, 150, 102])

    def __init__(self, site_id, data_dir, out_dir=OUT):
        self.site_id = site_id
        self.config = SITES[site_id]
        self.src_dir = Path(data_dir) / "sites" / site_id
        self.out = Path(out_dir) / site_id

    def export(self):
        self._read()
        self._make_grids()
        texture_size = self._write_texture()
        stations = self._landmark_stations()
        reference = self._reference_drive(stations)
        stations = self._place_stations(stations)
        self._write_terrain(stations, reference)
        print(f"{self.site_id}: grid {self.rows}x{self.cols} @ {self.gx * self.f:.1f} m, {len(stations)} stations, "
              f"texture {texture_size[0]}x{texture_size[1]}, reference={'yes' if reference else 'no'}")

    # ---- reading ------------------------------------------------------------------------------
    def _read(self):
        self.meta = json.loads((self.src_dir / "meta.json").read_text())
        with rasterio.open(self.src_dir / "layers.tif") as src:
            self.elev = src.read(1, masked=True).filled(np.nan).astype("float32")
            self.slope = src.read(2, masked=True).filled(np.nan).astype("float32")
            self.transform = src.transform
            crs = CRS.from_wkt(src.crs.to_wkt())
        self.to_m = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
        self.gx, self.gy = self.meta["ground_res_m"]  # ground meters per native pixel (x, y)

    # ---- grids --------------------------------------------------------------------------------
    def _make_grids(self):
        self.f = int(np.ceil(max(self.elev.shape) / self.GRID_MAX))
        with np.errstate(all="ignore"):
            h = Raster.block_reduce(self.elev, self.f, np.nanmean)
            s = Raster.block_reduce(self.slope, self.f, np.nanmean)
        self.rows, self.cols = h.shape
        self.lo = float(np.nanmin(h))
        self.hi = float(np.nanmax(h))
        self.nodata = np.isnan(h) | np.isnan(s)
        self.height = np.where(np.isnan(h), self.lo, h).astype("<f4")
        self.slope8 = np.where(self.nodata, 255, np.clip(np.round(s), 0, 90)).astype("u1")

    # ---- texture ------------------------------------------------------------------------------
    def _write_texture(self):
        elev = self.elev
        t = int(np.ceil(max(elev.shape) / self.TEXTURE_MAX))
        filled = np.where(np.isnan(elev), np.nanmean(elev), elev)
        shade = Raster.hillshade(filled, self.gx, self.gy)
        with np.errstate(all="ignore"):
            shade = Raster.block_reduce(shade, t, np.mean)
            e = Raster.block_reduce(filled, t, np.mean)
            miss = Raster.block_reduce(np.isnan(elev).astype("f4"), t, np.mean) > 0.5
        en = np.clip((e - self.lo) / max(self.hi - self.lo, 1e-6), 0, 1)[..., None]
        base = self.LOW_COLOR + (self.HIGH_COLOR - self.LOW_COLOR) * en
        rgb = base * (0.35 + 0.85 * shade[..., None])
        rgb[miss] = [30, 30, 30]
        self.out.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.clip(rgb, 0, 255).astype("u1")).save(self.out / "texture.jpg", quality=88)
        return rgb.shape[1], rgb.shape[0]

    # ---- coordinates: lat/lon → grid (row, col) as floats ---------------------------------------
    def to_grid(self, lat, lon):
        x, y = self.to_m.transform(lon, lat)
        col = (x - self.transform.c) / self.transform.a / self.f
        row = (y - self.transform.f) / self.transform.e / self.f
        return [round(float(row), 2), round(float(col), 2)]

    def inside(self, rc):
        return 0 <= rc[0] < self.rows and 0 <= rc[1] < self.cols

    # ---- stations -----------------------------------------------------------------------------
    def _landmark_stations(self):
        landmarks = {lm["name"]: lm for lm in self.meta["landmarks"]}
        stations = []
        for name in self.config["landmarks"]:
            lm = landmarks[name]
            stations.append({"name": name, "lat": lm["lat"], "lon": lm["lon"], "rc": self.to_grid(lm["lat"], lm["lon"])})
        return stations

    def _reference_drive(self, stations):
        """The real rover drive clipped to the site, as a reference path. Adds the configured
        science stops along it to `stations`."""
        paths = json.loads((self.src_dir / "paths.json").read_text())["paths"]
        drive = next((p for p in paths if p["kind"] == "traverse"), None)
        if not drive:
            return None
        f = self.f
        coords = drive["path"]["geometry"]["coordinates"]
        grid = [self.to_grid(lat, lon) for lon, lat in coords]
        keep = [(c, g) for c, g in zip(coords, grid) if self.inside(g)]
        pts = np.array([g for _, g in keep])
        step = np.hypot(np.diff(pts[:, 0]) * self.gy * f, np.diff(pts[:, 1]) * self.gx * f)
        dist = np.concatenate([[0], np.cumsum(step)])
        for i, d in enumerate(self.config["drive_stops_m"]):
            k = int(np.searchsorted(dist, d))
            if k < len(keep):
                (lon, lat), g = keep[k]
                stations.append({"name": f"Science stop {i + 1} (on {drive['name'].split(' (')[0]})",
                                 "lat": lat, "lon": lon, "rc": g})
        thin = pts[:: max(1, len(pts) // 1500)]  # keep the file small
        return {"name": drive["name"], "rc": thin.round(2).tolist()}

    def _place_stations(self, stations):
        """A landmark outside the terrain data (e.g. Bradbury Landing sits just off Gale's DTM strip)
        moves to the nearest cell that has gentle ground, and says how far it moved."""
        f = self.f
        valid = np.argwhere(~self.nodata & (self.slope8 <= 15))
        for st in stations:
            r, c = st["rc"]
            ri, ci = int(round(r)), int(round(c))
            if 0 <= ri < self.rows and 0 <= ci < self.cols and not self.nodata[ri, ci]:
                continue
            d = np.hypot((valid[:, 0] - r) * self.gy * f, (valid[:, 1] - c) * self.gx * f)
            k = int(np.argmin(d))
            st["rc"] = [float(valid[k, 0]), float(valid[k, 1])]
            st["moved_m"] = round(float(d[k]))
            st["name"] = f"{st['name']} area"
        return [st for st in stations if self.inside(st["rc"])]

    # ---- writing ------------------------------------------------------------------------------
    def _write_terrain(self, stations, reference):
        terrain = {
            "id": self.site_id,
            "rows": self.rows,
            "cols": self.cols,
            "cell_m": [round(self.gx * self.f, 3), round(self.gy * self.f, 3)],  # [east-west, north-south] m per cell
            "elevation": [round(self.lo, 2), round(self.hi, 2)],
            "bounds": self.meta["bounds"],
            "stations": stations,
            "reference": reference,
        }
        (self.out / "terrain.json").write_text(json.dumps(terrain))
        self.height.tofile(self.out / "height.bin")
        self.slope8.tofile(self.out / "slope.bin")
        self._write_sky()

    def _write_sky(self):
        """sky.bin: uint8 sky-view factor (0..254 = 0..1 of the sky open; 255 = no data)."""
        svf = SkyView(self.height, self.nodata, self.gx * self.f, self.gy * self.f).compute()
        sky = np.where(np.isnan(svf), 255, np.clip(np.round(svf * 254), 0, 254)).astype("u1")
        sky.tofile(self.out / "sky.bin")
        valid = svf[~np.isnan(svf)]
        print(f"  sky view: mean {valid.mean():.3f}, most shielded {valid.min():.3f}")


if __name__ == "__main__":
    data = Path(sys.argv[1] if len(sys.argv) > 1 else "../space-apps/data").resolve()
    wanted = set(sys.argv[2:])  # optional site ids: export only these
    for sid in SITES:
        if not wanted or sid in wanted:
            SiteExporter(sid, data).export()
