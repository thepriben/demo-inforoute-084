(function (window) {
    'use strict';

    const repository = 'https://github.com/thepriben/demo-inforoute-084';

    window.APP_CONFIG = Object.freeze({
        appName: 'demo-inforoute-084',
        version: '0.1.0',
        repository,
        data: {
            geojson: {
                'departmental-roads': 'data/osm/departmental-roads.geojson',
                'construction-roads': 'data/osm/construction-roads.geojson',
                communes: 'data/osm/communes-vaucluse.geojson',
                'traffic-counting': 'data/external/traffic-counting.geojson',
                'road-events': 'data/external/road-events.geojson'
            },
            json: {
                weather: 'data/external/weather-avignon.json'
            }
        }
    });
})(window);
