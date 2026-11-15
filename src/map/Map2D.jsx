import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Top-down site map for tablets. World units are meters, origin at the north-west cell centre,
// x east, y south (so north is up). Grid point (row, col) sits at (col * cw, row * ch).

const MIN_WIDTH_M = 250 // most zoomed in: about 250 m across the screen
const TAP_SLOP_PX = 10 // a touch that moves less than this is a tap, not a pan

/** Moving-average smoothing so the 8-connected staircase reads as a path. */
function routePoints(grid, cells) {
  const pts = cells.map((i) => [Math.floor(i / grid.cols), i % grid.cols])
  return pts
    .map((_, k) => {
      let r = 0
      let c = 0
      let n = 0
      for (let j = Math.max(0, k - 2); j <= Math.min(pts.length - 1, k + 2); j++) {
        r += pts[j][0]
        c += pts[j][1]
        n++
      }
      return `${((c / n) * grid.cw).toFixed(1)},${((r / n) * grid.ch).toFixed(1)}`
    })
    .join(' ')
}

/** A round scale-bar length (1, 2 or 5 × 10^n meters) close to `target` meters. */
function niceLength(target) {
  const p = 10 ** Math.floor(Math.log10(target))
  const n = target / p
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p
}

export default function Map2D({
  grid,
  textureUrl,
  routes,
  selectedId,
  stations,
  draft,
  draftLabels,
  probe,
  drawing,
  showHazards,
  onRouteClick,
  onTerrainClick,
  onGroundClick,
  onEmptyClick,
  onReady,
}) {
  const svgRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState(null) // { x, y, w }: top-left corner and width of the visible area, meters
  const viewRef = useRef(view) // latest view for gesture handlers
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const worldW = grid.cols * grid.cw
  const worldH = grid.rows * grid.ch
  const hazards = useMemo(() => grid.hazardCanvas().toDataURL(), [grid])

  // --- view helpers ----------------------------------------------------
  // Screen space the side panels cover, so fitted content lands in the visible part of the map.
  const padding = useMemo(() => {
    if (size.w <= 760) return { l: 16, r: 16, t: 16, b: size.h * 0.5 } // panels are bottom sheets
    return { l: 332, r: selectedId ? 360 : 80, t: 24, b: 56 }
  }, [size, selectedId])

  /** View that fits a box (meters) into the unobstructed part of the screen. */
  const boxView = useCallback(
    ([x0, y0, x1, y1]) => {
      const availW = Math.max(size.w - padding.l - padding.r, 100)
      const availH = Math.max(size.h - padding.t - padding.b, 100)
      const k = Math.max((x1 - x0) / availW, (y1 - y0) / availH)
      return {
        x: x0 - padding.l * k - (availW * k - (x1 - x0)) / 2,
        y: y0 - padding.t * k - (availH * k - (y1 - y0)) / 2,
        w: Math.min(Math.max(k * size.w, MIN_WIDTH_M), Math.max(worldW, worldH) * 3),
      }
    },
    [size, padding, worldW, worldH],
  )

  // Smooth camera moves; any touch or wheel cancels them.
  const anim = useRef(null)
  const stopAnim = () => cancelAnimationFrame(anim.current)
  const animateTo = useCallback((target) => {
    cancelAnimationFrame(anim.current)
    const from = viewRef.current
    if (!from) {
      setView(target)
      return
    }
    const start = performance.now()
    const step = (now) => {
      const t = Math.min((now - start) / 450, 1)
      const e = 1 - (1 - t) ** 3
      setView({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
      })
      if (t < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => () => cancelAnimationFrame(anim.current), [])

  const siteBox = useMemo(
    () => [-grid.cw / 2, -grid.ch / 2, worldW - grid.cw / 2, worldH - grid.ch / 2],
    [grid, worldW, worldH],
  )
  const fit = useCallback(() => {
    if (size.w) animateTo(boxView(siteBox))
  }, [size, animateTo, boxView, siteBox])

  // Selecting a route frames it between the panels.
  const selectedRoute = routes.find((r) => r.id === selectedId)
  useEffect(() => {
    if (!selectedRoute || !size.w) return
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const i of selectedRoute.cells) {
      const x = (i % grid.cols) * grid.cw
      const y = Math.floor(i / grid.cols) * grid.ch
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    const margin = Math.max(x1 - x0, y1 - y0) * 0.12 + 60
    animateTo(boxView([x0 - margin, y0 - margin, x1 + margin, y1 + margin]))
    // only when the selection changes, not on every resize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoute?.id])

  useEffect(() => {
    const svg = svgRef.current
    const ro = new ResizeObserver(() => setSize({ w: svg.clientWidth, h: svg.clientHeight }))
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (size.w && !viewRef.current) setView(boxView(siteBox)) // first layout: frame the whole site
  }, [size, boxView, siteBox])

  const maxW = Math.max(worldW, worldH) * 3
  const zoomAt = useCallback(
    (factor, px, py) => {
      setView((v) => {
        if (!v) return v
        const k = v.w / size.w
        const wx = v.x + px * k
        const wy = v.y + py * k
        const w = Math.min(Math.max(v.w * factor, MIN_WIDTH_M), maxW)
        const k2 = w / size.w
        return { x: wx - px * k2, y: wy - py * k2, w }
      })
    },
    [size, maxW],
  )

  // --- gestures: one finger pans, two fingers pinch; mouse wheel zooms --
  const pointers = useRef(new Map())
  const gesture = useRef(null)

  const local = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  const onPointerDown = (e) => {
    stopAnim()
    svgRef.current.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    if (pointers.current.size === 1) {
      gesture.current = {
        start: local(e),
        moved: false,
        routeId: e.target.closest?.('[data-route]')?.dataset.route ?? null,
      }
    } else if (gesture.current) {
      gesture.current.moved = true // a second finger means pinch, never a tap
    }
  }

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId) || !viewRef.current) return
    const prev = [...pointers.current.values()]
    pointers.current.set(e.pointerId, local(e))
    const next = [...pointers.current.values()]
    const g = gesture.current
    if (g && Math.hypot(next[0][0] - g.start[0], next[0][1] - g.start[1]) > TAP_SLOP_PX) g.moved = true
    if (!g?.moved) return

    if (next.length === 1) {
      const k = viewRef.current.w / size.w
      const dx = next[0][0] - prev[0][0]
      const dy = next[0][1] - prev[0][1]
      setView((v) => ({ ...v, x: v.x - dx * k, y: v.y - dy * k }))
    } else if (next.length >= 2) {
      const mid = (p) => [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2]
      const dist = (p) => Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1
      const [mx0, my0] = mid(prev)
      const [mx1, my1] = mid(next)
      const k = viewRef.current.w / size.w
      setView((v) => ({ ...v, x: v.x - (mx1 - mx0) * k, y: v.y - (my1 - my0) * k }))
      zoomAt(dist(prev) / dist(next), mx1, my1)
    }
  }

  const onPointerUp = (e) => {
    const g = gesture.current
    const wasSingle = pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    if (!g || g.moved || !wasSingle || !viewRef.current) return

    const [px, py] = local(e)
    const v = viewRef.current
    const k = v.w / size.w
    const wx = v.x + px * k
    const wy = v.y + py * k
    if (drawing) onTerrainClick?.([wy / grid.ch, wx / grid.cw])
    else if (g.routeId) onRouteClick?.(g.routeId)
    else if (wx >= -grid.cw / 2 && wy >= -grid.ch / 2 && wx <= worldW - grid.cw / 2 && wy <= worldH - grid.ch / 2)
      onGroundClick?.([wy / grid.ch, wx / grid.cw])
    else onEmptyClick?.()
  }

  const onPointerCancel = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
  }

  useEffect(() => {
    const svg = svgRef.current
    const onWheel = (e) => {
      e.preventDefault()
      cancelAnimationFrame(anim.current)
      const rect = svg.getBoundingClientRect()
      zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // --- drawing ----------------------------------------------------------
  // Routes don't depend on the zoom (strokes are non-scaling), so they are memoised separately.
  const routeEls = useMemo(
    () =>
      routes.map((route) => {
        const selected = route.id === selectedId
        const dimmed = selectedId && !selected
        const points = routePoints(grid, route.cells)
        const width = (route.thin ? 3 : 5) + (selected ? 3 : 0)
        return (
          <g key={route.id} opacity={dimmed ? 0.45 : 1}>
            <polyline points={points} className="map2d-casing" strokeWidth={width + 4} />
            <polyline points={points} className="map2d-route" stroke={route.color} strokeWidth={width} />
            <polyline points={points} className="map2d-hit" data-route={route.id} />
          </g>
        )
      }),
    [routes, selectedId, grid],
  )

  const k = view && size.w ? view.w / size.w : 1 // meters per screen pixel
  const scaleM = niceLength(110 * k)

  return (
    <div className="map2d">
      <svg
        ref={svgRef}
        className={`map2d-svg${drawing ? ' is-drawing' : ''}`}
        viewBox={view && size.w ? `${view.x} ${view.y} ${view.w} ${(view.w * size.h) / size.w}` : '0 0 1 1'}
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        role="img"
        aria-label="Top-down map of the landing site with routes"
      >
        <image
          href={textureUrl}
          x={-grid.cw / 2}
          y={-grid.ch / 2}
          width={worldW}
          height={worldH}
          preserveAspectRatio="none"
          onLoad={() => onReady?.()}
        />
        {showHazards && (
          <image href={hazards} x={-grid.cw / 2} y={-grid.ch / 2} width={worldW} height={worldH} preserveAspectRatio="none" />
        )}

        {routeEls}

        {stations.map((st, i) => {
          const x = st.rc[1] * grid.cw
          const y = st.rc[0] * grid.ch
          const text = i === 0 ? (/landing/i.test(st.name) ? st.name : `${st.name} (landing)`) : `Stop ${i}`
          return (
            <g key={st.name} className="map2d-station">
              <circle cx={x} cy={y} r={7 * k} className={i === 0 ? 'is-landing' : ''} />
              <text x={x + 11 * k} y={y + 5 * k} fontSize={14 * k} strokeWidth={4 * k}>
                {text}
              </text>
            </g>
          )
        })}

        {draft.length > 1 && (
          <polyline
            points={draft.map(([r, c]) => `${c * grid.cw},${r * grid.ch}`).join(' ')}
            className="map2d-draft-line"
          />
        )}
        {draft.map(([r, c], i) => {
          const text = draftLabels?.[i] ?? String(i + 1)
          const long = text.length > 2 // "Start" / "End": written beside the dot instead of in it
          return (
            <g key={i} className={`map2d-draft${long ? ' is-end' : ''}`}>
              <circle cx={c * grid.cw} cy={r * grid.ch} r={(long ? 9 : 12) * k} />
              <text
                x={c * grid.cw + (long ? 14 * k : 0)}
                y={r * grid.ch + 5 * k}
                fontSize={14 * k}
                textAnchor={long ? 'start' : 'middle'}
                strokeWidth={long ? 4 * k : undefined}
              >
                {text}
              </text>
            </g>
          )
        })}
        {probe && (
          <g className="map2d-probe">
            <circle cx={probe[1] * grid.cw} cy={probe[0] * grid.ch} r={8 * k} strokeWidth={3 * k} />
          </g>
        )}
      </svg>

      <div className="map2d-controls">
        <button type="button" onClick={() => zoomAt(1 / 1.6, size.w / 2, size.h / 2)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomAt(1.6, size.w / 2, size.h / 2)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={fit} aria-label="Show whole site">
          ⤢
        </button>
      </div>

      <div className="map2d-legend" aria-hidden="true">
        <span className="map2d-north">N ↑</span>
        <span className="map2d-scale">
          <span style={{ width: `${scaleM / k}px` }} />
          {scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`}
        </span>
        {showHazards && (
          <span className="map2d-key">
            <i className="key-amber" /> 15–25° <i className="key-red" /> over 25°
          </span>
        )}
      </div>
    </div>
  )
}
