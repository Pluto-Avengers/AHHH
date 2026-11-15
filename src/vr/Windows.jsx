import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { ButtonRow, CanvasPanel, DraggableWindow, TITLE_H, VRButton } from './ui.jsx'
import { isDrag } from './input.js'
import PanelPainter from './PanelPainter.js'

const MAP_W = 0.74 // window width (m)
const MAP_BOX = [0.7, 0.5] // map area inside it (m)
const NEAR_WIDTH_M = 1200 // "Around me" zoom: this many meters across

/**
 * Grid area to show: the whole site, or ~1.2 km around you, letterboxed to the map box.
 * The 'near' view moves in steps (a sixth of its width), so the map image is redrawn only now and
 * then while you walk; the marker for you moves smoothly on top of it (PlayerMarker).
 */
function mapView(grid, player, zoom) {
  const aspect = MAP_BOX[1] / MAP_BOX[0] // height / width
  if (zoom === 'near') {
    const wc = NEAR_WIDTH_M / grid.cw
    const hr = (NEAR_WIDTH_M * aspect) / grid.ch
    const stepC = wc / 6
    const stepR = hr / 6
    const c = Math.round(player.c / stepC) * stepC
    const r = Math.round(player.r / stepR) * stepR
    return { c0: c - wc / 2, c1: c + wc / 2, r0: r - hr / 2, r1: r + hr / 2 }
  }
  const siteW = grid.cols * grid.cw
  const siteH = grid.rows * grid.ch
  const w = Math.max(siteW, siteH / aspect) * 1.02 // meters across
  const h = w * aspect
  const cc = (grid.cols - 1) / 2
  const cr = (grid.rows - 1) / 2
  return { c0: cc - w / grid.cw / 2, c1: cc + w / grid.cw / 2, r0: cr - h / grid.ch / 2, r1: cr + h / grid.ch / 2 }
}

/** You on the map window: an arrow in the direction you face, updated every frame without redrawing the map. */
function PlayerMarker({ playerRef, view, z }) {
  const ref = useRef(null)
  const { arrow, outline, dot, ring } = useMemo(() => {
    const tri = (len, half) => {
      const shape = new THREE.Shape()
      shape.moveTo(0, len)
      shape.lineTo(-half, 0)
      shape.lineTo(half, 0)
      shape.closePath()
      return new THREE.ShapeGeometry(shape)
    }
    return { arrow: tri(0.019, 0.0076), outline: tri(0.022, 0.0095), dot: new THREE.CircleGeometry(0.007, 20), ring: new THREE.CircleGeometry(0.0088, 20) }
  }, [])
  useEffect(() => () => [arrow, outline, dot, ring].forEach((g) => g.dispose()), [arrow, outline, dot, ring])
  useFrame(() => {
    const g = ref.current
    const p = playerRef.current
    if (!g || !p) return
    const u = (p.c - view.c0) / (view.c1 - view.c0)
    const v = (p.r - view.r0) / (view.r1 - view.r0)
    g.visible = u >= 0 && u <= 1 && v >= 0 && v <= 1
    g.position.set((u - 0.5) * MAP_BOX[0], (0.5 - v) * MAP_BOX[1], z)
    g.rotation.z = -(p.heading ?? 0)
  })
  // Transparent pass with a higher render order: drawn after (on top of) the map image, which is transparent too.
  const flat = { toneMapped: false, fog: false, depthTest: false, transparent: true }
  return (
    <group ref={ref} renderOrder={2} raycast={() => {}}>
      <mesh geometry={outline} position={[0, -0.0015, 0]} renderOrder={2} raycast={() => {}}>
        <meshBasicMaterial color="#000000" {...flat} />
      </mesh>
      <mesh geometry={arrow} renderOrder={3} raycast={() => {}}>
        <meshBasicMaterial color="#5ad1ff" {...flat} />
      </mesh>
      <mesh geometry={ring} renderOrder={4} raycast={() => {}}>
        <meshBasicMaterial color="#000000" {...flat} />
      </mesh>
      <mesh geometry={dot} renderOrder={5} raycast={() => {}}>
        <meshBasicMaterial color="#ffffff" {...flat} />
      </mesh>
    </group>
  )
}

/** The 2D map you carry with you: tap to move, or tap to add points to a new route. */
export function MapWindow({
  site,
  grid,
  textureUrl,
  routes,
  selectedId,
  draft,
  planning,
  showHazards,
  player,
  playerRef,
  message,
  resetKey,
  onMapPoint,
  onPlan,
  onUndo,
  onCreate,
  onCancel,
}) {
  const [zoom, setZoom] = useState('site')
  const [image, setImage] = useState(null) // the site's terrain picture, once loaded
  useEffect(() => {
    const img = new Image()
    img.onload = () => setImage(img)
    img.src = textureUrl
    return () => {
      img.onload = null
    }
  }, [textureUrl])
  const hazard = useMemo(() => grid.hazardCanvas(), [grid])

  const view = mapView(grid, player, zoom)
  const viewKey = [view.r0, view.c0, view.r1, view.c1].map((v) => v.toFixed(2)).join(',')
  const top = 0.42 // window is laid out downward from here
  const mapY = top - TITLE_H - 0.01 - MAP_BOX[1] / 2
  const rowY = mapY - MAP_BOX[1] / 2 - 0.04
  const statusY = rowY - 0.058
  const height = top - (statusY - 0.035) // total window height

  const status =
    message ??
    (planning
      ? draft.length < 2
        ? `Tap the map to place point ${draft.length + 1}.`
        : `${draft.length} points. Add more, or press Create route.`
      : '') // the map itself already says "Tap the map to go there"

  const buttons = planning
    ? [
        { key: 'undo', label: 'Undo point', width: 0.16, disabled: !draft.length, onClick: onUndo },
        { key: 'cancel', label: 'Cancel', width: 0.13, onClick: onCancel },
        { key: 'create', label: `Create route (${draft.length})`, width: 0.25, disabled: draft.length < 2, onClick: onCreate },
      ]
    : [{ key: 'plan', label: 'Plan a new route', width: 0.25, onClick: onPlan }]

  return (
    <DraggableWindow
      title={`Map · ${site.name}`}
      width={MAP_W}
      height={height}
      placement={{ angle: -30, distance: 0.8, drop: 0.32 }}
      resetKey={resetKey}
    >
      <group position={[0, height / 2 - top, 0]}>
        <CanvasPanel
          width={MAP_BOX[0]}
          height={MAP_BOX[1]}
          px={1100}
          draw={(ctx, w, h) =>
            new PanelPainter(ctx, w, h).map({
              image,
              hazard: showHazards ? hazard : null,
              grid,
              view,
              routes,
              selectedId,
              stations: grid.stations,
              draft,
              player: null, // drawn by PlayerMarker
              planning,
            })
          }
          drawKey={`${viewKey}|${image?.src}|${selectedId}|${draft.map((p) => p.join()).join(';')}|${planning}|${showHazards}|${routes.map((r) => r.id).join()}|${grid.id}`}
          dynamic
          position={[0, mapY, 0.001]}
          onClick={(e) => {
            if (isDrag(e) || !e.uv) return
            e.stopPropagation()
            onMapPoint([view.r0 + (1 - e.uv.y) * (view.r1 - view.r0), view.c0 + e.uv.x * (view.c1 - view.c0)])
          }}
        />
        <group position={[0, mapY, 0]}>
          <PlayerMarker playerRef={playerRef} view={view} z={0.003} />
        </group>
        <group position={[0, rowY, 0]}>
          <VRButton label="Whole site" width={0.14} height={0.045} active={zoom === 'site'} onClick={() => setZoom('site')} position={[-0.28, 0, 0.001]} />
          <VRButton label="Around me" width={0.14} height={0.045} active={zoom === 'near'} onClick={() => setZoom('near')} position={[-0.13, 0, 0.001]} />
          <group position={[0.17, 0, 0]}>
            <ButtonRow y={0} gap={0.008} buttons={buttons.map((b) => ({ ...b, height: 0.045 }))} />
          </group>
        </group>
        <CanvasPanel
          width={MAP_BOX[0]}
          height={0.05}
          px={1400}
          draw={(ctx, w, h) => new PanelPainter(ctx, w, h).status(status, Boolean(message))}
          drawKey={`${status}|${Boolean(message)}`}
          position={[0, statusY, 0.001]}
        />
      </group>
    </DraggableWindow>
  )
}

/** What the EVA readout shows, rounded as it is displayed: it is redrawn only when this changes. */
function evaKey(eva, selectedId) {
  return [
    selectedId,
    Math.round(eva.walked),
    Math.round(eva.length),
    Math.floor(eva.simSeconds),
    eva.playing,
    eva.speed,
    eva.elevation == null ? '' : Math.round(eva.elevation),
    eva.slope,
    eva.nextStop ? `${eva.nextStop.name}${Math.round(eva.nextStop.in)}` : '',
  ].join('|')
}

/** Sites, routes, walking controls and the live EVA readout. */
export function MissionPanel({
  sites,
  siteId,
  onSite,
  routes,
  selectedId,
  onSelectRoute,
  walk,
  eva,
  showHazards,
  onToggleHazards,
  onWalkToggle,
  onSpeed,
  onRestart,
  onPrevStop,
  onNextStop,
  onBringWindows,
  canDelete,
  onDelete,
  resetKey,
}) {
  const W = 0.56
  const inner = 0.53
  const bh = 0.045
  const gap = 0.008
  const evaH = 0.36

  // Lay out rows top to bottom (y relative to the window's top edge).
  const rows = []
  let y = -TITLE_H - 0.01
  const add = (h, render) => {
    rows.push(render(y - h / 2))
    y -= h + gap
  }
  for (let i = 0; i < sites.length; i += 2) {
    add(bh, (cy) => (
      <ButtonRow
        key={`sites${i}`}
        y={cy}
        gap={gap}
        buttons={sites.slice(i, i + 2).map((s) => ({
          key: s.id,
          label: s.name,
          width: (inner - gap) / 2,
          height: bh,
          active: s.id === siteId,
          onClick: () => onSite(s.id),
        }))}
      />
    ))
  }
  y -= 0.02 // a little space between the sites and the routes
  for (const r of routes) {
    add(bh, (cy) => (
      <VRButton
        key={r.id}
        label={`${r.name}  ·  ${(r.stats.distanceM / 1000).toFixed(1)} km`}
        swatch={r.color}
        width={inner}
        height={bh}
        active={r.id === selectedId}
        onClick={() => onSelectRoute(r.id === selectedId ? null : r.id)}
        position={[0, cy, 0.001]}
      />
    ))
  }
  if (selectedId) {
    y -= 0.02
    add(bh, (cy) => (
      <ButtonRow
        key="walk1"
        y={cy}
        gap={gap}
        buttons={[
          { key: 'walk', label: walk.playing ? '❚❚  Pause' : '▶  Walk', width: 0.2, height: bh, active: walk.playing, onClick: onWalkToggle },
          { key: 'speed', label: `Speed ${walk.speed}×`, width: 0.16, height: bh, onClick: onSpeed },
          { key: 'restart', label: 'Back to start', width: inner - 0.36 - gap * 2, height: bh, onClick: onRestart },
        ]}
      />
    ))
    add(bh, (cy) => (
      <ButtonRow
        key="walk2"
        y={cy}
        gap={gap}
        buttons={[
          { key: 'prev', label: '◀  Previous stop', width: (inner - gap) / 2, height: bh, onClick: onPrevStop },
          { key: 'next', label: 'Next stop  ▶', width: (inner - gap) / 2, height: bh, onClick: onNextStop },
        ]}
      />
    ))
  }
  add(evaH, (cy) => (
    <CanvasPanel
      key="eva"
      width={inner}
      height={evaH}
      px={1000}
      draw={(ctx, w, h) => new PanelPainter(ctx, w, h).eva(eva)}
      drawKey={evaKey(eva, selectedId)}
      dynamic
      position={[0, cy, 0.001]}
    />
  ))
  add(bh, (cy) => (
    <ButtonRow
      key="tools"
      y={cy}
      gap={gap}
      buttons={[
        { key: 'bring', label: 'Bring windows to me', width: canDelete ? 0.2 : 0.3, height: bh, onClick: onBringWindows },
        { key: 'haz', label: showHazards ? 'Steep ground: on' : 'Steep ground: off', width: canDelete ? 0.17 : inner - 0.3 - gap, height: bh, active: showHazards, onClick: onToggleHazards },
        ...(canDelete ? [{ key: 'del', label: 'Delete route', width: inner - 0.37 - gap * 2, height: bh, onClick: onDelete }] : []),
      ]}
    />
  ))
  const height = -y + 0.01

  return (
    <DraggableWindow title="Mission" width={W} height={height} placement={{ angle: 32, distance: 0.8, drop: 0.32 }} resetKey={resetKey}>
      <group position={[0, height / 2, 0]}>{rows}</group>
    </DraggableWindow>
  )
}
