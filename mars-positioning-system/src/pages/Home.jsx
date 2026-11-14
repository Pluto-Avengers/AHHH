import { Link } from 'react-router-dom'
import MarsGlobe from '../components/MarsGlobe.jsx'
import SiteFooter from '../components/SiteFooter.jsx'
import TraverseFigure from '../components/TraverseFigure.jsx'
import Wave from '../components/Wave.jsx'

const problems = [
  {
    title: 'There is no GPS',
    body: 'Earth has dozens of navigation satellites overhead. Mars has none. Knowing where you are means reading maps made from orbit and matching them to what you see.',
  },
  {
    title: 'Help is minutes away',
    body: 'A radio signal takes between 4 and 24 minutes to travel from Mars to Earth, depending on where the two planets are. Nobody at mission control can talk a crew through a bad spot as it happens.',
  },
  {
    title: 'The ground is the hazard',
    body: 'The Spirit rover got stuck in soft sand in 2009 and never drove out. Sharp rocks punched holes in Curiosity’s wheels. A crew on foot or in a rover meets the same slopes, sand and rock.',
  },
]

const comparison = [
  { label: 'Length of a day', mars: '24 h 39 min', earth: '24 h' },
  { label: 'Length of a year', mars: '687 Earth days', earth: '365 days' },
  { label: 'Gravity', mars: '38% of Earth’s', earth: '9.8 m/s²' },
  { label: 'Diameter', mars: '6,779 km', earth: '12,742 km' },
  { label: 'Average temperature', mars: 'about −63 °C', earth: 'about 15 °C' },
  { label: 'Air pressure at the surface', mars: 'about 6 millibars', earth: '1,013 millibars' },
  { label: 'Air', mars: '95% carbon dioxide', earth: '78% nitrogen, 21% oxygen' },
  { label: 'Moons', mars: 'Phobos and Deimos', earth: 'The Moon' },
]

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <h1>
            Mars
            <br />
            Positioning
            <br />
            System
          </h1>
          <p>
            Safe routes around Mars landing sites, so astronauts can cross the surface, collect
            their data and get back.
          </p>
          <div className="hero-actions">
            <Link to="/map" className="button">
              Explore Mars
            </Link>
            <a href="#challenge" className="text-link">
              Read about the project
            </a>
          </div>
        </div>

        <div className="hero-visual">
          <MarsGlobe />
        </div>
      </section>

      <section id="challenge" className="band band-spice">
        <Wave />
        <div className="band-inner split">
          <h2>The challenge</h2>
          <div className="split-body">
            <p className="lead">
              The first people on Mars will step out of their lander with no roads, no GPS and
              nobody on the radio who can answer right away.
            </p>
            <p>
              We took on <strong>Interplanetary Survival Guide: Martian Map</strong> from the 2026
              NASA Space Apps Challenge. It asks teams to build an interactive map that astronauts
              could use to explore Mars and find their way across it.
            </p>

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
            <p className="lead">
              Mars Positioning System plans the trip before anyone steps outside.
            </p>
            <p>
              Choose a landing site and mark where you need to go. The map draws a route that keeps
              clear of the terrain most likely to stop you, such as steep slopes, crater walls and
              loose sand, and still gets you to the science.
            </p>
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
              <p>Look around a landing site and plan a route from it.</p>
              <Link to="/map" className="text-link">
                Open the map
              </Link>
            </div>
            <div>
              <h3>The VR view</h3>
              <p>See the route from the ground, the way a crew would.</p>
              <Link to="/vr" className="text-link">
                Open the VR view
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
            <p className="lead">
              Mars is about half as wide as Earth, far colder, and its air is too thin to breathe.
              Its day is close to ours, and that is where the similarity ends.
            </p>

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

            <p className="about">
              This site was built in one weekend, November 14 and 15, 2026, for the NASA Space Apps
              Challenge. <Link to="/credits">Meet the team</Link>.
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  )
}
