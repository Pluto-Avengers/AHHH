import * as THREE from 'three'

export const VERTICAL_EXAGGERATION = 2

/** Converts between grid (row, col) and scene coordinates (meters, y up). */
export function makeProjection(grid, vex = VERTICAL_EXAGGERATION) {
  const { rows, cols, cw, ch, height, elevation } = grid
  const lo = elevation[0]
  const heightAt = (r, c) => {
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
  return {
    toWorld: (r, c, lift = 0) =>
      new THREE.Vector3((c - (cols - 1) / 2) * cw, (heightAt(r, c) - lo) * vex + lift, (r - (rows - 1) / 2) * ch),
    toGrid: (p) => [p.z / ch + (rows - 1) / 2, p.x / cw + (cols - 1) / 2],
    span: Math.max(cols * cw, rows * ch),
  }
}

/** Textured terrain mesh; quads touching cells without data are left out. */
export function buildTerrain(grid, proj, texture) {
  const { rows, cols, slope } = grid
  const positions = new Float32Array(rows * cols * 3)
  const uvs = new Float32Array(rows * cols * 2)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const p = proj.toWorld(r, c)
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
      if (slope[a] === 255 || slope[b] === 255 || slope[d] === 255 || slope[e] === 255) continue
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
