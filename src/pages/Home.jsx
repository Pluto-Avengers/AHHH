import { Link } from 'react-router-dom'
import MarsGlobe from '../components/MarsGlobe.jsx'

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <h1>Mars Positioning System</h1>
          <p>
            Safe traverse routes around Mars landing sites, so astronauts can move
            across the surface and collect data.
          </p>
          <Link to="/map" className="button">
            Explore Mars
          </Link>
        </div>

        <div className="hero-visual">
          <MarsGlobe />
        </div>
      </section>

      {/* Empty sections for more content later */}
      <section className="home-section" />
      <section className="home-section" />
      <section className="home-section" />
      <section className="home-section" />
    </>
  )
}
