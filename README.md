> **Project lead:** Jean-Louis Zimmermann [@JLZIMMERMANN](https://github.com/JLZIMMERMANN), *chargé de mission outils digitaux routiers* at the Conseil Départemental du Vaucluse (CD84), 2026.

---

[![Live demo](https://img.shields.io/badge/demo-GitHub%20Pages-2C3E50?style=flat-square)](https://thepriben.github.io/dataroads-FR84/)
[![Version](https://img.shields.io/badge/version-0.2.1-blue?style=flat-square)](CHANGELOG.md)
[![OpenStreetMap](https://img.shields.io/badge/data-OpenStreetMap-7EBC6F?style=flat-square&logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)

<img width="1000" alt="Vaucluse departmental road network map" src="https://github.com/user-attachments/assets/2bbcf25c-9aca-41ff-8773-8a8908b84bba" />

---

# dataroads-FR84

**Static web map prototype** for exploring the departmental road network of Vaucluse (French department 84).

Incubated within the *Bureau de l'information Routière* at CD84, this demonstrator brings together road data, crash statistics, traffic counts, and OpenStreetMap quality checks in a lightweight, browser-only interface — no backend required.

**Live demo:** [thepriben.github.io/dataroads-FR84](https://thepriben.github.io/dataroads-FR84/)

## What the map shows

| Layer | Source | Notes |
| --- | --- | --- |
| Departmental road hierarchy | OpenStreetMap | Regional, territorial, and local networks |
| Department boundary & communes | OpenStreetMap / static | Territorial context for every route |
| CD84 traffic-counting stations | [data.gouv.fr](https://www.data.gouv.fr) | Coloured by traffic level |
| Crash data (2024) | BAAC / provided file | Toggleable to avoid map clutter |
| Roads under construction or proposed | OSM weekly cache | `highway=construction` / `proposed` |
| Bicycle routes (*véloroutes*) | OSM weekly cache | `route=bicycle` relations |
| Live weather (Avignon) | Open-Meteo | Fetched directly by the browser |
| OSM data-quality panel | Computed client-side | Segments with / without usable OSM relations |

The user interface is in **French** (target audience: CD84 staff and partners).

## Why it matters for CD84

The prototype makes road data readable in a single view. For field agents or managers, it answers everyday questions quickly:

- Where are the most structurally important departmental roads?
- Which routes carry the heaviest traffic according to available counts?
- Where do crashes from the loaded vintage concentrate?
- Which communes are served by a given axis?
- Which OSM segments are well documented, and which need correction?
- Can a file published on data.gouv.fr or an OSM extract be reused without calling APIs on every visit?

## Data freshness

The page displays when each external dataset was last integrated and when the next refresh is expected. The browser reads **local GeoJSON files**; Python maintenance scripts regenerate them on a schedule.

| Schedule | Datasets | Mechanism |
| --- | --- | --- |
| Weekly (Mon 03:17 UTC) | OSM layers (roads, communes, construction, bicycle routes) | `scripts/update_osm_geojson.py` via GitHub Actions |
| Every 3 h (xx:23 UTC) | Traffic counts (data.gouv.fr), road events (Info Routière) | `scripts/update_external_data.py` via GitHub Actions |
| Manual / pinned | Department boundary, crash file, demo fallbacks | Committed under `data/static/` and `data/demo/` |
| Live (every 10 min) | Weather | Browser → Open-Meteo API |

**Overpass is never called from the browser.** It is used only inside the OSM refresh script.

## Dataset vintages (committed snapshot)

| Data | Source | Vintage / freshness | Notes |
| --- | --- | --- | --- |
| Departmental roads | OpenStreetMap | cache 2026-05-17 22:52 UTC | Network geometry, not an official CD84 administrative vintage |
| Construction / proposed roads | OpenStreetMap | weekly cache | Ways tagged `highway=construction` or `proposed` in FR-84 |
| Bicycle routes | OpenStreetMap | weekly cache | `route=bicycle` relations in the department |
| Communes | OpenStreetMap | cache 2026-05-17 22:53 UTC | 151 communes; population tags reference 2021 |
| Vaucluse boundary | OpenStreetMap | static GeoJSON | Pinned in `data/static/` |
| Crash data | BAAC / provided file | **2024** | 113 crashes, all dated 2024 |
| Traffic counts | data.gouv.fr | 1996–2025 | 3,098 observations; map shows latest year per station |
| Road events | Info Routière | 3-hour cache | |
| Weather | Open-Meteo | current | Direct API call, not versioned |

## Quick start

Serve the repository root with any static file server:

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080/](http://localhost:8080/).

No build step. No Node.js dependencies.

## Repository layout

```
data/
  osm/          # GeoJSON from Overpass (refreshed weekly)
  static/       # Pinned GeoJSON (boundary, crashes, …)
  external/     # GeoJSON from data.gouv.fr & Info Routière (every 3 h)
  demo/         # Fallback samples when a live source is unavailable
js/
  config.js     # Paths, version, live API endpoints
  api.js        # GeoJSON loader with in-memory cache
  app.js        # Map logic, layers, legend, quality panel
scripts/
  update_osm_geojson.py      # Overpass → data/osm/
  update_external_data.py    # External APIs → data/external/
  project_meta.py            # VERSION file helpers
  bump_version.py            # Semver sync & GitHub Releases
  publish_github_pages.py    # One-shot repo + Pages bootstrap
```

## Refresh data locally

```bash
python3 scripts/update_osm_geojson.py
python3 scripts/update_external_data.py
```

Overpass requests use an explicit User-Agent (version read from `VERSION`):

```text
dataroads-FR84/0.2.1 (https://github.com/thepriben/dataroads-FR84)
```

If Info Routière is unreachable, `update_external_data.py` keeps an empty GeoJSON with the error recorded in `_cache`.

## Versioning

Application version lives in [`VERSION`](VERSION) (currently **0.2.1**). Python scripts read it via `scripts/project_meta.py`; the front-end reads `js/config.js` (kept in sync by the commands below).

```bash
# Print current version
python3 scripts/bump_version.py show

# Copy VERSION → js/config.js
python3 scripts/bump_version.py sync

# Bump semver (patch | minor | major) — update CHANGELOG.md first
python3 scripts/bump_version.py bump patch

# After commit, push, and git tag vX.Y.Z — create GitHub Release
python3 scripts/bump_version.py release
```

Release history: [`CHANGELOG.md`](CHANGELOG.md).

## Deployment

GitHub Pages serves the repository root on every push to `main` (workflow: `.github/workflows/deploy-pages.yml`).

To bootstrap a fresh repository and enable Pages:

```bash
python3 scripts/publish_github_pages.py --help
```

## Contributing

Issues and pull requests are welcome on [github.com/thepriben/dataroads-FR84](https://github.com/thepriben/dataroads-FR84).

When refreshing OSM data, respect the [Overpass API usage policy](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Instance_Usage_Policy) and keep the User-Agent string intact.

## Acknowledgements

- **Conseil Départemental du Vaucluse (CD84)** — institutional context and traffic-counting data
- **OpenStreetMap contributors** — road network and bicycle route geometry
- **data.gouv.fr** — open traffic-counting dataset
- **Open-Meteo** — live weather without an API key
