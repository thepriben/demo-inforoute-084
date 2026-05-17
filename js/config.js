(function (window) {
    'use strict';

    const repository = 'https://github.com/thepriben/demo-inforoute-084';

    window.APP_CONFIG = Object.freeze({
        appName: 'demo-inforoute-084',
        version: '0.1.0',
        repository,
        overpass: {
            endpoint: 'https://overpass-api.de/api/interpreter',
            userAgent: `demo-inforoute-084/0.1.0 (${repository})`,
            timeoutMs: 90000,
            preferCache: true,
            cache: {
                'departmental-roads': 'data/osm/departmental-roads.geojson',
                'construction-roads': 'data/osm/construction-roads.geojson',
                communes: 'data/osm/communes-vaucluse.geojson'
            }
        }
    });
})(window);
