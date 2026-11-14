import { useEffect, useMemo, useState } from 'react'
import { hazardCanvas } from '../map/hazards.js'
import { ButtonRow, CanvasPanel, DraggableWindow, VRButton } from './ui.jsx'
import { isDrag } from './input.js'
import { drawEVA, drawMap, drawStatus, FONT } from './draw.js'

const MAP_W = 0.74 // window width (m)
const MAP_BOX = [0.7, 0.5] // map area inside it (m)
const NEAR_WIDTH_M = 1200 // "Around me" zoom: this many meters across

/** Grid area to show: the whole site, or ~1.2 km around you, letterboxed to the map box. */
function mapView(grid, player, zoom) {
  const aspect = MAP_BOX[1] / MAP_BOX[0] // height / width
  if (zoom === 'near') {
    const wc = NEAR_WIDTH_M / grid.cw
    const hr = (NEAR_WIDTH_M * aspect) / grid.ch
    return { c0: player.c - wc / 2, c1: player.c + wc / 2, r0: player.r - hr / 2, r1: player.r + hr / 2 }
  }
  const siteW = grid.cols * grid.cw
  const siteH = grid.rows * grid.ch
  const w = Math.max(siteW, siteH / aspect) * 1.02 // meters across
  const h = w * aspect
  const cc = (grid.cols - 1) / 2
  const cr = (grid.rows - 1) / 2
  return { c0: cc - w / grid.cw / 2, c1: cc + w / grid.cw / 2, r0: cr - h / grid.ch / 2, r1: cr + h / grid.ch / 2 }
}

function Heading({ text, y, width }) {
  return (
    <CanvasPanel
      width={width}
      height={0.035}
      px={Math.round(width * 1800)}
      draw={(ctx, w, h) => {
        ctx.fillStyle = '#9a9a9a'
        ctx.font = `600 ${Math.round(h * 0.6)}px ${FONT}`
        ctx.textBaseline = 'middle'
        ctx.fillText(text.toUpperCase(), 6, h / 2)
      }}
      drawKey={text}
      position={[0, y, 0.001]}
    />
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
  tick,
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
  const hazard = useMemo(() => hazardCanvas(grid), [grid])

  const view = mapView(grid, player, zoom)
  const top = 0.42 // window is laid out downward from here
  const mapY = top - 0.05 - 0.01 - MAP_BOX[1] / 2
  const rowY = mapY - MAP_BOX[1] / 2 - 0.04
  const statusY = rowY - 0.058
  const height = top - (statusY - 0.035) // total window height

  const status =
    message ??
    (planning
      ? draft.length < 2
        ? `Tap the map to place point ${draft.length + 1}.`
        : `${draft.length} points. Add more, or press Create route.`
      : 'Tap the map to go there. Pinch a title bar to move a window.')

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
            drawMap(ctx, w, h, {
              image,
              hazard: showHazards ? hazard : null,
              grid,
              view,
              routes,
              selectedId,
              stations: grid.stations,
              draft,
              player,
              planning,
            })
          }
          drawKey={`${tick}|${image?.src}|${zoom}|${selectedId}|${draft.length}|${planning}|${showHazards}|${routes.length}|${grid.id}`}
          position={[0, mapY, 0.001]}
          onClick={(e) => {
            if (isDrag(e) || !e.uv) return
            e.stopPropagation()
            onMapPoint([view.r0 + (1 - e.uv.y) * (view.r1 - view.r0), view.c0 + e.uv.x * (view.c1 - view.c0)])
          }}
        />
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
          draw={(ctx, w, h) => drawStatus(ctx, w, h, status, Boolean(message))}
          drawKey={`${status}|${Boolean(message)}`}
          position={[0, statusY, 0.001]}
        />
      </group>
    </DraggableWindow>
  )
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
  tick,
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
  let y = -0.05 - 0.01
  const add = (h, render) => {
    rows.push(render(y - h / 2))
    y -= h + gap
  }
  add(0.035, (cy) => <Heading key="h-site" text="Landing site" y={cy} width={inner} />)
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
  add(0.035, (cy) => <Heading key="h-routes" text="Routes" y={cy} width={inner} />)
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
    add(0.035, (cy) => <Heading key="h-walk" text="Walk this route" y={cy} width={inner} />)
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
      draw={(ctx, w, h) => drawEVA(ctx, w, h, eva)}
      drawKey={`${tick}|${selectedId}|${walk.playing}|${walk.speed}`}
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
