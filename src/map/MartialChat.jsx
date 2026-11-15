import { useEffect, useRef, useState } from 'react'
import { ROUTE_COLORS } from './routes.js'
import { routeStats } from './router.js'

// Martial, the navigation agent (MarsOllama.py, served by backend/server.py at /api).
// His tongue is out while he waits and goes in while he speaks.
const base = import.meta.env.BASE_URL
const FACE = { idle: `${base}martial/tongue-out.jpg`, speaking: `${base}martial/tongue-in.jpg` }
const SKILL_LABEL = { NAVIGATION: 'Navigation procedure', ROUTE_PREFERENCE: 'Route preference' }

const fmtLat = (v) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? 'N' : 'S'}`
const fmtLon = (v) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? 'E' : 'W'}`
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function Face({ speaking, size }) {
  return (
    <span className={`martial-face${speaking ? ' is-speaking' : ''}`} style={{ width: size, height: size }}>
      <img src={FACE.idle} alt="" className="martial-face-idle" />
      <img src={FACE.speaking} alt="" className="martial-face-speaking" />
    </span>
  )
}

/** Example requests built from this site's real stations, so every suggestion works on the map. */
function suggestions(grid) {
  const [landing, stop1, stop2] = grid.stations
  const list = ['Find me the least rocky route', 'Which route reaches the highest point?']
  if (stop2) list.splice(1, 0, 'Directions from the landing site to stop 2')
  if (stop1) list.push(`Route from ${fmtLat(landing.lat)}, ${fmtLon(landing.lon)} to ${fmtLat(stop1.lat)}, ${fmtLon(stop1.lon)}`)
  return list
}

export default function MartialChat({ site, grid, routes, onRoute, onHighlight }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [health, setHealth] = useState(null)
  const listRef = useRef(null)
  const abortRef = useRef(null)
  const typingRef = useRef(null)

  // Is the back end up, and is Ollama behind it?
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealth({ backend: false }))
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!pending) return
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000)
    return () => {
      clearInterval(id)
      setElapsed(0)
    }
  }, [pending])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, pending])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      clearInterval(typingRef.current)
    },
    [],
  )

  /** Shows Martial's reply a few characters at a time while his tongue is in. */
  const speak = (text, meta) => {
    clearInterval(typingRef.current)
    setMessages((m) => [...m, { from: 'martial', text: '', ...meta }])
    setSpeaking(true)
    const update = (shown) =>
      setMessages((m) => m.map((msg, k) => (k === m.length - 1 ? { ...msg, text: shown } : msg)))
    if (reducedMotion()) {
      update(text)
      setTimeout(() => setSpeaking(false), 1200)
      return
    }
    const perTick = Math.max(2, Math.ceil(text.length / 180)) // about 3 s however long the reply
    let shown = 0
    typingRef.current = setInterval(() => {
      shown = Math.min(text.length, shown + perTick)
      update(text.slice(0, shown))
      if (shown >= text.length) {
        clearInterval(typingRef.current)
        setSpeaking(false)
      }
    }, 16)
  }

  const showResult = (res) => {
    let routeName = null
    if (res.route?.cells?.length > 1) {
      const r = res.route
      onRoute({
        id: r.id,
        kind: 'custom',
        agent: true,
        name: r.name,
        description: r.description,
        color: ROUTE_COLORS.agent,
        cells: r.cells,
        stopCells: r.stopCells,
        stops: r.stops,
        stats: routeStats(grid, r.cells),
        cellM: Math.round(grid.cw),
      })
      routeName = r.name
    } else if (res.highlight) {
      onHighlight(res.highlight)
      routeName = routes.find((r) => r.id === res.highlight)?.name
    }
    speak(res.reply, { skill: res.skill, source: res.source, routeName })
  }

  const send = async (text) => {
    const message = text.trim()
    if (!message || pending) return
    setInput('')
    setMessages((m) => [...m, { from: 'user', text: message }])
    setPending(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          site: site.id,
          message,
          routes: routes.map((r) => ({ id: r.id, name: r.name, kind: r.kind, cells: r.cells })),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!body) throw new TypeError('no JSON') // the dev server's proxy could not reach the back end
      if (!res.ok || !body.reply) throw new Error(body.error ?? `The back end answered ${res.status}.`)
      showResult(body)
    } catch (e) {
      if (e.name === 'AbortError') return
      const offline = e instanceof TypeError
      speak(
        offline
          ? 'I can’t reach mission control. Start the back end with “python -m backend.server” and try again.'
          : e.message,
        { error: true },
      )
    } finally {
      setPending(false)
    }
  }

  const status = !health
    ? 'Checking in…'
    : health.backend === false
      ? 'Back end offline'
      : !health.ollama
        ? 'Ollama offline · answering from map data'
        : !health.model_installed
          ? `Model ${health.model} missing · run “ollama pull ${health.model}”`
          : `Online · ${health.model}`

  if (!open) {
    return (
      <button type="button" className="martial-launcher" onClick={() => setOpen(true)} aria-label="Ask Martial, the navigation assistant">
        <Face speaking={false} size={56} />
        <span>Ask Martial</span>
      </button>
    )
  }

  return (
    <section className="martial-chat" aria-label="Martial, navigation assistant">
      <header>
        <Face speaking={speaking} size={64} />
        <div>
          <h2>Martial</h2>
          <p className="muted">{status}</p>
        </div>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close Martial">
          ✕
        </button>
      </header>

      <div className="martial-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="martial-intro">
            <p>
              I plan routes on the {site.name} terrain map. Ask me for directions between two points, or tell me what
              kind of route you want and I’ll highlight the best one.
            </p>
            <p className="muted">
              Mapped area: {fmtLat(grid.bounds[0][0])} to {fmtLat(grid.bounds[1][0])}, {fmtLon(grid.bounds[0][1])} to{' '}
              {fmtLon(grid.bounds[1][1])}
            </p>
            <ul className="martial-suggestions">
              {suggestions(grid).map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => send(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m, k) => (
          <div key={k} className={`martial-msg from-${m.from}${m.error ? ' is-error' : ''}`}>
            {m.skill && (
              <p className="martial-skill">
                {SKILL_LABEL[m.skill]}
                {m.source === 'map' && ' · from map data'}
              </p>
            )}
            <pre>{m.text}</pre>
            {m.routeName && m.text.length > 0 && <p className="martial-shown">Shown on the map: {m.routeName}</p>}
          </div>
        ))}
        {pending && (
          <div className="martial-msg from-martial is-pending">
            <pre>Checking the terrain map… {elapsed > 3 ? `${elapsed} s` : ''}</pre>
          </div>
        )}
      </div>

      <form
        className="martial-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          aria-label="Message Martial"
        />
        <button type="submit" className="button" disabled={pending || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}
