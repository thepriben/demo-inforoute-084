        // Fonctions globales accessibles depuis le HTML

        // Icônes SVG pour les toggles œil ouvert / fermé (style Lucide)
        const EYE_OPEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
        const EYE_CLOSED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

        function setToggleIcon(iconElement, visible) {
            if (!iconElement) return;
            iconElement.innerHTML = visible ? EYE_OPEN_SVG : EYE_CLOSED_SVG;
            iconElement.classList.toggle('is-hidden', !visible);
            iconElement.setAttribute('aria-label', visible ? 'Couche visible (cliquer pour masquer)' : 'Couche masquée (cliquer pour afficher)');
            iconElement.setAttribute('title', visible ? 'Couche visible — cliquer pour masquer' : 'Couche masquée — cliquer pour afficher');
        }

        // ========== FRESHNESS BADGES (date d'intégration + prochain rafraîchissement) ==========

        const FRESHNESS_SCHEDULES = {
            osm: {
                label: 'Hebdomadaire — lundi 03:17 UTC',
                source: 'OpenStreetMap via Overpass',
                cron: '17 3 * * 1',
                intervalMs: 7 * 24 * 60 * 60 * 1000
            },
            external: {
                label: 'Toutes les 3 h — à xx:23 UTC',
                source: 'data.gouv.fr & Bison Futé',
                cron: '23 */3 * * *',
                intervalMs: 3 * 60 * 60 * 1000
            },
            static: {
                label: 'Figé dans le dépôt — mise à jour manuelle',
                source: 'Snapshot versionné (BAAC / OSM)'
            },
            live: {
                label: 'Toutes les 10 min — directement dans le navigateur',
                source: 'Open-Meteo (live)',
                intervalMs: 10 * 60 * 1000
            }
        };

        function parseCronField(field, min, max) {
            if (field === '*') {
                const out = [];
                for (let i = min; i <= max; i++) out.push(i);
                return out;
            }
            if (field.startsWith('*/')) {
                const step = Number.parseInt(field.slice(2), 10) || 1;
                const out = [];
                for (let i = min; i <= max; i += step) out.push(i);
                return out;
            }
            return field
                .split(',')
                .map(value => Number.parseInt(value, 10))
                .filter(Number.isFinite);
        }

        // Compute the next UTC occurrence matching a 5-field cron expression.
        // Only supports the patterns we use (`23 */3 * * *`, `17 3 * * 1`).
        function nextCronUtc(cronExpr, from = new Date()) {
            const parts = cronExpr.trim().split(/\s+/);
            if (parts.length !== 5) return null;
            const minutes = parseCronField(parts[0], 0, 59);
            const hours = parseCronField(parts[1], 0, 23);
            const doms = parseCronField(parts[2], 1, 31);
            const months = parseCronField(parts[3], 1, 12);
            const dows = parseCronField(parts[4], 0, 6);

            const candidate = new Date(from.getTime() + 60000);
            candidate.setUTCSeconds(0, 0);

            for (let i = 0; i < 366 * 24 * 60; i++) {
                if (
                    minutes.includes(candidate.getUTCMinutes()) &&
                    hours.includes(candidate.getUTCHours()) &&
                    doms.includes(candidate.getUTCDate()) &&
                    months.includes(candidate.getUTCMonth() + 1) &&
                    dows.includes(candidate.getUTCDay())
                ) {
                    return candidate;
                }
                candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
            }
            return null;
        }

        function formatRelativeDuration(ms, opts = {}) {
            const future = !!opts.future;
            const abs = Math.abs(ms);
            const prefix = future ? 'dans ' : 'il y a ';
            if (abs < 60000) return future ? 'imminent' : "à l'instant";
            const minutes = Math.round(abs / 60000);
            if (minutes < 60) return `${prefix}${minutes} min`;
            const hours = Math.floor(minutes / 60);
            const remMin = minutes % 60;
            if (hours < 24) return `${prefix}${hours}h${remMin > 0 ? String(remMin).padStart(2, '0') : ''}`;
            const days = Math.floor(hours / 24);
            const remH = hours % 24;
            return `${prefix}${days}j${remH > 0 ? ` ${remH}h` : ''}`;
        }

        function freshnessState(generatedAtMs, scheduleConfig) {
            if (!scheduleConfig.intervalMs) {
                return { status: 'static' };
            }
            if (!generatedAtMs) {
                return { status: 'unknown' };
            }
            const ageMs = Date.now() - generatedAtMs;
            const interval = scheduleConfig.intervalMs;
            if (ageMs <= interval * 1.15) return { status: 'fresh' };
            if (ageMs <= interval * 2) return { status: 'late' };
            return { status: 'stale' };
        }

        const latestCacheByGroup = {};

        function updateRefreshFormulaCell(scheduleKey) {
            const config = FRESHNESS_SCHEDULES[scheduleKey];
            if (!config) return;
            const cellId = 'refreshMeta' + scheduleKey.charAt(0).toUpperCase() + scheduleKey.slice(1);
            const cell = document.getElementById(cellId);
            if (!cell) return;

            const generatedAt = latestCacheByGroup[scheduleKey];
            const lines = [];

            if (scheduleKey === 'osm') lines.push('Hebdo · lun. 03:17 UTC');
            else if (scheduleKey === 'external') lines.push('Toutes les 3 h · xx:23 UTC');

            if (config.cron) {
                const next = nextCronUtc(config.cron);
                if (generatedAt) {
                    const age = formatRelativeDuration(Date.now() - new Date(generatedAt).getTime());
                    const nextLabel = next
                        ? `prochain ${formatRelativeDuration(next.getTime() - Date.now(), { future: true })}`
                        : '';
                    lines.push(`${age} · ${nextLabel}`);
                } else if (next) {
                    lines.push(`prochain ${formatRelativeDuration(next.getTime() - Date.now(), { future: true })}`);
                }
            }

            cell.innerHTML = lines.join('<br>');
        }

        function renderFreshnessBadge(element, { generatedAt, scheduleKey, errorMsg, layerVisible } = {}) {
            if (!element) return;
            const config = FRESHNESS_SCHEDULES[scheduleKey] || {};
            const generatedAtMs = generatedAt ? new Date(generatedAt).getTime() : null;
            let status = freshnessState(generatedAtMs, config).status;

            if (generatedAt && config.cron) {
                const current = latestCacheByGroup[scheduleKey];
                if (!current || new Date(generatedAt).getTime() > new Date(current).getTime()) {
                    latestCacheByGroup[scheduleKey] = generatedAt;
                    updateRefreshFormulaCell(scheduleKey);
                }
            }

            const ageText = generatedAtMs
                ? formatRelativeDuration(Date.now() - generatedAtMs)
                : (scheduleKey === 'static' ? 'snapshot' : '—');

            let nextText = '';
            if (config.cron) {
                const next = nextCronUtc(config.cron);
                if (next) {
                    nextText = ` • prochain ${formatRelativeDuration(next.getTime() - Date.now(), { future: true })}`;
                }
            } else if (config.intervalMs && generatedAtMs) {
                const nextMs = generatedAtMs + config.intervalMs;
                if (nextMs > Date.now()) {
                    nextText = ` • prochain ${formatRelativeDuration(nextMs - Date.now(), { future: true })}`;
                }
            }

            element.classList.add('freshness-badge');
            element.dataset.scheduleKey = scheduleKey || '';
            if (generatedAt) element.dataset.generatedAt = generatedAt;
            if (errorMsg) element.dataset.errorMsg = errorMsg; else delete element.dataset.errorMsg;

            const tooltipLines = [
                config.label || '',
                config.source ? `Source\u00a0: ${config.source}` : '',
                generatedAt ? `Intégré le ${formatParisDateTime(generatedAt)}` : '',
                errorMsg ? `Erreur\u00a0: ${errorMsg}` : ''
            ].filter(Boolean);
            element.title = tooltipLines.join('\n');

            if (layerVisible === undefined && element.id && typeof isFreshnessBadgeLayerVisible === 'function') {
                layerVisible = isFreshnessBadgeLayerVisible(element.id);
            } else if (layerVisible === undefined) {
                layerVisible = element.dataset.layerVisible !== 'false';
            }

            element.dataset.layerVisible = layerVisible ? 'true' : 'false';
            const layerHidden = !layerVisible;

            if (layerHidden) {
                status = 'hidden';
            } else if (!config.intervalMs && generatedAtMs) {
                status = 'static';
            }

            const errorIcon = errorMsg ? '<span class="freshness-error-icon" aria-hidden="true">⚠</span>' : '';
            const pillClasses = ['freshness-pill', `freshness-pill--${status}`];
            if (errorMsg) pillClasses.push('freshness-pill--error');
            element.classList.toggle('is-layer-hidden', layerHidden);
            element.innerHTML = `<span class="${pillClasses.join(' ')}"><span class="freshness-dot" aria-hidden="true"></span>${ageText}${nextText}${errorIcon}</span>`;
        }

        function refreshAllBadges() {
            document.querySelectorAll('.freshness-badge').forEach(el => {
                const scheduleKey = el.dataset.scheduleKey;
                const generatedAt = el.dataset.generatedAt;
                const errorMsg = el.dataset.errorMsg;
                if (scheduleKey) {
                    renderFreshnessBadge(el, { generatedAt, scheduleKey, errorMsg });
                }
            });
            Object.keys(FRESHNESS_SCHEDULES).forEach(updateRefreshFormulaCell);
            if (typeof syncLegendChrome === 'function') {
                document.querySelectorAll('.legend-family').forEach(refreshFamilyMeta);
            }
        }

        window.setInterval(refreshAllBadges, 60000);

        // Initial render so the bottom panel shows the cron formulas right away.
        document.addEventListener('DOMContentLoaded', () => {
            Object.keys(FRESHNESS_SCHEDULES).forEach(updateRefreshFormulaCell);
            document.querySelectorAll('.freshness-badge').forEach(el => {
                const scheduleKey = el.dataset.scheduleKey;
                if (scheduleKey) renderFreshnessBadge(el, { scheduleKey });
            });
        });

        // ========== FAMILLES DE SECTIONS DE LA SIDEBAR (collapsibles) ==========

        function syncFreshnessBadgeVisibility() {
            document.querySelectorAll('.freshness-badge[id]').forEach(element => {
                const layerVisible = isFreshnessBadgeLayerVisible(element.id);
                element.dataset.layerVisible = layerVisible ? 'true' : 'false';
                renderFreshnessBadge(element, {
                    generatedAt: element.dataset.generatedAt,
                    scheduleKey: element.dataset.scheduleKey,
                    errorMsg: element.dataset.errorMsg || undefined
                });
            });
        }

        function syncLegendChrome() {
            syncFreshnessBadgeVisibility();
            document.querySelectorAll('.legend-family').forEach(refreshFamilyMeta);
        }

        function refreshFamilyMeta(fam) {
            if (!fam) return;
            const meta = fam.querySelector('.legend-family-meta');
            if (!meta) return;

            const counts = getFamilyLayerCounts(fam.dataset.family);
            if (!counts) {
                meta.innerHTML = '';
                meta.hidden = true;
                return;
            }

            meta.hidden = false;
            const { visible, total } = counts;
            const label = visible > 1 ? 'couches visibles' : 'couche visible';
            const dots = Array.from({ length: total }, (_, index) =>
                `<span class="layer-vis-dot${index < visible ? ' is-on' : ''}"></span>`
            ).join('');

            meta.classList.toggle('is-all-visible', visible === total);
            meta.classList.toggle('is-partial-visible', visible > 0 && visible < total);
            meta.classList.toggle('is-none-visible', visible === 0);
            meta.title = `${visible} ${label} sur ${total}`;
            meta.innerHTML = `<span class="layer-vis-indicator"><span class="layer-vis-dots" aria-hidden="true">${dots}</span><span class="layer-vis-num"><strong>${visible}</strong><span class="layer-vis-sep">/</span>${total}</span></span>`;
        }

        function setupLegendFamilies() {
            document.querySelectorAll('.legend-family').forEach(fam => {
                refreshFamilyMeta(fam);
                const header = fam.querySelector('.legend-family-header');
                if (!header) return;
                header.addEventListener('click', () => {
                    const isExpanded = fam.dataset.expanded !== 'false';
                    const nextExpanded = !isExpanded;
                    fam.dataset.expanded = nextExpanded ? 'true' : 'false';
                    header.setAttribute('aria-expanded', String(nextExpanded));
                });
            });

            // Quand la section "Limitations" devient visible/invisible dynamiquement,
            // on rafraîchit le compteur de la famille "factual".
            const limitations = document.getElementById('limitationsLegend');
            if (limitations && typeof MutationObserver !== 'undefined') {
                const observer = new MutationObserver(() => {
                    syncLegendChrome();
                });
                observer.observe(limitations, { attributes: true, attributeFilter: ['style'] });
            }
            const roadInfo = document.getElementById('road-info-section');
            if (roadInfo && typeof MutationObserver !== 'undefined') {
                const observer = new MutationObserver(() => {
                    syncLegendChrome();
                });
                observer.observe(roadInfo, { attributes: true, attributeFilter: ['style'] });
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            setupLegendFamilies();
            syncLegendChrome();
        });

        // ========== WIKIDATA INFOBOX (onglet dédié dans le popup route) ==========

        const WIKIDATA_INFOBOX_CACHE = new Map();

        // Propriétés Wikidata mises en avant dans l'infobox, dans l'ordre d'affichage.
        const WIKIDATA_PROPS_TO_DISPLAY = [
            { id: 'P31',   label: 'Nature' },
            { id: 'P17',   label: 'Pays' },
            { id: 'P131',  label: 'Localisation' },
            { id: 'P1813', label: 'Nom abrégé' },
            { id: 'P2043', label: 'Longueur' },
            { id: 'P126',  label: 'Gestionnaire' },
            { id: 'P137',  label: 'Opérateur' },
            { id: 'P16',   label: 'Système routier' },
            { id: 'P1622', label: 'Sens de circulation' },
            { id: 'P571',  label: 'Date de création' },
            { id: 'P729',  label: 'Mise en service' },
            { id: 'P1619', label: 'Date d\'ouverture' }
        ];

        const WIKIDATA_SHIELD_PROPS = ['P1766', 'P154'];
        const WIKIDATA_IMAGE_PROPS = ['P18'];

        function commonsImageUrl(filename, width = 400) {
            return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        async function fetchWikidataItem(qid) {
            const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`;
            const response = await fetch(url, { credentials: 'omit' });
            if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
            const data = await response.json();
            return data.entities ? data.entities[qid] : null;
        }

        async function fetchWikidataLabels(qids) {
            if (!qids.length) return {};
            const params = new URLSearchParams({
                action: 'wbgetentities',
                ids: qids.slice(0, 50).join('|'),
                format: 'json',
                languages: 'fr|en',
                props: 'labels',
                origin: '*'
            });
            const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { credentials: 'omit' });
            if (!response.ok) throw new Error(`Wikidata labels HTTP ${response.status}`);
            const data = await response.json();
            const out = {};
            Object.entries(data.entities || {}).forEach(([id, entity]) => {
                out[id] = entity.labels?.fr?.value || entity.labels?.en?.value || id;
            });
            return out;
        }

        async function fetchWikipediaSummary(title) {
            try {
                const url = `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
                const response = await fetch(url, { credentials: 'omit' });
                if (!response.ok) return null;
                return await response.json();
            } catch {
                return null;
            }
        }

        function extractWikidataValues(entity) {
            const claims = entity.claims || {};
            const out = {};
            Object.keys(claims).forEach(propId => {
                out[propId] = claims[propId]
                    .filter(s => s.rank !== 'deprecated' && s.mainsnak?.snaktype === 'value')
                    .map(s => ({ value: s.mainsnak.datavalue.value, type: s.mainsnak.datavalue.type }));
            });
            return out;
        }

        function formatWikidataValuePlain(item, labels) {
            if (item.type === 'wikibase-entityid' && item.value.id) {
                return escapeHtml(labels[item.value.id] || item.value.id);
            }
            if (item.type === 'quantity') {
                const amount = item.value.amount.replace(/^\+/, '');
                const unitUrl = item.value.unit;
                const unitLabel = unitUrl && unitUrl !== '1' ? ' ' + (labels[unitUrl.split('/').pop()] || '') : '';
                return `${amount}${unitLabel}`;
            }
            if (item.type === 'time') {
                return item.value.time.replace(/^\+/, '').slice(0, 10);
            }
            if (item.type === 'monolingualtext') return escapeHtml(item.value.text);
            if (item.type === 'string') return escapeHtml(item.value);
            if (item.type === 'globecoordinate') {
                return `${item.value.latitude.toFixed(5)}, ${item.value.longitude.toFixed(5)}`;
            }
            return '—';
        }

        function firstCommonsFilename(claims, propIds) {
            for (const propId of propIds) {
                const filename = claims[propId]?.[0]?.value;
                if (typeof filename === 'string' && filename.trim()) return filename.trim();
            }
            return null;
        }

        function attachRoutePopupInfobox(polyline) {
            polyline.on('popupopen', () => {
                const popupEl = polyline.getPopup()?.getElement();
                if (!popupEl) return;
                const host = popupEl.querySelector('.popup-infobox-host');
                if (!host || host.dataset.loaded === '1') return;
                host.dataset.loaded = '1';
                const qid = host.dataset.qid;
                const containerId = host.id;
                if (qid && containerId) loadWikidataInfobox(qid, containerId);
            });
        }

        async function loadWikidataInfobox(qid, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            if (WIKIDATA_INFOBOX_CACHE.has(qid)) {
                container.innerHTML = WIKIDATA_INFOBOX_CACHE.get(qid);
                return;
            }

            container.innerHTML = `<div class="popup-infobox-loading">Chargement de l'infobox…</div>`;

            try {
                const entity = await fetchWikidataItem(qid);
                if (!entity) throw new Error('Entité introuvable');

                const labelFr = entity.labels?.fr?.value || entity.labels?.en?.value || qid;
                const descriptionFr = entity.descriptions?.fr?.value || entity.descriptions?.en?.value || '';
                const claims = extractWikidataValues(entity);

                const entityIds = new Set();
                WIKIDATA_PROPS_TO_DISPLAY.forEach(prop => {
                    (claims[prop.id] || []).forEach(c => {
                        if (c.type === 'wikibase-entityid' && c.value.id) entityIds.add(c.value.id);
                        if (c.type === 'quantity' && c.value.unit && c.value.unit !== '1') {
                            const id = c.value.unit.split('/').pop();
                            if (id?.startsWith('Q')) entityIds.add(id);
                        }
                    });
                });

                const labels = entityIds.size ? await fetchWikidataLabels([...entityIds]).catch(() => ({})) : {};

                const shieldFilename = firstCommonsFilename(claims, WIKIDATA_SHIELD_PROPS);
                const illustrationFilename = shieldFilename
                    ? null
                    : firstCommonsFilename(claims, WIKIDATA_IMAGE_PROPS);
                const shieldUrl = shieldFilename ? commonsImageUrl(shieldFilename, 220) : null;
                const illustrationUrl = illustrationFilename ? commonsImageUrl(illustrationFilename, 480) : null;

                const frWikiTitle = entity.sitelinks?.frwiki?.title;
                const wikipediaSummary = frWikiTitle ? await fetchWikipediaSummary(frWikiTitle) : null;

                const claimsRows = WIKIDATA_PROPS_TO_DISPLAY
                    .filter(prop => claims[prop.id]?.length)
                    .map(prop => {
                        const values = claims[prop.id]
                            .slice(0, 3)
                            .map(c => formatWikidataValuePlain(c, labels))
                            .join('<br>');
                        return `
                            <tr>
                                <td class="infobox-prop-label">${prop.label}</td>
                                <td class="infobox-prop-value">${values}</td>
                            </tr>
                        `;
                    }).join('');

                const html = `
                    <div class="wikidata-infobox">
                        ${shieldUrl ? `
                            <div class="infobox-shield-wrap">
                                <img class="infobox-shield" src="${shieldUrl}" alt="Panneau routier" loading="lazy">
                            </div>
                        ` : ''}
                        <div class="infobox-header">
                            <div class="infobox-header-text">
                                <div class="infobox-title">${escapeHtml(labelFr)}</div>
                                ${descriptionFr ? `<div class="infobox-description">${escapeHtml(descriptionFr)}</div>` : ''}
                            </div>
                            <span class="infobox-qid">${qid}</span>
                        </div>

                        ${illustrationUrl ? `
                            <img class="infobox-illustration" src="${illustrationUrl}" alt="" loading="lazy">
                        ` : ''}

                        ${wikipediaSummary?.extract ? `
                            <div class="infobox-extract">
                                ${escapeHtml(wikipediaSummary.extract.slice(0, 320))}${wikipediaSummary.extract.length > 320 ? '…' : ''}
                            </div>
                        ` : ''}

                        ${claimsRows ? `
                            <table class="infobox-table">
                                ${claimsRows}
                            </table>
                        ` : '<div class="infobox-empty">Aucune propriété structurée renseignée.</div>'}

                        <div class="infobox-source">Données issues de Wikidata</div>
                    </div>
                `;

                WIKIDATA_INFOBOX_CACHE.set(qid, html);
                container.innerHTML = html;
            } catch (error) {
                console.error('Wikidata infobox error:', error);
                container.innerHTML = `
                    <div class="infobox-error">
                        <strong>Infobox indisponible</strong><br>
                        <small>${escapeHtml(error.message)}</small>
                    </div>
                `;
            }
        }

        window.loadWikidataInfobox = loadWikidataInfobox;

        const hierarchyColors = {
            regional: '#E74C3C',
            territorial: '#F39C12',
            local: '#3498DB'
        };

        const hierarchyWeights = {
            regional: 6,
            territorial: 5,
            local: 4
        };

        function geoJsonLineFeatureToWay(feature) {
            if (!feature?.geometry || feature.geometry.type !== 'LineString') return null;

            const properties = { ...(feature.properties || {}) };
            const geometry = feature.geometry.coordinates
                .filter(coord => Array.isArray(coord) && coord.length >= 2)
                .map(([lon, lat]) => ({ lat, lon }));

            if (geometry.length < 2) return null;

            return {
                type: 'way',
                id: properties.osm_id,
                tags: properties,
                geometry,
                hasRelation: properties.has_relation === true,
                relationId: properties.relation_id,
                relationTags: properties.relation_tags || null
            };
        }

        function geoJsonPolygonGeometryToLatLngRings(geometry) {
            if (!geometry) return [];

            if (geometry.type === 'Polygon') {
                const outerRing = geometry.coordinates?.[0] || [];
                return [outerRing.map(([lon, lat]) => [lat, lon])];
            }

            if (geometry.type === 'MultiPolygon') {
                return geometry.coordinates
                    .map(polygon => polygon?.[0] || [])
                    .filter(ring => ring.length > 0)
                    .map(ring => ring.map(([lon, lat]) => [lat, lon]));
            }

            return [];
        }

        function toggleQualityPanel() {
            const panel = document.getElementById('qualityPanel');
            const btn = document.getElementById('qualityBtn');

            panel.classList.toggle('active');

            if (panel.classList.contains('active')) {
                btn?.classList.add('is-active');
                if (!panel.dataset.loaded) {
                    calculateQualityMetrics();
                    panel.dataset.loaded = 'true';
                }
            } else {
                btn?.classList.remove('is-active');
            }
        }

        // === Map toolbar helpers ===
        // Each .map-tool carries data-accent="#xxxxxx" ; we mirror it into the
        // --map-tool-accent CSS var so the hover/active states pick the right hue.
        function setupMapToolbar() {
            document.querySelectorAll('.map-tool[data-accent]').forEach(btn => {
                btn.style.setProperty('--map-tool-accent', btn.dataset.accent);
            });
        }

        function setToolActive(btnId, active) {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.classList.toggle('is-active', !!active);
        }

        document.addEventListener('DOMContentLoaded', setupMapToolbar);

        // === Sidebar resizer (drag horizontal) ===
        // Permet à l'utilisateur d'élargir/réduire la sidebar en glissant le
        // séparateur au centre. La taille est persistée dans localStorage et
        // Leaflet est notifié pour redessiner la carte une fois le drag fini.
        function setupSidebarResizer() {
            const resizer = document.getElementById('sidebarResizer');
            const mainContent = document.querySelector('.main-content');
            if (!resizer || !mainContent) return;

            const MIN_WIDTH = 220;
            const MAX_WIDTH = 560;

            // Restaurer la largeur sauvegardée
            try {
                const saved = Number.parseInt(localStorage.getItem('sidebarWidth') || '', 10);
                if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
                    mainContent.style.setProperty('--sidebar-width', `${saved}px`);
                }
            } catch (_) { /* localStorage indisponible (mode privé) */ }

            let dragging = false;
            let pendingWidth = null;

            const onPointerMove = (event) => {
                if (!dragging) return;
                const rect = mainContent.getBoundingClientRect();
                const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX - rect.left));
                pendingWidth = next;
                mainContent.style.setProperty('--sidebar-width', `${next}px`);
            };

            const onPointerUp = () => {
                if (!dragging) return;
                dragging = false;
                document.body.classList.remove('is-resizing');
                resizer.classList.remove('is-dragging');
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                if (pendingWidth != null) {
                    try { localStorage.setItem('sidebarWidth', String(Math.round(pendingWidth))); } catch (_) {}
                }
                if (window.map && typeof window.map.invalidateSize === 'function') {
                    window.map.invalidateSize();
                }
            };

            resizer.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                dragging = true;
                pendingWidth = null;
                document.body.classList.add('is-resizing');
                resizer.classList.add('is-dragging');
                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
            });

            // Double-clic : remettre la largeur par défaut
            resizer.addEventListener('dblclick', () => {
                mainContent.style.removeProperty('--sidebar-width');
                try { localStorage.removeItem('sidebarWidth'); } catch (_) {}
                if (window.map && typeof window.map.invalidateSize === 'function') {
                    window.map.invalidateSize();
                }
            });

            // Flèches clavier quand le séparateur a le focus
            resizer.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const current = Number.parseInt(getComputedStyle(mainContent).getPropertyValue('--sidebar-width'), 10) || 320;
                const delta = event.key === 'ArrowLeft' ? -20 : 20;
                const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, current + delta));
                mainContent.style.setProperty('--sidebar-width', `${next}px`);
                try { localStorage.setItem('sidebarWidth', String(next)); } catch (_) {}
                if (window.map && typeof window.map.invalidateSize === 'function') {
                    window.map.invalidateSize();
                }
            });
        }

        document.addEventListener('DOMContentLoaded', setupSidebarResizer);

        let wazeLayer = null;
        let wazeEnabled = false;
        let trafficMarkers = [];
        let trafficVisible = false;
        let accidentMarkers = [];
        let accidentsVisible = false;
        let convoiMode = false;
        let constructionPolylines = [];
        let constructionVisible = false;
        let bicyclePolylines = [];
        let bicycleVisible = false;
        let bisonFuteMarkers = [];
        let bisonFuteVisible = false;
        let cityMarkers = [];
        let citiesVisible = true;
        const dataRefreshState = {};
        
        // État de visibilité par hiérarchie
        let hierarchyVisibility = {
            regional: true,
            territorial: true,
            local: true
        };

        function getFamilyLayerCounts(familyId) {
            switch (familyId) {
                case 'factual': {
                    let visible = 1;
                    let total = 1;
                    total += 3;
                    visible += ['regional', 'territorial', 'local'].filter(h => hierarchyVisibility[h]).length;
                    total += 1;
                    if (constructionVisible) visible++;
                    total += 1;
                    if (bicycleVisible) visible++;
                    total += 1;
                    if (citiesVisible) visible++;
                    const limitations = document.getElementById('limitationsLegend');
                    if (limitations && limitations.style.display !== 'none') {
                        total += 1;
                        if (document.getElementById('limitsBtn')?.classList.contains('is-active')) visible++;
                    }
                    return { visible, total };
                }
                case 'stats': {
                    let visible = 0;
                    const total = 2;
                    if (accidentsVisible) visible++;
                    if (trafficVisible || wazeEnabled) visible++;
                    return { visible, total };
                }
                case 'realtime':
                    return {
                        visible: bisonFuteVisible ? 1 : 0,
                        total: 1
                    };
                default:
                    return null;
            }
        }

        function isFreshnessBadgeLayerVisible(badgeId) {
            switch (badgeId) {
                case 'freshness-boundary':
                case 'freshness-wikidata':
                    return true;
                case 'freshness-hierarchy':
                    return hierarchyVisibility.regional || hierarchyVisibility.territorial || hierarchyVisibility.local;
                case 'freshness-construction':
                    return constructionVisible;
                case 'freshness-bicycle':
                    return bicycleVisible;
                case 'freshness-accidents':
                    return accidentsVisible;
                case 'freshness-traffic':
                    return trafficVisible || wazeEnabled;
                case 'freshness-bison-fute':
                    return bisonFuteVisible;
                default:
                    return true;
            }
        }

        function setSourceText(elementId, value) {
            const element = document.getElementById(elementId);
            if (element) element.textContent = value;
        }

        function formatParisDateTime(value) {
            if (!value) return 'date inconnue';

            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return 'date inconnue';

            return `${new Intl.DateTimeFormat('fr-FR', {
                timeZone: 'Europe/Paris',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date)} (Paris)`;
        }

        function collectYears(features, propertyNames) {
            const years = new Set();
            const yearPattern = /\b(19|20)\d{2}\b/g;

            (features || []).forEach(feature => {
                const props = feature.properties || {};
                propertyNames.forEach(propertyName => {
                    const value = props[propertyName];
                    if (value === undefined || value === null) return;

                    String(value).match(yearPattern)?.forEach(year => years.add(Number(year)));
                });
            });

            return [...years].filter(Number.isFinite).sort((a, b) => a - b);
        }

        function formatYearRange(years) {
            if (!years.length) return 'millésime inconnu';
            if (years.length === 1) return `${years[0]}`;
            return `${years[0]}-${years[years.length - 1]}`;
        }

        function updateExternalRefreshStatus(sourceName, cache = {}) {
            dataRefreshState[sourceName] = {
                generatedAt: cache.generated_at || null,
                error: cache.error || null
            };

            const statusElement = document.getElementById('externalRefreshStatus');
            if (!statusElement) return;

            const refreshHours = window.APP_CONFIG?.data?.externalRefreshHours || 3;
            const lines = Object.entries(dataRefreshState).map(([name, state]) => {
                const dateLabel = formatParisDateTime(state.generatedAt);
                const errorLabel = state.error ? ' - source indisponible, cache conservé' : '';
                return `${name}: ${dateLabel}${errorLabel}`;
            });

            statusElement.innerHTML = [
                `Données externes\u00a0: cache local rafraîchi toutes les ${refreshHours} h`,
                ...lines
            ].join('<br>');
        }

        // ========== ROUTES EN CONSTRUCTION ==========
        
        // Helper qui applique l'état "couche visible" sur les éléments de l'UI.
        function applyConstructionVisibleUi() {
            const icon = document.getElementById('constructionToggleIcon');
            const title = document.querySelector('.legend-section:has([id="constructionToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-construction]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            legendItems.forEach(item => {
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            });
        }

        function applyConstructionHiddenUi() {
            const icon = document.getElementById('constructionToggleIcon');
            const title = document.querySelector('.legend-section:has([id="constructionToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-construction]');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '600';
            legendItems.forEach(item => {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
            });
        }

        window.toggleConstruction = function() {
            constructionVisible = !constructionVisible;
            console.log('🔵 toggleConstruction →', constructionVisible);

            if (!constructionVisible) {
                constructionPolylines.forEach(polyline => {
                    if (window.map.hasLayer(polyline)) window.map.removeLayer(polyline);
                });
                applyConstructionHiddenUi();
                syncLegendChrome();
                console.log('✗ Routes en construction masquées');
                return;
            }

            // À afficher : si on n'a jamais chargé, on lance le fetch local (instantané).
            // Pas de faux timer 30 s : c'est juste une lecture de GeoJSON local.
            if (constructionPolylines.length === 0) {
                const icon = document.getElementById('constructionToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                window.loadConstructionRoads();
                return;
            }

            constructionPolylines.forEach(polyline => {
                if (!window.map.hasLayer(polyline)) polyline.addTo(window.map);
            });
            applyConstructionVisibleUi();
            syncLegendChrome();
            console.log(`✓ ${constructionPolylines.length} polyline(s) construction affichée(s)`);
        };

        // ========== VÉLOROUTES (relations OSM route=bicycle) ==========

        const BICYCLE_ROUTE_COLOUR = '#27AE60';

        function applyBicycleVisibleUi() {
            const icon = document.getElementById('bicycleToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bicycleToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bicycle]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            legendItems.forEach(item => {
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            });
        }

        function applyBicycleHiddenUi() {
            const icon = document.getElementById('bicycleToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bicycleToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bicycle]');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '600';
            legendItems.forEach(item => {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
            });
        }

        window.toggleBicycleRoutes = function() {
            bicycleVisible = !bicycleVisible;

            if (!bicycleVisible) {
                bicyclePolylines.forEach(polyline => {
                    if (window.map.hasLayer(polyline)) window.map.removeLayer(polyline);
                });
                applyBicycleHiddenUi();
                syncLegendChrome();
                return;
            }

            if (bicyclePolylines.length === 0) {
                const icon = document.getElementById('bicycleToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                window.loadBicycleRoutes();
                return;
            }

            bicyclePolylines.forEach(polyline => {
                if (!window.map.hasLayer(polyline)) polyline.addTo(window.map);
            });
            applyBicycleVisibleUi();
            syncLegendChrome();
        };

        // ========== CONVOIS EXCEPTIONNELS ==========
        
        window.toggleConvoisExceptionnels = function() {
            convoiMode = !convoiMode;
            setToolActive('convoiBtn', convoiMode);

            if (convoiMode) {
                console.log('🚛 Mode Convois Exceptionnels activé');
                // Filtrer et mettre en évidence les routes adaptées
                filterRoutesForConvois();

                // Petit toast discret (~2,5 s) : la légende complète est dans l'aide sidebar
                L.popup({ closeButton: false, autoClose: true, closeOnClick: true })
                    .setLatLng(window.map.getCenter())
                    .setContent(`
                        <div style="padding: 10px 14px; text-align: center; font-size: 0.85rem;">
                            <strong>🚛 Mode Convois Exceptionnels</strong><br>
                            <small style="color:#5b6770;">Réseau régional + territorial mis en évidence,<br>réseau local atténué.</small>
                        </div>
                    `)
                    .openOn(window.map);
                setTimeout(() => window.map.closePopup(), 2500);

            } else {
                console.log('✗ Mode Convois Exceptionnels désactivé');
                // Restaurer toutes les routes
                restoreAllRoutes();
                window.map.closePopup();
            }
        };

        function filterRoutesForConvois() {
            // Critères pour convois exceptionnels :
            // - Réseau régional : toujours adapté (axes principaux, largeur suffisante)
            // - Réseau territorial : généralement adapté
            // - Réseau local : à éviter (trop étroit, virages serrés)
            
            Object.keys(window.routePolylines).forEach(ref => {
                const polylines = window.routePolylines[ref];
                
                polylines.forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    
                    if (hierarchy === 'regional') {
                        // Routes régionales : OPTIMAL pour convois
                        polyline.setStyle({
                            color: '#27AE60',  // Vert = adapté
                            weight: 8,
                            opacity: 1
                        });
                        polyline.bringToFront();
                    } else if (hierarchy === 'territorial') {
                        // Routes territoriales : ADAPTÉ avec précautions
                        polyline.setStyle({
                            color: '#F39C12',  // Orange = adapté avec précaution
                            weight: 6,
                            opacity: 0.9
                        });
                    } else if (hierarchy === 'local') {
                        // Routes locales : À ÉVITER (masquer)
                        polyline.setStyle({
                            opacity: 0.15,
                            weight: 2
                        });
                    }
                });
            });
            
            // Compter les routes adaptées
            const routesRegionales = Object.keys(window.routePolylines).filter(ref => {
                const hierarchy = window.routePolylines[ref][0].options.roadHierarchy;
                return hierarchy === 'regional';
            }).length;
            
            const routesTerritoriales = Object.keys(window.routePolylines).filter(ref => {
                const hierarchy = window.routePolylines[ref][0].options.roadHierarchy;
                return hierarchy === 'territorial';
            }).length;
            
            console.log(`✓ ${routesRegionales} routes régionales (optimales)`);
            console.log(`✓ ${routesTerritoriales} routes territoriales (adaptées)`);
        }

        function restoreAllRoutes() {
            // Restaurer l'apparence normale de toutes les routes
            Object.keys(window.routePolylines).forEach(ref => {
                const polylines = window.routePolylines[ref];
                
                polylines.forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    polyline.setStyle({
                        color: hierarchyColors[hierarchy],
                        weight: hierarchyWeights[hierarchy],
                        opacity: 0.8
                    });
                });
            });
        }


        // Toggle global de toute la hiérarchie
        window.toggleAllHierarchy = function() {
            const allVisible = hierarchyVisibility.regional && hierarchyVisibility.territorial && hierarchyVisibility.local;
            const newState = !allVisible;
            
            // Appliquer le même état à tous les niveaux
            hierarchyVisibility.regional = newState;
            hierarchyVisibility.territorial = newState;
            hierarchyVisibility.local = newState;
            
            // Mettre à jour l'affichage
            updateHierarchyDisplay();
            
            // Icône et titre
            const icon = document.getElementById('hierarchyToggleIcon');
            const title = document.querySelector('.legend-section:has([id="hierarchyToggleIcon"]) .legend-title');
            
            if (newState) {
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                console.log('✓ Toutes les routes affichées');
            } else {
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                console.log('✗ Toutes les routes masquées');
            }
        };

        // Toggle d'un niveau spécifique de hiérarchie
        window.toggleHierarchy = function(hierarchy) {
            if (!Object.prototype.hasOwnProperty.call(hierarchyVisibility, hierarchy)) {
                console.warn('Hiérarchie inconnue:', hierarchy);
                return;
            }
            
            hierarchyVisibility[hierarchy] = !hierarchyVisibility[hierarchy];
            updateHierarchyDisplay();
            
            const label = {
                regional: 'Réseau régional',
                territorial: 'Réseau territorial',
                local: 'Réseau local'
            }[hierarchy] || hierarchy;
            
            console.log(`${hierarchyVisibility[hierarchy] ? '✓' : '✗'} ${label} ${hierarchyVisibility[hierarchy] ? 'affiché' : 'masqué'}`);
        };

        // Mettre à jour l'affichage des routes selon la hiérarchie
        window.updateHierarchyDisplay = function() {
            if (!window.map || !window.routePolylines) return; // Attendre que la carte soit prête
            
            // Parcourir toutes les polylines de routes
            Object.keys(window.routePolylines).forEach(ref => {
                const polylines = window.routePolylines[ref];
                polylines.forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    
                    if (hierarchyVisibility[hierarchy]) {
                        // Afficher la route
                        if (!window.map.hasLayer(polyline)) {
                            polyline.addTo(window.map);
                        }
                        polyline.setStyle({ opacity: 0.8 });
                    } else {
                        // Masquer la route
                        if (window.map.hasLayer(polyline)) {
                            window.map.removeLayer(polyline);
                        }
                    }
                });
            });
            
            // Mettre à jour les ombres si une route est sélectionnée
            if (window.highlightedRoute && window.shadowPolylines[window.highlightedRoute]) {
                window.shadowPolylines[window.highlightedRoute].forEach(shadow => {
                    const hierarchy = shadow.options.roadHierarchy;
                    if (hierarchyVisibility[hierarchy]) {
                        if (!window.map.hasLayer(shadow)) {
                            shadow.addTo(window.map);
                        }
                    } else {
                        if (window.map.hasLayer(shadow)) {
                            window.map.removeLayer(shadow);
                        }
                    }
                });
            }
            
            // Mettre à jour le style des items de légende
            ['regional', 'territorial', 'local'].forEach(hierarchy => {
                const item = document.querySelector(`[data-hierarchy="${hierarchy}"]`);
                if (item) {
                    if (hierarchyVisibility[hierarchy]) {
                        item.style.opacity = '1';
                        item.style.fontWeight = '600';
                    } else {
                        item.style.opacity = '0.4';
                        item.style.fontWeight = '400';
                    }
                }
            });
            
            // Mettre à jour l'icône globale selon l'état
            const icon = document.getElementById('hierarchyToggleIcon');
            const title = document.querySelector('.legend-section:has([id="hierarchyToggleIcon"]) .legend-title');
            const allVisible = hierarchyVisibility.regional && hierarchyVisibility.territorial && hierarchyVisibility.local;
            const allHidden = !hierarchyVisibility.regional && !hierarchyVisibility.territorial && !hierarchyVisibility.local;
            
            if (allVisible) {
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
            } else if (allHidden) {
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
            } else {
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
            }

            if (typeof updateRouteLabels === 'function') {
                updateRouteLabels();
            }
            syncLegendChrome();
        };


        // Fonction pour afficher/masquer les accidents
        window.toggleAccidents = function() {
            accidentsVisible = !accidentsVisible;
            
            const icon = document.getElementById('accidentToggleIcon');
            const legendItems = document.querySelectorAll('[data-accident]');
            const title = document.querySelector('.legend-section:has([id="accidentToggleIcon"]) .legend-title');
            
            if (accidentsVisible) {
                // Afficher les accidents
                accidentMarkers.forEach(marker => marker.addTo(window.map));
                setToggleIcon(icon, true);
                
                // Titre en gras
                if (title) title.style.fontWeight = '700';
                
                // Activer visuellement les items de légende
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                    item.style.pointerEvents = 'auto';
                });
                
                console.log(`✓ ${accidentMarkers.length} accidents affichés`);
            } else {
                // Masquer les accidents
                accidentMarkers.forEach(marker => window.map.removeLayer(marker));
                setToggleIcon(icon, false);
                
                // Titre en poids normal
                if (title) title.style.fontWeight = '600';
                
                // Désactiver visuellement les items de légende
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                    item.style.pointerEvents = 'none';
                });
                
                console.log('✗ Accidents masqués');
            }
            syncLegendChrome();
        }

        // ========== STATIONS DE COMPTAGE ==========

        const TRAFFIC_STYLES = {
            high: { fill: '#34495E', stroke: '#FFFFFF', size: 12 },
            medium: { fill: '#95A5A6', stroke: '#FFFFFF', size: 10 },
            low: { fill: '#D5DBDB', stroke: '#7F8C8D', size: 8 }
        };

        function syncTrafficMarkersOnMap() {
            const shouldShow = trafficVisible || wazeEnabled;
            trafficMarkers.forEach(marker => {
                const onMap = window.map.hasLayer(marker);
                if (shouldShow && !onMap) marker.addTo(window.map);
                if (!shouldShow && onMap) window.map.removeLayer(marker);
            });
        }

        window.toggleTraffic = function() {
            trafficVisible = !trafficVisible;

            const icon = document.getElementById('trafficToggleIcon');
            const title = document.querySelector('.legend-section:has([id="trafficToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-traffic]');

            syncTrafficMarkersOnMap();

            if (trafficVisible) {
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                });
                console.log(`✓ ${trafficMarkers.length} stations de comptage affichées`);
            } else {
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                });
                console.log('✗ Stations de comptage masquées');
            }
            syncLegendChrome();
        };

        // ========== ÉVÉNEMENTS ROUTIERS / BISON FUTÉ ==========

        window.toggleBisonFute = function() {
            bisonFuteVisible = !bisonFuteVisible;

            const icon = document.getElementById('bisonFuteToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bisonFuteToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bison-fute]');

            if (bisonFuteVisible) {
                bisonFuteMarkers.forEach(marker => {
                    if (!window.map.hasLayer(marker)) marker.addTo(window.map);
                });
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                });
                console.log(`✓ ${bisonFuteMarkers.length} événements routiers affichés`);
            } else {
                bisonFuteMarkers.forEach(marker => {
                    if (window.map.hasLayer(marker)) window.map.removeLayer(marker);
                });
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                });
                console.log('✗ Événements routiers masqués');
            }
            syncLegendChrome();
        };

        // ========== VILLES PRINCIPALES ==========

        window.toggleCities = function() {
            citiesVisible = !citiesVisible;

            const icon = document.getElementById('citiesToggleIcon');
            const title = document.querySelector('.legend-section:has([id="citiesToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-city]');

            if (citiesVisible) {
                cityMarkers.forEach(marker => {
                    if (!window.map.hasLayer(marker)) marker.addTo(window.map);
                });
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                });
                console.log(`✓ ${cityMarkers.length} villes principales affichées`);
            } else {
                cityMarkers.forEach(marker => {
                    if (window.map.hasLayer(marker)) window.map.removeLayer(marker);
                });
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                });
                console.log('✗ Villes principales masquées');
            }
            syncLegendChrome();
        };

        async function toggleWazeTraffic() {
            wazeEnabled = !wazeEnabled;
            
            setToolActive('wazeBtn', wazeEnabled);
            syncTrafficMarkersOnMap();

            if (wazeEnabled) {
                // Mettre en évidence les stations de comptage CD84 (données de trafic réelles)
                console.log('🚗 Mise en évidence des stations de comptage CD84');

                trafficMarkers.forEach(marker => {
                    const originalRadius = marker.getRadius();
                    let pulse = 0;
                    const pulseInterval = setInterval(() => {
                        pulse++;
                        const scale = 1 + Math.sin(pulse * 0.3) * 0.3;
                        marker.setRadius(originalRadius * scale);

                        if (pulse > 20) {
                            clearInterval(pulseInterval);
                            marker.setRadius(originalRadius);
                        }
                    }, 100);

                    marker.setStyle({ fillOpacity: 1, opacity: 1 });
                });

                const stationBounds = trafficMarkers.map(marker => marker.getLatLng());

                if (stationBounds.length > 0) {
                    setTimeout(() => {
                        window.map.fitBounds(stationBounds, { padding: [50, 50], maxZoom: 11 });
                    }, 500);
                }

                console.log(`✓ ${trafficMarkers.length} stations de comptage mises en évidence`);

            } else {
                trafficMarkers.forEach(marker => {
                    marker.setStyle({ fillOpacity: 0.8, opacity: 1 });
                });
                window.map.closePopup();
                console.log('✗ Mode Trafic désactivé');
            }
            syncLegendChrome();
        }

        // Attendre que tout soit chargé (DOM + Leaflet)
        window.addEventListener('DOMContentLoaded', function() {
        
        // Initialisation de la carte centrée sur le Vaucluse
        window.map = L.map('map').setView([44.0, 5.1], 10);

        // Fond de carte sobre CartoDB Positron
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap contributors © CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(window.map);

        // Liste officielle des communes du Vaucluse (pour filtrage)
        const communesVaucluse = [
            "Althen-des-Paluds", "Ansouis", "Apt", "Aubignan", "Auribeau", "Avignon",
            "Beaumes-de-Venise", "Beaumont-de-Pertuis", "Beaumont-du-Ventoux", "Blauvac",
            "Bollène", "Bonnieux", "Brantes", "Buisson", "Buoux", "Bédarrides", "Bédoin",
            "Cabrières-d'Aigues", "Cabrières-d'Avignon", "Cadenet", "Caderousse", "Cairanne",
            "Camaret-sur-Aigues", "Caromb", "Carpentras", "Caseneuve", "Castellet",
            "Caumont-sur-Durance", "Cavaillon", "Cheval-Blanc", "Châteauneuf-du-Pape",
            "Courthézon", "Crestet", "Crillon-le-Brave", "Cucuron", "Entraigues-sur-la-Sorgue",
            "Entrechaux", "Faucon", "Flassan", "Fontaine-de-Vaucluse", "Gargas", "Gigondas",
            "Gordes", "Goult", "Grambois", "Grillon", "Jonquerettes", "Jonquières", "Joucas",
            "L'Isle-sur-la-Sorgue", "La Bastide-des-Jourdans", "La Roque-sur-Pernes",
            "La Tour-d'Aigues", "Lacoste", "Lafare", "Lagarde-Paréol", "Lagarde-d'Apt",
            "Lagnes", "Lamotte-du-Rhône", "Lauris", "Le Barroux", "Le Beaucet", "Le Pontet",
            "Le Thor", "Lioux", "Loriol-du-Comtat", "Lourmarin", "Malaucène",
            "Malemort-du-Comtat", "Maubec", "Mazan", "Mirabeau", "Mirabel-aux-Baronnies",
            "Modène", "Mondragon", "Monieux", "Monteux", "Montfavet", "Morières-lès-Avignon",
            "Mormoiron", "Mornas", "Murs", "Ménerbes", "Méthamis", "Oppède", "Orange",
            "Pernes", "Pernes-les-Fontaines", "Pertuis", "Piolenc", "Puymeras", "Puyméras",
            "Rasteau", "Richerenches", "Roaix", "Robion", "Roussillon", "Rustrel", "Sablet",
            "Saignon", "Saint-Christol", "Saint-Didier", "Saint-Hippolyte-le-Graveyron",
            "Saint-Léger-du-Ventoux", "Saint-Marcellin-lès-Vaison", "Saint-Pierre-de-Vassols",
            "Saint-Romain-en-Viennois", "Saint-Roman-de-Malegarde", "Saint-Saturnin-lès-Apt",
            "Saint-Trinit", "Sainte-Cécile-les-Vignes", "Sannes", "Sarrians", "Sault",
            "Sivergues", "Sorgues", "Suzette", "Séguret", "Sérignan-du-Comtat", "Taillades",
            "Travaillan", "Uchaux", "Vacqueyras", "Vaison-la-Romaine", "Valréas", "Vaugines",
            "Vedène", "Velleron", "Venasque", "Viens", "Villars", "Villedieu", "Villelaure",
            "Villes-sur-Auzon", "Violès", "Visan", "Vitrolles-en-Lubéron"
        ];

        // Fonction pour vérifier si un texte correspond à une commune du Vaucluse
        function isValidCommune(text) {
            if (!text || text.length < 3) return false;
            
            // Normaliser le texte
            const normalized = text.trim();
            
            // Vérifier si c'est une commune exacte
            if (communesVaucluse.includes(normalized)) return true;
            
            // Vérifier avec correspondance partielle (insensible à la casse)
            const lowerText = normalized.toLowerCase();
            return communesVaucluse.some(c => 
                c.toLowerCase() === lowerText ||
                c.toLowerCase().includes(lowerText) ||
                lowerText.includes(c.toLowerCase())
            );
        }

        // Charger la limite departementale du Vaucluse depuis le GeoJSON statique local
        async function loadVaucluseBoundary() {
            try {
                const geojsonData = await window.InforouteApi.fetchGeoJson('vaucluse-boundary');
                renderFreshnessBadge(document.getElementById('freshness-boundary'), {
                    generatedAt: geojsonData._cache?.generated_at,
                    scheduleKey: 'static'
                });
                
                // Ajouter la limite départementale avec Leaflet
                const boundaryLayer = L.geoJSON(geojsonData, {
                    style: {
                        color: '#2C3E50',
                        weight: 3,
                        opacity: 0.8,
                        dashArray: '8, 4',
                        fillColor: '#667eea',
                        fillOpacity: 0.05
                    }
                }).addTo(window.map);
                
                // Ajuster la vue sur le département
                map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
                
                console.log('✓ Limite départementale chargée depuis le GeoJSON local');
                
            } catch (error) {
                console.error('Erreur lors du chargement de la limite départementale:', error);
                
                L.popup()
                    .setLatLng([44.0, 5.1])
                    .setContent('<div style="padding: 10px;"><strong>⚠️ Limite non disponible</strong><br><small>Erreur de chargement des données</small></div>')
                    .openOn(window.map);
                
                setTimeout(() => window.map.closePopup(), 4000);
            }
        }
        
        // Charger la limite départementale en premier
        loadVaucluseBoundary();

        // Classification hiérarchique des routes départementales du Vaucluse
        const routeClassification = {
            regional: ['D900', 'D942', 'D950', 'D973', 'D974', 'D975', 'D938', 'D907', 'D225'],
            territorial: ['D901', 'D28', 'D4', 'D2', 'D36', 'D943', 'D22', 'D8', 'D177', 'D108', 'D15', 'D31'],
            local: ['D1', 'D7', 'D6', 'D5', 'D3', 'D10', 'D11', 'D12', 'D13', 'D14', 'D16', 'D17', 'D18', 'D19', 'D20']
        };

        // Message de chargement des routes
        const routesLoadingPopup = L.popup()
            .setLatLng([43.95, 5.1])
            .setContent('<div style="text-align: center; padding: 10px;"><strong>Chargement des routes départementales...</strong><br><small>Lecture du GeoJSON local issu d’OpenStreetMap</small></div>')
            .openOn(window.map);

        // Fonction pour charger les routes par catégorie hiérarchique
        let roadLabels = []; // Stocker les étiquettes pour gestion du zoom
        let routesByHierarchy = { regional: [], territorial: [], local: [] }; // Stocker les routes par hiérarchie
        window.routePolylines = {}; // Stocker les polylines par référence de route (global pour toggleHierarchy)
        let allRoadsList = []; // Liste complète des routes pour la recherche
        window.highlightedRoute = null; // Route actuellement mise en évidence (global pour toggleHierarchy)
        window.shadowPolylines = {}; // Polylines d'ombre pour les routes mises en évidence (par ref, global)

        async function loadDepartmentalRoads() {
            try {
                const data = await window.InforouteApi.fetchGeoJson('departmental-roads');
                const osmGeneratedAt = data._cache?.generated_at;
                renderFreshnessBadge(document.getElementById('freshness-hierarchy'), {
                    generatedAt: osmGeneratedAt,
                    scheduleKey: 'osm'
                });
                renderFreshnessBadge(document.getElementById('freshness-wikidata'), {
                    generatedAt: osmGeneratedAt,
                    scheduleKey: 'osm'
                });
                syncLegendChrome();
                routesLoadingPopup.remove();

                if (data.features && data.features.length > 0) {
                    console.log(`✓ ${data.features.length} tronçons chargés depuis le GeoJSON OSM`);

                    const ways = data.features
                        .map(geoJsonLineFeatureToWay)
                        .filter(Boolean);
                    
                    console.log(`  - ${ways.length} ways (tronçons)`);
                    console.log(`  - relations attachées aux propriétés GeoJSON`);

                    // Organiser les routes par référence
                    const routesByRef = {};
                    ways.forEach(way => {
                        if (way.tags && way.tags.ref) {
                            // Normaliser la référence (enlever les espaces, mettre en majuscule)
                            const ref = way.tags.ref.replace(/\s+/g, '').replace(/^D/, 'D');
                            
                            if (!routesByRef[ref]) {
                                routesByRef[ref] = [];
                            }
                            routesByRef[ref].push(way);
                        }
                    });

                    // Afficher les routes avec leur hiérarchie
                    Object.keys(routesByRef).forEach(ref => {
                        const ways = routesByRef[ref];
                        
                        // Déterminer la hiérarchie de cette route
                        let hierarchy = 'local'; // Par défaut
                        const refClean = ref.replace(/\s+/g, '');
                        
                        if (routeClassification.regional.some(r => refClean.includes(r.replace('D', '')))) {
                            hierarchy = 'regional';
                        } else if (routeClassification.territorial.some(r => refClean.includes(r.replace('D', '')))) {
                            hierarchy = 'territorial';
                        }

                        // Créer une ligne pour chaque segment
                        ways.forEach(way => {
                            if (way.geometry && way.geometry.length > 0) {
                                const coords = way.geometry.map(point => [point.lat, point.lon]);
                                
                                const polyline = L.polyline(coords, {
                                    color: hierarchyColors[hierarchy],
                                    weight: hierarchyWeights[hierarchy],
                                    opacity: 0.8,
                                    smoothFactor: 1,
                                    roadRef: ref,
                                    roadHierarchy: hierarchy,
                                    wayTags: way.tags || {},
                                    wayId: way.id
                                }).addTo(window.map);

                                // Stocker la polyline par référence de route
                                if (!routePolylines[ref]) {
                                    routePolylines[ref] = [];
                                }
                                routePolylines[ref].push(polyline);

                                // Stocker la référence pour les étiquettes et informations
                                if (!routesByHierarchy[hierarchy].find(r => r.ref === ref)) {
                                    routesByHierarchy[hierarchy].push({
                                        ref: ref,
                                        coords: coords,
                                        hierarchy: hierarchy,
                                        ways: [way],
                                        communes: new Set(),
                                        totalLength: 0,
                                        surfaces: new Set(),
                                        maxspeeds: new Set()
                                    });
                                } else {
                                    const route = routesByHierarchy[hierarchy].find(r => r.ref === ref);
                                    route.ways.push(way);
                                }
                                
                                // Collecter les informations de la route
                                const routeInfo = routesByHierarchy[hierarchy].find(r => r.ref === ref);
                                
                                // Communes traversées (analyser plusieurs sources et filtrer)
                                // 1. Tag 'destination' (destinations principales)
                                if (way.tags.destination) {
                                    way.tags.destination.split(';').forEach(c => {
                                        const commune = c.trim();
                                        if (isValidCommune(commune)) {
                                            routeInfo.communes.add(commune);
                                        }
                                    });
                                }
                                
                                // 2. Tag 'name' peut contenir le nom avec les communes
                                if (way.tags.name && way.tags.name.includes(' - ')) {
                                    const parts = way.tags.name.split(' - ');
                                    parts.forEach(p => {
                                        const commune = p.replace(/^(Route|Rue|Avenue|Boulevard) (de |d'|des )?/i, '').trim();
                                        if (isValidCommune(commune)) {
                                            routeInfo.communes.add(commune);
                                        }
                                    });
                                }
                                
                                // 3. Tag 'destination:ref' ou 'int_ref'
                                if (way.tags['destination:ref']) {
                                    const commune = way.tags['destination:ref'].trim();
                                    if (isValidCommune(commune)) {
                                        routeInfo.communes.add(commune);
                                    }
                                }
                                
                                // Calculer la longueur du segment
                                let segmentLength = 0;
                                for (let i = 0; i < coords.length - 1; i++) {
                                    segmentLength += map.distance(coords[i], coords[i + 1]);
                                }
                                routeInfo.totalLength += segmentLength;
                                
                                // Surface
                                if (way.tags.surface) {
                                    routeInfo.surfaces.add(way.tags.surface);
                                }
                                
                                // Vitesse max
                                if (way.tags.maxspeed) {
                                    routeInfo.maxspeeds.add(way.tags.maxspeed);
                                }
                                
                                // Stocker le premier et dernier point pour déterminer les communes extrêmes
                                if (!routeInfo.firstPoint) {
                                    routeInfo.firstPoint = coords[0];
                                }
                                routeInfo.lastPoint = coords[coords.length - 1];

                                // Informations sur la route
                                const roadName = way.tags.name || ref;
                                const hierarchyLabel = 
                                    hierarchy === 'regional' ? 'Réseau d\'intérêt régional' :
                                    hierarchy === 'territorial' ? 'Réseau de développement territorial' :
                                    'Réseau d\'intérêt local';

                                const wikidataQid = way.relationTags?.wikidata || way.tags.wikidata || null;
                                const popupInfoboxContainerId = wikidataQid
                                    ? `infobox-${wikidataQid}-${way.id || Math.random().toString(36).slice(2, 8)}`
                                    : null;
                                const popupContent = `
                                    <div class="route-popup">
                                        <h3>${roadName}</h3>
                                        <div class="detail"><strong>Référence&nbsp;:</strong> ${ref}</div>
                                        <div class="detail"><strong>Type&nbsp;:</strong> ${hierarchyLabel}</div>
                                        
                                        ${way.tags.description || way.relationTags?.description ? `
                                            <div class="detail" style="margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px; font-style: italic; font-size: 0.9rem;">
                                                ℹ️ ${way.relationTags?.description || way.tags.description}
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.surface ? `<div class="detail"><strong>Surface&nbsp;:</strong> ${way.tags.surface}</div>` : ''}
                                        ${way.tags.maxspeed ? `<div class="detail"><strong>Vitesse max&nbsp;:</strong> ${way.tags.maxspeed} km/h</div>` : ''}
                                        ${way.tags.lanes ? `<div class="detail"><strong>Voies&nbsp;:</strong> ${way.tags.lanes}</div>` : ''}
                                        ${way.tags.oneway === 'yes' ? `<div class="detail"><strong>Sens unique&nbsp;:</strong> ➡️ Oui</div>` : ''}
                                        
                                        ${way.relationTags && way.relationTags.wikidata ? `
                                            <div class="detail" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd;">
                                                <strong>📚 Wikidata&nbsp;:</strong> 
                                                <a href="https://www.wikidata.org/wiki/${way.relationTags.wikidata}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    ${way.relationTags.wikidata} →
                                                </a>
                                                <span style="color: #27AE60; font-size: 0.8rem; display: block; margin-top: 3px;">
                                                    ✓ Données structurées disponibles
                                                </span>
                                            </div>
                                        ` : way.tags.wikidata ? `
                                            <div class="detail" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd;">
                                                <strong>📚 Wikidata&nbsp;:</strong> 
                                                <a href="https://www.wikidata.org/wiki/${way.tags.wikidata}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    ${way.tags.wikidata} →
                                                </a>
                                                <span style="color: #999; font-size: 0.8rem; display: block; margin-top: 3px;">
                                                    ⚠️ Données sur le tronçon uniquement
                                                </span>
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.wikipedia || way.relationTags?.wikipedia ? `
                                            <div class="detail">
                                                <strong>📖 Wikipedia&nbsp;:</strong> 
                                                <a href="https://fr.wikipedia.org/wiki/${encodeURIComponent((way.relationTags?.wikipedia || way.tags.wikipedia).replace('fr:', ''))}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    Lire l'article →
                                                </a>
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.website || way.relationTags?.website ? `
                                            <div class="detail">
                                                <strong>🌐 Site web&nbsp;:</strong> 
                                                <a href="${way.relationTags?.website || way.tags.website}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    Visiter →
                                                </a>
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.destination || way.relationTags?.destination ? `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>🎯 Destination&nbsp;:</strong> ${way.relationTags?.destination || way.tags.destination}
                                            </div>
                                        ` : ''}
                                        
                                        ${way.hasRelation ? `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>Relation OSM&nbsp;:</strong> <span style="color: #27AE60; font-weight: 600;">✓ Complète</span>
                                            </div>
                                        ` : `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>Relation OSM&nbsp;:</strong> <span style="color: #E74C3C;">✗ Manquante</span>
                                                <span style="font-size: 0.8rem; color: #999; display: block; margin-top: 3px;">
                                                    💡 Contribuez en créant une relation pour cette route
                                                </span>
                                            </div>
                                        `}
                                        
                                        <div class="detail" style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #e0e0e0;">
                                            <div style="font-size: 0.7rem; font-weight: 700; color: #7f8c8d; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Contribuer / Qualifier</div>
                                            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                                                ${way.id ? `
                                                    <a href="https://www.openstreetmap.org/way/${way.id}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #3498DB; border-radius: 4px; font-size: 0.78rem;">
                                                        🗺️ Voir tronçon OSM
                                                    </a>
                                                    <a href="https://www.openstreetmap.org/edit?editor=id&way=${way.id}" target="_blank" title="Éditer ce tronçon dans iD" style="color: #2C3E50; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #2C3E50; border-radius: 4px; font-size: 0.78rem;">
                                                        ✏️ Éditer dans iD
                                                    </a>
                                                ` : ''}
                                                ${way.hasRelation ? `
                                                    <a href="https://www.openstreetmap.org/relation/${way.relationId}" target="_blank" style="color: #27AE60; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #27AE60; border-radius: 4px; font-size: 0.78rem;">
                                                        📋 Voir relation
                                                    </a>
                                                    <a href="https://www.openstreetmap.org/edit?editor=id&relation=${way.relationId}" target="_blank" title="Éditer la relation dans iD" style="color: #16a085; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #16a085; border-radius: 4px; font-size: 0.78rem;">
                                                        ✏️ Éditer relation
                                                    </a>
                                                ` : ''}
                                                ${(way.relationTags?.wikidata || way.tags.wikidata) ? `
                                                    <a href="https://www.wikidata.org/wiki/${way.relationTags?.wikidata || way.tags.wikidata}#identifiers" target="_blank" style="color: #9B59B6; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #9B59B6; border-radius: 4px; font-size: 0.78rem;">
                                                        📚 Compléter Wikidata
                                                    </a>
                                                ` : `
                                                    <a href="https://www.wikidata.org/wiki/Special:NewItem" target="_blank" title="Créer un nouvel item Wikidata pour cette route" style="color: #E74C3C; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #E74C3C; border-radius: 4px; font-size: 0.78rem;">
                                                        ➕ Créer item Wikidata
                                                    </a>
                                                `}
                                            </div>
                                        </div>
                                        ${wikidataQid ? `
                                            <div class="popup-infobox-section">
                                                <div class="popup-infobox-title">Infobox</div>
                                                <div class="popup-infobox-host" id="${popupInfoboxContainerId}" data-qid="${wikidataQid}">
                                                    <div class="popup-infobox-loading">Chargement…</div>
                                                </div>
                                            </div>
                                        ` : ''}
                                    </div>
                                `;

                                polyline.bindPopup(popupContent);
                                if (wikidataQid) attachRoutePopupInfobox(polyline);

                                // Effet de survol
                                polyline.on('mouseover', function() {
                                    this.setStyle({ weight: hierarchyWeights[hierarchy] + 2, opacity: 1 });
                                });

                                polyline.on('mouseout', function() {
                                    if (window.highlightedRoute !== ref) {
                                        this.setStyle({ weight: hierarchyWeights[hierarchy], opacity: 0.8 });
                                    }
                                });
                                
                                // Clic pour mettre en évidence
                                polyline.on('click', function() {
                                    highlightRoute(ref);
                                });
                            }
                        });
                    });

                    // Mettre à jour les compteurs dans la légende
                    const counts = {
                        regional: new Set(),
                        territorial: new Set(),
                        local: new Set()
                    };

                    Object.keys(routesByRef).forEach(ref => {
                        const refClean = ref.replace(/\s+/g, '');
                        if (routeClassification.regional.some(r => refClean.includes(r.replace('D', '')))) {
                            counts.regional.add(ref);
                        } else if (routeClassification.territorial.some(r => refClean.includes(r.replace('D', '')))) {
                            counts.territorial.add(ref);
                        } else {
                            counts.local.add(ref);
                        }
                    });

                    // Mettre à jour les compteurs dans la légende
                    const regionalItems = document.querySelectorAll('.legend-item[data-hierarchy="regional"] .legend-count');
                    regionalItems.forEach(item => item.textContent = counts.regional.size);
                    
                    const territorialItems = document.querySelectorAll('.legend-item[data-hierarchy="territorial"] .legend-count');
                    territorialItems.forEach(item => item.textContent = counts.territorial.size);
                    
                    const localItems = document.querySelectorAll('.legend-item[data-hierarchy="local"] .legend-count');
                    localItems.forEach(item => item.textContent = counts.local.size);

                    console.log('Routes chargées:', {
                        regional: counts.regional.size,
                        territorial: counts.territorial.size,
                        local: counts.local.size
                    });

                    // Initialiser l'affichage des étiquettes
                    updateRouteLabels();
                    
                    // Créer la liste des routes
                    createRoadList();

                    // Calculer les métriques de qualité OSM/Wikidata et alimenter le résumé sidebar
                    calculateQualityMetrics();
                    updateWikidataSummary();
                }
            } catch (error) {
                routesLoadingPopup.remove();
                console.error('Erreur lors du chargement des routes:', error);
                
                L.popup()
                    .setLatLng([43.95, 5.1])
                    .setContent('<div style="padding: 10px;"><strong>⚠️ Routes non disponibles</strong><br><small>Impossible de charger le GeoJSON local des routes.</small></div>')
                    .openOn(window.map);
                
                setTimeout(() => window.map.closePopup(), 4000);
            }
        }

        // Fonction pour mettre à jour l'affichage des étiquettes selon le zoom
        function updateRouteLabels() {
            // Supprimer toutes les étiquettes existantes
            roadLabels.forEach(label => map.removeLayer(label));
            roadLabels = [];

            const zoom = map.getZoom();
            
            // Définir les seuils de zoom pour chaque hiérarchie
            // Plus la route est importante, plus tôt elle apparaît
            const zoomThresholds = {
                regional: 9,    // Apparaissent dès le zoom 9
                territorial: 11, // Apparaissent au zoom 11
                local: 13       // Apparaissent au zoom 13
            };

            // Fonction pour calculer le centre d'une route (moyenne des coordonnées)
            function getRouteCenter(route) {
                // Utiliser le premier segment pour trouver un point représentatif
                if (route.ways && route.ways.length > 0) {
                    const way = route.ways[0];
                    if (way.geometry && way.geometry.length > 0) {
                        const midIndex = Math.floor(way.geometry.length / 2);
                        return [way.geometry[midIndex].lat, way.geometry[midIndex].lon];
                    }
                }
                return null;
            }

            // Afficher les étiquettes selon le niveau de zoom et la visibilité hiérarchique
            ['regional', 'territorial', 'local'].forEach(hierarchy => {
                if (!hierarchyVisibility[hierarchy]) return;
                if (zoom >= zoomThresholds[hierarchy]) {
                    routesByHierarchy[hierarchy].forEach(route => {
                        const center = getRouteCenter(route);
                        if (center) {
                            const label = L.marker(center, {
                                icon: L.divIcon({
                                    className: 'route-label-container',
                                    html: `<div class="route-label ${hierarchy}">${route.ref}</div>`,
                                    iconSize: null
                                }),
                                interactive: false
                            }).addTo(window.map);

                            roadLabels.push(label);
                        }
                    });
                }
            });
        }

        // Écouter les changements de zoom
        map.on('zoomend', updateRouteLabels);

        // ========== GESTION QUALITÉ OSM ==========
        
        let qualityMetrics = {
            totalRoutes: 0,
            withWikidata: 0,
            withRelation: 0,
            totalSegments: 0
        };

        // Met à jour la mini-carte Wikidata visible en permanence dans la sidebar
        function updateWikidataSummary() {
            const container = document.getElementById('wikidataSummary');
            if (!container) return;
            const total = qualityMetrics.totalRoutes || 0;
            if (total === 0) {
                container.innerHTML = '<div style="font-size:0.8rem;color:#7f8c8d;">Calcul en cours…</div>';
                return;
            }
            const withWd = qualityMetrics.withWikidata || 0;
            const without = total - withWd;
            const pct = Math.round((withWd / total) * 100);
            const withRel = qualityMetrics.withRelation || 0;
            const withoutRel = total - withRel;

            container.innerHTML = `
                <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
                    <span style="font-family:'JetBrains Mono', monospace;font-size:1.4rem;font-weight:700;color:#27AE60;">${withWd}</span>
                    <span style="font-size:0.8rem;color:#7f8c8d;">/ ${total} routes liées Wikidata</span>
                    <span style="margin-left:auto;font-family:'JetBrains Mono', monospace;font-weight:700;color:#2C3E50;">${pct}%</span>
                </div>
                <div style="height:6px;border-radius:3px;background:#ecf0f1;overflow:hidden;display:flex;margin-bottom:8px;">
                    <div style="width:${pct}%;background:linear-gradient(90deg,#27AE60,#2ECC71);"></div>
                    <div style="width:${100 - pct}%;background:linear-gradient(90deg,#E74C3C,#C0392B);"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.72rem;margin-bottom:8px;">
                    <div style="padding:6px 8px;background:#fdecea;border-radius:4px;color:#922b21;">
                        <strong>${without}</strong> routes <em>sans Wikidata</em>
                    </div>
                    <div style="padding:6px 8px;background:#fef5e7;border-radius:4px;color:#8a5a00;">
                        <strong>${withoutRel}</strong> routes <em>sans relation</em>
                    </div>
                </div>
                <div style="display:flex;gap:6px;">
                    <button onclick="highlightRoutesByWikidata(false)" style="flex:1;border:1px solid #E74C3C;background:white;color:#E74C3C;border-radius:5px;padding:6px;font-size:0.7rem;font-weight:600;cursor:pointer;">Voir les routes sans Wikidata</button>
                </div>
            `;
        }

        window.updateWikidataSummary = updateWikidataSummary;

        window.calculateQualityMetrics = function() {
            console.log('📊 Calcul des métriques de qualité OSM...');
            
            qualityMetrics = { totalRoutes: 0, withWikidata: 0, withRelation: 0, totalSegments: 0 };

            Object.keys(routePolylines).forEach(ref => {
                qualityMetrics.totalRoutes++;
                qualityMetrics.totalSegments += routePolylines[ref].length;
                
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                
                if (routeData && routeData.ways) {
                    // Vérifier Wikidata : priorité à la relation, sinon vérifier si TOUS les ways l'ont
                    let hasWikidata = false;
                    
                    // 1. Vérifier si la relation a un Wikidata
                    const relationWithWikidata = routeData.ways.find(way => 
                        way.relationTags && way.relationTags.wikidata
                    );
                    
                    if (relationWithWikidata) {
                        hasWikidata = true;
                    } else {
                        // 2. Sinon, vérifier si tous les ways ont un wikidata (rare mais possible)
                        const totalWays = routeData.ways.length;
                        const waysWithWikidata = routeData.ways.filter(way => 
                            way.tags && way.tags.wikidata
                        ).length;
                        
                        // Si au moins 80% des tronçons ont wikidata, on considère que c'est OK
                        hasWikidata = waysWithWikidata > 0 && (waysWithWikidata / totalWays) >= 0.8;
                    }
                    
                    // Vérifier Relation
                    const hasRelation = routeData.ways.some(way => 
                        way.hasRelation === true || way.relationId
                    );
                    
                    if (hasWikidata) qualityMetrics.withWikidata++;
                    if (hasRelation) qualityMetrics.withRelation++;
                }
            });

            console.log('Métriques calculées:', qualityMetrics);
            displayQualityMetrics();
            updateWikidataSummary();
            updateNetworkStats();
        }

        // Calcul live des statistiques "Informations Réseau" depuis les polylines chargées.
        function haversineKm(a, b) {
            const R = 6371;
            const toRad = d => d * Math.PI / 180;
            const dLat = toRad(b.lat - a.lat);
            const dLon = toRad(b.lng - a.lng);
            const lat1 = toRad(a.lat);
            const lat2 = toRad(b.lat);
            const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(h));
        }

        function polylineLengthKm(polyline) {
            const pts = polyline.getLatLngs();
            let total = 0;
            for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1], pts[i]);
            return total;
        }

        function updateNetworkStats() {
            const refsEl = document.getElementById('networkStat-refs');
            const segmentsEl = document.getElementById('networkStat-segments');
            const lengthEl = document.getElementById('networkStat-length');
            const trafficEl = document.getElementById('networkStat-traffic');
            const bridgesEl = document.getElementById('networkStat-bridges');
            const tunnelsEl = document.getElementById('networkStat-tunnels');
            if (!refsEl) return;

            const refs = Object.keys(window.routePolylines || {});
            let totalSegments = 0;
            let totalKm = 0;
            let bridgeCount = 0;
            let tunnelCount = 0;
            refs.forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    totalSegments++;
                    totalKm += polylineLengthKm(polyline);
                    const tags = polyline.options.wayTags || {};
                    if (tags.bridge && tags.bridge !== 'no') bridgeCount++;
                    if (tags.tunnel === 'yes') tunnelCount++;
                });
            });

            refsEl.textContent = refs.length.toLocaleString('fr-FR');
            segmentsEl.textContent = totalSegments.toLocaleString('fr-FR');
            lengthEl.textContent = totalKm >= 1
                ? `${Math.round(totalKm).toLocaleString('fr-FR')} km`
                : '—';
            bridgesEl.textContent = bridgeCount.toLocaleString('fr-FR');
            tunnelsEl.textContent = tunnelCount.toLocaleString('fr-FR');

            // Trafic MJA depuis les marqueurs de comptage chargés
            const mjaValues = [];
            (typeof trafficMarkers !== 'undefined' ? trafficMarkers : []).forEach(marker => {
                const popup = marker.getPopup && marker.getPopup();
                if (!popup) return;
                const html = popup.getContent ? popup.getContent() : '';
                // Accepte aussi le narrow no-break space (\u202f) que toLocaleString peut produire en fr-FR.
                const match = String(html).match(/MJA[^:]*:[^>]*?([\d\u00a0\u202f,. ]+)\s*v[ée]h\/jour/i);
                if (match) {
                    const num = Number.parseInt(match[1].replace(/[^0-9]/g, ''), 10);
                    if (Number.isFinite(num) && num > 0) mjaValues.push(num);
                }
            });
            const trafficTile = trafficEl ? trafficEl.closest('.network-tile') : null;
            if (mjaValues.length) {
                const min = Math.min(...mjaValues);
                const max = Math.max(...mjaValues);
                const fmt = v => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
                trafficEl.textContent = `${fmt(min)} – ${fmt(max)} véh/j`;
                if (trafficTile) trafficTile.style.display = '';
            } else {
                // On masque entièrement la tuile tant que la donnée n'est pas calculable.
                if (trafficTile) trafficTile.style.display = 'none';
            }
        }

        window.updateNetworkStats = updateNetworkStats;

        function displayQualityMetrics() {
            const content = document.getElementById('qualityContent');
            
            const wikidataPercent = qualityMetrics.totalRoutes > 0 
                ? Math.round((qualityMetrics.withWikidata / qualityMetrics.totalRoutes) * 100) : 0;
            const relationPercent = qualityMetrics.totalRoutes > 0 
                ? Math.round((qualityMetrics.withRelation / qualityMetrics.totalRoutes) * 100) : 0;

            const wikidataMissing = qualityMetrics.totalRoutes - qualityMetrics.withWikidata;
            const relationMissing = qualityMetrics.totalRoutes - qualityMetrics.withRelation;

            content.innerHTML = `
                <div class="quality-metric">
                    <div class="quality-metric-title">Routes avec Wikidata</div>
                    
                    <!-- Barre de progression interactive -->
                    <div style="display: flex; align-items: center; gap: 10px; margin: 15px 0;">
                        <div style="flex: 1; height: 40px; background: #f0f0f0; border-radius: 8px; overflow: hidden; display: flex; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
                            <div onclick="highlightRoutesByWikidata(true)" 
                                 style="width: ${wikidataPercent}%; background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%); cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.9rem; transition: all 0.3s; position: relative;"
                                 onmouseover="this.style.filter='brightness(1.1)'; this.style.transform='scaleY(1.05)'"
                                 onmouseout="this.style.filter='brightness(1)'; this.style.transform='scaleY(1)'">
                                ${wikidataPercent > 15 ? `${qualityMetrics.withWikidata}` : ''}
                            </div>
                            <div onclick="highlightRoutesByWikidata(false)" 
                                 style="width: ${100-wikidataPercent}%; background: linear-gradient(135deg, #E74C3C 0%, #C0392B 100%); cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.9rem; transition: all 0.3s;"
                                 onmouseover="this.style.filter='brightness(1.1)'; this.style.transform='scaleY(1.05)'"
                                 onmouseout="this.style.filter='brightness(1)'; this.style.transform='scaleY(1)'">
                                ${(100-wikidataPercent) > 15 ? `${wikidataMissing}` : ''}
                            </div>
                        </div>
                        <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 1.3rem; color: #2C3E50; min-width: 60px; text-align: right;">
                            ${wikidataPercent}%
                        </div>
                    </div>
                    
                    <!-- Légende interactive -->
                    <div style="display: flex; gap: 15px; font-size: 0.8rem; margin-top: 10px;">
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="highlightRoutesByWikidata(true)">
                            <div style="width: 16px; height: 16px; background: linear-gradient(135deg, #27AE60, #2ECC71); border-radius: 3px;"></div>
                            <span style="color: #27AE60; font-weight: 600;">${qualityMetrics.withWikidata} avec</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="highlightRoutesByWikidata(false)">
                            <div style="width: 16px; height: 16px; background: linear-gradient(135deg, #E74C3C, #C0392B); border-radius: 3px;"></div>
                            <span style="color: #E74C3C; font-weight: 600;">${wikidataMissing} sans</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer; margin-left: auto;" onclick="clearHighlight()">
                            <span style="color: #95a5a6; font-weight: 600;">⊗ Réinitialiser</span>
                        </div>
                    </div>
                </div>

                <div class="quality-metric">
                    <div class="quality-metric-title">Routes avec Relation OSM</div>
                    
                    <!-- Barre de progression interactive -->
                    <div style="display: flex; align-items: center; gap: 10px; margin: 15px 0;">
                        <div style="flex: 1; height: 40px; background: #f0f0f0; border-radius: 8px; overflow: hidden; display: flex; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
                            <div onclick="highlightRoutesByRelation(true)" 
                                 style="width: ${relationPercent}%; background: linear-gradient(135deg, #3498DB 0%, #2980B9 100%); cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.9rem; transition: all 0.3s;"
                                 onmouseover="this.style.filter='brightness(1.1)'; this.style.transform='scaleY(1.05)'"
                                 onmouseout="this.style.filter='brightness(1)'; this.style.transform='scaleY(1)'">
                                ${relationPercent > 15 ? `${qualityMetrics.withRelation}` : ''}
                            </div>
                            <div onclick="highlightRoutesByRelation(false)" 
                                 style="width: ${100-relationPercent}%; background: linear-gradient(135deg, #E67E22 0%, #D35400 100%); cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.9rem; transition: all 0.3s;"
                                 onmouseover="this.style.filter='brightness(1.1)'; this.style.transform='scaleY(1.05)'"
                                 onmouseout="this.style.filter='brightness(1)'; this.style.transform='scaleY(1)'">
                                ${(100-relationPercent) > 15 ? `${relationMissing}` : ''}
                            </div>
                        </div>
                        <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 1.3rem; color: #2C3E50; min-width: 60px; text-align: right;">
                            ${relationPercent}%
                        </div>
                    </div>
                    
                    <!-- Légende interactive -->
                    <div style="display: flex; gap: 15px; font-size: 0.8rem; margin-top: 10px;">
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="highlightRoutesByRelation(true)">
                            <div style="width: 16px; height: 16px; background: linear-gradient(135deg, #3498DB, #2980B9); border-radius: 3px;"></div>
                            <span style="color: #3498DB; font-weight: 600;">${qualityMetrics.withRelation} avec</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="highlightRoutesByRelation(false)">
                            <div style="width: 16px; height: 16px; background: linear-gradient(135deg, #E67E22, #D35400); border-radius: 3px;"></div>
                            <span style="color: #E67E22; font-weight: 600;">${relationMissing} sans</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer; margin-left: auto;" onclick="clearHighlight()">
                            <span style="color: #95a5a6; font-weight: 600;">⊗ Réinitialiser</span>
                        </div>
                    </div>
                </div>

                <div class="quality-metric">
                    <div class="quality-metric-title">📊 Statistiques</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 15px; border-radius: 8px; text-align: center; color: white;">
                            <div style="font-size: 1.8rem; font-weight: 700; font-family: 'JetBrains Mono', monospace;">${qualityMetrics.totalRoutes}</div>
                            <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 3px;">Routes totales</div>
                        </div>
                        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 15px; border-radius: 8px; text-align: center; color: white;">
                            <div style="font-size: 1.8rem; font-weight: 700; font-family: 'JetBrains Mono', monospace;">${qualityMetrics.totalSegments}</div>
                            <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 3px;">Tronçons OSM</div>
                        </div>
                    </div>
                </div>

            `;
        }

        // ========== FONCTIONS DE FILTRAGE PAR QUALITÉ ==========
        
        window.highlightRoutesByWikidata = function(hasWikidata) {
            console.log('🎯 Filtrage routes avec Wikidata:', hasWikidata);
            
            // Réinitialiser toutes les routes
            Object.keys(routePolylines).forEach(ref => {
                const polylines = routePolylines[ref];
                polylines.forEach(polyline => {
                    polyline.setStyle({ opacity: 0.2, weight: hierarchyWeights[polyline.options.roadHierarchy] });
                });
            });
            
            // Mettre en évidence les routes correspondantes
            Object.keys(routePolylines).forEach(ref => {
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                
                if (routeData && routeData.ways) {
                    // Même logique que calculateQualityMetrics
                    let routeHasWikidata = false;
                    
                    // 1. Vérifier si la relation a un Wikidata
                    const relationWithWikidata = routeData.ways.find(way => 
                        way.relationTags && way.relationTags.wikidata
                    );
                    
                    if (relationWithWikidata) {
                        routeHasWikidata = true;
                    } else {
                        // 2. Sinon, vérifier si tous les ways ont un wikidata
                        const totalWays = routeData.ways.length;
                        const waysWithWikidata = routeData.ways.filter(way => 
                            way.tags && way.tags.wikidata
                        ).length;
                        
                        routeHasWikidata = waysWithWikidata > 0 && (waysWithWikidata / totalWays) >= 0.8;
                    }
                    
                    if (routeHasWikidata === hasWikidata) {
                        const polylines = routePolylines[ref];
                        polylines.forEach(polyline => {
                            const hierarchy = polyline.options.roadHierarchy;
                            polyline.setStyle({ 
                                opacity: 1, 
                                weight: hierarchyWeights[hierarchy] + 2,
                                color: hasWikidata ? '#27AE60' : '#E74C3C'
                            });
                            polyline.bringToFront();
                        });
                    }
                }
            });
            
            // Message dans la console
            const matchingRoutes = Object.keys(routePolylines).filter(ref => {
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                if (routeData && routeData.ways) {
                    let routeHasWikidata = false;
                    const relationWithWikidata = routeData.ways.find(way => 
                        way.relationTags && way.relationTags.wikidata
                    );
                    if (relationWithWikidata) {
                        routeHasWikidata = true;
                    } else {
                        const totalWays = routeData.ways.length;
                        const waysWithWikidata = routeData.ways.filter(way => 
                            way.tags && way.tags.wikidata
                        ).length;
                        routeHasWikidata = waysWithWikidata > 0 && (waysWithWikidata / totalWays) >= 0.8;
                    }
                    return routeHasWikidata === hasWikidata;
                }
                return false;
            });
            
            console.log(`✓ ${matchingRoutes.length} routes mises en évidence (Wikidata : ${hasWikidata ? 'avec' : 'sans'})`);
        }
        
        window.highlightRoutesByRelation = function(hasRelation) {
            console.log('🎯 Filtrage routes avec Relation:', hasRelation);
            
            // Réinitialiser toutes les routes
            Object.keys(routePolylines).forEach(ref => {
                const polylines = routePolylines[ref];
                polylines.forEach(polyline => {
                    polyline.setStyle({ opacity: 0.2, weight: hierarchyWeights[polyline.options.roadHierarchy] });
                });
            });
            
            // Mettre en évidence les routes correspondantes
            Object.keys(routePolylines).forEach(ref => {
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                
                if (routeData && routeData.ways) {
                    const routeHasRelation = routeData.ways.some(way => way.hasRelation === true || way.relationId);
                    
                    if (routeHasRelation === hasRelation) {
                        const polylines = routePolylines[ref];
                        polylines.forEach(polyline => {
                            const hierarchy = polyline.options.roadHierarchy;
                            polyline.setStyle({ 
                                opacity: 1, 
                                weight: hierarchyWeights[hierarchy] + 2,
                                color: hasRelation ? '#27AE60' : '#E74C3C'
                            });
                            polyline.bringToFront();
                        });
                    }
                }
            });
            
            const matchingRoutes = Object.keys(routePolylines).filter(ref => {
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                if (routeData && routeData.ways) {
                    const routeHasRelation = routeData.ways.some(way => way.hasRelation === true || way.relationId);
                    return routeHasRelation === hasRelation;
                }
                return false;
            });
            
            console.log(`✓ ${matchingRoutes.length} routes mises en évidence (Relation : ${hasRelation ? 'avec' : 'sans'})`);
        }
        
        window.clearHighlight = function() {
            console.log('🔄 Réinitialisation de l\'affichage');
            
            // Restaurer l'apparence normale de toutes les routes
            Object.keys(routePolylines).forEach(ref => {
                const polylines = routePolylines[ref];
                polylines.forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    polyline.setStyle({ 
                        opacity: 0.8, 
                        weight: hierarchyWeights[hierarchy],
                        color: hierarchyColors[hierarchy]
                    });
                });
            });
            
            window.map.closePopup();
        }

        // Fonction pour créer la liste des routes
        function createRoadList() {
            // Compiler toutes les routes
            allRoadsList = [];
            
            Object.keys(routePolylines).forEach(ref => {
                const refClean = ref.replace(/\s+/g, '');
                let hierarchy = 'local';
                
                if (routeClassification.regional.some(r => refClean.includes(r.replace('D', '')))) {
                    hierarchy = 'regional';
                } else if (routeClassification.territorial.some(r => refClean.includes(r.replace('D', '')))) {
                    hierarchy = 'territorial';
                }
                
                allRoadsList.push({
                    ref: ref,
                    hierarchy: hierarchy,
                    searchText: ref.toLowerCase()
                });
            });
            
            // Trier par hiérarchie puis par numéro
            allRoadsList.sort((a, b) => {
                const hierarchyOrder = { regional: 0, territorial: 1, local: 2 };
                if (hierarchyOrder[a.hierarchy] !== hierarchyOrder[b.hierarchy]) {
                    return hierarchyOrder[a.hierarchy] - hierarchyOrder[b.hierarchy];
                }
                
                const numA = parseInt(a.ref.replace(/\D/g, '')) || 0;
                const numB = parseInt(b.ref.replace(/\D/g, '')) || 0;
                return numA - numB;
            });
            
            // Afficher la liste
            renderRoadList(allRoadsList);
            
            // Activer la recherche
            const searchInput = document.getElementById('road-search');
            searchInput.addEventListener('input', function() {
                const searchTerm = this.value.toLowerCase().trim();
                
                if (searchTerm === '') {
                    renderRoadList(allRoadsList);
                } else {
                    const filtered = allRoadsList.filter(road => 
                        road.searchText.includes(searchTerm)
                    );
                    renderRoadList(filtered);
                }
            });
        }
        
        // Fonction pour afficher la liste des routes
        function renderRoadList(roads) {
            const listContainer = document.getElementById('road-list');
            
            if (roads.length === 0) {
                listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; font-size: 0.85rem;">Aucune route trouvée</div>';
                return;
            }
            
            listContainer.innerHTML = roads.map(road => `
                <div class="road-item ${window.highlightedRoute === road.ref ? 'active' : ''}" data-ref="${road.ref}">
                    <div class="road-badge ${road.hierarchy}">${road.ref}</div>
                    <div class="road-name">${
                        road.hierarchy === 'regional' ? 'Intérêt régional' :
                        road.hierarchy === 'territorial' ? 'Développement territorial' :
                        'Intérêt local'
                    }</div>
                </div>
            `).join('');
            
            // Ajouter les événements de clic
            listContainer.querySelectorAll('.road-item').forEach(item => {
                item.addEventListener('click', function() {
                    const ref = this.getAttribute('data-ref');
                    highlightRoute(ref);
                });
            });
        }
        
        // Fonction pour mettre en évidence une route
        function highlightRoute(ref) {
            // Supprimer les ombres précédentes
            Object.values(shadowPolylines).forEach(shadows => {
                shadows.forEach(shadow => map.removeLayer(shadow));
            });
            window.shadowPolylines = {};
            
            // Réinitialiser la route précédente
            if (window.highlightedRoute && routePolylines[window.highlightedRoute]) {
                routePolylines[window.highlightedRoute].forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    polyline.setStyle({
                        color: hierarchyColors[hierarchy],
                        weight: hierarchyWeights[hierarchy],
                        opacity: 0.8
                    });
                });
            }
            
            // Mettre en évidence la nouvelle route
            if (routePolylines[ref]) {
                window.highlightedRoute = ref;
                
                const polylines = routePolylines[ref];
                const hierarchy = polylines[0].options.roadHierarchy;
                
                // Initialiser le tableau d'ombres pour cette route
                if (!window.shadowPolylines[ref]) {
                    window.shadowPolylines[ref] = [];
                }
                
                // Créer les ombres (3 couches pour un effet de glow)
                polylines.forEach(polyline => {
                    const coords = polyline.getLatLngs();
                    
                    // Ombre externe noire (la plus large)
                    const shadow1 = L.polyline(coords, {
                        color: '#000000',
                        weight: hierarchyWeights[hierarchy] + 12,
                        opacity: 0.3,
                        smoothFactor: 1,
                        interactive: false,
                        roadHierarchy: hierarchy
                    }).addTo(window.map);
                    window.shadowPolylines[ref].push(shadow1);
                    
                    // Ombre intermédiaire
                    const shadow2 = L.polyline(coords, {
                        color: '#000000',
                        weight: hierarchyWeights[hierarchy] + 8,
                        opacity: 0.4,
                        smoothFactor: 1,
                        interactive: false,
                        roadHierarchy: hierarchy
                    }).addTo(window.map);
                    window.shadowPolylines[ref].push(shadow2);
                    
                    // Halo blanc
                    const shadow3 = L.polyline(coords, {
                        color: '#FFFFFF',
                        weight: hierarchyWeights[hierarchy] + 6,
                        opacity: 0.6,
                        smoothFactor: 1,
                        interactive: false,
                        roadHierarchy: hierarchy
                    }).addTo(window.map);
                    window.shadowPolylines[ref].push(shadow3);
                });
                
                // Mettre en évidence la route elle-même
                polylines.forEach(polyline => {
                    polyline.setStyle({
                        color: hierarchyColors[hierarchy],
                        weight: hierarchyWeights[hierarchy] + 4,
                        opacity: 1
                    });
                    polyline.bringToFront();
                });
                
                // Centrer la carte sur la route
                const bounds = L.latLngBounds(polylines.map(p => p.getBounds()));
                map.fitBounds(bounds, { padding: [50, 50] });
                
                // Mettre à jour la liste visuelle
                document.querySelectorAll('.road-item').forEach(item => {
                    if (item.getAttribute('data-ref') === ref) {
                        item.classList.add('active');
                        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    } else {
                        item.classList.remove('active');
                    }
                });
                
                // Afficher les informations détaillées de la route
                displayRoadInfo(ref, hierarchy);
            }
        }
        
        // Fonction pour afficher les informations détaillées d'une route
        function displayRoadInfo(ref, hierarchy) {
            // Trouver les informations de la route
            let routeData = null;
            for (const [hier, routes] of Object.entries(routesByHierarchy)) {
                const found = routes.find(r => r.ref === ref);
                if (found) {
                    routeData = found;
                    break;
                }
            }
            
            if (!routeData) return;
            
            // Calculer les statistiques
            const lengthKm = (routeData.totalLength / 1000).toFixed(2);
            const nbSegments = routeData.ways.length;
            
            // Déterminer le type de hiérarchie
            const hierarchyLabels = {
                regional: { label: 'Intérêt régional', color: '#E74C3C' },
                territorial: { label: 'Développement territorial', color: '#F39C12' },
                local: { label: 'Intérêt local', color: '#3498DB' }
            };
            
            const hierInfo = hierarchyLabels[hierarchy];
            
            // Construire le HTML du panneau d'informations
            const infoPanel = document.getElementById('road-info-panel');
            const infoSection = document.getElementById('road-info-section');
            
            infoPanel.innerHTML = `
                <div class="road-info-title">${ref}</div>
                
                <div class="road-info-badge" style="background: ${hierInfo.color}; color: white;">
                    ${hierInfo.label}
                </div>
                
                <div style="margin-top: 15px;">
                    <div class="road-info-item">
                        <span class="road-info-label">Longueur totale</span>
                        <span class="road-info-value">${lengthKm} km</span>
                    </div>
                    
                    <div class="road-info-item">
                        <span class="road-info-label">Segments</span>
                        <span class="road-info-value">${nbSegments}</span>
                    </div>
                    
                    ${routeData.surfaces.size > 0 ? `
                    <div class="road-info-item">
                        <span class="road-info-label">Revêtement</span>
                        <span class="road-info-value">${Array.from(routeData.surfaces).join(', ')}</span>
                    </div>
                    ` : ''}
                    
                    ${routeData.maxspeeds.size > 0 ? `
                    <div class="road-info-item">
                        <span class="road-info-label">Vitesse max</span>
                        <span class="road-info-value">${Array.from(routeData.maxspeeds).sort((a,b) => parseInt(a) - parseInt(b)).join(', ')} km/h</span>
                    </div>
                    ` : ''}
                    
                    ${routeData.communes.size > 0 ? `
                    <div class="road-info-item" style="display: block; padding: 12px 0;">
                        <div class="road-info-label" style="margin-bottom: 8px;">Communes traversées</div>
                        <div class="road-info-value" style="text-align: left; line-height: 1.6; font-size: 0.8rem;">
                            ${formatCommunesList(Array.from(routeData.communes))}
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;
            
            // Afficher la section
            infoSection.style.display = 'block';
            
            // Ajouter les gestionnaires de clic sur les communes
            setTimeout(() => {
                document.querySelectorAll('.commune-link').forEach(link => {
                    link.addEventListener('click', function() {
                        const commune = this.getAttribute('data-commune');
                        zoomToCommune(commune, ref);
                    });
                });
            }, 100);
            
            // Scroll vers le panneau d'informations
            setTimeout(() => {
                infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
        
        // Fonction pour zoomer sur une commune spécifique d'une route
        let currentCommuneMarker = null; // Stocker le marqueur actuel pour le supprimer
        
        async function zoomToCommune(communeName, roadRef) {
            console.log(`Chargement du tronçon de ${roadRef} sur ${communeName}...`);
            
            // Supprimer le marqueur précédent s'il existe
            if (currentCommuneMarker) {
                map.removeLayer(currentCommuneMarker);
                currentCommuneMarker = null;
            }
            
            try {
                const communeFeature = await window.InforouteApi.fetchCommuneBoundary(communeName);
                
                if (communeFeature) {
                    const communeRings = geoJsonPolygonGeometryToLatLngRings(communeFeature.geometry);
                    
                    if (communeRings.length > 0) {
                        // Créer le polygone de la commune (temporaire, invisible)
                        const communePolygon = L.polygon(communeRings, {
                            color: 'transparent',
                            fillOpacity: 0
                        });
                        
                        // Trouver les segments de la route qui intersectent avec la commune
                        const roadPolylines = routePolylines[roadRef];
                        const intersectingSegments = [];
                        
                        if (roadPolylines) {
                            roadPolylines.forEach(polyline => {
                                const coords = polyline.getLatLngs();
                                
                                // Vérifier si au moins un point de la polyline est dans la commune
                                const hasIntersection = coords.some(coord => {
                                    const point = L.latLng(coord);
                                    return communeRings.some(ring => isPointInPolygon(point, ring));
                                });
                                
                                if (hasIntersection) {
                                    intersectingSegments.push(polyline);
                                }
                            });
                        }
                        
                        if (intersectingSegments.length > 0) {
                            // Calculer les bounds des segments qui traversent la commune
                            const bounds = L.latLngBounds(intersectingSegments.map(p => p.getBounds()));
                            
                            // Zoomer sur cette zone
                            map.fitBounds(bounds, { 
                                padding: [80, 80],
                                animate: true,
                                duration: 1
                            });
                            
                            // Créer un effet flash sur les segments concernés
                            const hierarchy = intersectingSegments[0].options.roadHierarchy;
                            const originalColor = hierarchyColors[hierarchy];
                            const originalWeight = hierarchyWeights[hierarchy] + 4; // Poids mis en évidence
                            
                            // Animation flash
                            let flashCount = 0;
                            const flashInterval = setInterval(() => {
                                if (intersectingSegments.length > 0 && intersectingSegments[0]._map) {
                                    intersectingSegments.forEach(seg => {
                                        seg.setStyle({
                                            color: flashCount % 2 === 0 ? '#FFD700' : originalColor,
                                            weight: originalWeight + 2,
                                            opacity: 1
                                        });
                                    });
                                    flashCount++;
                                    
                                    if (flashCount >= 6) {
                                        clearInterval(flashInterval);
                                        // Restaurer le style mis en évidence
                                        intersectingSegments.forEach(seg => {
                                            if (seg._map) {
                                                seg.setStyle({
                                                    color: originalColor,
                                                    weight: originalWeight,
                                                    opacity: 1
                                                });
                                            }
                                        });
                                    }
                                } else {
                                    clearInterval(flashInterval);
                                }
                            }, 200);
                            
                            // Afficher un marqueur avec le nom de la commune
                            const center = bounds.getCenter();
                            currentCommuneMarker = L.marker(center, {
                                icon: L.divIcon({
                                    className: 'commune-marker',
                                    html: `<div style="background: #3498DB; color: white; padding: 8px 12px; border-radius: 20px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-size: 0.9rem; white-space: nowrap;">${communeName}<br><small style="font-weight: normal; opacity: 0.9;">${roadRef}</small></div>`,
                                    iconSize: null
                                })
                            }).addTo(window.map);
                            
                            // Retirer le marqueur après 4 secondes
                            setTimeout(() => {
                                if (currentCommuneMarker) {
                                    map.removeLayer(currentCommuneMarker);
                                    currentCommuneMarker = null;
                                }
                            }, 4000);
                            
                            console.log(`✓ Tronçon de ${roadRef} sur ${communeName} affiché (${intersectingSegments.length} segments)`);
                        } else {
                            console.warn(`Aucun segment de ${roadRef} trouvé sur ${communeName}`);
                            // Fallback : zoom sur la commune quand même
                            zoomToCommuneFallback(communeName);
                        }
                    }
                } else {
                    // Fallback si la commune n'est pas trouvée dans le GeoJSON
                    console.warn(`Commune ${communeName} non trouvée dans le GeoJSON`);
                    zoomToCommuneFallback(communeName);
                }
            } catch (error) {
                console.error('Erreur lors du chargement de la géométrie:', error);
                // Fallback
                zoomToCommuneFallback(communeName);
            }
        }
        
        // Fonction de secours pour zoomer sur la commune via le GeoJSON local
        async function zoomToCommuneFallback(communeName) {
            try {
                const communeFeature = await window.InforouteApi.fetchCommuneBoundary(communeName);
                const communeRings = geoJsonPolygonGeometryToLatLngRings(communeFeature?.geometry);
                
                if (communeRings.length > 0) {
                    const bounds = L.latLngBounds(communeRings.flat());
                    map.fitBounds(bounds, {
                        padding: [80, 80],
                        animate: true,
                        duration: 1
                    });
                }
            } catch (error) {
                console.error('Erreur lors du zoom GeoJSON commune:', error);
            }
        }
        
        // Fonction pour vérifier si un point est dans un polygone (algorithme ray-casting)
        function isPointInPolygon(point, polygon) {
            let inside = false;
            const x = point.lat;
            const y = point.lng;
            
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i][0], yi = polygon[i][1];
                const xj = polygon[j][0], yj = polygon[j][1];
                
                const intersect = ((yi > y) !== (yj > y)) && 
                                  (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            
            return inside;
        }
        
        // Fonction pour formater la liste des communes avec les extrémités en gras
        function formatCommunesList(communes) {
            if (communes.length === 0) return 'Non disponible';
            if (communes.length === 1) return `<strong>${communes[0]}</strong>`;
            if (communes.length === 2) return `<strong>${communes[0]}</strong>, <strong>${communes[1]}</strong>`;
            
            // Trier les communes par ordre alphabétique
            const sorted = communes.sort((a, b) => a.localeCompare(b, 'fr'));
            
            // Créer des liens cliquables pour chaque commune
            const communeLinks = sorted.map((commune, index) => {
                const isExtremity = index === 0 || index === sorted.length - 1;
                const style = isExtremity ? 'font-weight: bold;' : '';
                return `<span class="commune-link" style="cursor: pointer; color: #3498DB; text-decoration: underline; ${style}" data-commune="${commune}">${commune}</span>`;
            });
            
            return communeLinks.join(', ');
        }

        // Charger les routes après un court délai pour laisser la carte s'initialiser
        setTimeout(loadDepartmentalRoads, 1000);

        // ========== MÉTÉO ==========

        function formatWeatherTime(value) {
            const match = String(value || '').match(/T(\d{2}:\d{2})/);
            return match ? match[1] : null;
        }
        
        async function loadWeather() {
            try {
                const data = await window.InforouteApi.fetchLiveJson('weather');
                
                if (data.current) {
                    const temp = Math.round(data.current.temperature_2m);
                    const weatherCode = data.current.weather_code;
                    
                    // Icônes météo selon le code WMO
                    const weatherIcons = {
                        0: '☀️',    // Ciel dégagé
                        1: '🌤️',   // Principalement dégagé
                        2: '⛅',   // Partiellement nuageux
                        3: '☁️',   // Couvert
                        45: '🌫️',  // Brouillard
                        48: '🌫️',  // Brouillard givrant
                        51: '🌦️',  // Bruine légère
                        53: '🌦️',  // Bruine modérée
                        55: '🌧️',  // Bruine dense
                        61: '🌧️',  // Pluie légère
                        63: '🌧️',  // Pluie modérée
                        65: '🌧️',  // Pluie forte
                        71: '🌨️',  // Neige légère
                        73: '🌨️',  // Neige modérée
                        75: '🌨️',  // Neige forte
                        77: '🌨️',  // Grésil
                        80: '🌧️',  // Averses légères
                        81: '🌧️',  // Averses modérées
                        82: '🌧️',  // Averses violentes
                        85: '🌨️',  // Averses de neige légères
                        86: '🌨️',  // Averses de neige fortes
                        95: '⛈️',  // Orage
                        96: '⛈️',  // Orage avec grêle légère
                        99: '⛈️'   // Orage avec grêle forte
                    };
                    
                    const weatherDescriptions = {
                        0: 'Ciel dégagé',
                        1: 'Dégagé',
                        2: 'Nuageux',
                        3: 'Couvert',
                        45: 'Brouillard',
                        48: 'Brouillard',
                        51: 'Bruine',
                        53: 'Bruine',
                        55: 'Bruine',
                        61: 'Pluie légère',
                        63: 'Pluie',
                        65: 'Forte pluie',
                        71: 'Neige légère',
                        73: 'Neige',
                        75: 'Forte neige',
                        77: 'Grésil',
                        80: 'Averses',
                        81: 'Averses',
                        82: 'Fortes averses',
                        85: 'Averses de neige',
                        86: 'Averses de neige',
                        95: 'Orage',
                        96: 'Orage',
                        99: 'Orage violent'
                    };
                    
                    const icon = weatherIcons[weatherCode] || '🌡️';
                    const desc = weatherDescriptions[weatherCode] || 'Variable';
                    const updatedAt = formatWeatherTime(data.current.time);
                    const details = ['Avignon', updatedAt].filter(Boolean).join(' • ');
                    
                    document.getElementById('weatherIcon').textContent = icon;
                    document.getElementById('weatherTemp').textContent = `${temp}°C`;
                    document.getElementById('weatherDesc').textContent = `${desc} • ${details}`;
                }
            } catch (error) {
                console.error('Erreur météo:', error);
                document.getElementById('weatherIcon').textContent = '🌡️';
                document.getElementById('weatherTemp').textContent = '--°C';
                document.getElementById('weatherDesc').textContent = 'Non disponible';
            }
        }
        
        // Charger la météo au démarrage
        loadWeather();
        window.setInterval(
            loadWeather,
            window.InforouteApi.getLiveSource('weather').refreshMs || (10 * 60 * 1000)
        );

        // ========== WAZE TRAFFIC ==========
        // (fonction définie globalement en haut du script)

        // Charger les données de comptage depuis le GeoJSON local actualisé par script
        async function loadTrafficCountingData() {
            console.log('🚦 === DÉBUT CHARGEMENT STATIONS DE COMPTAGE ===');
            
            let geojsonData = null;
            let sourceUsed = null;

            try {
                geojsonData = await window.InforouteApi.fetchGeoJson('traffic-counting');
                sourceUsed = geojsonData._cache?.source_name || 'data.gouv.fr / CD84 (GeoJSON local)';
                updateExternalRefreshStatus('Comptages CD84', geojsonData._cache);
                console.log(`✓ Données chargées depuis ${sourceUsed}`);
                console.log(`   Features: ${geojsonData.features.length}`);
            } catch (error) {
                console.warn('❌ Échec du chargement du GeoJSON local de comptage:', error.message);
            }

            if (!geojsonData || !geojsonData.features) {
                console.error('❌ AUCUN GEOJSON DE COMPTAGE DISPONIBLE');
                console.warn('⚠️ Utilisation de données de démonstration (local)');

                try {
                    geojsonData = await window.InforouteApi.fetchGeoJson('traffic-counting-demo');
                    sourceUsed = 'Données de démonstration (GeoJSON local)';
                    renderFreshnessBadge(document.getElementById('freshness-traffic'), {
                        generatedAt: geojsonData._cache?.generated_at,
                        scheduleKey: 'external',
                        errorMsg: 'Source réelle indisponible, démo affichée'
                    });
                    syncLegendChrome();
                } catch (error) {
                    console.error('❌ Échec du chargement des données de démonstration:', error);
                }
                
                if (geojsonData && geojsonData.features) {
                    L.popup()
                        .setLatLng([44.0, 5.0])
                        .setContent('<div style="padding: 15px; text-align: center;"><strong>⚠️ Stations de comptage</strong><br><small>GeoJSON local indisponible<br><br><strong>5 stations de démonstration affichées</strong><br><br>Lancez scripts/update_external_data.py pour actualiser les données réelles.</small></div>')
                        .openOn(window.map);
                    
                    setTimeout(() => window.map.closePopup(), 6000);
                } else {
                    geojsonData = { type: 'FeatureCollection', features: [] };
                    sourceUsed = 'Aucune donnée disponible';
                }
            }

            console.log(`✓ ${geojsonData.features.length} stations de comptage chargées depuis ${sourceUsed}`);

            // Compteurs pour les statistiques
            const trafficCounts = { high: 0, medium: 0, low: 0 };
            
            // Filtrer pour obtenir les données les plus récentes par station
            const latestDataByStation = {};
            geojsonData.features.forEach(feature => {
                const props = feature.properties;
                const stationId = props.section_compteur ?? props.section_co ?? props.identifian ?? props.id_station ?? props.id;
                const year = Number.parseInt(props.annee ?? props.year ?? props.an, 10);

                if (!stationId || !Number.isFinite(year)) return;
                
                if (!latestDataByStation[stationId] || year > latestDataByStation[stationId].year) {
                    latestDataByStation[stationId] = {
                        feature: feature,
                        year: year
                    };
                }
            });

            // Afficher les stations de comptage
            Object.values(latestDataByStation).forEach(data => {
                const feature = data.feature;
                const props = feature.properties;
                
                // Coordonnées de la station
                const lat = props.latitude || (feature.geometry ? feature.geometry.coordinates[1] : null);
                const lon = props.longitude || (feature.geometry ? feature.geometry.coordinates[0] : null);
                
                if (!lat || !lon) return;

                // MJA (Moyenne Journalière Annuelle)
                const mja = Number(props.mja_tv ?? props.mja ?? props.mja_jour ?? 0);
                const tauxPL = Number(props.taux_pl ?? props.tauxpl ?? props.taux_pl_pc ?? 0);
                const debitPL = Number(props.debit_pl ?? props.debitpl ?? props.pl_jour ?? 0);
                
                const routeName = props.nom_route_cd ?? props.nom_route_ ?? props.nom_route ?? props.route ?? props.ref ?? 'N/A';
                const sectionName = props.section_compteur ?? props.section_co ?? props.section ?? props.id_station ?? props.id ?? 'N/A';
                const yearValue = props.annee ?? props.year ?? props.an ?? 'N/A';
                
                const formatNumber = (value, suffix = '') => Number.isFinite(value) ? `${value.toLocaleString()}${suffix}` : 'N/A';
                
                // Déterminer la catégorie de trafic (gris clair → gris foncé)
                let style, category;
                if (mja >= 20000) {
                    style = TRAFFIC_STYLES.high;
                    category = 'high';
                    trafficCounts.high++;
                } else if (mja >= 5000) {
                    style = TRAFFIC_STYLES.medium;
                    category = 'medium';
                    trafficCounts.medium++;
                } else {
                    style = TRAFFIC_STYLES.low;
                    category = 'low';
                    trafficCounts.low++;
                }

                // Créer le marqueur (masqué par défaut — voir trafficVisible)
                const marker = L.circleMarker([lat, lon], {
                    radius: style.size,
                    fillColor: style.fill,
                    color: style.stroke,
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9,
                    stationType: 'counting'  // Pour identification lors du toggle trafic
                });

                // Stocker pour le toggle de visibilité
                trafficMarkers.push(marker);

                // Popup avec les informations de comptage
                const popupContent = `
                    <div class="route-popup">
                        <h3>📊 Station de comptage</h3>
                        <div class="detail"><strong>Route&nbsp;:</strong> ${routeName || 'N/A'}</div>
                        <div class="detail"><strong>Section&nbsp;:</strong> ${sectionName || 'N/A'}</div>
                        <div class="detail"><strong>Année&nbsp;:</strong> ${yearValue || 'N/A'}</div>
                        <div class="detail" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd;">
                            <strong>MJA (tous véhicules)&nbsp;:</strong> ${formatNumber(mja, ' véh/jour')}
                        </div>
                        <div class="detail"><strong>Taux PL&nbsp;:</strong> ${Number.isFinite(tauxPL) ? tauxPL.toFixed(1) + '%' : 'N/A'}</div>
                        <div class="detail"><strong>Débit PL&nbsp;:</strong> ${formatNumber(debitPL, ' PL/jour')}</div>
                        ${props.classe ? `<div class="detail"><strong>Classification&nbsp;:</strong> ${props.classe}</div>` : ''}
                        <div class="detail" style="margin-top: 8px; font-size: 0.75rem; color: #999;">
                            <strong>Source&nbsp;:</strong> ${sourceUsed || 'Inconnue'}
                        </div>
                    </div>
                `;

                marker.bindPopup(popupContent);

                // Effet de survol
                marker.on('mouseover', function() {
                    this.setStyle({
                        radius: style.size + 3,
                        weight: 3,
                        fillOpacity: 1
                    });
                });

                marker.on('mouseout', function() {
                    this.setStyle({
                        radius: style.size,
                        weight: 2,
                        fillOpacity: 0.9
                    });
                });
            });

            // Mettre à jour les compteurs dans la légende
            document.getElementById('count-high').textContent = trafficCounts.high;
            document.getElementById('count-medium').textContent = trafficCounts.medium;
            document.getElementById('count-low').textContent = trafficCounts.low;
            
            console.log(`✓ Marqueurs créés:`, trafficCounts);

            // Mettre à jour les statistiques
            const totalStations = trafficCounts.high + trafficCounts.medium + trafficCounts.low;
            const years = Object.values(latestDataByStation).map(d => d.year).filter(Number.isFinite);
            const latestYear = years.length ? Math.max(...years) : 'N/A';
            const sourceYears = formatYearRange(collectYears(geojsonData.features, ['annee', 'year', 'an']));
            renderFreshnessBadge(document.getElementById('freshness-traffic'), {
                generatedAt: geojsonData._cache?.generated_at,
                scheduleKey: 'external',
                errorMsg: geojsonData._cache?.error
            });
            syncLegendChrome();
            
            console.log(`✓ Total stations affichées: ${totalStations} (année max ${latestYear})`);
            console.log('🚦 === FIN CHARGEMENT STATIONS DE COMPTAGE ===');

            // Rafraîchir les statistiques "Informations Réseau" maintenant que les MJA sont connus.
            if (typeof updateNetworkStats === 'function') updateNetworkStats();
        }

        // Charger les données d'accidentologie depuis le GeoJSON statique local
        async function loadAccidentData() {
            try {
                console.log('📊 Chargement des données d\'accidentologie...');

                const dataToUse = await window.InforouteApi.fetchGeoJson('accidents');
                const stats = dataToUse.metadata?.statistiques || {};
                const features = dataToUse.features;
                renderFreshnessBadge(document.getElementById('freshness-accidents'), {
                    generatedAt: dataToUse._cache?.generated_at,
                    scheduleKey: 'static'
                });
                syncLegendChrome();
                
                console.log(`✓ ${features.length} accidents chargés pour le Vaucluse`);
                console.log('Statistiques:', stats);
                
                // Compteurs par catégorie
                const counts = { fatal: 0, hospitalized: 0, light: 0 };
                
                // Afficher chaque accident sur la carte
                features.forEach(feature => {
                    const props = feature.properties;
                    const coords = feature.geometry.coordinates;
                    const lat = coords[1];
                    const lon = coords[0];
                    
                    // Déterminer la couleur et la taille selon la gravité
                    let color, size, category, label;
                    if (props.gravite === 'mortel') {
                        color = '#000000';
                        size = 12;
                        category = 'fatal';
                        label = '💀 Accident mortel';
                        counts.fatal++;
                    } else if (props.gravite === 'grave') {
                        color = '#E74C3C';
                        size = 10;
                        category = 'hospitalized';
                        label = '🚑 Blessés hospitalisés';
                        counts.hospitalized++;
                    } else {
                        color = '#F39C12';
                        size = 8;
                        category = 'light';
                        label = '⚠️ Blessés légers';
                        counts.light++;
                    }
                    
                    // Créer le marqueur (ne PAS l'ajouter à la carte par défaut)
                    const marker = L.circleMarker([lat, lon], {
                        radius: size,
                        fillColor: color,
                        color: 'white',
                        weight: 2,
                        opacity: 0.9,
                        fillOpacity: 0.7
                    });
                    
                    // Stocker le marqueur pour le toggle
                    accidentMarkers.push(marker);
                    
                    // Popup avec les informations
                    const victimesInfo = [];
                    if (props.tues > 0) victimesInfo.push(`${props.tues} tué(s)`);
                    if (props.hospitalises > 0) victimesInfo.push(`${props.hospitalises} hospitalisé(s)`);
                    if (props.legers > 0) victimesInfo.push(`${props.legers} blessé(s) léger(s)`);
                    
                    const popupContent = `
                        <div class="route-popup">
                            <h3>${label}</h3>
                            <div class="detail"><strong>Victimes&nbsp;:</strong> ${victimesInfo.join(', ')}</div>
                            <div class="detail"><strong>Date&nbsp;:</strong> ${props.date}</div>
                            <div class="detail"><strong>Commune&nbsp;:</strong> ${props.commune}</div>
                            ${props.adresse ? `<div class="detail"><strong>Adresse&nbsp;:</strong> ${props.adresse}</div>` : ''}
                            <div class="detail"><strong>Milieu&nbsp;:</strong> ${props.milieu}</div>
                            ${props.resume ? `<div class="detail" style="margin-top: 8px; font-size: 0.85rem; font-style: italic;">${props.resume}</div>` : ''}
                        </div>
                    `;
                    
                    marker.bindPopup(popupContent);
                    
                    // Effet de survol
                    marker.on('mouseover', function() {
                        this.setStyle({ 
                            radius: size + 3,
                            weight: 3,
                            fillOpacity: 1
                        });
                    });
                    
                    marker.on('mouseout', function() {
                        this.setStyle({ 
                            radius: size,
                            weight: 2,
                            fillOpacity: 0.7
                        });
                    });
                });
                
                // Mettre à jour les compteurs
                document.getElementById('count-fatal').textContent = counts.fatal;
                document.getElementById('count-hospitalized').textContent = counts.hospitalized;
                document.getElementById('count-light').textContent = counts.light;
                
                console.log('Répartition:', counts);
                
            } catch (error) {
                console.error('Erreur lors du chargement de l\'accidentologie:', error);
            }
        }
        
        // Charger les données de comptage après les routes
        setTimeout(loadTrafficCountingData, 2000);
        
        // Charger l'accidentologie après le comptage
        setTimeout(loadAccidentData, 3000);
        
        // Charger les données Bison Futé (Info Routière)
        setTimeout(loadBisonFuteData, 4000);
        
        // ========== ROUTES EN CONSTRUCTION ==========

        function classifyConstructionWay(tags) {
            if (!tags) return null;
            if (tags.highway === 'construction' || tags.construction === 'highway' || tags['construction:highway']) {
                return 'construction';
            }
            if (tags.highway === 'proposed' || tags.proposed === 'highway' || tags['proposed:highway']) {
                return 'proposed';
            }
            return tags.road_status === 'construction' || tags.road_status === 'proposed'
                ? tags.road_status
                : null;
        }
        
        window.loadConstructionRoads = async function() {
            try {
                const data = await window.InforouteApi.fetchGeoJson('construction-roads');
                renderFreshnessBadge(document.getElementById('freshness-construction'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'osm'
                });
                syncLegendChrome();

                const constructionWays = (data.features || [])
                    .map(geoJsonLineFeatureToWay)
                    .filter(Boolean);

                let constructionCount = 0;
                let proposedCount = 0;

                constructionWays.forEach(way => {
                    if (!way.geometry || way.geometry.length === 0) return;

                    const coords = way.geometry.map(point => [point.lat, point.lon]);
                    const tags = way.tags || {};
                    const status = classifyConstructionWay(tags);
                    if (!status) return;

                    const styles = status === 'construction'
                        ? { color: '#FF6B35', weight: 6, dashArray: '15, 10', statusLabel: '🚧 En construction' }
                        : { color: '#9B59B6', weight: 5, dashArray: '10, 15', statusLabel: '📋 En projet' };

                    if (status === 'construction') constructionCount++;
                    else proposedCount++;

                    const polyline = L.polyline(coords, {
                        color: styles.color,
                        weight: styles.weight,
                        opacity: 0.9,
                        dashArray: styles.dashArray
                    }).addTo(window.map);

                    constructionPolylines.push(polyline);

                    const futureType = tags.construction || tags.proposed || tags['construction:highway'] || tags['proposed:highway'] || tags.highway || 'Route';
                    const name = tags.name || tags.ref || 'Sans nom';
                    const startDate = tags.start_date || tags['construction:start_date'] || 'Non renseignée';
                    const endDate = tags.end_date || tags['construction:end_date'] || tags.opening_date || 'Non renseignée';
                    const expectedOpening = tags.opening_date || tags['opening_date:expected'] || 'Non renseignée';

                    polyline.bindPopup(`
                        <div class="route-popup">
                            <h3>${styles.statusLabel}</h3>
                            <div class="detail"><strong>Nom/Réf&nbsp;:</strong> ${escapeHtml(name)}</div>
                            <div class="detail"><strong>Type futur&nbsp;:</strong> ${escapeHtml(String(futureType).replace('_', ' '))}</div>
                            ${tags.description || tags['construction:description'] ? `
                                <div class="detail" style="margin-top: 10px; padding: 10px; background: #fff3cd; border-left: 4px solid #FF6B35; border-radius: 4px; font-style: italic;">
                                    ℹ️ ${escapeHtml(tags.description || tags['construction:description'])}
                                </div>
                            ` : ''}
                            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #ddd;">
                                ${startDate !== 'Non renseignée' ? `<div class="detail"><strong>🗓️ Début&nbsp;:</strong> ${escapeHtml(startDate)}</div>` : ''}
                                ${endDate !== 'Non renseignée' ? `<div class="detail"><strong>🏁 Fin prévue&nbsp;:</strong> ${escapeHtml(endDate)}</div>` : ''}
                                ${expectedOpening !== 'Non renseignée' ? `<div class="detail"><strong>🎉 Ouverture&nbsp;:</strong> ${escapeHtml(expectedOpening)}</div>` : ''}
                            </div>
                            ${tags.operator || tags['construction:operator'] ? `
                                <div class="detail" style="margin-top: 8px;">
                                    <strong>🏗️ Maître d'ouvrage&nbsp;:</strong> ${escapeHtml(tags.operator || tags['construction:operator'])}
                                </div>
                            ` : ''}
                            ${tags.website ? `
                                <div class="detail" style="margin-top: 10px;">
                                    <strong>🌐 Site web&nbsp;:</strong>
                                    <a href="${escapeHtml(tags.website)}" target="_blank" rel="noopener noreferrer" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                        Visiter le site du projet →
                                    </a>
                                </div>
                            ` : ''}
                            <div class="detail" style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #e0e0e0;">
                                <a href="https://www.openstreetmap.org/way/${way.id}" target="_blank" rel="noopener noreferrer" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                    🗺️ Voir sur OpenStreetMap →
                                </a>
                            </div>
                        </div>
                    `);

                    polyline.on('mouseover', function() {
                        this.setStyle({ weight: styles.weight + 2, opacity: 1 });
                    });
                    polyline.on('mouseout', function() {
                        this.setStyle({ weight: styles.weight, opacity: 0.9 });
                    });
                });

                document.getElementById('count-construction').textContent = String(constructionCount);
                document.getElementById('count-proposed').textContent = String(proposedCount);
                applyConstructionVisibleUi();
            } catch (error) {
                console.error('Erreur chargement routes en construction:', error);
                document.getElementById('count-construction').textContent = '0';
                document.getElementById('count-proposed').textContent = '0';
                applyConstructionVisibleUi();
            }
        };

        window.loadBicycleRoutes = async function() {
            try {
                const data = await window.InforouteApi.fetchGeoJson('bicycle-routes');
                renderFreshnessBadge(document.getElementById('freshness-bicycle'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'osm'
                });
                syncLegendChrome();

                const bicycleWays = (data.features || [])
                    .map(geoJsonLineFeatureToWay)
                    .filter(Boolean);

                const relationIds = new Set(
                    bicycleWays
                        .map(way => way.tags?.relation_id)
                        .filter(Boolean)
                );

                document.getElementById('count-bicycle-routes').textContent = String(relationIds.size);

                if (bicycleWays.length === 0) {
                    bicycleVisible = false;
                    applyBicycleHiddenUi();
                    return;
                }

                bicycleWays.forEach(way => {
                    const coords = way.geometry.map(point => [point.lat, point.lon]);
                    const tags = way.tags || {};
                    const relationTags = tags.relation_tags || {};
                    const name = tags.name || relationTags.name || tags.ref || relationTags.ref || 'Véloroute sans nom';
                    const network = tags.network || relationTags.network || '';
                    const operator = tags.operator || relationTags.operator || '';
                    const relationId = tags.relation_id;

                    const polyline = L.polyline(coords, {
                        color: BICYCLE_ROUTE_COLOUR,
                        weight: 4,
                        opacity: 0.85
                    }).addTo(window.map);

                    bicyclePolylines.push(polyline);

                    const popupContent = `
                        <div class="route-popup">
                            <h3>🚴 ${escapeHtml(name)}</h3>
                            ${network ? `<div class="detail"><strong>Réseau&nbsp;:</strong> ${escapeHtml(network)}</div>` : ''}
                            ${operator ? `<div class="detail"><strong>Opérateur&nbsp;:</strong> ${escapeHtml(operator)}</div>` : ''}
                            ${relationId ? `
                                <div class="detail" style="margin-top: 10px;">
                                    <a href="https://www.openstreetmap.org/relation/${relationId}" target="_blank" rel="noopener noreferrer" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                        Voir la relation OSM →
                                    </a>
                                </div>
                            ` : ''}
                        </div>
                    `;

                    polyline.bindPopup(popupContent);
                    polyline.on('mouseover', function() {
                        this.setStyle({ weight: 6, opacity: 1 });
                    });
                    polyline.on('mouseout', function() {
                        this.setStyle({ weight: 4, opacity: 0.85 });
                    });
                });

                applyBicycleVisibleUi();
            } catch (error) {
                console.error('Erreur chargement véloroutes:', error);
                bicycleVisible = false;
                applyBicycleHiddenUi();
                document.getElementById('count-bicycle-routes').textContent = '0';
            }
        };

        // ========== BISON FUTÉ / INFO ROUTIÈRE ==========
        
        async function loadBisonFuteData() {
            try {
                console.log('🚗 Chargement des données Bison Futé / Info Routière...');
                
                const data = await window.InforouteApi.fetchGeoJson('road-events');
                updateExternalRefreshStatus('Info Routière', data._cache);

                renderFreshnessBadge(document.getElementById('freshness-bison-fute'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'external',
                    errorMsg: data._cache?.error
                });
                syncLegendChrome();
                
                if (!data.features || data.features.length === 0) {
                    console.log('ℹ️ Aucun événement Info Routière dans le GeoJSON local');
                    return;
                }
                
                console.log(`✓ ${data.features.length} événements routiers chargés`);
                
                // Filtrer les événements dans ou proche du Vaucluse (bbox approximatif)
                const vaucluseBbox = {
                    minLat: 43.6,
                    maxLat: 44.5,
                    minLon: 4.6,
                    maxLon: 5.8
                };
                
                let eventsCount = { travaux: 0, bouchons: 0, accidents: 0, autres: 0 };
                
                data.features.forEach(feature => {
                    const geom = feature.geometry;
                    const props = feature.properties;
                    
                    if (!geom || !geom.coordinates) return;
                    
                    // Extraire les coordonnées selon le type de géométrie
                    let lat, lon;
                    if (geom.type === 'Point') {
                        lon = geom.coordinates[0];
                        lat = geom.coordinates[1];
                    } else if (geom.type === 'LineString') {
                        // Prendre le point médian
                        const midIndex = Math.floor(geom.coordinates.length / 2);
                        lon = geom.coordinates[midIndex][0];
                        lat = geom.coordinates[midIndex][1];
                    } else {
                        return; // Ignorer les autres types
                    }
                    
                    // Vérifier si dans le Vaucluse ou proche
                    if (lat < vaucluseBbox.minLat || lat > vaucluseBbox.maxLat ||
                        lon < vaucluseBbox.minLon || lon > vaucluseBbox.maxLon) {
                        return; // Hors zone
                    }
                    
                    // Déterminer le type d'événement
                    const eventType = props.event_type || props.type || 'autre';
                    let icon, color, category;
                    
                    if (eventType.includes('roadwork') || eventType.includes('travaux')) {
                        icon = '🚧';
                        color = '#F39C12';
                        category = 'travaux';
                        eventsCount.travaux++;
                    } else if (eventType.includes('congestion') || eventType.includes('bouchon')) {
                        icon = '🚗';
                        color = '#E74C3C';
                        category = 'bouchons';
                        eventsCount.bouchons++;
                    } else if (eventType.includes('accident')) {
                        icon = '⚠️';
                        color = '#C0392B';
                        category = 'accidents';
                        eventsCount.accidents++;
                    } else {
                        icon = 'ℹ️';
                        color = '#3498DB';
                        category = 'autres';
                        eventsCount.autres++;
                    }
                    
                    // Créer le marqueur (masqué par défaut — voir bisonFuteVisible)
                    const marker = L.marker([lat, lon], {
                        icon: L.divIcon({
                            html: `<div style="font-size: 1.5rem; text-shadow: 0 0 3px white;">${icon}</div>`,
                            className: 'bison-fute-marker',
                            iconSize: [30, 30],
                            iconAnchor: [15, 15]
                        })
                    });

                    // Stocker pour le toggle de visibilité
                    bisonFuteMarkers.push(marker);
                    
                    // Popup avec les informations
                    const startDate = props.start_time ? new Date(props.start_time).toLocaleString('fr-FR') : 'N/A';
                    const endDate = props.end_time ? new Date(props.end_time).toLocaleString('fr-FR') : 'N/A';
                    
                    const popupContent = `
                        <div class="route-popup">
                            <h3>${icon} Bison Futé</h3>
                            <div class="detail"><strong>Type&nbsp;:</strong> ${eventType}</div>
                            ${props.description ? `<div class="detail"><strong>Description&nbsp;:</strong> ${props.description}</div>` : ''}
                            ${props.road_name ? `<div class="detail"><strong>Route&nbsp;:</strong> ${props.road_name}</div>` : ''}
                            <div class="detail"><strong>Début&nbsp;:</strong> ${startDate}</div>
                            ${props.end_time ? `<div class="detail"><strong>Fin prévue&nbsp;:</strong> ${endDate}</div>` : ''}
                            <div class="detail" style="margin-top: 8px; font-size: 0.75rem; color: #999;">
                                <strong>Source&nbsp;:</strong> Bison Futé / Info Routière
                            </div>
                        </div>
                    `;
                    
                    marker.bindPopup(popupContent);
                });
                
                const totalEvents = eventsCount.travaux + eventsCount.bouchons + eventsCount.accidents + eventsCount.autres;
                
                if (totalEvents > 0) {
                    console.log(`✓ Événements Bison Futé affichés:`, eventsCount);
                } else {
                    console.log('ℹ️ Aucun événement Bison Futé dans la zone du Vaucluse actuellement');
                }
                
            } catch (error) {
                console.error('❌ Erreur lors du chargement Bison Futé:', error);
                console.log('ℹ️ Bison Futé couvre principalement le RRN (autoroutes, nationales)');
            }
        }


        // Ajouter des marqueurs pour les principales villes
        const cities = [
            { name: 'Avignon', coords: [43.949, 4.805], size: 'large' },
            { name: 'Orange', coords: [44.136, 4.809], size: 'medium' },
            { name: 'Carpentras', coords: [44.055, 5.048], size: 'medium' },
            { name: 'Cavaillon', coords: [43.838, 5.038], size: 'medium' },
            { name: 'Apt', coords: [43.876, 5.396], size: 'medium' },
            { name: 'L\'Isle-sur-la-Sorgue', coords: [43.919, 5.052], size: 'small' },
            { name: 'Pertuis', coords: [43.693, 5.502], size: 'small' }
        ];

        cities.forEach(city => {
            const radius = city.size === 'large' ? 8 : city.size === 'medium' ? 6 : 4;
            const cityMarker = L.circleMarker(city.coords, {
                radius: radius,
                fillColor: '#2C3E50',
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9
            }).addTo(window.map).bindPopup(`<strong>${city.name}</strong>`);

            // Stocker pour le toggle de visibilité
            cityMarkers.push(cityMarker);
        });

        // Gestion des clics sur la légende (hiérarchie uniquement, si pas de handler inline)
        document.querySelectorAll('.legend-item[data-hierarchy]').forEach(item => {
            item.addEventListener('click', function() {
                const hierarchy = this.dataset.hierarchy;
                if (!hierarchy) return;
                if (this.getAttribute('onclick')) return;
                if (typeof window.toggleHierarchy === 'function') {
                    window.toggleHierarchy(hierarchy);
                }
            });
        });
        
        // ========== LIMITATIONS DE VITESSE & RESTRICTIONS (max*) ==========

        let limitationsMode = false;
        const speedPictoLayer = L.layerGroup();
        const restrictionLayer = L.layerGroup();
        let limitationsZoomHandler = null;

        // Échelle de couleurs chaud/froid pour les limites de vitesse (km/h).
        // Convention : froid (bleu) = lent / sécurisé, chaud (rouge) = rapide.
        const SPEED_COLOR_SCALE = [
            { max: 30,  color: '#2980B9', label: '≤30' },
            { max: 50,  color: '#5DADE2', label: '50' },
            { max: 70,  color: '#F4D03F', label: '70' },
            { max: 80,  color: '#F39C12', label: '80' },
            { max: 100, color: '#E67E22', label: '90' },
            { max: 130, color: '#C0392B', label: '≥110' }
        ];
        const SPEED_UNKNOWN_COLOR = '#95A5A6';

        // Convertit la valeur maxspeed OSM en nombre (km/h), ou null si inconnu.
        function parseMaxspeed(raw) {
            if (raw === null || raw === undefined) return null;
            const trimmed = String(raw).trim();
            if (!trimmed || trimmed === 'none' || trimmed === 'signals') return null;
            // OSM convention en France : "FR:rural" = 80, "FR:urban" = 50, "FR:motorway" = 130
            if (trimmed === 'FR:rural') return 80;
            if (trimmed === 'FR:urban') return 50;
            if (trimmed === 'FR:motorway') return 130;
            if (trimmed === 'FR:zone30') return 30;
            const m = trimmed.match(/^(\d+)(?:\s*(mph|kmh|km\/h))?$/i);
            if (!m) return null;
            const value = Number.parseInt(m[1], 10);
            if (!Number.isFinite(value)) return null;
            if (m[2] && m[2].toLowerCase() === 'mph') return Math.round(value * 1.60934);
            return value;
        }

        function colorForSpeed(kmh) {
            if (kmh === null || kmh === undefined) return SPEED_UNKNOWN_COLOR;
            for (const step of SPEED_COLOR_SCALE) {
                if (kmh <= step.max) return step.color;
            }
            return SPEED_COLOR_SCALE[SPEED_COLOR_SCALE.length - 1].color;
        }

        // Repeint toutes les polylines de routes selon leur maxspeed.
        function applySpeedGradient() {
            Object.keys(window.routePolylines).forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    const tags = polyline.options.wayTags || {};
                    const kmh = parseMaxspeed(tags.maxspeed);
                    polyline.setStyle({
                        color: colorForSpeed(kmh),
                        opacity: kmh === null ? 0.45 : 0.9,
                        weight: hierarchyWeights[polyline.options.roadHierarchy]
                    });
                });
            });
        }

        // Inverse de applySpeedGradient : restaure les couleurs hiérarchie normales.
        function restoreHierarchyStyles() {
            Object.keys(window.routePolylines).forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    polyline.setStyle({
                        color: hierarchyColors[hierarchy],
                        weight: hierarchyWeights[hierarchy],
                        opacity: 0.8
                    });
                });
            });
        }

        // Point médian d'une polyline (utilisé comme ancre des pictos).
        function polylineMidLatLng(polyline) {
            const latlngs = polyline.getLatLngs();
            if (!latlngs.length) return null;
            return latlngs[Math.floor(latlngs.length / 2)];
        }

        // Pictogramme rond style panneau de vitesse français.
        function makeSpeedPictoMarker(latlng, kmh) {
            return L.marker(latlng, {
                icon: L.divIcon({
                    html: `<div class="speed-picto" style="border-color:${colorForSpeed(kmh)};">${kmh}</div>`,
                    className: 'speed-picto-wrapper',
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                }),
                interactive: false,
                keyboard: false
            });
        }

        // Pictogramme rectangulaire pour les restrictions (hauteur, poids, longueur, largeur).
        // Box assez large (90px) pour absorber "🚛 12.5t" sans rognage, ancrée centrée.
        function makeRestrictionPictoMarker(latlng, icon, value, color) {
            return L.marker(latlng, {
                icon: L.divIcon({
                    html: `<div class="restriction-picto" style="border-color:${color};"><span class="restriction-picto-icon">${icon}</span><span>${value}</span></div>`,
                    className: 'restriction-picto-wrapper',
                    iconSize: [90, 22],
                    iconAnchor: [45, 11]
                })
            });
        }

        // Normalise une valeur OSM type "3.5", "4.0", "3.5 m" ou "12 t" en chaîne compacte
        // sans espace et sans décimale superflue ("4.0m" → "4m", "3.50m" → "3.5m").
        function compactUnit(raw, unit) {
            if (raw === null || raw === undefined) return '';
            const trimmed = String(raw).trim();
            // Si la valeur contient déjà une unité, on garde l'unité mais on nettoie.
            if (/[a-zA-Z]/.test(trimmed)) {
                const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z/]+)$/);
                if (m) {
                    const num = Number.parseFloat(m[1]);
                    return `${Number.isFinite(num) ? +num.toFixed(2) : m[1]}${m[2]}`;
                }
                return trimmed.replace(/\s+/g, '');
            }
            const num = Number.parseFloat(trimmed);
            const display = Number.isFinite(num) ? +num.toFixed(2) : trimmed;
            return `${display}${unit}`;
        }

        // Décide quelles restrictions on rend pour un way donné (hauteur, poids, longueur, largeur).
        function restrictionEntriesFromTags(tags) {
            const entries = [];
            const heightRaw = tags.maxheight;
            if (heightRaw && heightRaw !== 'no' && heightRaw !== 'default' && heightRaw !== 'none') {
                const v = compactUnit(heightRaw, 'm');
                entries.push({ icon: '🏔️', value: v, color: '#C0392B', label: `Hauteur max ${v}` });
            }
            const weightRaw = tags.maxweight || tags.maxweightrating;
            if (weightRaw && weightRaw !== 'no' && weightRaw !== 'default' && weightRaw !== 'none') {
                const v = compactUnit(weightRaw, 't');
                entries.push({ icon: '🚛', value: v, color: '#8E44AD', label: `Poids max ${v}` });
            }
            const lengthRaw = tags.maxlength;
            if (lengthRaw && lengthRaw !== 'no' && lengthRaw !== 'default') {
                const v = compactUnit(lengthRaw, 'm');
                entries.push({ icon: '↔️', value: v, color: '#E67E22', label: `Longueur max ${v}` });
            }
            const widthRaw = tags.maxwidth;
            if (widthRaw && widthRaw !== 'no' && widthRaw !== 'default') {
                const v = compactUnit(widthRaw, 'm');
                entries.push({ icon: '↕️', value: v, color: '#16A085', label: `Largeur max ${v}` });
            }
            return entries;
        }

        // Affiche les pictos vitesse / restrictions visibles dans la vue actuelle.
        // Stratégie zoom :
        //   - zoom <  11 : dégradé seul, aucun picto (carto-overview)
        //   - zoom 11-12: restrictions des ponts/PL seulement
        //   - zoom ≥ 13 : pictos vitesse + restrictions
        function renderPictograms() {
            speedPictoLayer.clearLayers();
            restrictionLayer.clearLayers();
            if (!limitationsMode) return;

            const zoom = window.map.getZoom();
            const bounds = window.map.getBounds();
            const showSpeed = zoom >= 13;
            const showRestrictions = zoom >= 11;
            if (!showSpeed && !showRestrictions) return;

            // Pour éviter la surcharge, on évite plusieurs pictos vitesse pour une même route
            // identifiée par sa valeur de maxspeed dans un petit rayon.
            const speedKeysSeen = new Set();

            Object.keys(window.routePolylines).forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    const tags = polyline.options.wayTags || {};
                    const mid = polylineMidLatLng(polyline);
                    if (!mid || !bounds.contains(mid)) return;

                    if (showSpeed) {
                        const kmh = parseMaxspeed(tags.maxspeed);
                        if (kmh !== null) {
                            // Clé approximative (réf + vitesse + 0.005° ~ 500 m) pour limiter les doublons.
                            const key = `${ref}|${kmh}|${mid.lat.toFixed(2)}|${mid.lng.toFixed(2)}`;
                            if (!speedKeysSeen.has(key)) {
                                speedKeysSeen.add(key);
                                makeSpeedPictoMarker(mid, kmh).addTo(speedPictoLayer);
                            }
                        }
                    }

                    if (showRestrictions) {
                        // On restreint les restrictions visuelles aux tronçons "remarquables"
                        // pour rester lisible : ponts, tunnels, ou tronçons restreints en zone large.
                        const isBridge = tags.bridge && tags.bridge !== 'no';
                        const isTunnel = tags.tunnel === 'yes';
                        const entries = restrictionEntriesFromTags(tags);
                        const interestingZoom = zoom >= 13;
                        if (entries.length > 0 && (isBridge || isTunnel || interestingZoom)) {
                            entries.slice(0, 2).forEach((entry, i) => {
                                const offsetLatLng = L.latLng(mid.lat, mid.lng + i * 0.0006);
                                const marker = makeRestrictionPictoMarker(offsetLatLng, entry.icon, entry.value, entry.color);
                                marker.bindTooltip(`${entry.label}${isBridge ? ' (pont)' : isTunnel ? ' (tunnel)' : ''}`);
                                marker.addTo(restrictionLayer);
                            });
                        }
                    }
                });
            });
        }

        function updateLimitationsLegend() {
            const container = document.getElementById('limitationsLegend');
            if (!container) return;
            if (!limitationsMode) {
                container.style.display = 'none';
                return;
            }
            container.style.display = 'block';
            const scaleHtml = SPEED_COLOR_SCALE.map(step =>
                `<div class="limitations-legend-step" style="background:${step.color};">${step.label}</div>`
            ).join('');
            container.innerHTML = `
                <div style="font-size:0.78rem; color:#5b6770; font-weight:600; margin-bottom:4px;">Limites de vitesse (km/h)</div>
                <div class="limitations-legend-scale">${scaleHtml}</div>
                <div style="font-size:0.7rem; color:#7f8c8d; margin-top:6px;">Inconnue&nbsp;: <span style="display:inline-block;width:14px;height:8px;border-radius:2px;background:${SPEED_UNKNOWN_COLOR};vertical-align:middle;"></span></div>
                <div style="font-size:0.7rem; color:#7f8c8d; margin-top:8px; padding-top:6px; border-top:1px solid #ecf0f1;">
                    Pictogrammes <strong style="color:#2C3E50;">vitesse</strong> au zoom ≥ 13.<br>
                    Restrictions <strong style="color:#C0392B;">🏔️ hauteur</strong> · <strong style="color:#8E44AD;">🚛 poids</strong> sur ponts et tronçons remarquables au zoom ≥ 11.
                </div>
            `;
        }

        function setLimitationsButtonActive(active) {
            setToolActive('limitsBtn', active);
        }

        window.toggleLimitationsMode = function() {
            limitationsMode = !limitationsMode;
            console.log(`🚦 Mode Limitations : ${limitationsMode ? 'ON' : 'OFF'}`);

            if (limitationsMode) {
                applySpeedGradient();
                speedPictoLayer.addTo(window.map);
                restrictionLayer.addTo(window.map);
                renderPictograms();
                if (!limitationsZoomHandler) {
                    limitationsZoomHandler = () => renderPictograms();
                    window.map.on('zoomend moveend', limitationsZoomHandler);
                }
                setLimitationsButtonActive(true);
            } else {
                restoreHierarchyStyles();
                speedPictoLayer.clearLayers();
                restrictionLayer.clearLayers();
                window.map.removeLayer(speedPictoLayer);
                window.map.removeLayer(restrictionLayer);
                if (limitationsZoomHandler) {
                    window.map.off('zoomend moveend', limitationsZoomHandler);
                    limitationsZoomHandler = null;
                }
                setLimitationsButtonActive(false);
            }
            updateLimitationsLegend();
            syncLegendChrome();
        };

        }); // Fin DOMContentLoaded
    
