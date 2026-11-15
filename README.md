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

Open a landing site on the map and press **Ask Martial**. `MarsOllama.py` holds the agent: a router and two
skills, each with its own instructions.

| Skill | Ask for | Martial does |
| --- | --- | --- |
| Navigation procedure | directions between two coordinates, or "landing site" / "stop N" | plans the safest path on the terrain map, cuts it into legs and writes a formal step-by-step procedure; the route appears on the map |
| Route preference | a kind of route: fastest, longest, rockiest, least rocky, highest or lowest point | compares the routes on the map plus safest and most direct paths to each science stop, and highlights the best match |

All numbers (coordinates, headings, distances, elevations, slopes, roughness) come from the same site terrain the
map draws (`public/sites/`), read by `backend/mars_map.py`. A navigation procedure is accepted from the model only
when its steps match the map exactly; otherwise, or when Ollama isn't running, Martial writes it straight from the
map data. Settings: `MARTIAL_MODEL` (default `llama3.2`), `OLLAMA_HOST`, `MPS_PORT` (default `8000`).
Try it without the website: `python MarsOllama.py jezero "Find me the least rocky route"`.

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
  map/MartialChat.jsx     chat panel for the Martial agent
MarsOllama.py             the agent: router + skill instructions (Ollama)
backend/mars_map.py       site terrain, routing and route measurements for the agent
backend/server.py         HTTP API the website calls (/api/agent, /api/health)
public/martial/           Martial's avatar (tongue out at rest, in while speaking)
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
