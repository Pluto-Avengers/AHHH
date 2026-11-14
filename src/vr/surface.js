// True-scale ground for the VR page: 1 unit = 1 meter, y up, north = -z.
// Grid point (row, col) sits at x = (col - cx) * cw, z = (row - cz) * ch, y = elevation - lowest elevation.
import * as THREE from 'three'
import { walkSpeedMs } from '../map/router.js'

/** Height and coordinate helpers that match the terrain mesh exactly (same triangles). */
export function makeSurface(grid) {
  const { rows, cols, cw, ch, height, elevation } = grid
  const lo = elevation[0]
  const cx = (cols - 1) / 2
  const cz = (rows - 1) / 2

  /** Ground height (m above the site's lowest point) at fractional grid coords. */
  function heightAt(r, c) {
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
    // The mesh splits each quad along the b–d diagonal (see buildTerrain).
    const h = fr + fc <= 1 ? a + (b - a) * fc + (d - a) * fr : e + (d - e) * (1 - fc) + (b - e) * (1 - fr)
    return h - lo
  }

  return {
    heightAt,
    toWorld: (r, c, lift = 0) => new THREE.Vector3((c - cx) * cw, heightAt(r, c) + lift, (r - cz) * ch),
    toGrid: (x, z) => [z / ch + cz, x / cw + cx],
    elevationAt: (r, c) => heightAt(r, c) + lo,
    slopeAt: (r, c) => {
      const s = grid.slope[Math.round(Math.min(Math.max(r, 0), rows - 1)) * cols + Math.round(Math.min(Math.max(c, 0), cols - 1))]
      return s === 255 ? null : s
    },
    hasData: (r, c) => {
      const rr = Math.round(r)
      const cc = Math.round(c)
      return grid.inBounds(rr, cc) && grid.hasData(grid.index(rr, cc))
    },
    size: [cols * cw, rows * ch],
  }
}

/**
 * A walkable path along a route: smoothed grid points plus the distance walked (m) to each,
 * and the distance at which each stop is reached.
 */
export function makeWalkPath(grid, surface, route) {
  const raw = route.cells.map((i) => [Math.floor(i / grid.cols), i % grid.cols])
  const pts = raw.map((_, k) => {
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
  const dist = [0]
  for (let k = 1; k < pts.length; k++) {
    const a = surface.toWorld(...pts[k - 1])
    const b = surface.toWorld(...pts[k])
    dist.push(dist[k - 1] + a.distanceTo(b))
  }

  // Each stop: the first time the route passes its cell (searching forward from the previous stop).
  const stopDist = []
  let from = 0
  for (const cell of route.stopCells ?? []) {
    const k = route.cells.indexOf(cell, from)
    if (k === -1) continue
    stopDist.push(dist[k])
    from = k
  }

  const length = dist[dist.length - 1]

  /** Grid position, heading (radians, 0 = north) and local grade at distance s. */
  function at(s) {
    s = Math.min(Math.max(s, 0), length)
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

  return { pts, dist, stopDist, length, at, speedAt: (s) => walkSpeedMs(at(s).grade) }
}

/** Tileable grey noise used to give the ground fine detail up close. */
export function detailTexture(size = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  let seed = 11
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const octave = (cells) => {
    const g = Array.from({ length: cells * cells }, rand)
    return (x, y) => {
      const fx = (x / size) * cells
      const fy = (y / size) * cells
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = fx - x0
      const ty = fy - y0
      const v = (i, j) => g[((j % cells) * cells + (i % cells)) | 0]
      const s = (t) => t * t * (3 - 2 * t)
      const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * s(tx)
      const bot = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * s(tx)
      return top + (bot - top) * s(ty)
    }
  }
  const layers = [octave(4), octave(8), octave(16), octave(32), octave(64)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      let amp = 0.5
      for (const f of layers) {
        v += f(x, y) * amp
        amp *= 0.55
      }
      const g = Math.max(0, Math.min(255, Math.round(v * 255)))
      img.data.set([g, g, g, 255], (y * size + x) * 4)
    }
  }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  return t
}

/** Adds world-space detail noise to a terrain material, so the ground isn't flat colour up close. */
export function addGroundDetail(material, detail) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vGroundPos;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float fine = texture2D(detailMap, vGroundPos.xz * 0.35).r;
        float mid = texture2D(detailMap, vGroundPos.xz * 0.04 + 0.37).r;
        diffuseColor.rgb *= 0.95 + 0.55 * (fine - 0.5) + 0.35 * (mid - 0.5);`,
      )
  }
  material.needsUpdate = true
}
