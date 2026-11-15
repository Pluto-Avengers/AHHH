import TerrainGrid from '../core/TerrainGrid.js'

/**
 * A walkable path along a route for the VR EVA: smoothed grid points, the distance walked (m)
 * to each, and the distance at which each stop is reached.
 */
export default class WalkPath {
  /**
   * @param {TerrainGrid} grid
   * @param {import('./VRSurface.js').default} surface
   * @param {{ cells: number[], stopCells?: number[] }} route
   */
  constructor(grid, surface, route) {
    this.grid = grid
    this.surface = surface

    // Grid points smoothed over a 5-cell window so the walk doesn't zigzag
    const raw = route.cells.map((i) => [Math.floor(i / grid.cols), i % grid.cols])
    this.pts = raw.map((_, k) => {
      let r = 0
      let c = 0
      let n = 0
      for (let j = Math.max(0, k - 2); j <= Math.min(raw.length - 1, k + 2); j++) {
        r += raw[j][0]
        c += raw[j][1]
        n++
      }
      return [r / n, c / n]
    })

    this.dist = [0]
    for (let k = 1; k < this.pts.length; k++) {
      const a = surface.toWorld(...this.pts[k - 1])
      const b = surface.toWorld(...this.pts[k])
      this.dist.push(this.dist[k - 1] + a.distanceTo(b))
    }

    // Each stop: the first time the route passes its cell (searching forward from the previous stop).
    this.stopDist = []
    let from = 0
    for (const cell of route.stopCells ?? []) {
      const k = route.cells.indexOf(cell, from)
      if (k === -1) continue
      this.stopDist.push(this.dist[k])
      from = k
    }

    this.length = this.dist[this.dist.length - 1]
  }

  /** Grid position, heading (radians, 0 = north) and local grade at distance s. */
  at(s) {
    const { pts, dist, grid, surface } = this
    s = Math.min(Math.max(s, 0), this.length)
    let lo = 0
    let hi = dist.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (dist[mid] <= s) lo = mid
      else hi = mid
    }
    const span = dist[hi] - dist[lo] || 1
    const t = (s - dist[lo]) / span
    const r = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t
    const c = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t
    const dx = (pts[hi][1] - pts[lo][1]) * grid.cw
    const dz = (pts[hi][0] - pts[lo][0]) * grid.ch
    const flat = Math.hypot(dx, dz) || 1
    const grade = (surface.heightAt(...pts[hi]) - surface.heightAt(...pts[lo])) / flat
    return { r, c, heading: Math.atan2(dx, -dz), grade }
  }

  /** Suited walking speed (m/s) at distance s. */
  speedAt(s) {
    return TerrainGrid.walkSpeedMs(this.at(s).grade)
  }
}
