// 2D canvas drawing for VR panels. Text is drawn into textures, so nothing
// (fonts included) has to be downloaded inside the headset.
import RoutePlanner from '../core/RoutePlanner.js'

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const TEXT = '#f2f2f2'
const MUTED = '#9a9a9a'
const LINE = '#333333'
const RISK_COLORS = { Low: '#7fd17f', Moderate: '#ffc35a', High: '#ff6b5a' }

const formatTime = (minutes) => {
  const m = Math.round(minutes)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

const formatClock = (seconds) => {
  const s = Math.round(seconds)
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Top-down site map. `view` = { r0, c0, r1, c1 }: the visible grid area.
 * Grid point (r, c) is drawn at the centre of its image pixel block.
 */

/**
 * Draws one VR panel into a 2D canvas (w × h pixels), which is then used as the panel's texture.
 * Usage: new PanelPainter(ctx, w, h).button({ label, … })
 */
export default class PanelPainter {
  constructor(ctx, w, h) {
    this.ctx = ctx
    this.w = w
    this.h = h
  }

  /** Writes `text` wrapped to `maxWidth`; returns the y after the last line. */
  wrapText(text, x, y, maxWidth, lineHeight) {
    const { ctx } = this
    let line = ''
    for (const word of text.split(' ')) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y)
        line = word
        y += lineHeight
      } else {
        line = test
      }
    }
    if (line) ctx.fillText(line, x, y)
    return y + lineHeight
  }

  /** Shrinks the font until `text` fits in `maxWidth`. */
  #fitFont(text, size, weight, maxWidth) {
    const { ctx } = this
    let s = size
    do {
      ctx.font = `${weight} ${s}px ${FONT}`
    } while (ctx.measureText(text).width > maxWidth && --s > 10)
  }

  background() {
    const { ctx, w, h } = this
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = LINE
    ctx.lineWidth = 3
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3)
  }

  /** A flat button: white fill when active, outline otherwise. */
  button({ label, swatch, active, hovered, disabled }) {
    const { ctx, w, h } = this
    ctx.fillStyle = active ? TEXT : hovered ? '#2a2a2a' : 'rgba(0, 0, 0, 0.9)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = hovered || active ? TEXT : '#555'
    ctx.lineWidth = 4
    ctx.strokeRect(2, 2, w - 4, h - 4)
    let x = 28
    if (swatch) {
      ctx.fillStyle = swatch
      ctx.beginPath()
      ctx.arc(x + 10, h / 2, 11, 0, Math.PI * 2)
      ctx.fill()
      x += 38
    }
    ctx.fillStyle = active ? '#000' : disabled ? '#666' : TEXT
    this.#fitFont(label, Math.round(h * 0.42), 600, w - x - 24)
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x, h / 2 + 1)
  }

  /** Small floating tag, e.g. a station name. */
  tag(text, color = TEXT) {
    const { ctx, w, h } = this
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = color
    this.#fitFont(text, Math.round(h * 0.6), 600, w - 20)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2 + 1)
  }

  /** One line of status text. */
  status(text, warn) {
    const { ctx, w, h } = this
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = warn ? '#ffb27a' : TEXT
    this.#fitFont(text, Math.round(h * 0.45), 500, w - 40)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2 + 1)
  }

  /** Heading + body lines for the help panel. */
  help(site) {
    const { ctx, w } = this
    this.background()
    const pad = 56
    let y = 100
    ctx.fillStyle = TEXT
    ctx.font = `700 64px ${FONT}`
    ctx.fillText(site?.name ?? 'Mars Positioning System', pad, y)
    y += 62
    if (site) {
      ctx.fillStyle = MUTED
      ctx.font = `400 40px ${FONT}`
      ctx.fillText(site.mission, pad, y)
      y += 64
      ctx.font = `400 38px ${FONT}`
      y = this.wrapText(site.summary, pad, y, w - pad * 2, 52) + 30
    }
    ctx.fillStyle = TEXT
    ctx.font = `700 46px ${FONT}`
    ctx.fillText('Controls', pad, y)
    y += 66
    const rows = [
      ['Trigger', 'Select a route, a button or a map point'],
      ['Pinch', 'Same as the trigger, with hands'],
      ['Stick ← →', 'Turn the table'],
      ['Stick ↑ ↓', 'Zoom the table in or out'],
      ['A / X', 'Undo the last route point'],
      ['B / Y', 'Cancel planning or close a route'],
    ]
    const keyW = 250
    for (const [key, what] of rows) {
      ctx.fillStyle = TEXT
      ctx.font = `600 38px ${FONT}`
      ctx.fillText(key, pad, y)
      ctx.fillStyle = MUTED
      ctx.font = `400 38px ${FONT}`
      y = this.wrapText(what, pad + keyW, y, w - pad * 2 - keyW, 48) + 22
    }
  }

  /** Route details: name, stats, risk, elevation profile and stops (mirrors the Map page panel). */
  routeInfo(route) {
    const { ctx, w, h } = this
    this.background()
    const { stats } = route
    const risk = RoutePlanner.riskLevel(stats)
    const pad = 56
    let y = 80

    ctx.fillStyle = route.color
    ctx.beginPath()
    ctx.arc(pad + 12, y - 12, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = MUTED
    ctx.font = `500 32px ${FONT}`
    const kind = { recommended: 'Recommended route', custom: 'Your route', reference: 'Rover drive (reference)' }
    ctx.fillText(kind[route.kind], pad + 40, y)
    y += 70
    ctx.fillStyle = TEXT
    this.#fitFont(route.name, 52, 700, w - pad * 2)
    ctx.fillText(route.name, pad, y)
    y += 30

    // 2 × 3 stat grid
    const cells = [
      ['Distance', `${(stats.distanceM / 1000).toFixed(2)} km`],
      ['Walking time', formatTime(stats.walkMinutes)],
      ['Climb / descent', `+${Math.round(stats.gainM)} / −${Math.round(stats.lossM)} m`],
      ['Steepest slope', `${stats.maxSlope}°`],
      ['Average slope', `${stats.meanSlope.toFixed(1)}°`],
      ['Terrain risk', risk.label],
    ]
    const cw = (w - pad * 2) / 2
    const ch = 118
    y += 20
    cells.forEach(([label, value], i) => {
      const cx = pad + (i % 2) * cw
      const cy = y + Math.floor(i / 2) * ch
      ctx.strokeStyle = LINE
      ctx.lineWidth = 2
      ctx.strokeRect(cx, cy, cw, ch)
      ctx.fillStyle = MUTED
      ctx.font = `400 28px ${FONT}`
      ctx.fillText(label, cx + 22, cy + 42)
      ctx.fillStyle = label === 'Terrain risk' ? RISK_COLORS[risk.label] : TEXT
      ctx.font = `600 40px ${FONT}`
      ctx.fillText(value, cx + 22, cy + 92)
    })
    y += ch * 3 + 50
    ctx.fillStyle = MUTED
    ctx.font = `400 30px ${FONT}`
    ctx.fillText(`${risk.note}.`, pad, y)
    y += 60

    // elevation profile
    const es = stats.profile.map((p) => p.e)
    const lo = Math.min(...es)
    const hi = Math.max(...es)
    const maxD = stats.profile[stats.profile.length - 1].d || 1
    ctx.fillStyle = TEXT
    ctx.font = `600 32px ${FONT}`
    ctx.fillText(`Elevation profile  (${Math.round(lo)} to ${Math.round(hi)} m)`, pad, y)
    y += 20
    const gh = 170
    const gw = w - pad * 2
    ctx.beginPath()
    stats.profile.forEach((p, i) => {
      const px = pad + (p.d / maxD) * gw
      const py = y + gh - ((p.e - lo) / Math.max(hi - lo, 1)) * (gh - 12) - 6
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.strokeStyle = TEXT
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.strokeStyle = LINE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pad, y + gh)
    ctx.lineTo(pad + gw, y + gh)
    ctx.stroke()
    y += gh + 44
    ctx.fillStyle = MUTED
    ctx.font = `400 28px ${FONT}`
    ctx.fillText('0 km', pad, y)
    ctx.textAlign = 'right'
    ctx.fillText(`${(maxD / 1000).toFixed(2)} km`, pad + gw, y)
    ctx.textAlign = 'left'
    y += 64

    if (route.stops?.length) {
      ctx.fillStyle = TEXT
      ctx.font = `600 32px ${FONT}`
      ctx.fillText('Stops', pad, y)
      y += 48
      ctx.font = `400 30px ${FONT}`
      for (const [i, stop] of route.stops.entries()) {
        if (y > h - 40) break
        y = this.wrapText(`${i + 1}. ${stop.name}`, pad, y, w - pad * 2, 40) + 4
      }
    }
  }

  /** Window title bar (the drag handle). */
  titleBar(title, hovered) {
    const { ctx, w, h } = this
    ctx.fillStyle = hovered ? '#3a3a3a' : '#1c1c1c'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = MUTED
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.beginPath()
        ctx.arc(30 + j * 14, h / 2 - 14 + i * 14, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.fillStyle = TEXT
    this.#fitFont(title, Math.round(h * 0.5), 600, w - 100)
    ctx.textBaseline = 'middle'
    ctx.fillText(title, 72, h / 2 + 1)
  }

  map({ image, hazard, grid, view, routes, selectedId, stations, draft, player, planning }) {
    const { ctx, w, h } = this
    const { r0, c0, r1, c1 } = view
    const X = (c) => ((c - c0) / (c1 - c0)) * w
    const Y = (r) => ((r - r0) / (r1 - r0)) * h
    const k = w / (c1 - c0) // canvas px per cell
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, w, h)
    if (image?.complete) ctx.drawImage(image, X(-0.5), Y(-0.5), X(grid.cols - 0.5) - X(-0.5), Y(grid.rows - 0.5) - Y(-0.5))
    if (hazard) ctx.drawImage(hazard, X(-0.5), Y(-0.5), X(grid.cols - 0.5) - X(-0.5), Y(grid.rows - 0.5) - Y(-0.5))

    const line = (cells, color, width, alpha) => {
      const step = Math.max(1, Math.floor(cells.length / 900))
      ctx.globalAlpha = alpha
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      for (const [stroke, lw] of [['rgba(0,0,0,0.75)', width + 5], [color, width]]) {
        ctx.beginPath()
        for (let i = 0; i < cells.length; i += step) {
          const x = X(cells[i] % grid.cols)
          const y = Y(Math.floor(cells[i] / grid.cols))
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        const last = cells[cells.length - 1]
        ctx.lineTo(X(last % grid.cols), Y(Math.floor(last / grid.cols)))
        ctx.strokeStyle = stroke
        ctx.lineWidth = lw
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    for (const r of routes) {
      const sel = r.id === selectedId
      line(r.cells, r.color, (r.thin ? 3 : 5) + (sel ? 4 : 0), selectedId && !sel ? 0.45 : 1)
    }

    ctx.font = `600 22px ${FONT}`
    ctx.textBaseline = 'middle'
    stations.forEach((st, i) => {
      const x = X(st.rc[1])
      const y = Y(st.rc[0])
      ctx.fillStyle = i === 0 ? '#ffffff' : '#ffb27a'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      const label = i === 0 ? 'Landing' : `Stop ${i}`
      ctx.lineWidth = 5
      ctx.strokeText(label, x + 14, y)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, x + 14, y)
    })

    if (draft.length) {
      ctx.setLineDash([12, 8])
      ctx.strokeStyle = '#5ad1ff'
      ctx.lineWidth = 3
      ctx.beginPath()
      draft.forEach(([r, c], i) => (i ? ctx.lineTo(X(c), Y(r)) : ctx.moveTo(X(c), Y(r))))
      ctx.stroke()
      ctx.setLineDash([])
      draft.forEach(([r, c], i) => {
        ctx.fillStyle = '#5ad1ff'
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(X(c), Y(r), 15, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#000'
        ctx.font = `700 20px ${FONT}`
        ctx.textAlign = 'center'
        ctx.fillText(String(i + 1), X(c), Y(r) + 1)
        ctx.textAlign = 'left'
      })
    }

    // You: a dot with an arrow for the way you're facing (heading 0 = north/up, clockwise).
    if (player) {
      const x = X(player.c)
      const y = Y(player.r)
      const dx = Math.sin(player.heading)
      const dy = -Math.cos(player.heading)
      ctx.fillStyle = '#5ad1ff'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x + dx * 30, y + dy * 30)
      ctx.lineTo(x - dy * 12, y + dx * 12)
      ctx.lineTo(x + dy * 12, y - dx * 12)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // Scale bar + north
    const metersPerPx = grid.cw / k
    const target = 160 * metersPerPx
    const p = 10 ** Math.floor(Math.log10(target))
    const n = target / p
    const len = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p
    const barPx = len / metersPerPx
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    ctx.fillRect(14, h - 56, barPx + 170, 42)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(28, h - 30)
    ctx.lineTo(28, h - 22)
    ctx.lineTo(28 + barPx, h - 22)
    ctx.lineTo(28 + barPx, h - 30)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = `600 22px ${FONT}`
    ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, 40 + barPx, h - 28)
    ctx.fillText('N ↑', w - 70, 34)

    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    const hint = planning ? 'Tap the map to add route points' : 'Tap the map to go there'
    ctx.font = `600 24px ${FONT}`
    const hw = ctx.measureText(hint).width + 32
    ctx.fillRect(w - hw - 14, h - 56, hw, 42)
    ctx.fillStyle = planning ? '#5ad1ff' : '#fff'
    ctx.fillText(hint, w - hw + 2, h - 34)
  }

  /** Live EVA readout while standing on or walking a route. */
  eva({ route, walked, length, simSeconds, playing, speed, elevation, slope, nextStop }) {
    const { ctx, w, h } = this
    const pad = 40
    if (!route) {
      ctx.fillStyle = '#cfcfcf'
      ctx.font = `400 34px ${FONT}`
      let y = 70
      y = this.wrapText('Choose a route above to walk it as an astronaut.', pad, y, w - pad * 2, 46) + 10
      this.wrapText('To move anywhere: tap the map, or point at the ground and pinch.', pad, y, w - pad * 2, 46)
      if (elevation != null) {
        ctx.fillStyle = TEXT
        ctx.font = `600 34px ${FONT}`
        ctx.fillText(`Here: ${Math.round(elevation)} m · slope ${slope ?? '–'}°`, pad, h - 40)
      }
      return
    }
    let y = 60
    ctx.fillStyle = route.color
    ctx.beginPath()
    ctx.arc(pad + 12, y - 12, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = TEXT
    this.#fitFont(route.name, 40, 700, w - pad * 2 - 260)
    ctx.fillText(route.name, pad + 36, y)
    ctx.fillStyle = playing ? '#7fd17f' : MUTED
    ctx.font = `600 32px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText(playing ? `Walking ${speed}×` : walked >= length - 0.5 ? 'Arrived' : 'Paused', w - pad, y)
    ctx.textAlign = 'left'

    // progress bar
    y += 30
    ctx.fillStyle = '#333'
    ctx.fillRect(pad, y, w - pad * 2, 14)
    ctx.fillStyle = route.color
    ctx.fillRect(pad, y, (w - pad * 2) * Math.min(walked / (length || 1), 1), 14)
    y += 30

    const cells = [
      ['Walked', `${(walked / 1000).toFixed(2)} / ${(length / 1000).toFixed(2)} km`],
      ['EVA time', formatClock(simSeconds)],
      ['Elevation', `${Math.round(elevation)} m`],
      ['Slope here', slope == null ? '–' : `${slope}°`],
      ['Next stop', nextStop ? `${nextStop.name} · ${Math.round(nextStop.in)} m` : 'None ahead'],
    ]
    const cw = (w - pad * 2) / 2
    const ch = 96
    cells.forEach(([label, value], i) => {
      const full = i === 4
      const cx = pad + (full ? 0 : (i % 2) * cw)
      const cy = y + Math.floor(i / 2) * ch
      ctx.strokeStyle = LINE
      ctx.lineWidth = 2
      ctx.strokeRect(cx, cy, full ? cw * 2 : cw, ch)
      ctx.fillStyle = MUTED
      ctx.font = `400 26px ${FONT}`
      ctx.fillText(label, cx + 18, cy + 36)
      ctx.fillStyle = TEXT
      this.#fitFont(value, 34, 600, (full ? cw * 2 : cw) - 36)
      ctx.fillText(value, cx + 18, cy + 78)
    })
    y += ch * 3 + 24

    // elevation profile with a marker where you are
    const prof = route.stats.profile
    const es = prof.map((p) => p.e)
    const lo = Math.min(...es)
    const hi = Math.max(...es)
    const maxD = prof[prof.length - 1].d || 1
    const gh = h - y - 30
    const gw = w - pad * 2
    ctx.beginPath()
    prof.forEach((p, i) => {
      const px = pad + (p.d / maxD) * gw
      const py = y + gh - ((p.e - lo) / Math.max(hi - lo, 1)) * (gh - 10) - 5
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.strokeStyle = TEXT
    ctx.lineWidth = 3
    ctx.stroke()
    const mx = pad + Math.min(walked / (length || 1), 1) * gw
    ctx.strokeStyle = '#5ad1ff'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(mx, y)
    ctx.lineTo(mx, y + gh)
    ctx.stroke()
    ctx.fillStyle = MUTED
    ctx.font = `400 24px ${FONT}`
    ctx.fillText(`${Math.round(hi)} m`, pad, y + 20)
    ctx.fillText(`${Math.round(lo)} m`, pad, y + gh + 24)
  }
}
