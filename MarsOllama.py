"""Martial: the Mars Positioning System navigation agent (Ollama).

The agent has a router and two skills. Each one has its own instructions, kept apart below:

    ROUTER                    decides which skill a request needs
    SKILL 1  NAVIGATION       a formal step-by-step procedure between two points on the map
    SKILL 2  ROUTE PREFERENCE picks and highlights the map route that best fits what the user wants

Martial never invents terrain. Every coordinate, heading, distance and elevation it writes comes from
the landing-site map (backend/mars_map.py reads the same data the website draws) and is handed to
the model inside a MAP DATA block.

Run the API for the website:  python -m backend.server
Try it from a terminal:       python MarsOllama.py jezero "Find me the least rocky route"
"""

import json
import os
import re
import sys

from backend import mars_map as mm

MODEL = os.environ.get("MARTIAL_MODEL", "llama3.2")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST")  # default: http://localhost:11434

PERSONA = (
    "Your name is Martial. You are the navigation assistant of the Mars Positioning System, "
    "a surface GPS for astronauts. You are concise, professional and encouraging."
)

# =====================================================================================
# ROUTER: which skill does this request need?
# =====================================================================================
ROUTER_INSTRUCTIONS = f"""{PERSONA}

YOUR ONLY TASK RIGHT NOW: classify the user's request. Do not answer it.

Reply with JSON: {{"skill": "NAVIGATION"}} or {{"skill": "ROUTE_PREFERENCE"}}.

NAVIGATION: the user wants directions or a navigation procedure from one place to another,
for example between two coordinates, or from the landing site to a science stop.

ROUTE_PREFERENCE: the user describes what kind of route or destination they want
(fastest, longest, rockiest, least rocky, highest, lowest, flattest, safest, most varied, and so on)
and wants you to choose one.
"""

# =====================================================================================
# SKILL 1: NAVIGATION PROCEDURE
# =====================================================================================
NAVIGATION_INSTRUCTIONS = f"""{PERSONA}

SKILL: NAVIGATION PROCEDURE
You write a formal ground navigation procedure for a route that has already been planned on the map.

WHEN THIS SKILL IS USED
The user asked for directions between two points on the landing-site map.

YOUR DATA
The user message ends with a MAP DATA block measured on the landing-site terrain map. It gives the
departure, the destination, the total distance and the PHASES of the route in order. Each phase has
its title and its steps, already worded by the rules below from the map's headings, distances,
elevations, end coordinates and hazards. Copy every phase and step exactly, in order. Never invent,
change, round, reorder, add or remove a step, and never change a coordinate or its N, S, E or W.
The rules below explain what the steps mean, so you can present them correctly.

GENERAL RULES
1. Metric units only.
2. Header lines and phase titles in capital letters. Steps in sentence case.
3. Number steps 1, 2, 3 and so on across the whole document. Never restart the numbering. Never number phase titles.
4. One short command per step.
5. All travel is on foot or by ground vehicle. Use only: heading, waypoint, proceed, adjust, ascend, descend.
6. MISSION: use the mission name the user gave, otherwise NOT SPECIFIED.
   DESTINATION: use the destination name in MAP DATA, or the name the user gave, otherwise NOT SPECIFIED.

PHASE TITLES (one per leg, from the leg's terrain in MAP DATA)
INITIAL DEPARTURE: the first leg. No terrain step.
LEVEL TRAVERSE: terrain LEVEL. Terrain step: "Terrain level."
ELEVATION ASCENT: terrain ASCENT. Terrain step: "Ascend for approximately [elevation change] meters."
TERRAIN DESCENT: terrain DESCENT. Terrain step: "Descend for approximately [elevation change] meters."
FINAL APPROACH: the last leg. No terrain step.

STEPS FOR EACH LEG, IN ORDER
a. "Set heading to [heading]°." on the first leg, "Adjust heading to [heading]°." on the others.
b. "Proceed for approximately [distance] meters."
c. The terrain step (middle legs only).
d. Only if the leg has a hazard: "Hazard: [type] at [coordinates]. Adjust heading to [bypass heading]° to bypass."
e. "Establish position at [end coordinates]."

START AND END
Step 1 is "Establish position at departure coordinates." under INITIAL DEPARTURE, before the heading step.
In FINAL APPROACH, step e is replaced by "Confirm arrival at [destination name] at [destination coordinates]."
Then write one unnumbered line: "Total distance traveled: [total distance] meters." Then stop. Add nothing else.

FORMAT (headings always in this order)
MARS SURFACE NAVIGATION PROCEDURES
MISSION: <mission> | DESTINATION: <destination>
DEPARTURE COORDINATES: <departure>
DESTINATION COORDINATES: <destination coordinates>
NAVIGATION SEQUENCE

INITIAL DEPARTURE
1. Establish position at departure coordinates.
2. Set heading to <heading>°.
3. Proceed for approximately <distance> meters.
4. Establish position at <coordinates>.

<PHASE TITLE>
5. Adjust heading to <heading>°.
...

FINAL APPROACH
...
<n>. Confirm arrival at <destination> at <destination coordinates>.

Total distance traveled: <total> meters.
"""

# =====================================================================================
# SKILL 2: ROUTE PREFERENCE
# =====================================================================================
ROUTE_PREFERENCE_INSTRUCTIONS = f"""{PERSONA}

SKILL: ROUTE PREFERENCE
You choose the one route on the map that best matches what the user wants, and it is highlighted for them.

WHEN THIS SKILL IS USED
The user described the kind of route or destination they want instead of exact directions.

YOUR DATA
The user message ends with a MAP DATA block measured on the landing-site terrain map:
a table of candidate routes (key R1, R2, ...) with their departure, destination, steps, distance,
walking time, climb, slopes, roughness and highest and lowest points, and BEST MATCH BY
CHARACTERISTIC, which says which route wins each dictionary characteristic. Choose only from
these routes. Never invent a route, destination or number.

DICTIONARY (a guideline; the user's words only need to match loosely)
fastest: the fewest coordinate steps from departure to destination.
longest: the most coordinate steps from departure to destination.
rockiest: the greatest cumulative high-frequency, low-magnitude elevation fluctuation (roughness).
least rocky: the lowest cumulative roughness. Also fits flattest, smoothest, easiest, safest.
highest point: contains the point with the greatest rise above the departure point.
lowest point: contains the point with the greatest drop below the departure point.
For a request that is not in the dictionary (for example most varied rock), choose the route whose
numbers best fit it and say which numbers you used.

HOW TO CHOOSE
1. Find the characteristic in the user's request.
2. Use BEST MATCH BY CHARACTERISTIC for it. If several apply, weigh them and explain briefly.

FORMAT (exactly these lines, then stop)
MARS SURFACE PREFERRED ROUTES
MISSION: <mission from MAP DATA> | DESTINATION: <destination of the chosen route>
DEPARTURE COORDINATES: <departure of the chosen route>
DESTINATION COORDINATES: <destination coordinates of the chosen route>
ROUTE REQUIREMENTS: <the user's preference, in a few words>
HIGHLIGHTED ROUTE: <key>: <route name>
REASON: <one or two sentences quoting the map numbers that decided it>
"""

SKILLS = {
    "NAVIGATION": NAVIGATION_INSTRUCTIONS,
    "ROUTE_PREFERENCE": ROUTE_PREFERENCE_INSTRUCTIONS,
}


class AgentError(Exception):
    """A request Martial can't carry out; the message is shown to the user."""


# ---- talking to Ollama ---------------------------------------------------------------
def _chat(system, user, fmt=None):
    from ollama import Client  # imported here so the map code works without the package

    client = Client(host=OLLAMA_HOST) if OLLAMA_HOST else Client()
    response = client.chat(
        model=MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        format=fmt,
        options={"temperature": 0.1, "num_ctx": 8192},
        keep_alive="30m",  # stay loaded between questions (a cold start takes a while on CPU)
    )
    return response.message.content.strip()


def ollama_status():
    try:
        from ollama import Client

        client = Client(host=OLLAMA_HOST) if OLLAMA_HOST else Client()
        names = [m.model for m in client.list().models]
        ok = any(n == MODEL or n.split(":")[0] == MODEL for n in names)
        return {"ollama": True, "model": MODEL, "model_installed": ok}
    except Exception as e:  # noqa: BLE001  (any connection failure means offline)
        return {"ollama": False, "model": MODEL, "error": str(e)}


# ---- reading points from the request -------------------------------------------------
COORD_PAIR = re.compile(
    r"(?<![\d.])(-?\d+(?:\.\d+)?)\s*°?\s*(?:([NS])(?![A-Za-z]))?"  # latitude, optional N/S
    r"(?:\s*[,;/]\s*|\s+)"  # separator
    r"(-?\d+(?:\.\d+)?)\s*°?\s*(?:([EW])(?![A-Za-z]))?",  # longitude, optional E/W
    re.IGNORECASE,
)
STATION_WORDS = re.compile(r"\blanding\b|\b(?:science\s+)?stop\s*(\d+)\b", re.IGNORECASE)


def find_points(grid, text):
    """Points named in the request, in the order written: coordinates, 'landing' or 'stop N'.
    Returns (list of (label, row, col, station name or None), list of out-of-map coordinates)."""
    found, outside = [], []
    for m in COORD_PAIR.finditer(text):
        lat_s, ns, lon_s, ew = m.groups()
        lat, lon = float(lat_s), float(lon_s)
        if ns and ns.upper() == "S":
            lat = -abs(lat)
        if ew and ew.upper() == "W":
            lon = -abs(lon)
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        if not grid.contains(lat, lon):
            outside.append(f"{mm.fmt_lat(lat)}, {mm.fmt_lon(lon)}")
            continue
        r, c = grid.latlon_to_rc(lat, lon)
        found.append((m.start(), f"{mm.fmt_lat(lat)}, {mm.fmt_lon(lon)}", r, c, None))
    for m in STATION_WORDS.finditer(text):
        k = int(m.group(1)) if m.group(1) else 0
        if k < len(grid.stations):
            s = grid.stations[k]
            found.append((m.start(), f"{mm.fmt_lat(s['lat'])}, {mm.fmt_lon(s['lon'])}", *s["rc"], s["name"]))
    found.sort(key=lambda p: p[0])
    return [p[1:] for p in found], outside


# ---- the router ----------------------------------------------------------------------
PREFERENCE_WORDS = re.compile(
    r"fast|quick|short|long|rock|smooth|flat|easy|easi|safe|high|low|steep|gentle|varied|divers|scenic|prefer",
    re.IGNORECASE,
)


def route_skill(grid, message):
    points, _ = find_points(grid, message)
    coords = sum(1 for p in points if p[3] is None)
    if coords >= 2:
        return "NAVIGATION"  # two coordinates: no doubt, no need to ask the model
    try:
        out = json.loads(_chat(ROUTER_INSTRUCTIONS, message, fmt={
            "type": "object",
            "properties": {"skill": {"type": "string", "enum": list(SKILLS)}},
            "required": ["skill"],
        }))
        if out.get("skill") in SKILLS:
            return out["skill"]
    except Exception:  # noqa: BLE001  (offline or malformed: fall back to the keyword rule)
        pass
    return "ROUTE_PREFERENCE" if PREFERENCE_WORDS.search(message) or len(points) < 1 else "NAVIGATION"


# ---- SKILL 1 ---------------------------------------------------------------------------
def run_navigation(grid, site, message):
    points, outside = find_points(grid, message)
    if len(points) == 1:  # only a destination: depart from the landing site
        s = grid.stations[0]
        points.insert(0, (f"{mm.fmt_lat(s['lat'])}, {mm.fmt_lon(s['lon'])}", *s["rc"], s["name"]))
    if len(points) < 2:
        where = f" {', '.join(outside)} is outside the mapped area." if outside else ""
        raise AgentError(
            "Give me a departure and a destination inside the mapped area of "
            f"{site['name']} ({grid.bounds_text()}), as coordinates such as "
            f"{mm.fmt_lat(grid.stations[1]['lat'])}, {mm.fmt_lon(grid.stations[1]['lon'])}, "
            f"or by name (landing site, stop 1 to stop {len(grid.stations) - 1}).{where}"
        )
    (dep_label, dr, dc, _), (dst_label, tr, tc, dst_station) = points[0], points[-1]

    planned = grid.plan([(dr, dc), (tr, tc)])
    if "error" in planned:
        raise AgentError(planned["error"])
    cells = planned["cells"]
    if len(cells) < 2:
        raise AgentError("Those two points are on the same spot of the map. Choose a destination farther away.")

    legs = mm.split_legs(grid, cells)
    end_station = grid.nearest_station(cells[-1])
    dest_name = dst_station or (end_station["name"] if end_station else "NOT SPECIFIED")
    total = sum(l["distance_m"] for l in legs)
    data = {
        "landing_site": site["name"],
        "departure_coordinates": dep_label,
        "destination_coordinates": dst_label,
        "destination_name": dest_name,
        "total_distance_m": total,
        "phases": navigation_phases(legs, dest_name, dst_label),
    }
    prompt = f"{message}\n\nMAP DATA\n{json.dumps(data, indent=1, ensure_ascii=False)}"
    try:
        reply, source = _chat(NAVIGATION_INSTRUCTIONS, prompt), "ollama"
        mission = mission_from(reply, message)
        if matches_map(reply, data):
            reply = navigation_text(data, mission)  # same steps, laid out and numbered 1..n without gaps
        else:  # the model changed a step: use the map's own wording
            reply, source = navigation_text(data, mission), "map"
    except Exception:  # noqa: BLE001  (Ollama offline)
        reply, source = navigation_text(data), "map"

    stats = grid.stats(cells)
    return {
        "skill": "NAVIGATION",
        "source": source,
        "reply": reply,
        "route": {
            "id": f"martial-nav-{cells[0]}-{cells[-1]}",
            "name": f"Martial: to {dest_name if dest_name != 'NOT SPECIFIED' else dst_label}",
            "description": f"Navigation procedure from {dep_label} to {dst_label}: {len(legs)} legs, "
            f"{total} m on ground under {mm.MAX_SLOPE}°.",
            "cells": cells,
            "stopCells": planned["stopCells"],
            "stops": [{"name": "Departure"}, {"name": dest_name if dest_name != "NOT SPECIFIED" else "Destination"}],
            "distance_m": round(stats["distance_m"]),
        },
    }


def navigation_phases(legs, dest_name, dest_coords):
    """Each leg as a phase title and its steps, worded by the SKILL 1 rules from the map's numbers."""
    titles = {"LEVEL": "LEVEL TRAVERSE", "ASCENT": "ELEVATION ASCENT", "DESCENT": "TERRAIN DESCENT"}
    phases = []
    for k, leg in enumerate(legs):
        first, last = k == 0, k == len(legs) - 1
        steps = ["Establish position at departure coordinates."] if first else []
        steps.append(f"{'Set' if first else 'Adjust'} heading to {leg['heading']:03d}°.")
        steps.append(f"Proceed for approximately {leg['distance_m']} meters.")
        if not first and not last:
            if leg["terrain"] == "LEVEL":
                steps.append("Terrain level.")
            else:
                verb = "Ascend" if leg["terrain"] == "ASCENT" else "Descend"
                steps.append(f"{verb} for approximately {leg['elevation_change_m']} meters.")
        hz = leg["hazard"]
        if hz and hz["bypass_heading"] is not None:
            steps.append(f"Hazard: {hz['type']} at {hz['at']}. Adjust heading to {hz['bypass_heading']:03d}° to bypass.")
        steps.append(
            f"Confirm arrival at {dest_name} at {dest_coords}." if last else f"Establish position at {leg['end']}."
        )
        phases.append({"title": leg["terrain"] if first or last else titles[leg["terrain"]], "steps": steps})
    return phases


def _norm(text):
    return re.sub(r"[^a-z0-9.]+", " ", text.lower()).strip()


def matches_map(reply, data):
    """True when the model's numbered steps are exactly the map's steps, in order."""
    got = [_norm(m.group(1)) for m in re.finditer(r"^\s*\d+\.\s*(.+)$", reply, re.MULTILINE)]
    want = [_norm(s) for p in data["phases"] for s in p["steps"]]
    return got == want and f"{data['total_distance_m']} meters" in reply


def mission_from(reply, message):
    """The mission name the model read from the request, if the user really wrote it."""
    m = re.search(r"MISSION:\s*(.+?)\s*\|", reply)
    name = m.group(1).strip() if m else ""
    return name if name and name.upper() != "NOT SPECIFIED" and name.lower() in message.lower() else "NOT SPECIFIED"


def navigation_text(data, mission="NOT SPECIFIED"):
    """The procedure written directly from MAP DATA (used when Ollama is offline or alters a step)."""
    lines = [
        "MARS SURFACE NAVIGATION PROCEDURES",
        f"MISSION: {mission} | DESTINATION: {data['destination_name']}",
        f"DEPARTURE COORDINATES: {data['departure_coordinates']}",
        f"DESTINATION COORDINATES: {data['destination_coordinates']}",
        "NAVIGATION SEQUENCE",
    ]
    n = 0
    for phase in data["phases"]:
        lines += ["", phase["title"]]
        for step in phase["steps"]:
            n += 1
            lines.append(f"{n}. {step}")
    lines += ["", f"Total distance traveled: {data['total_distance_m']} meters."]
    return "\n".join(lines)


# ---- SKILL 2 ---------------------------------------------------------------------------
KEYWORDS = [  # used only when Ollama is offline or names no valid route
    ("least rocky", r"least rock|smooth|flat|easi|easy|gentle|safe|calm"),
    ("rockiest", r"rock|rough|bump|divers|varied|variety"),
    ("fastest", r"fast|quick|short|direct|minimum"),
    ("longest", r"long|scenic|maximum"),
    ("highest point", r"high|summit|top|climb|view"),
    ("lowest point", r"low|deep|bottom|valley|basin"),
]

_mission_counter = 0


def run_route_preference(grid, site, message, client_routes):
    global _mission_counter
    points, _ = find_points(grid, message)
    departure = (points[0][1], points[0][2]) if points and points[0][3] is None else None
    routes = mm.candidate_routes(grid, client_routes, departure)
    if not routes:
        raise AgentError("The map has no safe routes from that point. Try a departure closer to the landing site.")
    ranking = mm.characteristic_ranking(routes)
    _mission_counter += 1
    mission = f"MISSION {_mission_counter} ({site['name'].upper()})"

    table = [
        {
            "key": r["key"],
            "name": r["name"],
            "departure": r["start"],
            "destination": r["destination"],
            "destination_coordinates": r["end"],
            "steps": r["stats"]["steps"],
            "distance_m": round(r["stats"]["distance_m"]),
            "walk_min": round(r["stats"]["walk_min"]),
            "climb_m": round(r["stats"]["gain_m"]),
            "descent_m": round(r["stats"]["loss_m"]),
            "max_slope_deg": r["stats"]["max_slope"],
            "mean_slope_deg": round(r["stats"]["mean_slope"], 1),
            "roughness_m": round(r["stats"]["roughness_m"], 1),
            "highest_above_departure_m": round(r["stats"]["highest_rel_m"], 1),
            "lowest_below_departure_m": round(r["stats"]["lowest_rel_m"], 1),
        }
        for r in routes
    ]
    data = {"landing_site": site["name"], "mission": mission, "routes": table, "best_match_by_characteristic": ranking}
    prompt = f"{message}\n\nMAP DATA\n{json.dumps(data, indent=1, ensure_ascii=False)}"

    by_key = {r["key"]: r for r in routes}
    try:
        reply, source = _chat(ROUTE_PREFERENCE_INSTRUCTIONS, prompt), "ollama"
        m = re.search(r"HIGHLIGHTED ROUTE:\s*\**\s*(R\d+)", reply, re.IGNORECASE)
        chosen = by_key.get(m.group(1).upper()) if m else None
    except Exception:  # noqa: BLE001
        reply, source, chosen = None, "map", None

    if chosen is None:
        trait = next((t for t, rx in KEYWORDS if re.search(rx, message, re.IGNORECASE)), "least rocky")
        chosen = by_key[ranking[trait]]
        s = chosen["stats"]
        fallback = "\n".join([
            "MARS SURFACE PREFERRED ROUTES",
            f"MISSION: {mission} | DESTINATION: {chosen['destination']}",
            f"DEPARTURE COORDINATES: {chosen['start']}",
            f"DESTINATION COORDINATES: {chosen['end']}",
            f"ROUTE REQUIREMENTS: {trait}",
            f"HIGHLIGHTED ROUTE: {chosen['key']}: {chosen['name']}",
            f"REASON: Best {trait} route on the map: {s['steps']} steps, {s['distance_m']:.0f} m, "
            f"roughness {s['roughness_m']:.1f} m, highest +{s['highest_rel_m']:.0f} m, lowest {s['lowest_rel_m']:.0f} m.",
        ])
        if reply:  # the model answered but named no valid route: keep the map's choice, consistently
            source = "map"
        reply = fallback
    else:
        # Keep the model's requirements and reason, but take every header value from the map.
        def field(name):
            m = re.search(rf"^{name}:\s*(.+)$", reply, re.MULTILINE | re.IGNORECASE)
            return m.group(1).strip() if m else None

        reason = field("REASON") or "Best match on the map for your request."
        reply = "\n".join([
            "MARS SURFACE PREFERRED ROUTES",
            f"MISSION: {mission} | DESTINATION: {chosen['destination']}",
            f"DEPARTURE COORDINATES: {chosen['start']}",
            f"DESTINATION COORDINATES: {chosen['end']}",
            f"ROUTE REQUIREMENTS: {field('ROUTE REQUIREMENTS') or message.strip()}",
            f"HIGHLIGHTED ROUTE: {chosen['key']}: {chosen['name']}",
            f"REASON: {reason}",
        ])

    result = {"skill": "ROUTE_PREFERENCE", "source": source, "reply": reply, "highlight": chosen["id"]}
    if chosen["new"]:
        result["route"] = {
            "id": chosen["id"],
            "name": f"Martial: {chosen['name']}",
            "description": f"Chosen by Martial for: {message.strip()[:120]}",
            "cells": chosen["cells"],
            "stopCells": chosen["stopCells"],
            "stops": [{"name": "Departure"}, {"name": chosen["destination"]}],
        }
    return result


# ---- entry point -------------------------------------------------------------------
def ask(site_id, message, client_routes=None):
    """Answers one request about a landing site. Returns a dict for the website (see backend/server.py)."""
    message = (message or "").strip()
    if not message:
        raise AgentError("Ask me for directions between two points, or describe the route you want.")
    grid = mm.load_grid(site_id)
    site = mm.SITE_INFO[site_id]
    skill = route_skill(grid, message)
    if skill == "NAVIGATION":
        return run_navigation(grid, site, message)
    return run_route_preference(grid, site, message, client_routes)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print('Usage: python MarsOllama.py <jezero|gale|gusev|meridiani> "your request"')
        sys.exit(1)
    try:
        out = ask(sys.argv[1], " ".join(sys.argv[2:]))
    except AgentError as e:
        print(e)
        sys.exit(1)
    print(f"[{out['skill']} via {out['source']}]\n")
    print(out["reply"])
