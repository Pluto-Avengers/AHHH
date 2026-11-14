import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { XR, createXRStore } from '@react-three/xr'
import { SITES } from '../map/sites.js'
import { loadSite } from '../map/loadSite.js'
import { builtInRoutes, customRoute } from '../map/routes.js'
import { makeSurface, makeWalkPath } from '../vr/surface.js'
import { MarsSurface, PlayerRig, SessionWatcher, Walker } from '../vr/MarsWorld.jsx'
import { MapWindow, MissionPanel } from '../vr/Windows.jsx'
import '../vr/vr.css'

// One XR session for the page. Hands (and controllers, if they work) get laser pointers:
// a pinch fires the same onClick a mouse click does, so every action works by hand.
const store = createXRStore({ emulate: false })

const SPEEDS = [1, 3, 10] // walking speed multipliers (1× = real suited walking pace)

/** 'yes' | 'no' | 'insecure' (WebXR needs https or localhost) | 'checking' */
function useVRSupport() {
  const [support, setSupport] = useState(() =>
    !window.isSecureContext ? 'insecure' : !navigator.xr ? 'no' : 'checking',
  )
  useEffect(() => {
    if (support !== 'checking') return
    navigator.xr
      .isSessionSupported('immersive-vr')
      .then((ok) => setSupport(ok ? 'yes' : 'no'))
      .catch(() => setSupport('no'))
  }, [support])
  return support
}

/** Where you start at a site: the landing point, facing the first stop. */
function startPose(grid) {
  const [a, b] = grid.stations
  const heading = b ? Math.atan2((b.rc[1] - a.rc[1]) * grid.cw, -(b.rc[0] - a.rc[0]) * grid.ch) : 0
  return { r: a.rc[0], c: a.rc[1], heading }
}

export default function VRPage() {
  const support = useVRSupport()
  const [siteId, setSiteId] = useState(SITES[0].id)
  const [loaded, setLoaded] = useState(null) // { id, data } | { id, error }
  const [customRoutes, setCustomRoutes] = useState({}) // { [siteId]: route[] }
  const [selectedId, setSelectedId] = useState(null)
  const [planning, setPlanning] = useState(false)
  const [draft, setDraft] = useState([])
  const [message, setMessage] = useState(null)
  const [showHazards, setShowHazards] = useState(false)
  const [resetKey, setResetKey] = useState(0) // bump to bring the windows in front of you
  const [snap, setSnap] = useState(null) // 4×/s copy of where you are and how the walk is going

  // Live state, changed every frame by the walker and the rig (not React state).
  const playerRef = useRef({ r: 0, c: 0, heading: 0 })
  const walkRef = useRef({ routeId: null, path: null, s: 0, sim: 0, playing: false, speed: 3, onRoute: false })

  const site = SITES.find((s) => s.id === siteId)

  useEffect(() => {
    let cancelled = false
    loadSite(siteId)
      .then((d) => {
        if (cancelled) return
        playerRef.current = startPose(d.grid) // before the rig mounts for this site
        walkRef.current = { ...walkRef.current, routeId: null, path: null, s: 0, sim: 0, playing: false, onRoute: false }
        setSnap({ player: { ...playerRef.current }, walk: { ...walkRef.current } })
        setLoaded({ id: siteId, data: d })
      })
      .catch((e) => !cancelled && setLoaded({ id: siteId, error: e.message }))
    return () => {
      cancelled = true
    }
  }, [siteId])

  const current = loaded?.id === siteId ? loaded : null
  const data = current?.data
  const grid = data?.grid
  const surface = useMemo(() => (grid ? makeSurface(grid) : null), [grid])
  const mine = useMemo(() => customRoutes[siteId] ?? [], [customRoutes, siteId])
  const builtIn = useMemo(() => (grid ? builtInRoutes(grid) : []), [grid])
  const routes = useMemo(() => [...builtIn, ...mine], [builtIn, mine])
  const paths = useMemo(
    () => (surface ? Object.fromEntries(routes.map((r) => [r.id, makeWalkPath(grid, surface, r)])) : {}),
    [grid, surface, routes],
  )
  const selected = routes.find((r) => r.id === selectedId)

  // Refresh the map and EVA readout a few times a second.
  useEffect(() => {
    const id = setInterval(() => setSnap({ player: { ...playerRef.current }, walk: { ...walkRef.current } }), 250)
    return () => clearInterval(id)
  }, [])

  // ---- moving ----------------------------------------------------------------
  const placeOnRoute = (s) => {
    const w = walkRef.current
    w.s = s
    w.onRoute = true
    const at = w.path.at(s)
    playerRef.current.r = at.r
    playerRef.current.c = at.c
  }
  const moveTo = ([r, c]) => {
    if (!surface.hasData(r, c)) return setMessage('No terrain data there. Pick a spot inside the mapped area.')
    playerRef.current.r = r
    playerRef.current.c = c
    walkRef.current.playing = false
    walkRef.current.onRoute = false
    setMessage(null)
  }

  // ---- routes ------------------------------------------------------------------
  const selectRoute = (id) => {
    setSelectedId(id)
    setMessage(null)
    walkRef.current = { ...walkRef.current, routeId: id, path: id ? paths[id] : null, s: 0, sim: 0, playing: false, onRoute: false }
  }
  const walkToggle = () => {
    const w = walkRef.current
    if (!w.path) return
    if (!w.onRoute || w.s >= w.path.length - 0.5) {
      w.sim = 0
      placeOnRoute(0)
      w.playing = true
    } else {
      w.playing = !w.playing
    }
    setMessage(null)
  }
  const cycleSpeed = () => {
    const w = walkRef.current
    w.speed = SPEEDS[(SPEEDS.indexOf(w.speed) + 1) % SPEEDS.length]
  }
  const restart = () => {
    const w = walkRef.current
    if (!w.path) return
    w.playing = false
    w.sim = 0
    placeOnRoute(0)
  }
  const jumpStop = (dir) => {
    const w = walkRef.current
    if (!w.path) return
    const stops = w.path.stopDist.length ? w.path.stopDist : [0, w.path.length]
    const here = w.onRoute ? w.s : -1
    const target = dir > 0 ? stops.find((d) => d > here + 1) : [...stops].reverse().find((d) => d < here - 1)
    w.playing = false
    placeOnRoute(target ?? (dir > 0 ? w.path.length : 0))
  }
  const onArrive = useCallback(() => setMessage('You reached the end of the route.'), [])

  // ---- planning -----------------------------------------------------------------
  const onMapPoint = ([r, c]) => {
    if (!planning) return moveTo([r, c])
    if (!surface.hasData(r, c)) return setMessage('No terrain data there. Place points on the mapped area.')
    const slope = surface.slopeAt(r, c)
    setMessage(slope > 25 ? 'Steeper than 25° there: the route will start from the nearest safe ground.' : null)
    setDraft((d) => [...d, [r, c]])
  }
  const startPlanning = () => {
    setPlanning(true)
    setDraft([])
    setMessage(null)
  }
  const cancelPlanning = () => {
    setPlanning(false)
    setDraft([])
    setMessage(null)
  }
  const createRoute = () => {
    const { route, error } = customRoute(grid, draft, mine.length + 1)
    if (error) return setMessage(error)
    const next = [...mine, route]
    setCustomRoutes((all) => ({ ...all, [siteId]: next }))
    setPlanning(false)
    setDraft([])
    setMessage(`${route.name} created. Press Walk to try it.`)
    setSelectedId(route.id)
    walkRef.current = {
      ...walkRef.current,
      routeId: route.id,
      path: makeWalkPath(grid, surface, route),
      s: 0,
      sim: 0,
      playing: false,
      onRoute: false,
    }
  }
  const deleteRoute = () => {
    setCustomRoutes((all) => ({ ...all, [siteId]: mine.filter((r) => r.id !== selectedId) }))
    selectRoute(null)
  }
  const changeSite = (id) => {
    if (id === siteId) return
    setSiteId(id)
    setSelectedId(null)
    setPlanning(false)
    setDraft([])
    setMessage(null)
  }

  // Entering VR: bring the windows in front of wherever you're facing.
  const onSession = useCallback((session) => {
    if (session) setTimeout(() => setResetKey((k) => k + 1), 700)
  }, [])

  // ---- EVA readout ----------------------------------------------------------------
  const player = snap?.player ?? { r: 0, c: 0, heading: 0 }
  const walk = snap?.walk ?? { playing: false, speed: 3, s: 0, sim: 0 }
  const onRoute = selected && walk.routeId === selected.id && walk.onRoute
  const path = selected ? paths[selected.id] : null
  let nextStop = null
  if (onRoute && path) {
    const idx = path.stopDist.findIndex((d) => d > walk.s + 1)
    if (idx !== -1) {
      const name = selected.kind === 'recommended' ? (idx === 0 ? 'Landing' : `Stop ${idx}`) : selected.stops[idx].name
      nextStop = { name, in: path.stopDist[idx] - walk.s }
    }
  }
  const eva = {
    route: selected ?? null,
    walked: onRoute ? walk.s : 0,
    length: path?.length ?? 0,
    simSeconds: onRoute ? walk.sim : 0,
    playing: walk.playing,
    speed: walk.speed,
    elevation: surface ? surface.elevationAt(player.r, player.c) : null,
    slope: surface ? surface.slopeAt(player.r, player.c) : null,
    nextStop,
  }
  const tick = snap ? `${player.r.toFixed(1)},${player.c.toFixed(1)},${(player.heading ?? 0).toFixed(1)},${walk.s.toFixed(0)}` : '0'

  return (
    <div className="vr-page">
      <Canvas camera={{ fov: 70, near: 0.05, far: 15000 }} className="vr-canvas">
        <XR store={store}>
          <SessionWatcher onChange={onSession} />
          {grid && surface && (
            <>
              <MarsSurface
                grid={grid}
                textureUrl={data.textureUrl}
                surface={surface}
                routes={routes}
                paths={paths}
                selectedId={selectedId}
                showHazards={showHazards}
                draft={draft}
                onGroundPick={moveTo}
              />
              <Walker walkRef={walkRef} playerRef={playerRef} onArrive={onArrive} />
              <PlayerRig key={grid.id} surface={surface} playerRef={playerRef}>
                <MapWindow
                  site={site}
                  grid={grid}
                  textureUrl={data.textureUrl}
                  routes={routes}
                  selectedId={selectedId}
                  draft={draft}
                  planning={planning}
                  showHazards={showHazards}
                  player={player}
                  tick={tick}
                  message={message}
                  resetKey={`${resetKey}|${grid.id}`}
                  onMapPoint={onMapPoint}
                  onPlan={startPlanning}
                  onUndo={() => setDraft((d) => d.slice(0, -1))}
                  onCreate={createRoute}
                  onCancel={cancelPlanning}
                />
                <MissionPanel
                  sites={SITES}
                  siteId={siteId}
                  onSite={changeSite}
                  routes={routes}
                  selectedId={selectedId}
                  onSelectRoute={selectRoute}
                  walk={walk}
                  tick={tick}
                  eva={eva}
                  showHazards={showHazards}
                  onToggleHazards={() => setShowHazards((v) => !v)}
                  onWalkToggle={walkToggle}
                  onSpeed={cycleSpeed}
                  onRestart={restart}
                  onPrevStop={() => jumpStop(-1)}
                  onNextStop={() => jumpStop(1)}
                  onBringWindows={() => setResetKey((k) => k + 1)}
                  canDelete={selected?.kind === 'custom'}
                  onDelete={deleteRoute}
                  resetKey={`${resetKey}|${grid.id}`}
                />
              </PlayerRig>
            </>
          )}
        </XR>
      </Canvas>

      {!grid && <p className="vr-loading">{current?.error ?? `Landing at ${site.name}…`}</p>}

      <section className="vr-intro">
        <h1>Walk on Mars</h1>
        <p className="muted">
          Stand on the landing site at real scale, walk the planned route as an astronaut, or plan your own on the map
          window. Works with hands only: pinch to press.
        </p>
        <button
          type="button"
          className="button"
          disabled={support !== 'yes'}
          onClick={() => store.enterVR().catch((e) => setMessage(`Couldn't start VR: ${e.message}`))}
        >
          Enter VR
        </button>
        <p className="vr-support muted">
          {support === 'yes' && 'Headset ready. Put it on after pressing Enter VR.'}
          {support === 'checking' && 'Checking for a VR headset…'}
          {support === 'no' && 'No VR headset in this browser. Open this page in the Meta Quest Browser to enter VR. Preview here: drag to look around, click to press.'}
          {support === 'insecure' && 'VR needs a secure page: use npm run quest (https) or http://localhost.'}
        </p>
      </section>
    </div>
  )
}
