import { useState } from 'react'
import Coordinates from '../core/Coordinates.js'
import { NO_DATA } from '../core/TerrainGrid.js'

/**
 * What's at the point you clicked on the site: coordinates, elevation, slope and open sky.
 * onStart / onDestination start planning a route from or to it.
 */
export default function PointCard({ grid, point, onClose, onStart, onDestination }) {
  const [copied, setCopied] = useState(false)
  const [r, c] = point
  const [lat, lon] = grid.latLonAt(r, c)
  const text = Coordinates.point(lat, lon)
  const rr = Math.min(Math.max(Math.round(r), 0), grid.rows - 1)
  const cc = Math.min(Math.max(Math.round(c), 0), grid.cols - 1)
  const i = grid.index(rr, cc)
  const known = grid.hasData(i)

  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div className="point-card" role="status">
      <div className="point-coords">
        <strong>{text}</strong>
        <button type="button" className="text-button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Hide coordinates">
          ✕
        </button>
      </div>
      {known ? (
        <p className="point-facts">
          Elevation {Math.round(grid.height[i]).toLocaleString()} m · Slope {grid.slope[i] === NO_DATA ? '–' : `${grid.slope[i]}°`} ·
          Open sky {Math.round(grid.skyView(i) * 100)}%
        </p>
      ) : (
        <p className="point-facts">No terrain data here.</p>
      )}
      {known && (onStart || onDestination) && (
        <div className="point-actions">
          {onStart && (
            <button type="button" className="button" onClick={onStart}>
              Start here
            </button>
          )}
          {onDestination && (
            <button type="button" className="button" onClick={onDestination}>
              Go here
            </button>
          )}
        </div>
      )}
    </div>
  )
}
