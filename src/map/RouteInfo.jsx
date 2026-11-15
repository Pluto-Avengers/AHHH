import { riskLevel, MAX_SLOPE } from './router.js'

const KIND_LABEL = {
  recommended: 'Recommended route',
  custom: 'Your route',
  reference: 'Rover drive (for reference)',
}

const formatTime = (minutes) => {
  const m = Math.round(minutes)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

function Profile({ profile }) {
  const w = 300
  const h = 90
  const step = Math.max(1, Math.floor(profile.length / 300))
  const pts = profile.filter((_, k) => k % step === 0 || k === profile.length - 1)
  const maxD = pts[pts.length - 1].d || 1
  const es = pts.map((p) => p.e)
  const lo = Math.min(...es)
  const hi = Math.max(...es)
  const range = Math.max(hi - lo, 1)
  const line = pts.map((p) => `${((p.d / maxD) * w).toFixed(1)},${(h - ((p.e - lo) / range) * (h - 8) - 4).toFixed(1)}`)

  return (
    <figure className="profile">
      <figcaption>
        Elevation profile{' '}
        <span className="muted">
          ({Math.round(lo)} to {Math.round(hi)} m)
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Elevation along the route">
        <polygon points={`0,${h} ${line.join(' ')} ${w},${h}`} className="profile-fill" />
        <polyline points={line.join(' ')} className="profile-line" />
      </svg>
      <div className="profile-axis">
        <span>0 km</span>
        <span>{(maxD / 1000).toFixed(2)} km</span>
      </div>
    </figure>
  )
}

export default function RouteInfo({ route, onClose, onDelete }) {
  const { stats } = route
  const risk = riskLevel(stats)

  return (
    <aside className="route-info" aria-label="Route details">
      <header>
        <div>
          <p className="route-kind">
            <span className="swatch" style={{ background: route.color }} />
            {route.agent ? 'Planned by Martial' : KIND_LABEL[route.kind]}
          </p>
          <h2>{route.name}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close route details">
          ✕
        </button>
      </header>

      {route.description && <p className="route-desc">{route.description}</p>}

      <dl className="route-stats">
        <div>
          <dt>Distance</dt>
          <dd>{(stats.distanceM / 1000).toFixed(2)} km</dd>
        </div>
        <div>
          <dt>Walking time</dt>
          <dd>{formatTime(stats.walkMinutes)}</dd>
        </div>
        <div>
          <dt>Climb / descent</dt>
          <dd>
            +{Math.round(stats.gainM)} / −{Math.round(stats.lossM)} m
          </dd>
        </div>
        <div>
          <dt>Steepest slope</dt>
          <dd>{stats.maxSlope}°</dd>
        </div>
        <div>
          <dt>Average slope</dt>
          <dd>{stats.meanSlope.toFixed(1)}°</dd>
        </div>
        <div>
          <dt>Terrain risk</dt>
          <dd className={`risk risk-${risk.label.toLowerCase()}`}>{risk.label}</dd>
        </div>
      </dl>
      <p className="route-note">{risk.note}.</p>

      <Profile profile={stats.profile} />

      {route.stops?.length > 0 && (
        <>
          <h3>Stops</h3>
          <ol className="route-stops">
            {route.stops.map((stop) => (
              <li key={stop.name}>
                {stop.name}
                {stop.note && <span className="muted"> · {stop.note}</span>}
              </li>
            ))}
          </ol>
        </>
      )}

      <p className="route-note muted">
        Walking time assumes a suited astronaut and slows on grades. Slopes over {MAX_SLOPE}° are treated as
        impassable. Terrain is HiRISE elevation resampled to about {route.cellM} m.
      </p>

      {onDelete && (
        <button type="button" className="text-button" onClick={onDelete}>
          Delete this route
        </button>
      )}
    </aside>
  )
}
