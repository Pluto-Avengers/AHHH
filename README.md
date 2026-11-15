# Mars Positioning System

NASA Space Apps Challenge project: a mapping system that plans safe traverse routes
around Mars landing sites so astronauts can commute safely and collect data.

## Run

```bash
npm install
npm run dev
```

In a second terminal, start Martial, the navigation agent (needs [Ollama](https://ollama.com) with `llama3.2`):

```bash
pip install -r backend/requirements.txt
ollama pull llama3.2
python -m backend.server        # http://127.0.0.1:8000; the dev server forwards /api to it
```

## Martial, the navigation agent

Open a landing site on the map and press **Ask Martial**. The agent lives in `backend/martial/`: a router and two
skills, each a class with its own instructions (`prompts.py`).

| Skill | Ask for | Martial does |
| --- | --- | --- |
| Navigation procedure | directions between two coordinates, or "landing site" / "stop N" | plans the safest path on the terrain map, cuts it into legs and writes a formal step-by-step procedure; the route appears on the map |
| Route preference | a kind of route: fastest, longest, rockiest, least rocky, highest or lowest point | compares the routes on the map plus safest and most direct paths to each science stop, and highlights the best match |

Routes also consider radiation. Cosmic rays reach the surface from the open sky, so `scripts/export_sites.py` works
out how much of the sky each spot sees (`public/sites/<id>/sky.bin`), and the route planner (the website and Martial
alike) prefers ground where hills and crater walls block part of it. Each route's estimated dose is its walking time
× 0.21 mGy a day (Curiosity's measurement at Gale) × the share of open sky.

Gale, Gusev, Meridiani and Elysium have a simulated dust storm (`public/storms.json`, made by
`scripts/make_storms.py`; made-up planning scenarios, not observed weather). While it is switched on in the site
panel, the red area is closed to every route: the recommended traverse, your own routes (planned again around it)
and Martial's.

All numbers (coordinates, headings, distances, elevations, slopes, roughness) come from the same site terrain the
map draws (`public/sites/`), read by `backend/terrain/`. A navigation procedure is accepted from the model only
when its steps match the map exactly; otherwise, or when Ollama isn't running, Martial writes it straight from the
map data. Settings: `MARTIAL_MODEL` (default `llama3.2`), `OLLAMA_HOST`, `MPS_PORT` (default `8000`).
Try it without the website: `python MarsOllama.py jezero "Find me the least rocky route"`.

## Structure

The logic is in classes, grouped by what it does. React components stay function components with hooks
(React's recommended style) and call into these classes.

```
src/
  App.jsx                    routes (/, /map, /vr, /credits)
  pages/                     Home, MapPage, VRPage, Credits
  components/                Navbar, MarsGlobe (home hero), SiteFooter, TraverseFigure, Wave
  data/sites.js              the landing sites and their rover data
  core/                      plain JavaScript, no React or three.js
    TerrainGrid.js           a site's terrain: A* routing, route stats, hazard overlay
    MinHeap.js               priority queue for A*
    RoutePlanner.js          builds route objects (recommended, rover drive, custom, Martial's)
    SiteLoader.js            downloads and caches each site's terrain
  three/                     three.js helpers
    TerrainProjection.js     grid <-> scene coordinates, terrain mesh
    ThumbnailRenderer.js     3D miniatures for the world-map markers
    MarsTexture.js           procedural Mars texture (globe fallback)
  map/                       the Map page: world map, site view (3D / 2D), route details
    martial/                 Martial's chat: MartialChat, MartialReply, ReplyParser,
                             MartialClient (API calls)
  vr/                        the VR page: MarsWorld, Windows, ui, VRSurface, WalkPath,
                             GroundDetail, PanelPainter (draws the VR panels)
api/                         Vercel Functions for /api/agent and /api/health (wrap backend/)
backend/
  server.py                  MartialServer: HTTP API the website calls (/api/agent, /api/health)
  martial/                   the agent
    agent.py                 MartialAgent: reads a request, routes it to a skill
    router.py                SkillRouter
    skills/                  NavigationSkill, RoutePreferenceSkill (one Skill class each)
    prompts.py               the router's and each skill's instructions for the model
    request.py               RequestReader: coordinates, stations and off-map destinations in a request
    llm.py                   OllamaClient
  terrain/                   TerrainGrid (routing), LegPlanner, RouteCandidates, SiteCatalog, Coordinates,
                             files.py (reads public/, or downloads it from the website when hosted)
MarsOllama.py                command-line entry point for the agent
scripts/                     SiteExporter (export_sites.py), GlobeTextureExporter, push-hosting.mjs
public/martial/              Martial's avatar (tongue out at rest, in while speaking)
```

Colors and spacing live as CSS variables at the top of `src/index.css`.

## VR on a Meta Quest

The VR page (`/vr`) puts you on the landing site at real scale (HiRISE terrain, 1 m = 1 m). A movable map window
shows where you are and lets you plan new routes; the mission panel walks you along a route as an astronaut
(1×/3×/10× suited walking pace) with a live EVA readout. Everything works with hand tracking: pinch to press.

**Easiest (no Developer Mode):** put the computer and the Quest on the same Wi-Fi, run `npm run quest`, and open
the `Network: https://…:5173` address it prints, plus `/vr`, in the Quest Browser. The certificate is self-signed, so
the browser warns first: choose **Advanced → Proceed**. If Windows asks whether Node.js may use the network, allow it.

**Alternative (USB, needs Developer Mode):**

One-time setup: turn on Developer Mode for the headset in the Meta Horizon phone app, and install
[Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) (for `adb`).

Each time:

```bash
npm run dev                         # serves http://127.0.0.1:5173 (fixed in vite.config.js)
adb devices                         # with the Quest plugged in by USB-C; accept "Allow USB debugging" in the headset
adb reverse tcp:5173 tcp:5173       # the Quest's localhost:5173 now reaches this computer
```

Then open `http://localhost:5173/vr` in the Quest Browser and press **Enter VR**. WebXR only works on `localhost`
or `https`, so opening the computer's Wi-Fi IP address in the headset won't offer VR.

Controls (hands or controller trigger): pinch a button to press it, pinch a window's title bar and move your hand
to drag it, pinch the map to go there (or to add route points while planning), and point at the ground and pinch to
step there.

## Hosting (Vercel)

The website is hosted from the team repo, https://github.com/Pluto-Avengers/mars-positioning-system: Vercel
builds its `main` branch. The code here runs unchanged both locally and on Vercel, so to update the website,
commit your work on `main` and run

```bash
npm run push:hosting              # checks the build, then pushes main to the hosting repo's main
npm run push:hosting -- --dry-run # only shows what would change
```

The hosting repo has its own history (files were uploaded on GitHub), so the script makes one commit on the local
`hosting` branch with exactly `main`'s files on top of the hosting repo's latest commit, and pushes that. If
someone changed the hosting repo directly since your last push, it lists those files and stops; copy what you want
to keep into `main`, or pass `--overwrite`. After the first push you can also do it by hand:
`git checkout hosting && git merge main && git push` (the `hosting` branch pushes to the hosting repo's `main`).
Set `HOSTING_BRANCH=newest` to push to another branch of the hosting repo instead.

How the same code runs on Vercel:

- `vercel.json` builds the Vite site into `dist/`, sends every page path to `index.html` (so `/map`, `/vr` and
  `/credits` work on refresh), and leaves `/api` to the functions.
- `api/agent.py` and `api/health.py` are Vercel Functions that wrap the same `MartialAgent` as `backend/server.py`;
  `requirements.txt` installs `ollama` for them.
- A function doesn't get the `public/` folder, so `backend/terrain/files.py` downloads the site terrain and
  `storms.json` from the website itself (the request's own address, or `VERCEL_PROJECT_PRODUCTION_URL`).
- Vercel has no Ollama, so Martial answers from the map data. To have the model write his replies there, set
  `OLLAMA_API_KEY` (from ollama.com/settings/keys) and `MARTIAL_MODEL` (a cloud model such as `gpt-oss:120b`)
  in the Vercel project's environment variables.
