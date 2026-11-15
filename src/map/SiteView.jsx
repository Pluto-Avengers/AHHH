import { useEffect, useMemo, useState } from 'react'
import { loadSite } from './loadSite.js'
import { builtInRoutes, customRoute } from './routes.js'
import TerrainScene from './TerrainScene.jsx'
import { VERTICAL_EXAGGERATION } from './terrainMesh.js'
import RouteInfo from './RouteInfo.jsx'
import Map2D from './Map2D.jsx'
import MartialChat from './MartialChat.jsx'

// 3D terrain or the 2D tablet map. Touch devices start in 2D; the last choice is remembered.
const MODE_KEY = 'mps-site-view'
function initialMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === '2d' || saved === '3d') return saved
  } catch {
    // storage unavailable: fall through to the device default
  }
  return window.matchMedia?.('(pointer: coarse)').matches ? '2d' : '3d'
}

export default function SiteView({ site, customRoutes, onCustomRoutesChange, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState([])
  const [message, setMessage] = useState(null)
  const [mode, setMode] = useState(initialMode)
  const [showHazards, setShowHazards] = useState(false)

  const changeMode = (m) => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // storage unavailable (private mode): the choice just isn't remembered
    }
  }

  useEffect(() => {
    let cancelled = false
    loadSite(site.id)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [site.id])

  const grid = data?.grid
  const builtIn = useMemo(() => (grid ? builtInRoutes(grid) : []), [grid])
  const routes = useMemo(() => [...builtIn, ...customRoutes], [builtIn, customRoutes])
  const selected = routes.find((r) => r.id === selectedId)

  const startDrawing = () => {
    setDrawing(true)
    setDraft([])
    setSelectedId(null)
    setMessage(null)
  }
  const cancelDrawing = () => {
    setDrawing(false)
    setDraft([])
    setMessage(null)
  }
  const createRoute = () => {
    const { route, error } = customRoute(grid, draft, customRoutes.filter((r) => !r.agent).length + 1)
    if (error) {
      setMessage(error)
      return
    }
    onCustomRoutesChange([...customRoutes, route])
    setDrawing(false)
    setDraft([])
    setMessage(null)
    setSelectedId(route.id)
  }
  // Martial planned or chose a route: add it to the map (once) and select it.
  const addAgentRoute = (route) => {
    if (!routes.some((r) => r.id === route.id)) onCustomRoutesChange([...customRoutes, route])
    setDrawing(false)
    setSelectedId(route.id)
  }
  const deleteRoute = (id) => {
    onCustomRoutesChange(customRoutes.filter((r) => r.id !== id))
    setSelectedId(null)
  }

  const addPoint = ([r, c]) => {
    const i = grid.index(Math.round(r), Math.round(c))
    if (!grid.inBounds(Math.round(r), Math.round(c)) || !grid.hasData(i)) {
      setMessage('There is no terrain data there. Place points inside the mapped area.')
      return
    }
    setMessage(grid.passable(i) ? null : 'That spot is steeper than 25°. The route will start from the nearest safe ground.')
    setDraft((d) => [...d, [r, c]])
  }

  return (
    <div
      className={`site-view is-${mode}${ready ? ' is-ready' : ''}${selected || drawing ? ' has-overlay' : ''}`}
    >
      {grid && mode === '3d' && (
        <TerrainScene
          grid={grid}
          textureUrl={data.textureUrl}
          routes={routes}
          selectedId={selectedId}
          stations={grid.stations}
          draft={draft}
          drawing={drawing}
          onRouteClick={setSelectedId}
          onTerrainClick={addPoint}
          onEmptyClick={() => setSelectedId(null)}
          onReady={() => setReady(true)}
        />
      )}
      {grid && mode === '2d' && (
        <Map2D
          grid={grid}
          textureUrl={data.textureUrl}
          routes={routes}
          selectedId={selectedId}
          stations={grid.stations}
          draft={draft}
          drawing={drawing}
          showHazards={showHazards}
          onRouteClick={setSelectedId}
          onTerrainClick={addPoint}
          onEmptyClick={() => setSelectedId(null)}
          onReady={() => setReady(true)}
        />
      )}

      {!ready && <p className="site-loading">{error ?? 'Loading terrain…'}</p>}

      <section className="map-panel site-panel">
        <button type="button" className="text-button" onClick={onBack}>
          ← Back to Mars
        </button>
        <h1>{site.name}</h1>
        <p className="muted">{site.mission}</p>
        <p className="site-summary">{site.summary}</p>

        <div className="view-toggle" role="group" aria-label="View">
          <button type="button" aria-pressed={mode === '3d'} onClick={() => changeMode('3d')}>
            3D terrain
          </button>
          <button type="button" aria-pressed={mode === '2d'} onClick={() => changeMode('2d')}>
            2D map (tablet)
          </button>
        </div>
        {mode === '2d' && (
          <label className="hazard-toggle">
            <input type="checkbox" checked={showHazards} onChange={(e) => setShowHazards(e.target.checked)} />
            Show steep ground
          </label>
        )}

        {grid && (
          <>
            <h2>Routes</h2>
            <ul className="route-list">
              {routes.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={r.id === selectedId ? 'is-selected' : ''}
                    onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                  >
                    <span className="swatch" style={{ background: r.color }} />
                    <span className="route-list-name">{r.name}</span>
                    <span className="muted">{(r.stats.distanceM / 1000).toFixed(1)} km</span>
                  </button>
                </li>
              ))}
            </ul>
            {!drawing && (
              <button type="button" className="button" onClick={startDrawing}>
                Plan your own route
              </button>
            )}
          </>
        )}
      </section>

      {drawing && (
        <div className="draw-bar" role="status">
          <p>
            {draft.length === 0
              ? `${mode === '2d' ? 'Tap' : 'Click'} the terrain to place your start point.`
              : `${draft.length} point${draft.length === 1 ? '' : 's'} placed. Keep ${mode === '2d' ? 'tapping' : 'clicking'} to add stops.`}
          </p>
          {message && <p className="draw-message">{message}</p>}
          <div className="draw-actions">
            <button type="button" className="text-button" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length}>
              Undo
            </button>
            <button type="button" className="text-button" onClick={cancelDrawing}>
              Cancel
            </button>
            <button type="button" className="button" onClick={createRoute} disabled={draft.length < 2}>
              Create route
            </button>
          </div>
        </div>
      )}

      {selected && !drawing && (
        <RouteInfo
          route={selected}
          onClose={() => setSelectedId(null)}
          onDelete={selected.kind === 'custom' ? () => deleteRoute(selected.id) : null}
        />
      )}

      {grid && (
        <MartialChat
          site={site}
          grid={grid}
          routes={routes}
          onRoute={addAgentRoute}
          onHighlight={(id) => {
            setDrawing(false)
            setSelectedId(id)
          }}
        />
      )}

      {mode === '3d' && (
        <p className="scene-hint">
          Drag to orbit · right-drag to pan · scroll to zoom · height ×{VERTICAL_EXAGGERATION}
        </p>
      )}
    </div>
  )
}
