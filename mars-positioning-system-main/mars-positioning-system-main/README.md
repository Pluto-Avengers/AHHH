# Mars Positioning System

NASA Space Apps Challenge project: a mapping system that plans safe traverse routes
around Mars landing sites so astronauts can commute safely and collect data.

## Run

```bash
npm install
npm run dev
```

## Structure

```
src/
  App.jsx                 routes (/, /map, /vr, /credits)
  components/Navbar.jsx   top navigation (collapses to a menu on mobile)
  components/MarsGlobe.jsx  rotating three.js Mars globe (home hero)
  lib/marsTexture.js      procedural Mars surface texture
  pages/Home.jsx          hero + "Explore Mars" button
  pages/MapPage.jsx       (empty) route map
  pages/VRPage.jsx        (empty) VR experience
  pages/Credits.jsx       team cards: edit the `team` array
```

Colors and spacing live as CSS variables at the top of `src/index.css`.
