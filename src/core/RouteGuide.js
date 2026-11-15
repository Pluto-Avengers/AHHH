// Directions for a route, written in the same format as Martial's (backend/martial/skills/navigation.py
// and backend/terrain/legs.py): a title, a friendly opening, From / Going to, one section per leg
// (heading, distance, the turn from the leg before, how much it climbs or drops, steep ground, and a
// point to check in at), a trip summary and a sign-off. The chat's MartialReply lays it out.
import { HAZARD_SLOPE, NO_DATA } from './TerrainGrid.js'
import Coordinates from './Coordinates.js'

const COMPASS = [
  'north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest',
]
const LEG_TITLES = { LEVEL: 'LEVEL GROUND', ASCENT: 'UPHILL', DESCENT: 'DOWNHILL' }
const LEVEL_TOLERANCE_M = 3

export default class RouteGuide {
  static MIN_LEGS = 3 // a route between two points always has middle legs (as Martial's do)
  static MAX_LEGS = 6
  static LEG_LENGTH_M = 300
  static MAX_LEGS_BETWEEN_STOPS = 3 // on a route with several stops, so the whole walk stays readable

  /** @param {import('./TerrainGrid.js').default} grid */
  constructor(grid) {
    this.grid = grid
  }

  static compass(deg) {
    return COMPASS[Math.round(deg / 22.5) % 16]
  }

  static turn(delta) {
    delta = ((delta + 540) % 360) - 180
    const side = delta > 0 ? 'right' : 'left'
    const a = Math.abs(delta)
    if (a < 20) return 'Carry straight on at'
    if (a < 45) return `Bear slightly ${side} to`
    if (a < 120) return `Turn ${side} to`
    return `Turn sharply ${side} to`
  }

  static duration(minutes) {
    const m = Math.max(1, Math.round(minutes))
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
  }

  /**
   * The directions as text.
   * @param {object} route { cells, stopCells?, stops?: [{ name, lat?, lon? }], stats }
   */
  write(route) {
    const { cells, stats } = route
    if (!cells || cells.length < 2) return ''
    const stops = this.#stops(route)
    const legs = this.#legs(cells, stops)

    const from = stops[0]
    const to = stops.at(-1)
    const dest = /^(end|destination)$/i.test(to.name) ? null : to.name
    const fromName = /^start$/i.test(from.name) ? 'your starting point' : from.name
    const [opener, signoff] = this.#lines(dest, legs)
    const lines = [dest ? `DIRECTIONS TO ${dest.toUpperCase().replace(/:/g, ' -')}` : 'DIRECTIONS', '', opener, '']
    lines.push(`FROM: ${fromName[0].toUpperCase()}${fromName.slice(1)} · ${from.label}`)
    lines.push(`GOING TO: ${dest ?? 'Your destination'} · ${to.label}`, '')

    let previous = null
    legs.forEach((leg, k) => {
      const first = k === 0
      const last = k === legs.length - 1
      const heading = `${String(leg.heading).padStart(3, '0')}° (${RouteGuide.compass(leg.heading)})`
      const title = first ? 'HEADING OUT' : last ? 'FINAL STRETCH' : LEG_TITLES[leg.trend]
      lines.push(`LEG ${k + 1} - ${title}`)
      if (first) lines.push(`Face ${heading} and walk about ${leg.distance} m.`)
      else {
        const tail = last ? `for the last ${leg.distance} m` : `and keep going for about ${leg.distance} m`
        lines.push(`${RouteGuide.turn(leg.heading - previous)} ${heading} ${tail}.`)
      }
      if ((!first && !last) || leg.trend !== 'LEVEL') lines.push(RouteGuide.#elevationNote(leg))
      if (leg.hazard) {
        lines.push(
          `Careful: there's a steep slope of ${leg.hazard.slope}° at ${leg.hazard.at}. Swing to ${String(leg.hazard.bypass).padStart(3, '0')}° (${RouteGuide.compass(leg.hazard.bypass)}) to get around it.`,
        )
      }
      if (last) lines.push(`${dest ?? 'Your destination'} is right ahead at ${to.label}. You've made it!`)
      else if (leg.reaches) lines.push(`You've reached ${leg.reaches.name}. Check in at ${leg.reaches.label}.`)
      else lines.push(`Check in at ${leg.end}.`)
      lines.push('')
      previous = leg.heading
    })

    const distance = legs.reduce((s, l) => s + l.distance, 0)
    lines.push(
      'TRIP SUMMARY',
      `DISTANCE: ${distance.toLocaleString('en-US')} m`,
      `WALKING TIME: about ${RouteGuide.duration(stats.walkMinutes)}`,
      `RADIATION DOSE: about ${stats.doseUGy.toFixed(1)} µGy`,
      '',
      signoff,
    )
    return lines.join('\n')
  }

  // ---- stops and legs -------------------------------------------------------------------------------
  /** Named points along the route (start, any stops, end), each with its position on the path. */
  #stops(route) {
    const { cells } = route
    const names = route.stops ?? []
    const at = []
    let from = 0
    for (const [k, cell] of (route.stopCells ?? []).entries()) {
      const i = cells.indexOf(cell, from)
      if (i === -1) continue
      at.push({ index: i, name: names[k]?.name ?? `Stop ${k}`, lat: names[k]?.lat, lon: names[k]?.lon })
      from = i
    }
    if (!at.length || at[0].index !== 0) at.unshift({ index: 0, name: names[0]?.name ?? 'Start' })
    if (at.at(-1).index !== cells.length - 1) at.push({ index: cells.length - 1, name: names.at(-1)?.name ?? 'End' })
    return at.map((s) => ({ ...s, label: s.lat != null ? Coordinates.point(s.lat, s.lon) : this.#cellLabel(cells[s.index]) }))
  }

  /** Legs of roughly equal length between each pair of stops (3 to 6 for a route between two points). */
  #legs(cells, stops) {
    const cum = [0]
    for (let k = 1; k < cells.length; k++) {
      const [flat, dz] = this.#step(cells[k - 1], cells[k])
      cum.push(cum[k - 1] + Math.hypot(flat, dz))
    }
    const legs = []
    const twoPoint = stops.length <= 2
    for (let s = 0; s + 1 < stops.length; s++) {
      const a = stops[s].index
      const b = stops[s + 1].index
      if (b <= a) continue
      const bounds = twoPoint
        ? this.#bounds(cum, a, b, RouteGuide.MIN_LEGS, RouteGuide.MAX_LEGS)
        : this.#bounds(cum, a, b, 1, RouteGuide.MAX_LEGS_BETWEEN_STOPS)
      for (let k = 0; k + 1 < bounds.length; k++) {
        const leg = this.#leg(cells, bounds[k], bounds[k + 1], cum[bounds[k + 1]] - cum[bounds[k]])
        if (k + 2 === bounds.length && s + 2 < stops.length) leg.reaches = stops[s + 1]
        legs.push(leg)
      }
    }
    return legs
  }

  /** Indices where the legs of cells[a..b] start and end (same rule as backend/terrain/legs.py). */
  #bounds(cum, a, b, minLegs, maxLegs) {
    const total = cum[b] - cum[a]
    let n = Math.max(minLegs, Math.min(maxLegs, Math.floor(total / RouteGuide.LEG_LENGTH_M)))
    n = Math.min(n, b - a) || 1
    const bounds = [a]
    for (let j = 1; j < n; j++) {
      const target = cum[a] + (total * j) / n
      let k = bounds.at(-1) + 1
      while (k < b && cum[k] < target) k++
      bounds.push(Math.min(k, b - 1))
    }
    bounds.push(b)
    return [...new Set(bounds)].sort((x, y) => x - y)
  }

  #leg(cells, a, b, distance) {
    const { slope, height } = this.grid
    const dz = height[cells[b]] - height[cells[a]]
    const trend = Math.abs(dz) < LEVEL_TOLERANCE_M ? 'LEVEL' : dz > 0 ? 'ASCENT' : 'DESCENT'
    let steepest = a
    for (let i = a; i <= b; i++) {
      const s = slope[cells[i]] === NO_DATA ? 0 : slope[cells[i]]
      const best = slope[cells[steepest]] === NO_DATA ? 0 : slope[cells[steepest]]
      if (s > best) steepest = i
    }
    let hazard = null
    const worst = slope[cells[steepest]]
    if (worst !== NO_DATA && worst > HAZARD_SLOPE) {
      const ahead = Math.min(steepest + 8, b)
      if (ahead !== steepest) {
        hazard = {
          slope: worst,
          at: this.#cellLabel(cells[steepest]),
          bypass: Math.round(this.#heading(cells[steepest], cells[ahead])) % 360,
        }
      }
    }
    return {
      heading: Math.round(this.#heading(cells[a], cells[b])) % 360,
      distance: Math.round(distance),
      trend,
      elevationChange: Math.round(Math.abs(dz)),
      end: this.#cellLabel(cells[b]),
      hazard,
    }
  }

  // ---- measurements (same as backend/terrain/grid.py) -------------------------------------------
  #rc(i) {
    return [Math.floor(i / this.grid.cols), i % this.grid.cols]
  }

  #step(a, b) {
    const { cw, ch, height } = this.grid
    const [ar, ac] = this.#rc(a)
    const [br, bc] = this.#rc(b)
    return [Math.hypot((br - ar) * ch, (bc - ac) * cw), height[b] - height[a]]
  }

  #heading(a, b) {
    const { cw, ch } = this.grid
    const [ar, ac] = this.#rc(a)
    const [br, bc] = this.#rc(b)
    const deg = (Math.atan2((bc - ac) * cw, -(br - ar) * ch) * 180) / Math.PI
    return ((deg % 360) + 360) % 360
  }

  #cellLabel(i) {
    return Coordinates.point(...this.grid.latLonAt(...this.#rc(i)))
  }

  // ---- words ----------------------------------------------------------------------------------------
  static #elevationNote(leg) {
    const dz = leg.elevationChange
    if (leg.trend === 'ASCENT') return `Heads up: this stretch climbs about ${dz} m, so take it slow and steady.`
    if (leg.trend === 'DESCENT') return `Heads up: this stretch drops about ${dz} m, so watch your footing on the way down.`
    if (dz === 0) return 'Heads up: the ground stays level here, with less than a metre of height change.'
    return `Heads up: the ground stays fairly level here, about ${dz} m of height change.`
  }

  /** The opening and sign-off, chosen from what the walk is like (as Martial's are without the model). */
  #lines(dest, legs) {
    const middle = legs.slice(1, -1).map((l) => l.trend)
    const steep = legs.some((l) => l.hazard)
    let feel
    if (middle.length && middle.every((t) => t === 'LEVEL')) feel = "It's a nice, mostly level walk"
    else if (middle.includes('ASCENT') && middle.includes('DESCENT')) feel = 'There are a few ups and downs on the way'
    else if (middle.includes('ASCENT')) feel = "There's a bit of climbing on the way"
    else feel = "It's mostly downhill from here"
    feel += steep ? ", and there's a steep patch I'll warn you about." : '.'
    const opener = `Okay, let's get you to ${dest ?? 'your destination'}. ${feel} I'll take you through it one leg at a time.`
    const signoff = steep
      ? "Keep clear of the steep ground, check in at each point, and you'll be fine."
      : 'Take it steady, check in at each point, and enjoy the view out there.'
    return [opener, signoff]
  }
}
