import SiteFooter from '../components/SiteFooter.jsx'
import Wave from '../components/Wave.jsx'

// The team, in the order shown. Photos live in public/team/.
const team = [
  { name: 'Ryan Calixte', role: 'Project Lead', photo: '/team/ryan.jpg' },
  { name: 'Emma Boudreaux', role: 'AI Engineer', photo: '/team/emma.jpg' },
  { name: 'Valery Macena', role: 'Backend Developer', photo: '/team/valery.jpg' },
  { name: 'Mia Mandili', role: 'AI Engineer', photo: '/team/mia.jpg' },
  { name: 'Gabriel Sharipov', role: 'Frontend Developer', photo: '/team/gabriel.jpg' },
]

const stack = [
  { name: 'React', use: 'Builds every page and component on the site.' },
  { name: 'Vite', use: 'Runs the site while we work and bundles it for release.' },
  { name: 'React Router', use: 'Moves between Home, Map, VR and Credits without reloading.' },
  { name: 'three.js', use: 'Draws the spinning Mars on the home page in 3D.' },
  { name: 'Oxlint', use: 'Checks the code for mistakes before it ships.' },
  { name: 'Vercel', use: 'Hosts the site and redeploys it on every push to GitHub.' },
]

export default function Credits() {
  return (
    <>
      <section className="credits-top">
        <div className="band-inner">
          <h1>Pluto Avengers</h1>
          <p className="credits-lead">
            We are Plutonians researching the Martians of Mars! We are a group of high schoolers in
            South Florida who want to become engineers, physicists and biological researchers.
          </p>

          <ul className="team-grid">
            {team.map((member) => (
              <li key={member.name} className="team-member">
                {member.photo ? (
                  <img className="photo" src={member.photo} alt={`Portrait of ${member.name}`} />
                ) : (
                  <div className="photo photo-empty" aria-hidden="true" />
                )}
                <h2>{member.name}</h2>
                <p>{member.role}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band band-spice">
        <Wave />
        <div className="band-inner split">
          <h2>Built with</h2>
          <div className="split-body">
            <table className="compare stack">
              <tbody>
                {stack.map((tool) => (
                  <tr key={tool.name}>
                    <th scope="row">{tool.name}</th>
                    <td>{tool.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 24 }}>
              Super Intelligence tools were used to organize, create, and debug code throughout the project.
              Specifically, it organized UI for device compatibility, optimized virtual reality rendering, polished
              code formatting for efficient debugging, and helped debug our Ollama model's instructions.
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  )
}
