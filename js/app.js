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

        const hierarchyColors = {
            regional: '#E74C3C',
            territorial: '#F39C12',
            local: '#3498DB',
            veloroute: '#27AE60'
        };

        const hierarchyWeights = {
            regional: 6,
            territorial: 5,
            local: 4,
            veloroute: 3
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
            const btn = document.querySelector('button[onclick="toggleQualityPanel()"]');
            
            panel.classList.toggle('active');
            
            // Mettre le bouton en gras quand actif
            if (panel.classList.contains('active')) {
                if (btn) btn.style.fontWeight = '700';
                if (!panel.dataset.loaded) {
                    calculateQualityMetrics();
                    panel.dataset.loaded = 'true';
                }
            } else {
                if (btn) btn.style.fontWeight = '600';
            }
        }

        let wazeLayer = null;
        let wazeEnabled = false;
        let trafficMarkers = [];
        let trafficVisible = true;
        let accidentMarkers = [];
        let accidentsVisible = false;
        let convoiMode = false;
        let constructionPolylines = [];
        let constructionVisible = false;
        let bisonFuteMarkers = [];
        let bisonFuteVisible = true;
        let cityMarkers = [];
        let citiesVisible = true;
        const dataRefreshState = {};
        
        // État de visibilité par hiérarchie
        let hierarchyVisibility = {
            regional: true,
            territorial: true,
            local: true
        };

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
                `Données externes : cache local rafraîchi toutes les ${refreshHours} h`,
                ...lines
            ].join('<br>');
        }

        // ========== ROUTES EN CONSTRUCTION ==========
        
        window.toggleConstruction = function() {
            console.log('🔵 toggleConstruction appelée, état actuel:', constructionVisible);
            console.log('   Nombre de polylines:', constructionPolylines.length);
            
            constructionVisible = !constructionVisible;
            
            const icon = document.getElementById('constructionToggleIcon');
            const legendItems = document.querySelectorAll('[data-construction]');
            const title = document.querySelector('.legend-section:has([id="constructionToggleIcon"]) .legend-title');
            
            console.log('   Nouvel état:', constructionVisible);
            console.log('   Icône trouvée:', icon ? 'oui' : 'non');
            console.log('   Items légende:', legendItems.length);
            
            if (constructionVisible) {
                console.log('   → Affichage des routes en construction');
                
                // Charger les données si pas encore fait
                if (constructionPolylines.length === 0) {
                    console.log('   → Chargement des données...');
                    
                    // Afficher un popup de chargement avec spinner animé
                    const loadingPopup = L.popup({
                        closeButton: false,
                        autoClose: false,
                        closeOnClick: false,
                        className: 'loading-popup'
                    })
                        .setLatLng([44.0, 5.1])
                        .setContent(`
                            <div style="padding: 25px; text-align: center; min-width: 280px;">
                                <div style="font-size: 3rem; animation: spin 1.5s linear infinite;">⏳</div>
                                <div style="margin-top: 15px; font-weight: 700; font-size: 1.2rem; color: #2C3E50;">
                                    Chargement en cours...
                                </div>
                                <div style="margin-top: 10px; color: #666; font-size: 0.9rem;">
                                    Lecture du GeoJSON local
                                </div>
                                <div id="loadingTimer" style="margin-top: 15px; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 1.8rem; color: white; font-weight: 700; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                                    <span id="timerSeconds">0</span>s
                                </div>
                                <div style="margin-top: 12px; font-size: 0.75rem; color: #999; line-height: 1.4;">
                                    ⏱️ Cela peut prendre 10-30 secondes<br>
                                    <span style="color: #3498DB;">Merci de votre patience...</span>
                                </div>
                            </div>
                            <style>
                                @keyframes spin {
                                    from { transform: rotate(0deg); }
                                    to { transform: rotate(360deg); }
                                }
                                .loading-popup .leaflet-popup-content-wrapper {
                                    border-radius: 12px;
                                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                                }
                            </style>
                        `)
                        .openOn(window.map);
                    
                    // Compte à rebours visible
                    let seconds = 0;
                    const timerInterval = setInterval(() => {
                        seconds++;
                        const timerElement = document.getElementById('timerSeconds');
                        if (timerElement) {
                            timerElement.textContent = seconds;
                            // Changer la couleur selon le temps écoulé
                            const timerDiv = document.getElementById('loadingTimer');
                            if (timerDiv) {
                                if (seconds > 30) {
                                    timerDiv.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
                                } else if (seconds > 15) {
                                    timerDiv.style.background = 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)';
                                }
                            }
                        } else {
                            clearInterval(timerInterval);
                        }
                    }, 1000);
                    
                    // Stocker pour pouvoir arrêter le timer plus tard
                    window.constructionTimerInterval = timerInterval;
                    window.constructionLoadingPopup = loadingPopup;
                    
                    window.loadConstructionRoads();
                } else {
                    console.log('   → Affichage des polylines existantes');
                    constructionPolylines.forEach(polyline => {
                        if (!window.map.hasLayer(polyline)) {
                            polyline.addTo(window.map);
                            console.log('   → Polyline ajoutée');
                        }
                    });
                }
                
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                    item.style.pointerEvents = 'auto';
                });
                
                console.log('✓ Routes en construction affichées');
            } else {
                console.log('   → Masquage des routes en construction');
                
                constructionPolylines.forEach(polyline => {
                    if (window.map.hasLayer(polyline)) {
                        window.map.removeLayer(polyline);
                        console.log('   → Polyline retirée');
                    }
                });
                
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                    item.style.pointerEvents = 'none';
                });
                
                console.log('✗ Routes en construction masquées');
            }
        };

        // ========== CONVOIS EXCEPTIONNELS ==========
        
        window.toggleConvoisExceptionnels = function() {
            convoiMode = !convoiMode;
            const btn = document.getElementById('convoiBtn');
            
            if (convoiMode) {
                console.log('🚛 Mode Convois Exceptionnels activé');
                
                // Changer le style du bouton
                btn.style.background = 'linear-gradient(135deg, #9B59B6 0%, #8E44AD 100%)';
                btn.style.color = 'white';
                btn.style.borderColor = '#9B59B6';
                btn.style.fontWeight = '700';
                
                // Filtrer et mettre en évidence les routes adaptées
                filterRoutesForConvois();
                
                // Message d'information
                L.popup()
                    .setLatLng(window.map.getCenter())
                    .setContent(`
                        <div style="padding: 15px; text-align: center;">
                            <strong style="font-size: 1.2rem;">🚛 Mode Convois Exceptionnels</strong>
                            <div style="margin: 15px 0; padding: 12px; background: #f0f0f0; border-radius: 8px; text-align: left;">
                                <div style="font-size: 0.9rem; line-height: 1.6;">
                                    <strong>Routes prioritaires affichées :</strong>
                                    <ul style="margin: 10px 0; padding-left: 20px;">
                                        <li>🔴 <strong>Réseau régional</strong> (axes principaux)</li>
                                        <li>🟠 <strong>Réseau territorial</strong> (connexions)</li>
                                    </ul>
                                    <div style="margin-top: 10px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 0.85rem;">
                                        ⚠️ <strong>Important :</strong> Routes de largeur ≥ 6m privilégiées<br>
                                        Les routes locales étroites sont masquées
                                    </div>
                                </div>
                            </div>
                            <div style="font-size: 0.8rem; color: #666; margin-top: 10px;">
                                💡 Consultez la DDE pour les autorisations spécifiques et restrictions ponctuelles
                            </div>
                        </div>
                    `)
                    .openOn(window.map);
                
                setTimeout(() => window.map.closePopup(), 8000);
                
            } else {
                console.log('✗ Mode Convois Exceptionnels désactivé');
                
                // Restaurer le style du bouton
                btn.style.background = 'white';
                btn.style.color = '#9B59B6';
                btn.style.borderColor = '#9B59B6';
                btn.style.fontWeight = '600';
                
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
        }

        // ========== STATIONS DE COMPTAGE ==========

        window.toggleTraffic = function() {
            trafficVisible = !trafficVisible;

            const icon = document.getElementById('trafficToggleIcon');
            const title = document.querySelector('.legend-section:has([id="trafficToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-traffic]');

            if (trafficVisible) {
                trafficMarkers.forEach(marker => {
                    if (!window.map.hasLayer(marker)) marker.addTo(window.map);
                });
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                });
                console.log(`✓ ${trafficMarkers.length} stations de comptage affichées`);
            } else {
                trafficMarkers.forEach(marker => {
                    if (window.map.hasLayer(marker)) window.map.removeLayer(marker);
                });
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                });
                console.log('✗ Stations de comptage masquées');
            }
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
        };

        async function toggleWazeTraffic() {
            wazeEnabled = !wazeEnabled;
            
            const btn = document.getElementById('wazeBtn');
            
            if (wazeEnabled) {
                // Mettre en évidence les stations de comptage CD84 (données de trafic réelles)
                console.log('🚗 Mise en évidence des stations de comptage CD84');
                
                // Changer le style du bouton
                btn.style.background = 'linear-gradient(135deg, #FF6B35 0%, #F7931E 100%)';
                btn.style.color = 'white';
                btn.style.borderColor = '#FF6B35';
                btn.style.fontWeight = '700'; // Gras quand actif
                
                // Compter les stations
                let stationCount = 0;
                
                // Faire pulser tous les marqueurs de comptage
                window.map.eachLayer(function(layer) {
                    if (layer instanceof L.CircleMarker && layer.options.stationType === 'counting') {
                        // Animation de pulsation
                        const originalRadius = layer.getRadius();
                        let pulse = 0;
                        const pulseInterval = setInterval(() => {
                            pulse++;
                            const scale = 1 + Math.sin(pulse * 0.3) * 0.3;
                            layer.setRadius(originalRadius * scale);
                            
                            if (pulse > 20) {
                                clearInterval(pulseInterval);
                                layer.setRadius(originalRadius);
                            }
                        }, 100);
                        
                        // Augmenter temporairement l'opacité
                        layer.setStyle({ fillOpacity: 1, opacity: 1 });
                        
                        stationCount++;
                    }
                });
                
                // Afficher un message informatif
                L.popup()
                    .setLatLng(window.map.getCenter())
                    .setContent(`
                        <div style="padding: 15px; text-align: center;">
                            <strong style="font-size: 1.2rem;">📊 Données de Trafic CD84</strong>
                            <div style="margin: 15px 0; padding: 12px; background: #f0f0f0; border-radius: 8px;">
                                <div style="font-size: 2rem; font-weight: 700; color: #3498DB;">${stationCount}</div>
                                <div style="font-size: 0.85rem; color: #666;">stations de comptage permanent</div>
                            </div>
                            <div style="font-size: 0.85rem; line-height: 1.6; text-align: left;">
                                <strong>Les cercles animés</strong> représentent les stations de comptage du Département du Vaucluse avec :
                                <ul style="margin: 10px 0; padding-left: 20px;">
                                    <li>🔴 Trafic élevé (≥20k véh/j)</li>
                                    <li>🟠 Trafic moyen (5-20k véh/j)</li>
                                    <li>🔵 Trafic faible (<5k véh/j)</li>
                                </ul>
                                <strong>Cliquez sur une station</strong> pour voir les détails (MJA, taux PL, débit).
                            </div>
                        </div>
                    `)
                    .openOn(window.map);
                
                // Zoomer pour voir toutes les stations
                const stationBounds = [];
                window.map.eachLayer(function(layer) {
                    if (layer instanceof L.CircleMarker && layer.options.stationType === 'counting') {
                        stationBounds.push(layer.getLatLng());
                    }
                });
                
                if (stationBounds.length > 0) {
                    setTimeout(() => {
                        window.map.fitBounds(stationBounds, { padding: [50, 50], maxZoom: 11 });
                    }, 500);
                }
                
                console.log(`✓ ${stationCount} stations de comptage mises en évidence`);
                
            } else {
                // Restaurer l'apparence normale des stations
                window.map.eachLayer(function(layer) {
                    if (layer instanceof L.CircleMarker && layer.options.stationType === 'counting') {
                        layer.setStyle({ fillOpacity: 0.8, opacity: 1 });
                    }
                });
                
                // Restaurer le style du bouton
                btn.style.background = 'white';
                btn.style.color = '#00D4FF';
                btn.style.borderColor = '#00D4FF';
                btn.style.fontWeight = '600'; // Poids normal
                
                // Fermer le popup
                window.map.closePopup();
                
                console.log('✗ Mode Trafic désactivé');
            }
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
                setSourceText('boundaryDataFreshness', 'OpenStreetMap (limite 84, GeoJSON local)');
                
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
                const osmDate = osmGeneratedAt ? formatParisDateTime(osmGeneratedAt) : 'GeoJSON local';
                setSourceText('osmDataFreshness', `OpenStreetMap (cache ${osmDate})`);
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
                                    roadHierarchy: hierarchy
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

                                const popupContent = `
                                    <div class="route-popup">
                                        <h3>${roadName}</h3>
                                        <div class="detail"><strong>Référence:</strong> ${ref}</div>
                                        <div class="detail"><strong>Type:</strong> ${hierarchyLabel}</div>
                                        
                                        ${way.tags.description || way.relationTags?.description ? `
                                            <div class="detail" style="margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px; font-style: italic; font-size: 0.9rem;">
                                                ℹ️ ${way.relationTags?.description || way.tags.description}
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.surface ? `<div class="detail"><strong>Surface:</strong> ${way.tags.surface}</div>` : ''}
                                        ${way.tags.maxspeed ? `<div class="detail"><strong>Vitesse max:</strong> ${way.tags.maxspeed} km/h</div>` : ''}
                                        ${way.tags.lanes ? `<div class="detail"><strong>Voies:</strong> ${way.tags.lanes}</div>` : ''}
                                        ${way.tags.oneway === 'yes' ? `<div class="detail"><strong>Sens unique:</strong> ➡️ Oui</div>` : ''}
                                        
                                        ${way.relationTags && way.relationTags.wikidata ? `
                                            <div class="detail" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd;">
                                                <strong>📚 Wikidata:</strong> 
                                                <a href="https://www.wikidata.org/wiki/${way.relationTags.wikidata}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    ${way.relationTags.wikidata} →
                                                </a>
                                                <span style="color: #27AE60; font-size: 0.8rem; display: block; margin-top: 3px;">
                                                    ✓ Données structurées disponibles
                                                </span>
                                            </div>
                                        ` : way.tags.wikidata ? `
                                            <div class="detail" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd;">
                                                <strong>📚 Wikidata:</strong> 
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
                                                <strong>📖 Wikipedia:</strong> 
                                                <a href="https://fr.wikipedia.org/wiki/${encodeURIComponent((way.relationTags?.wikipedia || way.tags.wikipedia).replace('fr:', ''))}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    Lire l'article →
                                                </a>
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.website || way.relationTags?.website ? `
                                            <div class="detail">
                                                <strong>🌐 Site web:</strong> 
                                                <a href="${way.relationTags?.website || way.tags.website}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    Visiter →
                                                </a>
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.destination || way.relationTags?.destination ? `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>🎯 Destination:</strong> ${way.relationTags?.destination || way.tags.destination}
                                            </div>
                                        ` : ''}
                                        
                                        ${way.hasRelation ? `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>Relation OSM:</strong> <span style="color: #27AE60; font-weight: 600;">✓ Complète</span>
                                            </div>
                                        ` : `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>Relation OSM:</strong> <span style="color: #E74C3C;">✗ Manquante</span>
                                                <span style="font-size: 0.8rem; color: #999; display: block; margin-top: 3px;">
                                                    💡 Contribuez en créant une relation pour cette route
                                                </span>
                                            </div>
                                        `}
                                        
                                        <div class="detail" style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #e0e0e0;">
                                            ${way.id ? `
                                                <a href="https://www.openstreetmap.org/way/${way.id}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none; display: inline-block; margin-right: 15px; margin-bottom: 8px;">
                                                    🗺️ Tronçon OSM →
                                                </a>
                                            ` : ''}
                                            ${way.hasRelation ? `
                                                <a href="https://www.openstreetmap.org/relation/${way.relationId}" target="_blank" style="color: #27AE60; font-weight: 600; text-decoration: none; display: inline-block; margin-bottom: 8px;">
                                                    📋 Relation →
                                                </a>
                                            ` : ''}
                                        </div>
                                    </div>
                                `;

                                polyline.bindPopup(popupContent);

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

            // Afficher les étiquettes selon le niveau de zoom
            ['regional', 'territorial', 'local'].forEach(hierarchy => {
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
        }

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

                <div class="quality-metric" style="background: linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 100%); border-left: 4px solid #00ACC1;">
                    <div class="quality-metric-title" style="color: #00838F;">💡 Comment contribuer</div>
                    <div class="quality-metric-desc" style="line-height: 1.6; color: #00695C;">
                        <strong>Cliquez sur les barres</strong> pour visualiser les routes à améliorer. 
                        Puis cliquez sur une route pour accéder directement à OSM et ajouter le Wikidata ou créer la relation manquante.
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
            
            console.log(`✓ ${matchingRoutes.length} routes mises en évidence`);
            console.log('Routes:', matchingRoutes.join(', '));
            
            // Afficher un message temporaire
            L.popup()
                .setLatLng(map.getCenter())
                .setContent(`<div style="padding: 10px; text-align: center;"><strong>${matchingRoutes.length} routes ${hasWikidata ? 'avec' : 'sans'} Wikidata</strong><br><small>${hasWikidata ? 'En vert' : 'En rouge'}</small></div>`)
                .openOn(window.map);
            
            setTimeout(() => window.map.closePopup(), 2000);
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
            
            console.log(`✓ ${matchingRoutes.length} routes mises en évidence`);
            
            L.popup()
                .setLatLng(map.getCenter())
                .setContent(`<div style="padding: 10px; text-align: center;"><strong>${matchingRoutes.length} routes ${hasRelation ? 'avec' : 'sans'} Relation</strong><br><small>${hasRelation ? 'En vert' : 'En rouge'}</small></div>`)
                .openOn(window.map);
            
            setTimeout(() => window.map.closePopup(), 2000);
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
                    setSourceText('trafficDataFreshness', 'Démonstration locale (5 stations 2024)');
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
                
                // Déterminer la catégorie de trafic
                let color, size, category;
                if (mja >= 20000) {
                    color = '#E74C3C';
                    size = 12;
                    category = 'high';
                    trafficCounts.high++;
                } else if (mja >= 5000) {
                    color = '#F39C12';
                    size = 10;
                    category = 'medium';
                    trafficCounts.medium++;
                } else {
                    color = '#3498DB';
                    size = 8;
                    category = 'low';
                    trafficCounts.low++;
                }

                // Créer le marqueur
                const marker = L.circleMarker([lat, lon], {
                    radius: size,
                    fillColor: color,
                    color: 'white',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8,
                    stationType: 'counting'  // Pour identification lors du toggle trafic
                }).addTo(window.map);

                // Stocker pour le toggle de visibilité
                trafficMarkers.push(marker);

                // Popup avec les informations de comptage
                const popupContent = `
                    <div class="route-popup">
                        <h3>📊 Station de comptage</h3>
                        <div class="detail"><strong>Route:</strong> ${routeName || 'N/A'}</div>
                        <div class="detail"><strong>Section:</strong> ${sectionName || 'N/A'}</div>
                        <div class="detail"><strong>Année:</strong> ${yearValue || 'N/A'}</div>
                        <div class="detail" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd;">
                            <strong>MJA (tous véhicules):</strong> ${formatNumber(mja, ' véh/jour')}
                        </div>
                        <div class="detail"><strong>Taux PL:</strong> ${Number.isFinite(tauxPL) ? tauxPL.toFixed(1) + '%' : 'N/A'}</div>
                        <div class="detail"><strong>Débit PL:</strong> ${formatNumber(debitPL, ' PL/jour')}</div>
                        ${props.classe ? `<div class="detail"><strong>Classification:</strong> ${props.classe}</div>` : ''}
                        <div class="detail" style="margin-top: 8px; font-size: 0.75rem; color: #999;">
                            <strong>Source:</strong> ${sourceUsed || 'Inconnue'}
                        </div>
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
                        fillOpacity: 0.8
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
            const cacheDate = geojsonData._cache?.generated_at
                ? `, cache ${formatParisDateTime(geojsonData._cache.generated_at)}`
                : '';
            setSourceText('trafficDataFreshness', `data.gouv.fr / CD84 (${sourceYears}${cacheDate})`);
            
            console.log(`✓ Total stations affichées: ${totalStations}`);
            console.log(`✓ Année la plus récente: ${latestYear}`);
            console.log('🚦 === FIN CHARGEMENT STATIONS DE COMPTAGE ===');
            
            document.querySelector('.info-box').innerHTML = `
                <h3>Statistiques du réseau</h3>
                <div class="stat">
                    <span>Longueur totale</span>
                    <span class="stat-value">2 342 km</span>
                </div>
                <div class="stat">
                    <span>Stations de comptage</span>
                    <span class="stat-value">${totalStations}</span>
                </div>
                <div class="stat">
                    <span>Année des données</span>
                    <span class="stat-value">${latestYear}</span>
                </div>
                <div class="stat">
                    <span>Source</span>
                    <span class="stat-value">${sourceUsed}</span>
                </div>
            `;

            console.log('Stations de comptage:', trafficCounts);
        }

        // Charger les données d'accidentologie depuis le GeoJSON statique local
        async function loadAccidentData() {
            try {
                console.log('📊 Chargement des données d\'accidentologie...');

                const dataToUse = await window.InforouteApi.fetchGeoJson('accidents');
                const stats = dataToUse.metadata?.statistiques || {};
                const features = dataToUse.features;
                const accidentYears = formatYearRange(collectYears(features, ['date']));
                setSourceText('accidentDataFreshness', `ONISR / BAAC ${accidentYears} (${features.length} accidents)`);
                
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
                            <div class="detail"><strong>Victimes:</strong> ${victimesInfo.join(', ')}</div>
                            <div class="detail"><strong>Date:</strong> ${props.date}</div>
                            <div class="detail"><strong>Commune:</strong> ${props.commune}</div>
                            ${props.adresse ? `<div class="detail"><strong>Adresse:</strong> ${props.adresse}</div>` : ''}
                            <div class="detail"><strong>Milieu:</strong> ${props.milieu}</div>
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
        
        // ========== CHARGEMENT ROUTES EN CONSTRUCTION ==========
        
        window.loadConstructionRoads = async function() {
            try {
                console.log('🚧 === CHARGEMENT ROUTES EN CONSTRUCTION ===');
                
                console.log('📡 Chargement GeoJSON routes en construction...');
                console.log('   Recherche : construction, proposed, et variantes');
                console.log('   Zone : Vaucluse (84) + bbox élargi');
                
                const data = await window.InforouteApi.fetchGeoJson('construction-roads');
                const constructionWays = (data.features || [])
                    .map(geoJsonLineFeatureToWay)
                    .filter(Boolean);
                
                console.log('📦 GeoJSON routes en construction reçu:');
                console.log('   Features:', constructionWays.length);
                
                if (constructionWays.length > 0) {
                    console.log('   Exemples de tags:');
                    constructionWays.slice(0, 3).forEach((el, i) => {
                        console.log(`   Element ${i+1}:`, el.tags);
                    });
                }
                
                if (constructionWays.length === 0) {
                    console.log('ℹ️ Aucune route en construction trouvée');
                    console.log('💡 Vérifiez sur https://www.openstreetmap.org autour d\'Orange');
                    console.log('💡 Recherchez les tags: highway=construction ou proposed');
                    
                    document.getElementById('count-construction').textContent = '0';
                    document.getElementById('count-proposed').textContent = '0';
                    
                    L.popup()
                        .setLatLng([44.136, 4.809]) // Orange
                        .setContent(`
                            <div style="padding: 15px; text-align: center;">
                                <strong>ℹ️ Routes en construction</strong><br>
                                <small>Aucune route trouvée avec les tags OSM :<br>
                                • highway=construction<br>
                                • highway=proposed<br><br>
                                <strong>💡 Suggestions :</strong><br>
                                1. Vérifiez sur <a href="https://www.openstreetmap.org/#map=13/44.136/4.809" target="_blank">OSM à Orange</a><br>
                                2. Les routes en travaux sont peut-être taguées différemment<br>
                                3. Contribuez en ajoutant les travaux manquants !
                                </small>
                            </div>
                        `)
                        .openOn(window.map);
                    
                    setTimeout(() => window.map.closePopup(), 8000);
                    return;
                }
                
                console.log(`✓ ${constructionWays.length} éléments chargés`);
                
                let constructionCount = 0;
                let proposedCount = 0;
                let skippedCount = 0;
                
                console.log('🔨 Début de traitement des éléments...');
                
                constructionWays.forEach((way, index) => {
                    if (!way.geometry || way.geometry.length === 0) {
                        skippedCount++;
                        if (index < 3) console.log(`   ⚠️ Element ${index+1} sans géométrie, ignoré`);
                        return;
                    }
                    
                    const coords = way.geometry.map(point => [point.lat, point.lon]);
                    const tags = way.tags || {};
                    
                    if (index < 3) {
                        console.log(`   📍 Element ${index+1}:`, {
                            id: way.id,
                            highway: tags.highway,
                            construction: tags.construction,
                            proposed: tags.proposed,
                            name: tags.name || tags.ref,
                            coords: coords.length + ' points'
                        });
                    }
                    
                    // Déterminer le type et le style
                    let color, weight, dashArray, statusLabel;
                    
                    if (tags.highway === 'construction' || tags.construction) {
                        color = '#FF6B35';
                        weight = 6;
                        dashArray = '15, 10';
                        statusLabel = '🚧 En construction';
                        constructionCount++;
                    } else if (tags.highway === 'proposed') {
                        color = '#9B59B6';
                        weight = 5;
                        dashArray = '10, 15';
                        statusLabel = '📋 En projet';
                        proposedCount++;
                    } else {
                        return;
                    }
                    
                    // Créer la polyline
                    const polyline = L.polyline(coords, {
                        color: color,
                        weight: weight,
                        opacity: 0.9,
                        dashArray: dashArray
                    }).addTo(window.map);
                    
                    constructionPolylines.push(polyline);
                    
                    if (index < 3) {
                        console.log(`   ✅ Polyline ${index+1} créée et ajoutée:`, {
                            color: color,
                            weight: weight,
                            status: statusLabel,
                            coords: coords.length + ' points'
                        });
                    }
                    
                    // Préparer les informations pour le popup
                    const futureType = tags.construction || tags.proposed || tags.highway || 'Route';
                    const name = tags.name || tags.ref || 'Sans nom';
                    const startDate = tags.start_date || tags['construction:start_date'] || 'Non renseignée';
                    const endDate = tags.end_date || tags['construction:end_date'] || tags.opening_date || 'Non renseignée';
                    const expectedOpening = tags.opening_date || tags['opening_date:expected'] || 'Non renseignée';
                    
                    // Popup enrichi
                    const popupContent = `
                        <div class="route-popup">
                            <h3>${statusLabel}</h3>
                            <div class="detail"><strong>Nom/Réf:</strong> ${name}</div>
                            <div class="detail"><strong>Type futur:</strong> ${futureType.replace('_', ' ')}</div>
                            
                            ${tags.description || tags['construction:description'] ? `
                                <div class="detail" style="margin-top: 10px; padding: 10px; background: #fff3cd; border-left: 4px solid #FF6B35; border-radius: 4px; font-style: italic;">
                                    ℹ️ ${tags.description || tags['construction:description']}
                                </div>
                            ` : ''}
                            
                            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #ddd;">
                                ${startDate !== 'Non renseignée' ? `<div class="detail"><strong>🗓️ Début:</strong> ${startDate}</div>` : ''}
                                ${endDate !== 'Non renseignée' ? `<div class="detail"><strong>🏁 Fin prévue:</strong> ${endDate}</div>` : ''}
                                ${expectedOpening !== 'Non renseignée' ? `<div class="detail"><strong>🎉 Ouverture:</strong> ${expectedOpening}</div>` : ''}
                            </div>
                            
                            ${tags.operator || tags['construction:operator'] ? `
                                <div class="detail" style="margin-top: 8px;">
                                    <strong>🏗️ Maître d'ouvrage:</strong> ${tags.operator || tags['construction:operator']}
                                </div>
                            ` : ''}
                            
                            ${tags.note || tags['construction:note'] ? `
                                <div class="detail" style="margin-top: 8px; font-size: 0.85rem; color: #666;">
                                    📝 ${tags.note || tags['construction:note']}
                                </div>
                            ` : ''}
                            
                            ${tags.website ? `
                                <div class="detail" style="margin-top: 10px;">
                                    <strong>🌐 Site web:</strong> 
                                    <a href="${tags.website}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                        Visiter le site du projet →
                                    </a>
                                </div>
                            ` : ''}
                            
                            ${tags.wikidata ? `
                                <div class="detail" style="margin-top: 8px;">
                                    <strong>📚 Wikidata:</strong> 
                                    <a href="https://www.wikidata.org/wiki/${tags.wikidata}" target="_blank" style="color: #3498DB; font-weight: 600;">
                                        ${tags.wikidata} →
                                    </a>
                                </div>
                            ` : ''}
                            
                            <div class="detail" style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #e0e0e0;">
                                <a href="https://www.openstreetmap.org/way/${way.id}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                    🗺️ Voir sur OpenStreetMap →
                                </a>
                            </div>
                        </div>
                    `;
                    
                    polyline.bindPopup(popupContent);
                    
                    // Effet hover
                    polyline.on('mouseover', function() {
                        this.setStyle({ weight: weight + 2, opacity: 1 });
                    });
                    
                    polyline.on('mouseout', function() {
                        this.setStyle({ weight: weight, opacity: 0.9 });
                    });
                });
                
                // Mettre à jour les compteurs
                document.getElementById('count-construction').textContent = constructionCount;
                document.getElementById('count-proposed').textContent = proposedCount;
                
                const totalConstruction = constructionCount + proposedCount;
                
                console.log('📊 RÉSUMÉ:');
                console.log(`   En construction: ${constructionCount}`);
                console.log(`   En projet: ${proposedCount}`);
                console.log(`   Ignorés (sans géométrie): ${skippedCount}`);
                console.log(`   Total polylines créées: ${constructionPolylines.length}`);
                console.log(`   Visibles sur carte: ${constructionVisible ? 'OUI' : 'NON (masquées par défaut)'}`);
                
                // Arrêter le timer de chargement
                if (window.constructionTimerInterval) {
                    clearInterval(window.constructionTimerInterval);
                    window.constructionTimerInterval = null;
                }
                
                // Fermer le popup de chargement
                window.map.closePopup();
                
                if (totalConstruction > 0) {
                    console.log(`✓ ${constructionCount} en construction, ${proposedCount} projets`);
                    
                    // Message de confirmation (après une petite pause)
                    setTimeout(() => {
                        L.popup()
                            .setLatLng([44.0, 5.1])
                            .setContent(`
                                <div style="padding: 15px; text-align: center;">
                                    <div style="font-size: 2rem; margin-bottom: 10px;">✅</div>
                                    <strong>🚧 ${totalConstruction} voie(s) chargée(s) !</strong><br>
                                    <div style="margin-top: 10px; font-size: 0.9rem;">
                                        <span style="color: #FF6B35; font-weight: 600;">${constructionCount} en construction</span> | 
                                        <span style="color: #9B59B6; font-weight: 600;">${proposedCount} projet(s)</span>
                                    </div>
                                    <div style="margin-top: 12px; padding: 10px; background: #d4edda; border-radius: 6px; font-size: 0.85rem;">
                                        <strong>👁️ Elles sont maintenant visibles sur la carte</strong><br>
                                        <small>Cliquez sur les lignes pour voir les détails</small>
                                    </div>
                                </div>
                            `)
                            .openOn(window.map);
                        
                        setTimeout(() => window.map.closePopup(), 5000);
                    }, 300);
                } else {
                    console.log('ℹ️ Aucune route en construction dans le Vaucluse actuellement');
                }
                
                console.log('🚧 === FIN CHARGEMENT ROUTES EN CONSTRUCTION ===');
                
            } catch (error) {
                console.error('❌ Erreur chargement routes en construction:', error);
                
                // Arrêter le timer de chargement
                if (window.constructionTimerInterval) {
                    clearInterval(window.constructionTimerInterval);
                    window.constructionTimerInterval = null;
                }
                
                // Fermer le popup de chargement et afficher l'erreur
                window.map.closePopup();
                
                setTimeout(() => {
                    L.popup()
                        .setLatLng([44.0, 5.1])
                        .setContent(`
                            <div style="padding: 15px; text-align: center;">
                                <div style="font-size: 2rem; color: #E74C3C;">⚠️</div>
                                <strong>Erreur de chargement</strong><br>
                                <small style="color: #666; display: block; margin-top: 8px;">
                                    Impossible de charger les routes en construction.<br>
                                    ${error.message}
                                </small>
                            </div>
                        `)
                        .openOn(window.map);
                    
                    setTimeout(() => window.map.closePopup(), 4000);
                }, 300);
                
                document.getElementById('count-construction').textContent = '0';
                document.getElementById('count-proposed').textContent = '0';
            }
        }

        // ========== BISON FUTÉ / INFO ROUTIÈRE ==========
        
        async function loadBisonFuteData() {
            try {
                console.log('🚗 Chargement des données Bison Futé / Info Routière...');
                
                const data = await window.InforouteApi.fetchGeoJson('road-events');
                updateExternalRefreshStatus('Info Routière', data._cache);

                const roadEventsDate = data._cache?.generated_at
                    ? `cache ${formatParisDateTime(data._cache.generated_at)}`
                    : 'GeoJSON local';
                const roadEventsError = data._cache?.error ? ', source indisponible' : '';
                setSourceText('roadEventsFreshness', `Info Routière (${data.features?.length || 0} événement(s), ${roadEventsDate}${roadEventsError})`);
                
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
                    
                    // Créer le marqueur
                    const marker = L.marker([lat, lon], {
                        icon: L.divIcon({
                            html: `<div style="font-size: 1.5rem; text-shadow: 0 0 3px white;">${icon}</div>`,
                            className: 'bison-fute-marker',
                            iconSize: [30, 30],
                            iconAnchor: [15, 15]
                        })
                    }).addTo(window.map);

                    // Stocker pour le toggle de visibilité
                    bisonFuteMarkers.push(marker);
                    
                    // Popup avec les informations
                    const startDate = props.start_time ? new Date(props.start_time).toLocaleString('fr-FR') : 'N/A';
                    const endDate = props.end_time ? new Date(props.end_time).toLocaleString('fr-FR') : 'N/A';
                    
                    const popupContent = `
                        <div class="route-popup">
                            <h3>${icon} Bison Futé</h3>
                            <div class="detail"><strong>Type:</strong> ${eventType}</div>
                            ${props.description ? `<div class="detail"><strong>Description:</strong> ${props.description}</div>` : ''}
                            ${props.road_name ? `<div class="detail"><strong>Route:</strong> ${props.road_name}</div>` : ''}
                            <div class="detail"><strong>Début:</strong> ${startDate}</div>
                            ${props.end_time ? `<div class="detail"><strong>Fin prévue:</strong> ${endDate}</div>` : ''}
                            <div class="detail" style="margin-top: 8px; font-size: 0.75rem; color: #999;">
                                <strong>Source:</strong> Bison Futé / Info Routière
                            </div>
                        </div>
                    `;
                    
                    marker.bindPopup(popupContent);
                });
                
                const totalEvents = eventsCount.travaux + eventsCount.bouchons + eventsCount.accidents + eventsCount.autres;
                
                if (totalEvents > 0) {
                    console.log(`✓ Événements Bison Futé affichés:`, eventsCount);
                    
                    // Message d'information
                    L.popup()
                        .setLatLng([44.0, 5.1])
                        .setContent(`
                            <div style="padding: 12px; text-align: center;">
                                <strong>🚗 Bison Futé chargé</strong><br>
                                <small>${totalEvents} événement(s) dans la zone:<br>
                                🚧 ${eventsCount.travaux} travaux | 
                                🚗 ${eventsCount.bouchons} bouchons | 
                                ⚠️ ${eventsCount.accidents} accidents</small>
                            </div>
                        `)
                        .openOn(window.map);
                    
                    setTimeout(() => window.map.closePopup(), 4000);
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
        
        }); // Fin DOMContentLoaded
    
