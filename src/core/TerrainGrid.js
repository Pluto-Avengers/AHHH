// One landing site's terrain and the least-cost routing over it (runs in the browser).
//
// Cost of walking one meter = slope factor × radiation factor:
//   slope factor     = 1 + SLOPE_WEIGHT * (slope / MAX_SLOPE)^2, so gentle ground is strongly preferred
//                      and anything steeper than MAX_SLOPE (or without data) is impassable;
//   radiation factor = 1 - RADIATION_WEIGHT * (1 - sky view), so ground where hills and walls block
//                      part of the sky (and so part of the cosmic radiation) is preferred.
// A* finds the cheapest 8-connected path.
// backend/terrain/grid.py runs the same routing for the Martial agent.
import MinHeap from './MinHeap.js'

export const MAX_SLOPE = 25 // degrees: steeper is unsafe for a suited astronaut
export const HAZARD_SLOPE = 15 // degrees: ground worth a warning
export const NO_DATA = 255
const SLOPE_WEIGHT = 6
const RADIATION_WEIGHT = 1
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]

/**
 * Surface radiation dose rate under open sky: 0.21 mGy a day, measured by Curiosity's RAD instrument
 * at Gale crater (Hassler et al., Science 2014). In µGy per second.
 */
export const OPEN_SKY_DOSE_UGY_S = 210 / 86400

const slopeFactor = Array.from({ length: 256 }, (_, s) => 1 + SLOPE_WEIGHT * (s / MAX_SLOPE) ** 2)
const skyFraction = (v) => (v === NO_DATA ? 1 : v / 254)
const radiationFactor = Array.from({ length: 256 }, (_, v) => Math.max(0.05, 1 - RADIATION_WEIGHT * (1 - skyFraction(v))))

/**
 * A site's exported terrain (see scripts/export_sites.py): elevation (m), slope (deg) and sky view
 * per cell, row 0 = north. Every field of terrain.json (rows, cols, stations, reference, bounds, …)
 * is kept on the instance.
 */
export default class TerrainGrid {
  /**
   * @param {object} terrain    terrain.json
   * @param {Float32Array} height elevation per cell (m)
   * @param {Uint8Array} slope    slope per cell (deg), NO_DATA where unknown
   * @param {Uint8Array} [sky]    open-sky fraction per cell × 254, NO_DATA where unknown (all open if missing)
   */
  constructor(terrain, height, slope, sky = new Uint8Array(slope.length).fill(254)) {
    Object.assign(this, terrain)
    ;[this.cw, this.ch] = terrain.cell_m
    this.height = height
    this.slope = slope
    this.sky = sky
    this.blocked = null // Uint8Array, 1 = closed to routes (a dust storm); null = nothing closed
    this.blockedReason = null
    this.leastFactor = TerrainGrid.#cheapestFactor(this)
  }

  /** The cheapest a meter can be anywhere on the site: keeps the A* estimate from overshooting. */
  static #cheapestFactor(grid) {
    let least = 1
    for (let i = 0; i < grid.slope.length; i++) if (grid.passable(i)) least = Math.min(least, radiationFactor[grid.sky[i]])
    return least
  }

  /**
   * A copy of this grid (sharing its terrain data) where the cells set in `mask` are closed to
   * routes, e.g. a dust storm. `reason` names the area in error messages.
   */
  withBlocked(mask, reason) {
    const copy = Object.assign(Object.create(TerrainGrid.prototype), this)
    copy.blocked = mask
    copy.blockedReason = reason
    copy.leastFactor = TerrainGrid.#cheapestFactor(copy)
    return copy
  }

  /** Is grid point (r, c) inside a closed area? */
  isBlocked(r, c) {
    const rr = Math.round(r)
    const cc = Math.round(c)
    return Boolean(this.blocked) && this.inBounds(rr, cc) && this.blocked[this.index(rr, cc)] === 1
  }

  /** Suited walking speed (m/s) from grade: Tobler-style, slowed for EVA suits. A planning assumption. */
  static walkSpeedMs(grade) {
    return (3.6 * Math.exp(-3.5 * Math.abs(grade + 0.05))) / 3.6
  }

  // ---- cells ----------------------------------------------------------------------------------
  index(r, c) {
    return r * this.cols + c
  }

  inBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols
  }

  hasData(i) {
    return this.slope[i] !== NO_DATA
  }

  passable(i) {
    return this.slope[i] !== NO_DATA && this.slope[i] <= MAX_SLOPE && !(this.blocked && this.blocked[i])
  }

  /** Fraction of the sky (0..1) open above cell i; lower means more radiation shielding. */
  skyView(i) {
    return skyFraction(this.sky[i])
  }

  /** Latitude and longitude of fractional grid point (r, c) (same as backend/terrain/grid.py). */
  latLonAt(r, c) {
    const [[south, west], [north, east]] = this.bounds
    return [north - (r / this.rows) * (north - south), west + (c / this.cols) * (east - west)]
  }

  /** Fractional grid point [row, col] of a latitude/longitude (may lie outside the grid). */
  gridAt(lat, lon) {
    const [[south, west], [north, east]] = this.bounds
    return [((north - lat) / (north - south)) * this.rows, ((lon - west) / (east - west)) * this.cols]
  }

  /** Is a latitude/longitude inside this site's mapped area? */
  contains(lat, lon) {
    const [[south, west], [north, east]] = this.bounds
    return lat >= south && lat <= north && lon >= west && lon <= east
  }

  /** Nearest passable cell to (r, c) within `radius` cells, or null. */
  snap(r, c, radius = 8) {
    r = Math.round(r)
    c = Math.round(c)
    let best = null
    let bestD = Infinity
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const nr = r + dr
        const nc = c + dc
        if (!this.inBounds(nr, nc) || !this.passable(this.index(nr, nc))) continue
        const d = dr * dr + dc * dc
        if (d < bestD) {
          bestD = d
          best = this.index(nr, nc)
        }
      }
    }
    return best
  }

  /** Turns a list of [row, col] floats (e.g. a rover drive) into a list of cells. */
  cellsFromPolyline(rcs) {
    const cells = []
    for (const [r, c] of rcs) {
      const rr = Math.round(r)
      const cc = Math.round(c)
      if (!this.inBounds(rr, cc)) continue
      const i = this.index(rr, cc)
      if (cells[cells.length - 1] !== i) cells.push(i)
    }
    return cells
  }

  // ---- routing --------------------------------------------------------------------------------
  /** A* between two cell indices. Returns an array of cell indices, or null. */
  findPath(start, goal) {
    const { rows, cols, cw, ch, slope, sky } = this
    const n = rows * cols
    const g = new Float64Array(n).fill(Infinity)
    const from = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const steps = DIRS.map(([dr, dc]) => Math.hypot(dr * ch, dc * cw))
    const gr = Math.floor(goal / cols)
    const gc = goal % cols
    const least = this.leastFactor
    const h = (r, c) => Math.hypot((r - gr) * ch, (c - gc) * cw) * least

    const heap = new MinHeap()
    g[start] = 0
    heap.push(start, h(Math.floor(start / cols), start % cols))

    while (heap.size) {
      const i = heap.pop()
      if (i === goal) break
      if (closed[i]) continue
      closed[i] = 1
      const r = Math.floor(i / cols)
      const c = i % cols
      const mi = slopeFactor[slope[i]]
      const ri = radiationFactor[sky[i]]
      for (let k = 0; k < 8; k++) {
        const nr = r + DIRS[k][0]
        const nc = c + DIRS[k][1]
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        const j = nr * cols + nc
        if (closed[j] || !this.passable(j)) continue
        const cost = g[i] + ((steps[k] * (mi + slopeFactor[slope[j]])) / 2) * (ri + radiationFactor[sky[j]]) / 2
        if (cost < g[j]) {
          g[j] = cost
          from[j] = i
          heap.push(j, cost + h(nr, nc))
        }
      }
    }

    if (!Number.isFinite(g[goal])) return null
    const path = []
    for (let i = goal; i !== -1; i = from[i]) path.push(i)
    return path.reverse()
  }

  /**
   * Route through waypoints given as [row, col] (floats ok), in order.
   * Returns { cells, stopCells } or { error }.
   */
  planRoute(waypoints) {
    // A point inside a closed area (a dust storm) is refused, never quietly moved out of it.
    const inside = waypoints.findIndex(([r, c]) => this.isBlocked(r, c))
    if (inside !== -1) return { error: `Point ${inside + 1} is inside the ${this.blockedReason}, which routes must avoid.` }
    const snapped = waypoints.map(([r, c]) => this.snap(r, c))
    const bad = snapped.indexOf(null)
    if (bad !== -1) return { error: `Point ${bad + 1} is on terrain that is too steep or has no data.` }

    const cells = [snapped[0]]
    for (let k = 1; k < snapped.length; k++) {
      if (snapped[k] === snapped[k - 1]) continue
      const leg = this.findPath(snapped[k - 1], snapped[k])
      if (!leg) return { error: `No safe path between points ${k} and ${k + 1}.` }
      cells.push(...leg.slice(1))
    }
    return { cells, stopCells: snapped }
  }

  // ---- measurements ---------------------------------------------------------------------------
  /**
   * Distance, climb, slope, time, radiation and an elevation profile for a route.
   * doseUGy: estimated cosmic-radiation dose for walking it (µGy) = time at each step × the open-sky
   * dose rate × the fraction of sky open there.
   */
  routeStats(cells) {
    const { cols, cw, ch, height, slope } = this
    let distance = 0
    let gain = 0
    let loss = 0
    let seconds = 0
    let dose = 0
    let maxSlope = 0
    let slopeSum = 0
    let steepCount = 0
    let skySum = 0
    const profile = [{ d: 0, e: height[cells[0]] }]

    for (let k = 0; k < cells.length; k++) {
      const s = slope[cells[k]] === NO_DATA ? 0 : slope[cells[k]]
      maxSlope = Math.max(maxSlope, s)
      slopeSum += s
      skySum += this.skyView(cells[k])
      if (s > HAZARD_SLOPE) steepCount++
      if (k === 0) continue
      const a = cells[k - 1]
      const b = cells[k]
      const flat = Math.hypot((Math.floor(b / cols) - Math.floor(a / cols)) * ch, ((b % cols) - (a % cols)) * cw)
      const dz = height[b] - height[a]
      const step = Math.hypot(flat, dz)
      const time = step / TerrainGrid.walkSpeedMs(dz / flat)
      distance += step
      if (dz > 0) gain += dz
      else loss -= dz
      seconds += time
      dose += time * OPEN_SKY_DOSE_UGY_S * this.skyView(b)
      profile.push({ d: distance, e: height[b] })
    }

    return {
      distanceM: distance,
      gainM: gain,
      lossM: loss,
      walkMinutes: seconds / 60,
      doseUGy: dose,
      meanSkyView: skySum / cells.length,
      maxSlope,
      meanSlope: slopeSum / cells.length,
      steepShare: steepCount / cells.length,
      profile,
    }
  }

  /** Canvas (one pixel per cell) tinting steep ground: amber over 15°, red over the 25° limit. */
  hazardCanvas() {
    const { rows, cols, slope } = this
    const canvas = document.createElement('canvas')
    canvas.width = cols
    canvas.height = rows
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(cols, rows)
    for (let i = 0; i < rows * cols; i++) {
      const s = slope[i]
      if (s === NO_DATA || s <= HAZARD_SLOPE) continue
      img.data.set(s > MAX_SLOPE ? [255, 60, 40, 170] : [255, 190, 60, 110], i * 4)
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }
}
