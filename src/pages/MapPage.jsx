import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import MarsMap from '../map/MarsMap.jsx'
import SiteView from '../map/SiteView.jsx'
import { SITES } from '../map/sites.js'
import '../map/map.css'

export default function MapPage() {
  const fromGlobe = useLocation().state?.fromGlobe // arrived from the home-page globe zoom
  const [site, setSite] = useState(null)
  const [arrived, setArrived] = useState(false)
  const [customRoutes, setCustomRoutes] = useState({}) // { [siteId]: route[] }, kept while on this page

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
      <MarsMap sites={SITES} target={site} onSelect={selectSite} onArrive={onArrive} />

      {!site && (
        <section className="map-panel">
          <h1>Landing sites</h1>
          <p className="muted">
            Four sites where landers have already touched down safely. Choose one to fly in and view its terrain and
            routes in 3D.
          </p>
          <ul className="site-list">
            {SITES.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => selectSite(s)}>
                  <span>{s.name}</span>
                  <span className="muted">{s.mission}</span>
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
        />
      )}
    </div>
  )
}
