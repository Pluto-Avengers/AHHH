// Turn-by-turn directions for a route, read from its actual path on the terrain:
// where it bends left or right (slightly, normally or sharply), where it climbs or drops,
// where the ground gets steep, and where it reaches each stop.
import { HAZARD_SLOPE, NO_DATA } from './TerrainGrid.js'

const COMPASS = [
  'north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest',
]

export default class RouteDirections {
  static STRAIGHT_DEG = 20 // a bend smaller than this just "keeps going"
  static SLIGHT_DEG = 45
  static SHARP_DEG = 120
  static LEVEL_M = 3 // less height change than this is level ground
  static STEEP_GRADE = 0.08 // 8 %: a steep climb or descent for a suited astronaut

  /** @param {import('./TerrainGrid.js').default} grid */
  constructor(grid) {
    this.grid = grid
  }

  static compass(deg) {
    return COMPASS[Math.round(deg / 22.5) % 16]
  }

  static distance(m) {
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
    return `${Math.max(10, Math.round(m / 10) * 10)} m`
  }

  /** How a change of heading (degrees, + = clockwise) is said, and its arrow. */
  static turn(delta) {
    const { STRAIGHT_DEG, SLIGHT_DEG, SHARP_DEG } = RouteDirections
    const side = delta > 0 ? 'right' : 'left'
    const a = Math.abs(delta)
    if (a < STRAIGHT_DEG) return { kind: 'straight', say: 'Keep going', arrow: '↑' }
    if (a < SLIGHT_DEG) return { kind: `slight-${side}`, say: `Bear slightly ${side}`, arrow: side === 'right' ? '↗' : '↖' }
    if (a < SHARP_DEG) return { kind: side, say: `Turn ${side}`, arrow: side === 'right' ? '→' : '←' }
    return { kind: `sharp-${side}`, say: `Turn sharply ${side}`, arrow: side === 'right' ? '↘' : '↙' }
  }

  /**
   * Steps from the start to the end of a route.
   * @param {number[]} cells   the route's grid cells, in order
   * @param {number[]} [stopCells] the cells of its named stops (first = start, last = end)
   * @param {{ name: string }[]} [stops] their names
   * @returns {{ arrow: string, kind: string, text: string }[]}
   */
  describe(cells, stopCells = [], stops = []) {
    if (cells.length < 2) return []
    const pts = this.#points(cells)
    const stopAt = this.#stopPositions(cells, stopCells, stops)
    const corners = this.#merge(pts, this.#simplify(pts, [...stopAt.keys()]), stopAt)

    // Plain 'Start' / 'End' / 'Destination' names read better as 'your starting point' / 'your destination'
    const startName = /^(start|the start)?$/i.test(stops[0]?.name ?? '') ? 'your starting point' : stops[0].name
    const endName = /^(end|destination|the end)?$/i.test(stops.at(-1)?.name ?? '') ? 'your destination' : stops.at(-1).name
    const steps = [{ arrow: '●', kind: 'start', text: `Start at ${startName}.` }]
    let previous = null
    for (let k = 0; k + 1 < corners.length; k++) {
      const a = corners[k]
      const b = corners[k + 1]
      const leg = this.#leg(pts, a, b)
      const where = `${RouteDirections.compass(leg.heading)} (${String(Math.round(leg.heading) % 360).padStart(3, '0')}°)`
      let text
      let turn = { kind: 'straight', arrow: '↑' }
      if (previous === null) {
        text = `Head ${where} for ${RouteDirections.distance(leg.length)}${this.#terrain(leg)}.`
      } else {
        turn = RouteDirections.turn(((leg.heading - previous + 540) % 360) - 180)
        text =
          turn.kind === 'straight'
            ? `Keep going ${where} for ${RouteDirections.distance(leg.length)}${this.#terrain(leg)}.`
            : `${turn.say} to face ${where}, then go ${RouteDirections.distance(leg.length)}${this.#terrain(leg)}.`
      }
      if (leg.steepest > HAZARD_SLOPE) text += ` Watch for slopes up to ${leg.steepest}° on this stretch.`
      steps.push({ arrow: turn.arrow, kind: turn.kind, text })
      const reached = stopAt.get(b)
      if (reached && b !== pts.length - 1) steps.push({ arrow: '◆', kind: 'stop', text: `You reach ${reached}.` })
      previous = leg.heading
    }
    steps.push({ arrow: '⚑', kind: 'arrive', text: `Arrive at ${endName}.` })
    return steps
  }

  // ---- the path in meters ------------------------------------------------------------------------
  #points(cells) {
    const { cols, cw, ch, height, slope } = this.grid
    return cells.map((i) => ({
      x: (i % cols) * cw,
      y: Math.floor(i / cols) * ch, // grows southward
      h: height[i],
      s: slope[i] === NO_DATA ? 0 : slope[i],
    }))
  }

  /** Index on the path of each named stop (searching forward), mapped to its name. */
  #stopPositions(cells, stopCells, stops) {
    const at = new Map()
    let from = 0
    stopCells.forEach((cell, k) => {
      const i = cells.indexOf(cell, from)
      if (i === -1) return
      at.set(i, stops[k]?.name ?? `Stop ${k}`)
      from = i
    })
    at.set(0, at.get(0) ?? stops[0]?.name ?? 'the start')
    at.set(cells.length - 1, at.get(cells.length - 1) ?? stops.at(-1)?.name ?? 'the end')
    return at
  }

  /** Corner points of the path (Douglas-Peucker), always keeping the stops. */
  #simplify(pts, keep) {
    const tolerance = Math.max(this.grid.cw * 1.5, 20)
    const kept = new Set([0, pts.length - 1, ...keep])
    const anchors = [...kept].sort((a, b) => a - b)
    const visit = (a, b) => {
      let worst = -1
      let worstD = tolerance
      const ax = pts[a].x
      const ay = pts[a].y
      const dx = pts[b].x - ax
      const dy = pts[b].y - ay
      const len = Math.hypot(dx, dy) || 1
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i].x - ax) * dy - (pts[i].y - ay) * dx) / len
        if (d > worstD) {
          worstD = d
          worst = i
        }
      }
      if (worst !== -1) {
        kept.add(worst)
        visit(a, worst)
        visit(worst, b)
      }
    }
    for (let k = 0; k + 1 < anchors.length; k++) visit(anchors[k], anchors[k + 1])
    return [...kept].sort((a, b) => a - b)
  }

  /** Drops corners that make very short stretches or barely bend the path (stops always stay). */
  #merge(pts, corners, stopAt) {
    const total = this.#length(pts, 0, pts.length - 1)
    const minLen = Math.min(150, Math.max(40, total * 0.04))
    let list = corners
    for (let changed = true; changed && list.length > 2; ) {
      changed = false
      for (let k = 1; k + 1 < list.length; k++) {
        const v = list[k]
        if (stopAt.has(v)) continue
        const before = this.#leg(pts, list[k - 1], v)
        const after = this.#leg(pts, v, list[k + 1])
        const bend = Math.abs(((after.heading - before.heading + 540) % 360) - 180)
        if (bend < RouteDirections.STRAIGHT_DEG || Math.min(before.length, after.length) < minLen) {
          list = [...list.slice(0, k), ...list.slice(k + 1)]
          changed = true
          break
        }
      }
    }
    return list
  }

  #length(pts, a, b) {
    let m = 0
    for (let i = a + 1; i <= b; i++) m += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    return m
  }

  /** One stretch between two corners: heading, length, height change and steepest ground. */
  #leg(pts, a, b) {
    const dx = pts[b].x - pts[a].x
    const dy = pts[b].y - pts[a].y
    let steepest = 0
    for (let i = a; i <= b; i++) steepest = Math.max(steepest, pts[i].s)
    return {
      heading: (Math.atan2(dx, -dy) * 180) / Math.PI + (dx < 0 ? 360 : 0),
      length: this.#length(pts, a, b),
      dz: pts[b].h - pts[a].h,
      steepest,
    }
  }

  /** ", climbing gently (+5 m)" and the like. */
  #terrain(leg) {
    const { LEVEL_M, STEEP_GRADE } = RouteDirections
    const dz = Math.round(leg.dz)
    if (Math.abs(leg.dz) < LEVEL_M) return ' over level ground'
    const steep = Math.abs(leg.dz) / Math.max(leg.length, 1) > STEEP_GRADE
    if (leg.dz > 0) return steep ? `, climbing steeply (+${dz} m), so take it slow` : `, gently uphill (+${dz} m)`
    return steep ? `, going steeply downhill (${dz} m), so watch your footing` : `, gently downhill (${dz} m)`
  }
}
