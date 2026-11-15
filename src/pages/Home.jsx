import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import MarsGlobe from '../components/MarsGlobe.jsx'
import SiteFooter from '../components/SiteFooter.jsx'
import TraverseFigure from '../components/TraverseFigure.jsx'
import Wave from '../components/Wave.jsx'
import { preloadWorldTiles } from '../map/tiles.js'

const problems = [
  { title: 'No GPS', body: 'Mars has no navigation satellites.' },
  { title: 'Help is far away', body: 'A radio message to Earth takes 4 to 24 minutes.' },
  { title: 'The ground is the hazard', body: 'Spirit got stuck in sand. Rocks tore Curiosity’s wheels.' },
]

const comparison = [
  { label: 'Gravity', mars: '38% of Earth’s', earth: '9.8 m/s²' },
  { label: 'Length of a day', mars: '24 h 39 min', earth: '24 h' },
  { label: 'Average temperature', mars: 'about −63 °C', earth: 'about 15 °C' },
  { label: 'Air pressure', mars: 'less than 1% of Earth’s', earth: '1,013 millibars' },
]

const ZOOM_MS = 1800

export default function Home() {
  const globe = useRef(null)
  const navigate = useNavigate()
  const [zooming, setZooming] = useState(false)

  // Explore Mars: fly into the globe, then open the map
  const explore = async (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // let new-tab clicks through
    e.preventDefault()
    if (zooming) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return navigate('/map')
    setZooming(true)
    preloadWorldTiles() // so the map is ready when the zoom ends
    window.scrollTo({ top: 0, behavior: 'smooth' })
    await globe.current?.zoomIn(ZOOM_MS)
    navigate('/map', { state: { fromGlobe: true } })
  }

  return (
    <>
      <section className={zooming ? 'hero zooming' : 'hero'} style={{ '--zoom-ms': `${ZOOM_MS}ms` }}>
        <div className="hero-text">
          <h1>
            Mars
            <br />
            Positioning
            <br />
            System
          </h1>
          <p>Safe routes for astronauts on Mars.</p>
          <div className="hero-actions">
            <Link to="/map" className="button" onClick={explore}>
              Explore Mars
            </Link>
            <a href="#challenge" className="text-link">
              About the project
            </a>
          </div>
        </div>

        <div className="hero-visual">
          <MarsGlobe ref={globe} />
        </div>
        <div className="hero-veil" aria-hidden="true" />
      </section>

      <section id="challenge" className="band band-spice">
        <Wave />
        <div className="band-inner split">
          <h2>The challenge</h2>
          <div className="split-body">
            <p className="lead">No roads, no GPS, and nobody who can answer right away.</p>

            <ul className="problems">
              {problems.map((problem) => (
                <li key={problem.title}>
                  <h3>{problem.title}</h3>
                  <p>{problem.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="solution" className="band band-black">
        <Wave />
        <div className="band-inner split">
          <h2>Our solution</h2>
          <div className="split-body">
            <p className="lead">Plan the safest route before anyone steps outside.</p>
          </div>
        </div>

        <div className="band-inner">
          <TraverseFigure />
        </div>

        <div className="band-inner split">
          <span aria-hidden="true" />
          <div className="split-body parts">
            <div>
              <h3>The map</h3>
              <Link to="/map" className="text-link">
                Open the map
              </Link>
            </div>
            <div>
              <h3>The VR view</h3>
              <Link to="/vr" className="text-link">
                Walk it in VR
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="mars" className="band band-spice">
        <Wave />
        <div className="band-inner split">
          <h2>Mars, briefly</h2>
          <div className="split-body">
            <p className="lead">About half as wide as Earth.</p>

            <table className="compare">
              <thead>
                <tr>
                  <td />
                  <th scope="col">Mars</th>
                  <th scope="col">Earth</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td className="mars-value">{row.mars}</td>
                    <td>{row.earth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  )
}
