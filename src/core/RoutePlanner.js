// Route objects shared by the Map page (2D and 3D), Martial's chat and the VR page.
// Routes stay plain data objects (they live in React state and are sent to the agent);
// RoutePlanner is what builds them for one site's terrain.
import { HAZARD_SLOPE, MAX_SLOPE } from './TerrainGrid.js'
import RouteGuide from './RouteGuide.js'

export const ROUTE_COLORS = { recommended: '#ff7a3d', reference: '#ffffff', custom: '#5ad1ff', agent: '#ffd23d' }

export default class RoutePlanner {
  /** @param {import('./TerrainGrid.js').default} grid (with a dust storm closed off, if one is shown) */
  constructor(grid) {
    this.grid = grid
  }

  /** Plain-language risk level from the steepest ground on a route. */
  static riskLevel(stats) {
    if (stats.maxSlope > MAX_SLOPE) return { label: 'High', note: `Crosses slopes over ${MAX_SLOPE}°` }
    if (stats.maxSlope > HAZARD_SLOPE || stats.steepShare > 0.1)
      return { label: 'Moderate', note: `Some sections over ${HAZARD_SLOPE}°` }
    return { label: 'Low', note: 'Gentle ground the whole way' }
  }

  get #cellM() {
    return Math.round(this.grid.cw)
  }

  /** [row, col] of a cell index. */
  #rc(i) {
    return [Math.floor(i / this.grid.cols), i % this.grid.cols]
  }

  /** Adds each stop's latitude/longitude, from the grid cell the route stops at. */
  #locate(stops, stopCells) {
    return stops.map((stop, k) => {
      if (stop.lat != null || stopCells?.[k] == null) return stop
      const [lat, lon] = this.grid.latLonAt(...this.#rc(stopCells[k]))
      return { ...stop, lat, lon }
    })
  }

  /** The route with its directions, in the same format as Martial's (see RouteGuide). */
  #withGuide(route, stops = route.stops) {
    return { ...route, guide: new RouteGuide(this.grid).write({ ...route, stops }) }
  }

  #stormNote(text) {
    return this.grid.blocked ? text.replace('{storm}', this.grid.blockedReason) : null
  }

  /** The site's built-in routes: the recommended traverse and (if any) the real rover drive. */
  builtInRoutes() {
    const { grid } = this
    const routes = []
    const planned = grid.planRoute(grid.stations.map((s) => s.rc))
    if (!planned.error) {
      routes.push(this.#withGuide({
        id: 'recommended',
        kind: 'recommended',
        name: 'Recommended traverse',
        description: `Lowest-risk path from the landing point through ${grid.stations.length - 1} science stop${
          grid.stations.length === 2 ? '' : 's'
        }, keeping to gentle ground, avoiding anything steeper than 25° and favouring ground sheltered from cosmic radiation.`,
        color: ROUTE_COLORS.recommended,
        cells: planned.cells,
        stopCells: planned.stopCells, // grid cell of each stop, in order (used to walk stop to stop in VR)
        stats: grid.routeStats(planned.cells),
        cellM: this.#cellM,
        stormNote: this.#stormNote('Planned around the {storm}.'),
        // The stations' own coordinates (as Martial quotes them).
        stops: grid.stations.map((s, k) => ({
          name: k === 0 ? s.name : `Stop ${k}: ${s.name}`,
          note: s.moved_m ? `moved ${(s.moved_m / 1000).toFixed(1)} km onto the terrain data` : null,
          lat: s.lat,
          lon: s.lon,
        })),
      }))
    }
    if (grid.reference) {
      const cells = grid.cellsFromPolyline(grid.reference.rc)
      if (cells.length > 1) {
        const crosses = Boolean(grid.blocked) && cells.some((i) => grid.blocked[i])
        routes.push(this.#withGuide({
          id: 'reference',
          kind: 'reference',
          name: grid.reference.name,
          description: 'The path the rover actually drove inside this area, from NASA mission data.',
          color: ROUTE_COLORS.reference,
          thin: true,
          cells,
          stats: grid.routeStats(cells),
          cellM: this.#cellM,
          stopCells: [cells[0], cells.at(-1)],
          stormNote: crosses ? this.#stormNote('Part of this drive is inside the {storm}. It is shown for reference only.') : null,
        }, [{ name: "the drive's first point in this area" }, { name: "the drive's last point in this area" }]))
      }
    }
    return routes
  }

  /**
   * A user-planned route through `points` ([row, col]), or { error }. `n` numbers its name;
   * `names` names the points (start, stops, destination), Start / Point k / End by default.
   */
  customRoute(points, n, names = null) {
    const planned = this.grid.planRoute(points)
    if (planned.error) return { error: planned.error }
    const stops = points.map((_, k) => ({
      name: names?.[k] ?? (k === 0 ? 'Start' : k === points.length - 1 ? 'End' : `Point ${k + 1}`),
    }))
    return {
      route: this.#withGuide({
        id: `custom-${Date.now()}`,
        kind: 'custom',
        name: `Your route ${n}`,
        description: `Safest path through your ${points.length} points, in order, on gentle ground sheltered from radiation where it can be.`,
        color: ROUTE_COLORS.custom,
        waypoints: points, // what the route was planned through: used to plan it again around a storm
        cells: planned.cells,
        stopCells: planned.stopCells,
        stats: this.grid.routeStats(planned.cells),
        cellM: this.#cellM,
        stops: this.#locate(stops, planned.stopCells),
      }),
    }
  }

  /**
   * A route Martial planned (the `route` of an /api/agent reply), ready for the map. `reply`: his
   * directions for it, shown as the route's directions word for word (else they are written here).
   */
  agentRoute(r, reply = null) {
    const route = {
      id: r.id,
      kind: 'custom',
      agent: true,
      name: r.name,
      description: r.description,
      color: ROUTE_COLORS.agent,
      waypoints: r.stopCells?.map((i) => this.#rc(i)),
      cells: r.cells,
      stopCells: r.stopCells,
      stops: this.#locate(r.stops ?? [], r.stopCells),
      stats: this.grid.routeStats(r.cells),
      cellM: this.#cellM,
    }
    return reply ? { ...route, guide: reply } : this.#withGuide(route)
  }

  /**
   * A saved route as it should be on this grid: unchanged unless it enters a closed area (a dust
   * storm), in which case it is planned again through the same points, or flagged if it can't be.
   */
  fit(route) {
    const { grid } = this
    if (!grid.blocked || !route.cells.some((i) => grid.blocked[i])) return route
    if (!route.waypoints) return { ...route, stormNote: this.#stormNote('This route crosses the {storm}.') }
    const planned = grid.planRoute(route.waypoints)
    if (planned.error) return { ...route, stormNote: `This route can't avoid the ${grid.blockedReason}: ${planned.error}` }
    return this.#withGuide({
      ...route,
      cells: planned.cells,
      stopCells: planned.stopCells,
      stats: grid.routeStats(planned.cells),
      stops: this.#locate(
        route.stops.map(({ lat, lon, ...s }) => s), // eslint-disable-line no-unused-vars
        planned.stopCells,
      ),
      stormNote: this.#stormNote('Re-planned to go around the {storm}.'),
    })
  }
}
