import { useState } from 'react'
import Coordinates from '../core/Coordinates.js'

/**
 * Type a latitude and longitude to find that point. `onFind(lat, lon)` shows it on the map and
 * returns a sentence about where it is, which appears under the box.
 */
export default function CoordinateSearch({ onFind, placeholder = '18.4447 N, 77.4508 E' }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null) // { ok, text }

  const submit = (e) => {
    e.preventDefault()
    const point = Coordinates.parse(text)
    if (!point) {
      setResult({ ok: false, text: 'Type a latitude and longitude, for example 18.4447 N, 77.4508 E or -4.59, 137.44.' })
      return
    }
    setResult({ ok: true, text: onFind(...point) })
  }

  return (
    <form className="coord-search" onSubmit={submit} role="search">
      <label htmlFor="coord-search-input">Find coordinates</label>
      <div className="coord-search-row">
        <input
          id="coord-search-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="button">
          Find
        </button>
      </div>
      {result && <p className={`coord-search-result${result.ok ? '' : ' is-error'}`}>{result.text}</p>}
    </form>
  )
}
