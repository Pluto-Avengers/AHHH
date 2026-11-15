// Dust storms: areas a route must not enter (public/storms.json, made by scripts/make_storms.py).
// They are simulated planning scenarios, not observed weather. A cell is inside when its centre
// (row, col) is inside the outline: the same test as backend/terrain/storms.py, so the website and
// Martial plan the same routes around a storm.

export default class DustStorm {
  static #all = null
  #masks = new WeakMap() // grid -> mask

  /** @param {{ name: string, polygon: number[][] }} data outline as [lat, lon] points */
  constructor(siteId, { name, polygon }) {
    this.siteId = siteId
    this.name = name
    this.polygon = polygon
  }

  /** Resolves to { [siteId]: DustStorm } (empty if the file is missing). Downloaded once. */
  static loadAll(baseUrl = import.meta.env?.BASE_URL ?? '/') {
    DustStorm.#all ??= fetch(`${baseUrl}storms.json`)
      .then((r) => (r.ok ? r.json() : { storms: {} }))
      .then((data) => Object.fromEntries(Object.entries(data.storms ?? {}).map(([id, s]) => [id, new DustStorm(id, s)])))
      .catch(() => ({}))
    return DustStorm.#all
  }

  /** The outline in grid [row, col] coordinates. */
  outline(grid) {
    return this.polygon.map(([lat, lon]) => grid.gridAt(lat, lon))
  }

  /** Uint8Array over the grid, 1 for cells inside the storm. Computed once per grid. */
  mask(grid) {
    if (this.#masks.has(grid)) return this.#masks.get(grid)
    const pts = this.outline(grid)
    const out = new Uint8Array(grid.rows * grid.cols)
    const rLo = Math.max(0, Math.trunc(Math.min(...pts.map((p) => p[0]))))
    const rHi = Math.min(grid.rows - 1, Math.trunc(Math.max(...pts.map((p) => p[0]))) + 1)
    const cLo = Math.max(0, Math.trunc(Math.min(...pts.map((p) => p[1]))))
    const cHi = Math.min(grid.cols - 1, Math.trunc(Math.max(...pts.map((p) => p[1]))) + 1)
    const n = pts.length
    for (let r = rLo; r <= rHi; r++) {
      for (let c = cLo; c <= cHi; c++) {
        let inside = false
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const [yi, xi] = pts[i]
          const [yj, xj] = pts[j]
          if (yi > r !== yj > r && c < ((xj - xi) * (r - yi)) / (yj - yi) + xi) inside = !inside
        }
        if (inside) out[r * grid.cols + c] = 1
      }
    }
    this.#masks.set(grid, out)
    return out
  }

  /** Canvas (one pixel per cell) tinting the storm red, for the 3D and 2D maps. */
  overlayCanvas(grid) {
    const mask = this.mask(grid)
    const canvas = document.createElement('canvas')
    canvas.width = grid.cols
    canvas.height = grid.rows
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(grid.cols, grid.rows)
    for (let i = 0; i < mask.length; i++) if (mask[i]) img.data.set([225, 40, 30, 120], i * 4)
    ctx.putImageData(img, 0, 0)
    return canvas
  }
}
