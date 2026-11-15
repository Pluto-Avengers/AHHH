import * as THREE from 'three'
import { NO_DATA } from '../core/TerrainGrid.js'

export const VERTICAL_EXAGGERATION = 2

/**
 * Places a site's terrain in a Three.js scene: converts between grid (row, col) and scene
 * coordinates (meters, y up, centred on the site) and builds the textured terrain mesh.
 */
export default class TerrainProjection {
  #grid
  #vex
  #lowest

  /**
   * @param {import('../core/TerrainGrid.js').default} grid
   * @param {number} vex vertical exaggeration
   */
  constructor(grid, vex = VERTICAL_EXAGGERATION) {
    this.#grid = grid
    this.#vex = vex
    this.#lowest = grid.elevation[0]
    /** Longest side of the site in meters (for framing cameras). */
    this.span = Math.max(grid.cols * grid.cw, grid.rows * grid.ch)
  }

  /** Bilinear elevation (m) at fractional grid coordinates, clamped to the grid. */
  #heightAt(r, c) {
    const { rows, cols, height } = this.#grid
    r = Math.min(Math.max(r, 0), rows - 1)
    c = Math.min(Math.max(c, 0), cols - 1)
    const r0 = Math.floor(r)
    const c0 = Math.floor(c)
    const r1 = Math.min(r0 + 1, rows - 1)
    const c1 = Math.min(c0 + 1, cols - 1)
    const fr = r - r0
    const fc = c - c0
    const top = height[r0 * cols + c0] * (1 - fc) + height[r0 * cols + c1] * fc
    const bottom = height[r1 * cols + c0] * (1 - fc) + height[r1 * cols + c1] * fc
    return top * (1 - fr) + bottom * fr
  }

  /** Scene position of grid point (r, c), raised by `lift` meters. */
  toWorld(r, c, lift = 0) {
    const { rows, cols, cw, ch } = this.#grid
    return new THREE.Vector3(
      (c - (cols - 1) / 2) * cw,
      (this.#heightAt(r, c) - this.#lowest) * this.#vex + lift,
      (r - (rows - 1) / 2) * ch,
    )
  }

  /** Grid [row, col] under a scene position. */
  toGrid(p) {
    const { rows, cols, cw, ch } = this.#grid
    return [p.z / ch + (rows - 1) / 2, p.x / cw + (cols - 1) / 2]
  }

  /** Textured terrain mesh; quads touching cells without data are left out. */
  buildMesh(texture) {
    const { rows, cols, slope } = this.#grid
    const positions = new Float32Array(rows * cols * 3)
    const uvs = new Float32Array(rows * cols * 2)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const p = this.toWorld(r, c)
        positions.set([p.x, p.y, p.z], i * 3)
        uvs.set([c / (cols - 1), 1 - r / (rows - 1)], i * 2)
      }
    }
    const indices = []
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c
        const b = a + 1
        const d = a + cols
        const e = d + 1
        if (slope[a] === NO_DATA || slope[b] === NO_DATA || slope[d] === NO_DATA || slope[e] === NO_DATA) continue
        indices.push(a, d, b, b, d, e)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture }))
  }
}
