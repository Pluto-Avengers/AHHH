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
  components/TraverseFigure.jsx  route illustration (home, "Our solution")
  pages/Home.jsx          hero, the challenge, our solution, Mars facts
  pages/MapPage.jsx       (empty) route map
  pages/VRPage.jsx        (empty) VR experience
  components/Wave.jsx     wave edge between coloured sections
  components/SiteFooter.jsx  footer shared by Home and Credits
  pages/Credits.jsx       team + tech stack: edit the `team` array,
                          photos go in public/team/
```

Colors and spacing live as CSS variables at the top of `src/index.css`.

## Deploy

Deploys to Vercel as a Vite project. `vercel.json` sends every path to
`index.html` so `/map`, `/vr` and `/credits` work on refresh.
