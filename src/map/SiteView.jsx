import { useEffect, useMemo, useState } from 'react'
import { siteLoader } from '../core/SiteLoader.js'
import RoutePlanner from '../core/RoutePlanner.js'
import RouteDraft from '../core/RouteDraft.js'
import Coordinates from '../core/Coordinates.js'
import CoordinateSearch from './CoordinateSearch.jsx'
import TerrainScene from './TerrainScene.jsx'
import RouteInfo from './RouteInfo.jsx'
import Map2D from './Map2D.jsx'
import MartialChat from './martial/MartialChat.jsx'
import PointCard from './PointCard.jsx'

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

/** focusPoint: { lat, lon } to pin once the terrain loads (a point found with the world-map search). */
export default function SiteView({ site, customRoutes, onCustomRoutesChange, onBack, focusPoint = null }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState(() => new RouteDraft()) // start, stops and destination of a route being planned
  const [placing, setPlacing] = useState('start') // what the next click places: 'start' | 'stop' | 'end'
  const [message, setMessage] = useState(null)
  const [mode, setMode] = useState(initialMode)
  const [showHazards, setShowHazards] = useState(false)
  const [probe, setProbe] = useState(null) // [row, col] of the point last clicked: its coordinates are shown
  // The right side holds Martial's chat and the route details. When both are open, the one in
  // `focus` is expanded and the other shrinks to a chip in the bottom-right corner.
  const [chatOpen, setChatOpen] = useState(false)
  const [focus, setFocus] = useState('chat')

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
    siteLoader.load(site.id)
      .then((d) => {
        if (cancelled) return
        setData(d)
        if (focusPoint && d.grid.contains(focusPoint.lat, focusPoint.lon)) setProbe(d.grid.gridAt(focusPoint.lat, focusPoint.lon))
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
    // focusPoint only matters when the site first opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id])

  const grid = data?.grid
  const builtIn = useMemo(() => (grid ? new RoutePlanner(grid).builtInRoutes() : []), [grid])
  const routes = useMemo(() => [...builtIn, ...customRoutes], [builtIn, customRoutes])
  const selected = routes.find((r) => r.id === selectedId)
  const draftPoints = useMemo(() => draft.points, [draft])
  const draftLabels = useMemo(() => draft.labels, [draft])

  const infoShown = Boolean(selected && !drawing)
  const chatMinimized = chatOpen && infoShown && focus === 'info'
  const infoMinimized = infoShown && chatOpen && focus === 'chat'
  const rightPanel = (chatOpen && !chatMinimized) || (infoShown && !infoMinimized)
  const corner = chatMinimized || infoMinimized || (infoShown && !chatOpen) // something in the bottom-right

  // The user picked a route: its details take the right side (Martial, if open, shrinks).
  const selectRoute = (id) => {
    setSelectedId(id)
    if (id) setFocus('info')
  }
  const openChat = () => {
    setChatOpen(true)
    setFocus('chat')
  }

  /** Starts planning, optionally with a first point already in a role (from the point card). */
  const startDrawing = (role = null, point = null) => {
    const first = role && point ? new RouteDraft().place(role, point) : new RouteDraft()
    setDrawing(true)
    setDraft(first)
    setPlacing(first.suggestedRole)
    setSelectedId(null)
    setProbe(null)
    setMessage(null)
  }
  const cancelDrawing = () => {
    setDrawing(false)
    setDraft(new RouteDraft())
    setMessage(null)
  }
  const createRoute = () => {
    const { route, error } = new RoutePlanner(grid).customRoute(
      draft.points,
      customRoutes.filter((r) => !r.agent).length + 1,
      draft.stopNames,
    )
    if (error) {
      setMessage(error)
      return
    }
    onCustomRoutesChange([...customRoutes, route])
    setDrawing(false)
    setDraft(new RouteDraft())
    setMessage(null)
    setSelectedId(route.id)
  }
  /** A point typed into the search box: pinned if it is on this site (or placed, while planning). */
  const findInSite = (lat, lon) => {
    const where = Coordinates.point(lat, lon)
    if (!grid.contains(lat, lon)) {
      const km = Coordinates.distanceKm([lat, lon], [site.lat, site.lon])
      return `${where} is outside the ${site.name} map, about ${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()} km from the site.`
    }
    const rc = grid.gridAt(lat, lon)
    if (drawing) {
      addPoint(rc)
      return `${where} placed as the ${placing === 'end' ? 'destination' : placing}.`
    }
    setProbe(rc)
    return `${where} is on the ${site.name} map: it is pinned on the terrain.`
  }

  const undoPoint = () => {
    const next = draft.undo()
    setDraft(next)
    setPlacing(next.suggestedRole)
    setMessage(null)
  }
  // Martial planned or chose a route: add it to the map (once) and select it.
  const addAgentRoute = (route) => {
    if (!routes.some((r) => r.id === route.id)) onCustomRoutesChange([...customRoutes, route])
    setDrawing(false)
    setSelectedId(route.id)
    setFocus('chat')
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
    setMessage(grid.passable(i) ? null : 'That spot is steeper than 25°. The route will use the nearest safe ground.')
    const next = draft.place(placing, [r, c])
    setDraft(next)
    // After the start, go on to the destination; after that, more taps add stops in between.
    setPlacing(placing === 'stop' ? 'stop' : next.suggestedRole)
  }

  return (
    <div
      className={`site-view is-${mode}${ready ? ' is-ready' : ''}${selected || drawing ? ' has-overlay' : ''}${
        rightPanel ? ' has-right' : ''
      }${corner ? ' has-corner' : ''}${infoShown && !chatOpen ? ' launcher-in-corner' : ''}`}
    >
      {grid && mode === '3d' && (
        <TerrainScene
          grid={grid}
          textureUrl={data.textureUrl}
          routes={routes}
          selectedId={selectedId}
          stations={grid.stations}
          draft={draftPoints}
          draftLabels={draftLabels}
          probe={probe}
          drawing={drawing}
          onRouteClick={selectRoute}
          onTerrainClick={addPoint}
          onGroundClick={setProbe}
          onEmptyClick={() => {
            setSelectedId(null)
            setProbe(null)
          }}
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
          draft={draftPoints}
          draftLabels={draftLabels}
          probe={probe}
          drawing={drawing}
          showHazards={showHazards}
          onRouteClick={selectRoute}
          onTerrainClick={addPoint}
          onGroundClick={setProbe}
          onEmptyClick={() => {
            setSelectedId(null)
            setProbe(null)
          }}
          onReady={() => setReady(true)}
        />
      )}

      {!ready && <p className="site-loading">{error ?? 'Loading terrain…'}</p>}

      <section className="map-panel site-panel">
        <button type="button" className="text-button" onClick={onBack}>
          ← Back to Mars
        </button>
        <h1>{site.name}</h1>
        <p className="site-summary">{site.summary}</p>
        {grid && <CoordinateSearch onFind={findInSite} placeholder={Coordinates.point(site.lat, site.lon)} />}

        {site.rover && (
          <section className="rover-card" aria-label={`${site.rover.name} mission data`}>
            <h2>
              {site.rover.name} <span className="rover-agency">{site.rover.agency}</span>
            </h2>
            <dl className="rover-stats">
              {site.rover.stats.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="rover-collected">
              {site.rover.collected.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}

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
            <ul className="route-list">
              {routes.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={r.id === selectedId ? 'is-selected' : ''}
                    onClick={() => selectRoute(r.id === selectedId ? null : r.id)}
                  >
                    <span className="swatch" style={{ background: r.color }} />
                    <span className="route-list-name">{r.name}</span>
                    <span className="muted">{(r.stats.distanceM / 1000).toFixed(1)} km</span>
                  </button>
                </li>
              ))}
            </ul>
            {!drawing && (
              <button type="button" className="button" onClick={() => startDrawing()}>
                Plan your own route
              </button>
            )}
          </>
        )}
      </section>

      {probe && !drawing && (
        <PointCard
          grid={grid}
          point={probe}
          onClose={() => setProbe(null)}
          onStart={() => startDrawing('start', probe)}
          onDestination={() => startDrawing('end', probe)}
        />
      )}

      {drawing && (
        <div className="draw-bar" role="status">
          <div className="draw-roles" role="radiogroup" aria-label={`Each ${mode === '2d' ? 'tap' : 'click'} places`}>
            {[
              ['start', 'Start', Boolean(draft.start)],
              ['stop', 'Stop', draft.stops.length > 0],
              ['end', 'Destination', Boolean(draft.end)],
            ].map(([role, label, set]) => (
              <button
                key={role}
                type="button"
                role="radio"
                aria-checked={placing === role}
                className={`draw-role draw-role-${role}${set ? ' is-set' : ''}`}
                onClick={() => setPlacing(role)}
              >
                {label}
                {role === 'stop' && draft.stops.length > 0 ? ` (${draft.stops.length})` : ''}
              </button>
            ))}
          </div>
          <p>
            {`${mode === '2d' ? 'Tap' : 'Click'} the terrain to ${
              placing === 'start'
                ? draft.start
                  ? 'move the start'
                  : 'place the start'
                : placing === 'end'
                  ? draft.end
                    ? 'move the destination'
                    : 'place the destination'
                  : 'add a stop between the start and the destination'
            }.`}
          </p>
          {message && <p className="draw-message">{message}</p>}
          <div className="draw-actions">
            <button type="button" className="text-button" onClick={undoPoint} disabled={draft.isEmpty}>
              Undo
            </button>
            <button type="button" className="text-button" onClick={cancelDrawing}>
              Cancel
            </button>
            <button type="button" className="button" onClick={createRoute} disabled={!draft.ready}>
              Create route
            </button>
          </div>
        </div>
      )}

      {infoShown && !infoMinimized && (
        <RouteInfo
          route={selected}
          onClose={() => setSelectedId(null)}
          onDelete={selected.kind === 'custom' ? () => deleteRoute(selected.id) : null}
        />
      )}
      {infoMinimized && (
        <button type="button" className="route-chip" onClick={() => setFocus('info')} aria-label="Show route details">
          <span className="swatch" style={{ background: selected.color }} />
          <span>{selected.name}</span>
        </button>
      )}

      {grid && (
        <MartialChat
          site={site}
          grid={grid}
          routes={routes}
          open={chatOpen}
          minimized={chatMinimized}
          onOpen={openChat}
          onClose={() => setChatOpen(false)}
          onRoute={addAgentRoute}
          onHighlight={(id) => {
            setDrawing(false)
            setSelectedId(id)
            setFocus('chat') // Martial's pick: the chat keeps the space, details wait in the corner
          }}
        />
      )}

    </div>
  )
}
