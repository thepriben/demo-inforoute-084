/**
 * @file dataroads-FR84 data access layer.
 * @description Browser-side loader for versioned GeoJSON caches and live JSON
 *   endpoints declared in {@link APP_CONFIG}. Provides in-memory caching so
 *   repeated layer toggles do not re-fetch files.
 * @namespace InforouteApi
 * @see config.js
 */
(function (window) {
    'use strict';

    const config = window.APP_CONFIG || {};
    const geojsonConfig = config.data?.geojson || {};
    const liveConfig = config.live || {};
    const responseCache = new Map();

    function createTimeout(timeoutMs) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

        return {
            signal: controller.signal,
            clear: () => window.clearTimeout(timeoutId)
        };
    }

    async function fetchJson(url, options = {}, requestOptions = {}) {
        const timeout = createTimeout(requestOptions.timeoutMs || 30000);

        try {
            const response = await fetch(url, {
                credentials: 'omit',
                ...options,
                signal: options.signal || timeout.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
            }

            return await response.json();
        } finally {
            timeout.clear();
        }
    }

    async function fetchGeoJson(cacheName) {
        const cachePath = geojsonConfig[cacheName];

        if (!cachePath) {
            throw new Error(`GeoJSON inconnu: ${cacheName}`);
        }

        if (responseCache.has(cachePath)) {
            return responseCache.get(cachePath);
        }

        const data = await fetchJson(cachePath, { cache: 'no-cache' }, { timeoutMs: 20000 });

        if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
            throw new Error(`GeoJSON invalide: ${cachePath}`);
        }

        responseCache.set(cachePath, data);
        return data;
    }

    function getLiveSource(sourceName) {
        const source = liveConfig[sourceName];

        if (!source?.url) {
            throw new Error(`Source dynamique inconnue: ${sourceName}`);
        }

        return source;
    }

    async function fetchLiveJson(sourceName) {
        const source = getLiveSource(sourceName);
        return fetchJson(source.url, { cache: 'no-store' }, { timeoutMs: source.timeoutMs || 10000 });
    }

    function normalizeCommuneName(value) {
        return String(value || '')
            .trim()
            .toLocaleLowerCase('fr-FR')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    async function fetchCommuneBoundary(communeName) {
        const targetName = normalizeCommuneName(communeName);
        const data = await fetchGeoJson('communes');

        return data.features.find((feature) => (
            normalizeCommuneName(feature.properties?.name) === targetName
        )) || null;
    }

    window.InforouteApi = Object.freeze({
        fetchJson,
        fetchGeoJson,
        fetchLiveJson,
        getLiveSource,
        fetchCommuneBoundary
    });
})(window);
