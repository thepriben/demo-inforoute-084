/**
 * @file dataroads-FR84 application configuration.
 * @description Static web map for the Vaucluse (FR-84) departmental road network.
 *   Centralizes GeoJSON paths, semver, repository URL, and live API endpoints.
 *   Consumed by {@link InforouteApi} and the map bootstrap in app.js.
 * @see https://thepriben.github.io/dataroads-FR84/
 * @see https://github.com/thepriben/dataroads-FR84
 */
(function (window) {
    'use strict';

    const repository = 'https://github.com/thepriben/dataroads-FR84';

    window.APP_CONFIG = Object.freeze({
        appName: 'dataroads-FR84',
        version: '0.2.1',
        repository,
        data: {
            externalRefreshHours: 3,
            geojson: {
                'departmental-roads': 'data/osm/departmental-roads.geojson',
                'construction-roads': 'data/osm/construction-roads.geojson',
                'bicycle-routes': 'data/osm/bicycle-routes.geojson',
                'vaucluse-boundary': 'data/static/vaucluse-boundary.geojson',
                communes: 'data/osm/communes-vaucluse.geojson',
                accidents: 'data/static/accidents-vaucluse.geojson',
                'traffic-counting': 'data/external/traffic-counting.geojson',
                'traffic-counting-demo': 'data/demo/traffic-counting-demo.geojson',
                'road-events': 'data/external/road-events.geojson'
            }
        },
        live: {
            weather: {
                sourceName: 'Open-Meteo Avignon',
                url: 'https://api.open-meteo.com/v1/forecast?latitude=43.9493&longitude=4.8055&current=temperature_2m,weather_code&timezone=Europe/Paris',
                refreshMs: 10 * 60 * 1000,
                timeoutMs: 10000
            }
        }
    });
})(window);
