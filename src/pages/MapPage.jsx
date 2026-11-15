import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import MarsMap from '../map/MarsMap.jsx'
import SiteView from '../map/SiteView.jsx'
import { SITES } from '../data/sites.js'
import CoordinateSearch from '../map/CoordinateSearch.jsx'
import Coordinates from '../core/Coordinates.js'
import '../map/map.css'

export default function MapPage() {
  const fromGlobe = useLocation().state?.fromGlobe // arrived from the home-page globe zoom
  const [site, setSite] = useState(null)
  const [arrived, setArrived] = useState(false)
  const [customRoutes, setCustomRoutes] = useState({}) // { [siteId]: route[] }, kept while on this page
  const [found, setFound] = useState(null) // { lat, lon, inside }: a point typed into the search box

  /** Pins a typed point on the world map and says where it is relative to the landing sites. */
  const findPoint = (lat, lon) => {
    const where = Coordinates.point(lat, lon)
    const inside = SITES.find(({ bounds: [[s, w], [n, e]] }) => lat >= s && lat <= n && lon >= w && lon <= e)
    setFound({ lat, lon, inside })
    if (inside) return `${where} is inside the mapped area of ${inside.name}. Open the site to see it in 3D.`
    const nearest = SITES.map((s) => ({ s, km: Coordinates.distanceKm([lat, lon], [s.lat, s.lon]) })).sort(
      (a, b) => a.km - b.km,
    )[0]
    const km = nearest.km < 10 ? nearest.km.toFixed(1) : Math.round(nearest.km).toLocaleString()
    return `${where} is not on a landing-site map. The nearest site is ${nearest.s.name}, ${km} km away.`
  }

  const selectSite = (s) => {
    setSite(s)
    setArrived(false)
  }
  const back = () => {
    setSite(null)
    setArrived(false)
  }
  const onArrive = useCallback(() => setArrived(true), [])

  return (
    <div className="map-page">
      {fromGlobe && <div className="map-arrive" aria-hidden="true" />}
      <MarsMap sites={SITES} target={site} found={site ? null : found} onSelect={selectSite} onArrive={onArrive} />

      {!site && (
        <section className="map-panel">
          <CoordinateSearch onFind={findPoint} />
          {found?.inside && (
            <button type="button" className="button coord-open" onClick={() => selectSite(found.inside)}>
              Open {found.inside.name}
            </button>
          )}
          <h1>Landing sites</h1>
          <ul className="site-list">
            {SITES.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => selectSite(s)}>
                  <span>{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {site && !arrived && <p className="flying">Flying to {site.name}…</p>}

      {site && arrived && (
        <SiteView
          key={site.id}
          site={site}
          customRoutes={customRoutes[site.id] ?? []}
          onCustomRoutesChange={(list) => setCustomRoutes((all) => ({ ...all, [site.id]: list }))}
          onBack={back}
          focusPoint={found?.inside?.id === site.id ? found : null}
        />
      )}
    </div>
  )
}
