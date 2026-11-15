// True-scale ground for the VR page: 1 unit = 1 meter, y up, north = -z.
// Grid point (row, col) sits at x = (col - cx) * cw, z = (row - cz) * ch, y = elevation - lowest elevation.
import * as THREE from 'three'
import { NO_DATA } from '../core/TerrainGrid.js'

/** Height and coordinate helpers that match the terrain mesh exactly (same triangles). */
export default class VRSurface {
  #grid
  #lowest
  #cx
  #cz

  /** @param {import('../core/TerrainGrid.js').default} grid */
  constructor(grid) {
    this.#grid = grid
    this.#lowest = grid.elevation[0]
    this.#cx = (grid.cols - 1) / 2
    this.#cz = (grid.rows - 1) / 2
    /** [east-west, north-south] size of the site in meters */
    this.size = [grid.cols * grid.cw, grid.rows * grid.ch]
  }

  /** Ground height (m above the site's lowest point) at fractional grid coords. */
  heightAt(r, c) {
    const { rows, cols, height } = this.#grid
    r = Math.min(Math.max(r, 0), rows - 1.0001)
    c = Math.min(Math.max(c, 0), cols - 1.0001)
    const r0 = Math.floor(r)
    const c0 = Math.floor(c)
    const fr = r - r0
    const fc = c - c0
    const a = height[r0 * cols + c0]
    const b = height[r0 * cols + c0 + 1]
    const d = height[(r0 + 1) * cols + c0]
    const e = height[(r0 + 1) * cols + c0 + 1]
    // The mesh splits each quad along the b–d diagonal (see TerrainProjection.buildMesh).
    const h = fr + fc <= 1 ? a + (b - a) * fc + (d - a) * fr : e + (d - e) * (1 - fc) + (b - e) * (1 - fr)
    return h - this.#lowest
  }

  /** World position of grid point (r, c) on the ground, raised by `lift` meters. */
  toWorld(r, c, lift = 0) {
    const { cw, ch } = this.#grid
    return new THREE.Vector3((c - this.#cx) * cw, this.heightAt(r, c) + lift, (r - this.#cz) * ch)
  }

  /** Grid [row, col] under world (x, z). */
  toGrid(x, z) {
    const { cw, ch } = this.#grid
    return [z / ch + this.#cz, x / cw + this.#cx]
  }

  /** Elevation above the Mars datum (m). */
  elevationAt(r, c) {
    return this.heightAt(r, c) + this.#lowest
  }

  /** Slope (deg) of the nearest cell, or null where there is no data. */
  slopeAt(r, c) {
    const { rows, cols, slope } = this.#grid
    const s = slope[Math.round(Math.min(Math.max(r, 0), rows - 1)) * cols + Math.round(Math.min(Math.max(c, 0), cols - 1))]
    return s === NO_DATA ? null : s
  }

  hasData(r, c) {
    const grid = this.#grid
    const rr = Math.round(r)
    const cc = Math.round(c)
    return grid.inBounds(rr, cc) && grid.hasData(grid.index(rr, cc))
  }

  /**
   * Where a ray (in the terrain's own coordinates) first meets the ground, or null.
   * Marches along the ray over the height grid (half a cell per step) and refines the crossing,
   * instead of testing every triangle of the mesh: a few hundred height lookups rather than
   * ~300,000 triangles, which matters because hand pointers test the ground every frame in VR.
   */
  intersectRay(ray, near = 0, far = Infinity) {
    const grid = this.#grid
    const [sx, sz] = this.size
    const top = grid.elevation[1] - this.#lowest + 1
    // Clip the ray to the box around the terrain.
    let t0 = near
    let t1 = far
    const box = [
      [ray.origin.x, ray.direction.x, -sx / 2, sx / 2],
      [ray.origin.y, ray.direction.y, -1, top],
      [ray.origin.z, ray.direction.z, -sz / 2, sz / 2],
    ]
    for (const [o, d, lo, hi] of box) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return null
        continue
      }
      let a = (lo - o) / d
      let b = (hi - o) / d
      if (a > b) [a, b] = [b, a]
      t0 = Math.max(t0, a)
      t1 = Math.min(t1, b)
      if (t0 > t1) return null
    }

    // Fine steps near you (where you point at the ground at your feet), half a cell far away.
    const maxStep = Math.min(grid.cw, grid.ch) * 0.5
    const stepAt = (t) => Math.min(maxStep, Math.max(0.1, t * 0.03))
    const above = (t) => {
      const x = ray.origin.x + ray.direction.x * t
      const z = ray.origin.z + ray.direction.z * t
      const [r, c] = this.toGrid(x, z)
      if (!this.#onMesh(r, c)) return null // a hole in the data: the mesh has no ground there
      return ray.origin.y + ray.direction.y * t - this.heightAt(r, c)
    }
    let prevT = t0
    let prev = above(t0)
    if (prev !== null && prev <= 0) return null // starts under the ground
    for (let t = t0 + stepAt(t0); t <= t1 + maxStep; t += stepAt(t)) {
      const tt = Math.min(t, t1)
      const h = above(tt)
      if (h !== null && h <= 0 && !(prev !== null && prev <= 0)) {
        // Below the ground now, and wasn't before: narrow down where (holes count as "above").
        let a = prevT
        let b = tt
        for (let k = 0; k < 14; k++) {
          const m = (a + b) / 2
          const hm = above(m)
          if (hm !== null && hm <= 0) b = m
          else a = m
        }
        // A real hit has ground just before it with the ray above it. Coming out of a hole
        // already under the ground (the ray passed beneath the mesh's edge) is not one.
        const before = above(a)
        if (before !== null && before > -1e-3) return { distance: b, point: ray.at(b, new THREE.Vector3()) }
      }
      prevT = tt
      prev = h
      if (tt === t1) break
    }
    return null
  }

  /** Is there mesh at (r, c)? The mesh leaves out every square with a corner that has no data. */
  #onMesh(r, c) {
    const { rows, cols, slope } = this.#grid
    const r0 = Math.floor(r)
    const c0 = Math.floor(c)
    if (r0 < 0 || c0 < 0 || r0 >= rows - 1 || c0 >= cols - 1) return false
    const i = r0 * cols + c0
    return slope[i] !== NO_DATA && slope[i + 1] !== NO_DATA && slope[i + cols] !== NO_DATA && slope[i + cols + 1] !== NO_DATA
  }

  /** Upward surface normal at grid point (r, c). */
  normalAt(r, c) {
    const { cw, ch } = this.#grid
    const dx = (this.heightAt(r, c + 0.5) - this.heightAt(r, c - 0.5)) / cw
    const dz = (this.heightAt(r + 0.5, c) - this.heightAt(r - 0.5, c)) / ch
    return new THREE.Vector3(-dx, 1, -dz).normalize()
  }
}
