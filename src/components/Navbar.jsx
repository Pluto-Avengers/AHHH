import { useState } from 'react'
import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/map', label: 'Map' },
  { to: '/vr', label: 'VR' },
  { to: '/credits', label: 'Credits' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="navbar">
      <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
        Mars Positioning System
      </NavLink>

      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="nav-links"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Close' : 'Menu'}
      </button>

      <nav id="nav-links" className={`nav-links ${open ? 'open' : ''}`}>
        {links.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}>
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
