// Least-cost routing over a site's slope grid (runs in the browser).
//
// Cost of walking one meter = 1 + SLOPE_WEIGHT * (slope / MAX_SLOPE)^2,
// so gentle ground is strongly preferred and anything steeper than MAX_SLOPE
// (or without data) is impassable. A* finds the cheapest 8-connected path.

export const MAX_SLOPE = 25 // degrees: steeper is unsafe for a suited astronaut
const SLOPE_WEIGHT = 6
const NO_DATA = 255
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]

/** Wraps a site's exported data with helpers used by routing and the 3D scene. */
export function createGrid(terrain, height, slope) {
  const { rows, cols } = terrain
  const [cw, ch] = terrain.cell_m
  return {
    ...terrain,
    cw,
    ch,
    height,
    slope,
    index: (r, c) => r * cols + c,
    inBounds: (r, c) => r >= 0 && r < rows && c >= 0 && c < cols,
    passable: (i) => slope[i] !== NO_DATA && slope[i] <= MAX_SLOPE,
    hasData: (i) => slope[i] !== NO_DATA,
  }
}

const multiplier = (s) => 1 + SLOPE_WEIGHT * (s / MAX_SLOPE) ** 2

class MinHeap {
  ids = []
  keys = []
  get size() {
    return this.ids.length
  }
  push(id, key) {
    const { ids, keys } = this
    let i = ids.length
    ids.push(id)
    keys.push(key)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      ids[i] = ids[p]
      keys[i] = keys[p]
      i = p
    }
    ids[i] = id
    keys[i] = key
  }
  pop() {
    const { ids, keys } = this
    const top = ids[0]
    const lastId = ids.pop()
    const lastKey = keys.pop()
    if (ids.length) {
      let i = 0
      const n = ids.length
      for (;;) {
        let m = 2 * i + 1
        if (m >= n) break
        if (m + 1 < n && keys[m + 1] < keys[m]) m++
        if (keys[m] >= lastKey) break
        ids[i] = ids[m]
        keys[i] = keys[m]
        i = m
      }
      ids[i] = lastId
      keys[i] = lastKey
    }
    return top
  }
}

/** A* between two cell indices. Returns an array of cell indices, or null. */
export function findPath(grid, start, goal) {
  const { rows, cols, cw, ch, slope } = grid
  const n = rows * cols
  const g = new Float64Array(n).fill(Infinity)
  const from = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const steps = DIRS.map(([dr, dc]) => Math.hypot(dr * ch, dc * cw))
  const gr = Math.floor(goal / cols)
  const gc = goal % cols
  const h = (r, c) => Math.hypot((r - gr) * ch, (c - gc) * cw)

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
    const mi = multiplier(slope[i])
    for (let k = 0; k < 8; k++) {
      const nr = r + DIRS[k][0]
      const nc = c + DIRS[k][1]
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      const j = nr * cols + nc
      if (closed[j] || !grid.passable(j)) continue
      const cost = g[i] + (steps[k] * (mi + multiplier(slope[j]))) / 2
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

/** Nearest passable cell to (r, c) within `radius` cells, or null. */
export function snap(grid, r, c, radius = 8) {
  r = Math.round(r)
  c = Math.round(c)
  let best = null
  let bestD = Infinity
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const nr = r + dr
      const nc = c + dc
      if (!grid.inBounds(nr, nc) || !grid.passable(grid.index(nr, nc))) continue
      const d = dr * dr + dc * dc
      if (d < bestD) {
        bestD = d
        best = grid.index(nr, nc)
      }
    }
  }
  return best
}

/**
 * Route through waypoints given as [row, col] (floats ok), in order.
 * Returns { cells, stopCells } or { error }.
 */
export function planRoute(grid, waypoints) {
  const snapped = waypoints.map(([r, c]) => snap(grid, r, c))
  const bad = snapped.indexOf(null)
  if (bad !== -1) return { error: `Point ${bad + 1} is on terrain that is too steep or has no data.` }

  const cells = [snapped[0]]
  for (let k = 1; k < snapped.length; k++) {
    if (snapped[k] === snapped[k - 1]) continue
    const leg = findPath(grid, snapped[k - 1], snapped[k])
    if (!leg) return { error: `No safe path between points ${k} and ${k + 1}.` }
    cells.push(...leg.slice(1))
  }
  return { cells, stopCells: snapped }
}

/** Turns a list of [row, col] floats (e.g. a rover drive) into a list of cells. */
export function cellsFromPolyline(grid, rcs) {
  const cells = []
  for (const [r, c] of rcs) {
    const rr = Math.round(r)
    const cc = Math.round(c)
    if (!grid.inBounds(rr, cc)) continue
    const i = grid.index(rr, cc)
    if (cells[cells.length - 1] !== i) cells.push(i)
  }
  return cells
}

// Suited walking speed from grade (Tobler-style hiking function, slowed for EVA suits).
// This is a planning assumption, not a measurement.
export const walkSpeedMs = (grade) => (3.6 * Math.exp(-3.5 * Math.abs(grade + 0.05))) / 3.6

/** Distance, climb, slope, time and an elevation profile for a route. */
export function routeStats(grid, cells) {
  const { cols, cw, ch, height, slope } = grid
  let distance = 0
  let gain = 0
  let loss = 0
  let seconds = 0
  let maxSlope = 0
  let slopeSum = 0
  let steepCount = 0
  const profile = [{ d: 0, e: height[cells[0]] }]

  for (let k = 0; k < cells.length; k++) {
    const s = slope[cells[k]] === NO_DATA ? 0 : slope[cells[k]]
    maxSlope = Math.max(maxSlope, s)
    slopeSum += s
    if (s > 15) steepCount++
    if (k === 0) continue
    const a = cells[k - 1]
    const b = cells[k]
    const flat = Math.hypot((Math.floor(b / cols) - Math.floor(a / cols)) * ch, ((b % cols) - (a % cols)) * cw)
    const dz = height[b] - height[a]
    const step = Math.hypot(flat, dz)
    distance += step
    if (dz > 0) gain += dz
    else loss -= dz
    seconds += step / walkSpeedMs(dz / flat)
    profile.push({ d: distance, e: height[b] })
  }

  return {
    distanceM: distance,
    gainM: gain,
    lossM: loss,
    walkMinutes: seconds / 60,
    maxSlope,
    meanSlope: slopeSum / cells.length,
    steepShare: steepCount / cells.length,
    profile,
  }
}

/** Plain-language risk level from the steepest ground on the route. */
export function riskLevel(stats) {
  if (stats.maxSlope > MAX_SLOPE) return { label: 'High', note: `Crosses slopes over ${MAX_SLOPE}°` }
  if (stats.maxSlope > 15 || stats.steepShare > 0.1) return { label: 'Moderate', note: 'Some sections over 15°' }
  return { label: 'Low', note: 'Gentle ground the whole way' }
}
