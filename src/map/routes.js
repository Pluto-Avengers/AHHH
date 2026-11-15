// Route objects shared by the Map page (2D and 3D) and the VR page.
import { cellsFromPolyline, planRoute, routeStats } from './router.js'

export const ROUTE_COLORS = { recommended: '#ff7a3d', reference: '#ffffff', custom: '#5ad1ff', agent: '#ffd23d' }

/** The site's built-in routes: the recommended traverse and (if any) the real rover drive. */
export function builtInRoutes(grid) {
  const routes = []
  const cellM = Math.round(grid.cw)
  const planned = planRoute(grid, grid.stations.map((s) => s.rc))
  if (!planned.error) {
    routes.push({
      id: 'recommended',
      kind: 'recommended',
      name: 'Recommended traverse',
      description: `Lowest-risk path from the landing point through ${grid.stations.length - 1} science stop${
        grid.stations.length === 2 ? '' : 's'
      }, keeping to gentle ground and avoiding anything steeper than 25°.`,
      color: ROUTE_COLORS.recommended,
      cells: planned.cells,
      stopCells: planned.stopCells, // grid cell of each stop, in order (used to walk stop to stop in VR)
      stats: routeStats(grid, planned.cells),
      cellM,
      stops: grid.stations.map((s, k) => ({
        name: k === 0 ? s.name : `Stop ${k}: ${s.name}`,
        note: s.moved_m ? `moved ${(s.moved_m / 1000).toFixed(1)} km onto the terrain data` : null,
      })),
    })
  }
  if (grid.reference) {
    const cells = cellsFromPolyline(grid, grid.reference.rc)
    if (cells.length > 1) {
      routes.push({
        id: 'reference',
        kind: 'reference',
        name: grid.reference.name,
        description: 'The path the rover actually drove inside this area, from NASA mission data.',
        color: ROUTE_COLORS.reference,
        thin: true,
        cells,
        stats: routeStats(grid, cells),
        cellM,
      })
    }
  }
  return routes
}

/** A user-planned route through `points` ([row, col]), or { error }. `n` numbers its name. */
export function customRoute(grid, points, n) {
  const planned = planRoute(grid, points)
  if (planned.error) return { error: planned.error }
  return {
    route: {
      id: `custom-${Date.now()}`,
      kind: 'custom',
      name: `Your route ${n}`,
      description: `Safest path through your ${points.length} points, in the order you placed them.`,
      color: ROUTE_COLORS.custom,
      cells: planned.cells,
      stopCells: planned.stopCells,
      stats: routeStats(grid, planned.cells),
      cellM: Math.round(grid.cw),
      stops: points.map((_, k) => ({ name: k === 0 ? 'Start' : k === points.length - 1 ? 'End' : `Point ${k + 1}` })),
    },
  }
}
