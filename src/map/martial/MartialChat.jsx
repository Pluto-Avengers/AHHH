import { useEffect, useMemo, useRef, useState } from 'react'
import Coordinates from '../../core/Coordinates.js'
import RoutePlanner from '../../core/RoutePlanner.js'
import { martialClient } from './MartialClient.js'
import { martialVoice } from './MartialVoice.js'
import MartialReply from './MartialReply.jsx'

// Martial, the navigation agent (backend/martial, served by backend/server.py at /api).
// His mouth is closed while he waits; while his reply types out he barks, opens his mouth and shakes.
const base = import.meta.env.BASE_URL
const FACE = { idle: `${base}martial/martial-closed.png`, speaking: `${base}martial/martial-open.png` }

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
  if (stop1) list.push(`Route from ${Coordinates.point(landing.lat, landing.lon)} to ${Coordinates.point(stop1.lat, stop1.lon)}`)
  return list
}

/**
 * open: the chat is open; minimized: it's open but shrunk to a chip (route details have the
 * space). It stays mounted either way, so the conversation and a reply mid-typing carry on.
 */
export default function MartialChat({ site, grid, storm = false, pin = null, routes, onRoute, onHighlight, open, minimized, onOpen, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  // Martial's open follow-up question ({ message, need, choices }): sent back with the next message
  const [question, setQuestion] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [health, setHealth] = useState(null)
  const listRef = useRef(null)
  const abortRef = useRef(null)
  const typingRef = useRef(null)
  const planner = useMemo(() => new RoutePlanner(grid), [grid])

  // Is the back end up, and is Ollama behind it?
  useEffect(() => {
    if (!open) return
    let cancelled = false
    martialClient.health().then((h) => !cancelled && setHealth(h))
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
  }, [messages, pending, open, minimized])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      clearInterval(typingRef.current)
    },
    [],
  )

  /** Shows Martial’s reply a few characters at a time, with a bark and an open, shaking mouth. */
  const speak = (text, meta) => {
    clearInterval(typingRef.current)
    martialVoice.bark()
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
      onRoute(planner.agentRoute(res.route))
      routeName = res.route.name
    } else if (res.highlight) {
      onHighlight(res.highlight)
      routeName = routes.find((r) => r.id === res.highlight)?.name
    }
    setQuestion(res.skill === 'CLARIFY' ? res.pending : null)
    speak(res.reply, { skill: res.skill, source: res.source, routeName, choices: res.choices ?? [] })
  }

  const send = async (text) => {
    const message = text.trim()
    if (!message || pending) return
    martialVoice.unlock() // this click or key press is what lets the reply bark when it arrives
    setInput('')
    setMessages((m) => [...m, { from: 'user', text: message }])
    setPending(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      showResult(await martialClient.ask({ siteId: site.id, message, routes, storm, pin, pending: question, signal: controller.signal }))
    } catch (e) {
      if (e.name === 'AbortError') return
      speak(e.message, { error: true })
    } finally {
      setPending(false)
    }
  }

  // Only shown when something needs attention
  const status = !health
    ? null
    : health.backend === false
      ? 'Back end offline'
      : !health.ollama
        ? 'Ollama offline, answering from map data'
        : !health.model_installed
          ? `Model missing: run “ollama pull ${health.model}”`
          : null

  if (!open) {
    return (
      <button type="button" className="martial-launcher" onClick={onOpen} aria-label="Ask Martial, the navigation assistant">
        <Face speaking={false} size={56} />
        <span>Ask Martial</span>
      </button>
    )
  }

  if (minimized) {
    return (
      <button type="button" className="martial-launcher is-minimized" onClick={onOpen} aria-label="Back to Martial">
        <Face speaking={speaking} size={48} />
        <span>
          Martial
          {(pending || speaking) && <small>{pending ? 'Thinking…' : 'Answering…'}</small>}
        </span>
      </button>
    )
  }

  return (
    <section className="martial-chat" aria-label="Martial, navigation assistant">
      <header>
        <Face speaking={speaking} size={104} />
        <div>
          <h2>Martial</h2>
          {status && <p className="muted">{status}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close Martial">
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
            {m.from === 'martial' ? (
              <MartialReply text={m.text} typing={speaking && k === messages.length - 1} />
            ) : (
              <pre>{m.text}</pre>
            )}
            {m.routeName && m.text.length > 0 && <p className="martial-shown">Shown on the map: {m.routeName}</p>}
            {m.choices?.length > 0 && k === messages.length - 1 && question && !speaking && !pending && (
              <div className="martial-choices" role="group" aria-label="Answers">
                {m.choices.map((c) => (
                  <button key={c} type="button" onClick={() => send(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
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
