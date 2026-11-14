// Replace these placeholders with your team's details.
// `photo` can be an imported image or a path in /public (e.g. '/team/alex.jpg').
const team = [
  { name: 'Team Member 1', role: 'Role', photo: null },
  { name: 'Team Member 2', role: 'Role', photo: null },
  { name: 'Team Member 3', role: 'Role', photo: null },
  { name: 'Team Member 4', role: 'Role', photo: null },
  { name: 'Team Member 5', role: 'Role', photo: null },
]

export default function Credits() {
  return (
    <section className="page">
      <h1>Credits</h1>

      <ul className="team-grid">
        {team.map((member) => (
          <li key={member.name} className="team-member">
            {member.photo ? (
              <img className="photo" src={member.photo} alt={member.name} />
            ) : (
              <div className="photo" aria-hidden="true" />
            )}
            <h2>{member.name}</h2>
            <p>{member.role}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
