"""
Export each prepared landing site into small static files the Map page loads.

Reads the processed HiRISE layers made by the old project's prepare_sites.py
(<data>/sites/<id>/layers.tif, meta.json, paths.json) and writes, per site:

  public/sites/<id>/terrain.json   grid size, cell size, elevation range, stations, reference path
  public/sites/<id>/height.bin     float32 elevation (m), row-major, north row first
  public/sites/<id>/slope.bin      uint8 slope (deg), 255 = no data
  public/sites/<id>/texture.jpg    shaded-relief texture for the 3D terrain

Run (from this repo, in the `mars` conda env):
  python scripts/export_sites.py ../space-apps/data
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import CRS, Transformer

GRID_MAX = 400          # longest side of the routing/height grid, in cells
TEXTURE_MAX = 1600      # longest side of the texture, in pixels
OUT = Path(__file__).resolve().parent.parent / "public" / "sites"

# Stations for the recommended route at each site.
#   "landmarks": names from meta.json, in visiting order (first one is the landing point)
#   "drive_stops_m": extra stops taken along the real rover drive, at these distances (m) from its start
SITES = {
    "jezero":    {"landmarks": ["Octavia E. Butler Landing"], "drive_stops_m": [1200, 2600, 3800]},
    "gale":      {"landmarks": ["Bradbury Landing"], "drive_stops_m": [900, 2000, 3200]},
    "gusev":     {"landmarks": ["Spirit landing site", "Columbia Hills high point"], "drive_stops_m": []},
    "meridiani": {"landmarks": ["Eagle crater", "Endurance crater", "Victoria crater (north rim)"], "drive_stops_m": []},
}


def block_reduce(a, f, fn):
    r, c = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return fn(a[:r, :c].reshape(r // f, f, c // f, f), axis=(1, 3))


def hillshade(elev, xres, yres, az=315, alt=40):
    dy, dx = np.gradient(elev, yres, xres)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = np.radians(az), np.radians(alt)
    return np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)


def export(site_id, data_dir):
    src_dir = data_dir / "sites" / site_id
    meta = json.loads((src_dir / "meta.json").read_text())
    with rasterio.open(src_dir / "layers.tif") as src:
        elev = src.read(1, masked=True).filled(np.nan).astype("float32")
        slope = src.read(2, masked=True).filled(np.nan).astype("float32")
        transform = src.transform
        crs = CRS.from_wkt(src.crs.to_wkt())
    to_m = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
    gx, gy = meta["ground_res_m"]                              # ground meters per native pixel (x, y)

    # --- grids -------------------------------------------------------------
    f = int(np.ceil(max(elev.shape) / GRID_MAX))
    with np.errstate(all="ignore"):
        h = block_reduce(elev, f, np.nanmean)
        s = block_reduce(slope, f, np.nanmean)
    rows, cols = h.shape
    lo = float(np.nanmin(h))
    hi = float(np.nanmax(h))
    nodata = np.isnan(h) | np.isnan(s)
    h = np.where(np.isnan(h), lo, h).astype("<f4")
    s8 = np.where(nodata, 255, np.clip(np.round(s), 0, 90)).astype("u1")

    # --- texture -----------------------------------------------------------
    t = int(np.ceil(max(elev.shape) / TEXTURE_MAX))
    filled = np.where(np.isnan(elev), np.nanmean(elev), elev)
    shade = hillshade(filled, gx, gy)
    with np.errstate(all="ignore"):
        shade = block_reduce(shade, t, np.mean)
        e = block_reduce(filled, t, np.mean)
        miss = block_reduce(np.isnan(elev).astype("f4"), t, np.mean) > 0.5
    en = np.clip((e - lo) / max(hi - lo, 1e-6), 0, 1)[..., None]
    low, high = np.array([120, 62, 38]), np.array([214, 150, 102])   # Mars dust, dark lowlands → bright highs
    base = low + (high - low) * en
    rgb = base * (0.35 + 0.85 * shade[..., None])
    rgb[miss] = [30, 30, 30]
    out = OUT / site_id
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(rgb, 0, 255).astype("u1")).save(out / "texture.jpg", quality=88)

    # --- coordinates: lat/lon → grid (row, col) as floats ----------------
    def to_grid(lat, lon):
        x, y = to_m.transform(lon, lat)
        col = (x - transform.c) / transform.a / f
        row = (y - transform.f) / transform.e / f
        return [round(float(row), 2), round(float(col), 2)]

    def inside(rc):
        return 0 <= rc[0] < rows and 0 <= rc[1] < cols

    landmarks = {lm["name"]: lm for lm in meta["landmarks"]}
    cfg = SITES[site_id]
    stations = []
    for name in cfg["landmarks"]:
        lm = landmarks[name]
        stations.append({"name": name, "lat": lm["lat"], "lon": lm["lon"], "rc": to_grid(lm["lat"], lm["lon"])})

    # Real rover drive, clipped to the site, as a reference path
    reference = None
    paths = json.loads((src_dir / "paths.json").read_text())["paths"]
    drive = next((p for p in paths if p["kind"] == "traverse"), None)
    if drive:
        coords = drive["path"]["geometry"]["coordinates"]
        grid = [to_grid(lat, lon) for lon, lat in coords]
        keep = [(c, g) for c, g in zip(coords, grid) if inside(g)]
        pts = np.array([g for _, g in keep])
        step = np.hypot(np.diff(pts[:, 0]) * gy * f, np.diff(pts[:, 1]) * gx * f)
        dist = np.concatenate([[0], np.cumsum(step)])
        for i, d in enumerate(cfg["drive_stops_m"]):
            k = int(np.searchsorted(dist, d))
            if k < len(keep):
                (lon, lat), g = keep[k]
                stations.append({"name": f"Science stop {i + 1} (on {drive['name'].split(' (')[0]})",
                                 "lat": lat, "lon": lon, "rc": g})
        thin = pts[:: max(1, len(pts) // 1500)]                # keep the file small
        reference = {"name": drive["name"], "rc": thin.round(2).tolist()}

    # A landmark outside the terrain data (e.g. Bradbury Landing sits just off Gale's DTM strip)
    # moves to the nearest cell that has gentle ground, and says how far it moved.
    valid = np.argwhere(~nodata & (s8 <= 15))
    for st in stations:
        r, c = st["rc"]
        ri, ci = int(round(r)), int(round(c))
        if 0 <= ri < rows and 0 <= ci < cols and not nodata[ri, ci]:
            continue
        d = np.hypot((valid[:, 0] - r) * gy * f, (valid[:, 1] - c) * gx * f)
        k = int(np.argmin(d))
        st["rc"] = [float(valid[k, 0]), float(valid[k, 1])]
        st["moved_m"] = round(float(d[k]))
        st["name"] = f"{st['name']} area"

    stations = [st for st in stations if inside(st["rc"])]

    terrain = {
        "id": site_id,
        "rows": rows,
        "cols": cols,
        "cell_m": [round(gx * f, 3), round(gy * f, 3)],      # [east-west, north-south] meters per cell
        "elevation": [round(lo, 2), round(hi, 2)],
        "bounds": meta["bounds"],
        "stations": stations,
        "reference": reference,
    }
    (out / "terrain.json").write_text(json.dumps(terrain))
    h.tofile(out / "height.bin")
    s8.tofile(out / "slope.bin")
    print(f"{site_id}: grid {rows}x{cols} @ {gx * f:.1f} m, {len(stations)} stations, "
          f"texture {rgb.shape[1]}x{rgb.shape[0]}, reference={'yes' if reference else 'no'}")


if __name__ == "__main__":
    data = Path(sys.argv[1] if len(sys.argv) > 1 else "../space-apps/data").resolve()
    for sid in SITES:
        export(sid, data)
