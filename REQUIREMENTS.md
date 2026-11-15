# Requirements

What you need to run Mars Positioning System on another computer. The JavaScript libraries are
listed in `package.json` and installed by `npm install`; everything below is what you need
besides them.

## Needed

| Requirement | Why |
| --- | --- |
| **Node.js 20.19+ or 22.12+** | Runs the site (Vite 8 needs one of these versions). Get the LTS version from [nodejs.org](https://nodejs.org); npm comes with it. Check with `node -v`. |
| **Internet for the install** | `npm install` downloads the libraries the first time (about 230 MB on disk). |
| **Internet while using the site** | The Mars map imagery streams from NASA Mars Trek and the font from Google Fonts. Landing-site terrain, routes and the globe texture are in `public/` and work offline. |
| **A modern browser with WebGL** | Chrome, Edge, Firefox or Safari. The globe, 3D terrain and VR all use WebGL. |
| **Port 5173 free** | The dev server uses it and won't start on another port. `npm run preview` uses 4173. |

## For Martial, the navigation agent

| Requirement | Why |
| --- | --- |
| **Python 3.10+** | Runs the agent's back end (`python -m backend.server`). Install its one library with `pip install -r backend/requirements.txt`. |
| **Ollama with `llama3.2`** | The language model behind Martial. Install from [ollama.com](https://ollama.com), then `ollama pull llama3.2` (about 2 GB). Without it, Martial still answers from map data. |
| **Port 8000 free** | The back end listens there; the dev server forwards `/api` to it. Change with `MPS_PORT`. |

On a computer without a graphics card the model answers in about a minute.

## For VR (Meta Quest 3)

| Requirement | Why |
| --- | --- |
| **Quest on the same Wi-Fi as the computer** | The headset opens the site over the network. Networks that block devices from seeing each other (some school or guest Wi-Fi) won't work; a phone or laptop hotspot will. |
| **Firewall allows Node.js on port 5173** | Allow it when Windows asks, and set the Wi-Fi network to Private. |
| **Accept the certificate warning** | `npm run quest` uses a self-signed HTTPS certificate (WebXR needs HTTPS). In the Quest Browser choose Advanced, then Proceed. |

No Developer Mode, cable or phone app is needed.

## Not needed

| | |
| --- | --- |
| **A NASA account or API key** | Mars Trek imagery is public. |
| **Git** | Only to clone the repo; downloading it as a zip works too. |

## Set up

```bash
npm install
npm run dev          # http://localhost:5173

# second terminal, for Martial
pip install -r backend/requirements.txt
ollama pull llama3.2
python -m backend.server
```

For the Quest:

```bash
npm run quest        # open the https "Network" address it prints, plus /vr
```

For a finished, faster copy:

```bash
npm run build
npm run preview      # http://localhost:4173
```

## Regenerating the data (optional)

Only if you change the landing sites or want a new globe texture. Needs Python 3 with `numpy`,
`rasterio`, `pyproj` and `Pillow`, and the raw NASA files in `../space-apps/data`.

```bash
python scripts/export_sites.py
python scripts/export_globe_texture.py
```
