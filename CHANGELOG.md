# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-05-30

### Changed

- **Documentation fully translated to English:** README, CHANGELOG, HTML meta tags, and JavaScript module headers.
- Polished GitHub README with live-demo badge, dataset table, and repository layout.

## [0.2.0] - 2026-05-30

### Added

- **Bicycle routes** layer: OSM `route=bicycle` relations for Vaucluse, weekly cache.
- `VERSION` file and `scripts/project_meta.py` / `scripts/bump_version.py` for centralized semver.
- `CHANGELOG.md`.

### Changed

- Repository references aligned with `dataroads-FR84`; footer redesigned (README credit + discreet repo link + version number).
- Source freshness badges restyled to neutral gray pills.
- Bicycle routes placed before construction roads in the legend.
- Construction-roads Overpass query fixed (department 84 filter); Python script and map display criteria harmonized.
- Construction layer UX: no popup when empty; zero counts are sufficient.

### Fixed

- Empty `construction-roads.geojson` cache caused by an invalid Overpass query (administrative area misplaced inside a union).

## [0.1.0] - 2026-05-17

### Added

- Web map prototype: Vaucluse departmental network, communes, department boundary, 2024 crash data, CD84 traffic counts, Info Routière events, Avignon weather, OSM quality panel.
- Data refresh scripts `update_osm_geojson.py` and `update_external_data.py`.
- GitHub Pages deployment and automated data-refresh workflows.

[Unreleased]: https://github.com/thepriben/dataroads-FR84/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/thepriben/dataroads-FR84/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thepriben/dataroads-FR84/releases/tag/v0.1.0
