// Route objects shared by the Map page (2D and 3D), Martial's chat and the VR page.
// Routes stay plain data objects (they live in React state and are sent to the agent);
// RoutePlanner is what builds them for one site's terrain.
import { HAZARD_SLOPE, MAX_SLOPE } from './TerrainGrid.js'

export const ROUTE_COLORS = { recommended: '#ff7a3d', reference: '#ffffff', custom: '#5ad1ff', agent: '#ffd23d' }

export default class RoutePlanner {
  /** @param {import('./TerrainGrid.js').default} grid */
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

  /** The site's built-in routes: the recommended traverse and (if any) the real rover drive. */
  builtInRoutes() {
    const { grid } = this
    const routes = []
    const planned = grid.planRoute(grid.stations.map((s) => s.rc))
    if (!planned.error) {
      routes.push({
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
        stops: grid.stations.map((s, k) => ({
          name: k === 0 ? s.name : `Stop ${k}: ${s.name}`,
          note: s.moved_m ? `moved ${(s.moved_m / 1000).toFixed(1)} km onto the terrain data` : null,
        })),
      })
    }
    if (grid.reference) {
      const cells = grid.cellsFromPolyline(grid.reference.rc)
      if (cells.length > 1) {
        routes.push({
          id: 'reference',
          kind: 'reference',
          name: grid.reference.name,
          description: 'The path the rover actually drove inside this area, from NASA mission data.',
          color: ROUTE_COLORS.reference,
          thin: true,
          cells,
          stats: grid.routeStats(cells),
          cellM: this.#cellM,
        })
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
    return {
      route: {
        id: `custom-${Date.now()}`,
        kind: 'custom',
        name: `Your route ${n}`,
        description: `Safest path through your ${points.length} points, in order, on gentle ground sheltered from radiation where it can be.`,
        color: ROUTE_COLORS.custom,
        cells: planned.cells,
        stopCells: planned.stopCells,
        stats: this.grid.routeStats(planned.cells),
        cellM: this.#cellM,
        stops: points.map((_, k) => ({
          name: names?.[k] ?? (k === 0 ? 'Start' : k === points.length - 1 ? 'End' : `Point ${k + 1}`),
        })),
      },
    }
  }

  /** A route Martial planned (the `route` of an /api/agent reply), ready for the map. */
  agentRoute(r) {
    return {
      id: r.id,
      kind: 'custom',
      agent: true,
      name: r.name,
      description: r.description,
      color: ROUTE_COLORS.agent,
      cells: r.cells,
      stopCells: r.stopCells,
      stops: r.stops,
      stats: this.grid.routeStats(r.cells),
      cellM: this.#cellM,
    }
  }
}
