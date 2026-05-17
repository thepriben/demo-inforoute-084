        // Fonctions globales accessibles depuis le HTML
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
        let accidentMarkers = [];
        let accidentsVisible = false;
        let convoiMode = false;
        let constructionPolylines = [];
        let constructionVisible = false;
        
        // État de visibilité par hiérarchie
        let hierarchyVisibility = {
            regional: true,
            territorial: true,
            local: true
        };

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
                                    Interrogation OpenStreetMap
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
                
                if (icon) {
                    icon.textContent = '👁️';
                    icon.style.transform = 'scale(1.2)';
                }
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
                
                if (icon) {
                    icon.textContent = '👁️‍🗨️';
                    icon.style.transform = 'scale(1)';
                }
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
                icon.textContent = '👁️';
                icon.style.transform = 'scale(1.2)';
                if (title) title.style.fontWeight = '700';
                console.log('✓ Toutes les routes affichées');
            } else {
                icon.textContent = '👁️‍🗨️';
                icon.style.transform = 'scale(1)';
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
                icon.textContent = '👁️';
                icon.style.transform = 'scale(1.2)';
                if (title) title.style.fontWeight = '700';
            } else if (allHidden) {
                icon.textContent = '👁️‍🗨️';
                icon.style.transform = 'scale(1)';
                if (title) title.style.fontWeight = '600';
            } else {
                icon.textContent = '👁️';
                icon.style.transform = 'scale(1)';
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
                icon.textContent = '👁️';
                icon.style.transform = 'scale(1.2)';
                
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
                icon.textContent = '👁️‍🗨️';
                icon.style.transform = 'scale(1)';
                
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

        // Données GeoJSON de la limite départementale du Vaucluse (embarquées)
        // Source: Limites administratives Vaucluse (84) 2023
        const vaucluseGeoJSON = {"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"MultiPolygon","coordinates":[[[[5.383099,44.155371],[5.383599,44.156656],[5.383735,44.156997],[5.383743,44.157518],[5.38346,44.15827],[5.383161,44.158705],[5.382499,44.160303],[5.382543,44.161629],[5.383089,44.163212],[5.383522,44.16412],[5.383795,44.164372],[5.384321,44.165811],[5.384322,44.166599],[5.383718,44.172301],[5.383669,44.173188],[5.386589,44.177468],[5.386611,44.181817],[5.386563,44.183387],[5.386558,44.183541],[5.386254,44.185656],[5.385897,44.186616],[5.385278,44.187441],[5.381513,44.191634],[5.381258,44.192209],[5.381219,44.193206],[5.381041,44.193993],[5.381309,44.194512],[5.381334,44.195298],[5.381066,44.195929],[5.383088,44.199267],[5.384607,44.20129],[5.383306,44.201719],[5.381875,44.202522],[5.38009,44.203136],[5.378712,44.204302],[5.378341,44.204617],[5.376712,44.205245],[5.374344,44.205721],[5.369911,44.207836],[5.366803,44.209205],[5.363215,44.210635],[5.362205,44.210885],[5.358763,44.212051],[5.357228,44.213315],[5.35697,44.213435],[5.3562,44.214112],[5.354903,44.214579],[5.354168,44.2139],[5.350891,44.211571],[5.349744,44.211082],[5.348885,44.21084],[5.347944,44.210597],[5.347556,44.210443],[5.346511,44.210222],[5.346148,44.20942],[5.344498,44.208908],[5.343903,44.208527],[5.343462,44.207673],[5.342581,44.20719],[5.342335,44.206911],[5.341765,44.206633],[5.339939,44.205871],[5.337374,44.204674],[5.336571,44.204284],[5.336766,44.203903],[5.336795,44.203518],[5.336558,44.203559],[5.334058,44.203569],[5.333087,44.203662],[5.331895,44.203949],[5.331675,44.20407],[5.330108,44.204664],[5.328217,44.205658],[5.327414,44.206234],[5.325358,44.207296],[5.323139,44.208165],[5.322673,44.208378],[5.319331,44.209623],[5.318333,44.209841],[5.318049,44.209678],[5.315773,44.208609],[5.313855,44.208307],[5.313256,44.208467],[5.312229,44.208421],[5.310546,44.209055],[5.310109,44.209096],[5.30983,44.209227],[5.308947,44.209421],[5.307385,44.209246],[5.307106,44.209004],[5.305098,44.209669],[5.304206,44.209708],[5.303622,44.209901],[5.303334,44.20992],[5.302835,44.209776],[5.302647,44.209685],[5.302303,44.209052],[5.302443,44.208834],[5.30247,44.208634],[5.302409,44.208508],[5.302588,44.208292],[5.302776,44.207789],[5.303373,44.207209],[5.303775,44.206512],[5.303759,44.206214],[5.303749,44.206029],[5.30312,44.205507],[5.301508,44.205983],[5.301029,44.206299],[5.299293,44.206967],[5.298943,44.207199],[5.298095,44.207535],[5.297609,44.207951],[5.297052,44.208852],[5.29678,44.209892],[5.296055,44.210969],[5.294656,44.212542],[5.292286,44.214441],[5.290709,44.215065],[5.289613,44.215697],[5.289075,44.215818],[5.288117,44.216251],[5.287764,44.216211],[5.287014,44.216521],[5.28638,44.216758],[5.285897,44.216812],[5.285375,44.217117],[5.284431,44.21797],[5.28305,44.218804],[5.280656,44.219784],[5.280357,44.219951],[5.278664,44.220103],[5.278089,44.220034],[5.277631,44.220217],[5.275379,44.221403],[5.275331,44.221576],[5.274682,44.222076],[5.274028,44.222468],[5.273668,44.222568],[5.272585,44.223125],[5.272064,44.223548],[5.270828,44.223912],[5.27067,44.224052],[5.270155,44.22414],[5.27002,44.224229],[5.269886,44.224486],[5.269736,44.224548],[5.269151,44.224552],[5.268623,44.22489],[5.268327,44.225359],[5.267535,44.225524],[5.267376,44.225546],[5.266485,44.225671],[5.265622,44.226185],[5.265286,44.226276],[5.2636,44.227224],[5.262897,44.227492],[5.260529,44.228219],[5.260204,44.228219],[5.259875,44.228478],[5.258369,44.229147],[5.25693,44.229981],[5.256084,44.230345],[5.255386,44.230387],[5.254857,44.230582],[5.254209,44.230733],[5.253315,44.231286],[5.251926,44.231271],[5.25062,44.231217],[5.249624,44.23147],[5.249474,44.231473],[5.248527,44.231276],[5.247167,44.230932],[5.246589,44.230846],[5.246237,44.230887],[5.245505,44.230767],[5.244987,44.23076],[5.244531,44.230887],[5.244446,44.230869],[5.244105,44.231025],[5.243947,44.230898],[5.243652,44.230771],[5.243389,44.230783],[5.243133,44.230858],[5.242713,44.230846],[5.242266,44.230776],[5.241899,44.230813],[5.241804,44.230887],[5.241651,44.230904],[5.241326,44.230867],[5.240459,44.230852],[5.238537,44.215147],[5.238256,44.213385],[5.237998,44.213423],[5.2378,44.213491],[5.237673,44.213539],[5.237509,44.213545],[5.237291,44.21351],[5.237119,44.213313],[5.236808,44.212913],[5.236739,44.212786],[5.236652,44.212718],[5.236561,44.212705],[5.236418,44.212742],[5.236313,44.212755],[5.236177,44.212814],[5.23606,44.21284],[5.235903,44.212825],[5.235781,44.212835],[5.235541,44.21288],[5.235165,44.212967],[5.234868,44.213052],[5.234582,44.213188],[5.234336,44.213369],[5.234066,44.213473],[5.233914,44.213563],[5.233803,44.213572],[5.233669,44.213521],[5.233333,44.213379],[5.233078,44.213236],[5.232908,44.213154],[5.232744,44.213116],[5.232588,44.213172],[5.232492,44.213235],[5.232099,44.213642],[5.232035,44.213732],[5.231926,44.213758],[5.231839,44.213739],[5.231784,44.213699],[5.231727,44.213593],[5.231692,44.213511],[5.231661,44.213332],[5.231739,44.213031],[5.23176,44.212696],[5.231585,44.212419],[5.231306,44.212156],[5.231154,44.212043],[5.230899,44.21193],[5.230613,44.211826],[5.230322,44.211767],[5.22974,44.211904],[5.229469,44.212022],[5.229183,44.212173],[5.228576,44.212314],[5.228331,44.212331],[5.228236,44.212436],[5.228118,44.212604],[5.22802,44.212762],[5.227988,44.213056],[5.228109,44.213279],[5.228112,44.21334],[5.228079,44.213547],[5.227981,44.213674],[5.227693,44.213941],[5.227387,44.214284],[5.227208,44.21446],[5.227054,44.214624],[5.226893,44.214796],[5.226689,44.214913],[5.226428,44.215015],[5.226247,44.215076],[5.226074,44.215089],[5.225832,44.215081],[5.225541,44.215073],[5.225263,44.215054],[5.224991,44.215016],[5.224673,44.214899],[5.224381,44.214799],[5.22415,44.214704],[5.223944,44.214638],[5.223687,44.214621],[5.223437,44.214613],[5.223218,44.214546],[5.223035,44.214484],[5.222908,44.214406],[5.222818,44.214291],[5.222763,44.214232],[5.22259,44.213998],[5.222528,44.213897],[5.222427,44.21378],[5.222265,44.213554],[5.222157,44.213332],[5.221962,44.213143],[5.2217,44.213056],[5.221419,44.213069],[5.22115,44.21314],[5.220707,44.213398],[5.22045,44.213584],[5.220216,44.213751],[5.219863,44.213837],[5.219564,44.213897],[5.219334,44.213943],[5.219017,44.214013],[5.218739,44.214055],[5.218463,44.214127],[5.218167,44.214195],[5.217844,44.214285],[5.217704,44.214291],[5.217419,44.214351],[5.217313,44.214417],[5.217188,44.214496],[5.217065,44.214612],[5.216945,44.214629],[5.216759,44.214717],[5.216596,44.214808],[5.216424,44.214861],[5.216178,44.214961],[5.21596,44.215025],[5.215613,44.215101],[5.21534,44.215119],[5.214731,44.215057],[5.213915,44.21501],[5.213743,44.214894],[5.213627,44.214862],[5.213475,44.214836],[5.212784,44.214719],[5.212617,44.214692],[5.212541,44.214689],[5.212465,44.214695],[5.212311,44.214683],[5.210341,44.214099],[5.210204,44.214077],[5.208649,44.213925],[5.206355,44.214145],[5.205114,44.214853],[5.204874,44.21501],[5.204523,44.215194],[5.204166,44.215416],[5.203704,44.215688],[5.20354,44.215785],[5.203404,44.215858],[5.20316,44.215966],[5.202895,44.216115],[5.20195,44.216289],[5.201914,44.216345],[5.201949,44.216535],[5.201941,44.216596],[5.201885,44.216714],[5.201793,44.216799],[5.201713,44.216857],[5.201573,44.216867],[5.201519,44.216909],[5.201466,44.216991],[5.201431,44.217],[5.201286,44.21704],[5.201207,44.217045],[5.200929,44.217094],[5.200521,44.217093],[5.200191,44.217028],[5.199847,44.216908],[5.199543,44.216771],[5.199295,44.216613],[5.199097,44.216568],[5.198872,44.216568],[5.198482,44.216664],[5.198188,44.216767],[5.197946,44.216869],[5.197427,44.217214],[5.197068,44.217382],[5.196584,44.217474],[5.196063,44.217538],[5.195448,44.217542],[5.195348,44.217589],[5.195214,44.217688],[5.195151,44.218157],[5.194869,44.218347],[5.194621,44.218333],[5.194385,44.218404],[5.194196,44.218488],[5.193971,44.218461],[5.193657,44.218559],[5.19269,44.219013],[5.192333,44.219169],[5.192147,44.219186],[5.191999,44.219074],[5.191939,44.218934],[5.191807,44.218816],[5.191709,44.218754],[5.191526,44.218731],[5.191338,44.218794],[5.191159,44.218877],[5.190789,44.219345],[5.190506,44.219534],[5.190183,44.219667],[5.189666,44.219822],[5.189081,44.220115],[5.188523,44.220163],[5.187955,44.220078],[5.187745,44.219897],[5.187582,44.219785],[5.187517,44.219646],[5.187422,44.219597],[5.187281,44.21962],[5.187188,44.219649],[5.187087,44.219677],[5.186963,44.219657],[5.186111,44.219365],[5.185584,44.218995],[5.185194,44.218662],[5.18497,44.21861],[5.184877,44.218679],[5.184835,44.218763],[5.184738,44.219597],[5.184608,44.219746],[5.18443,44.2198],[5.183944,44.21962],[5.183633,44.219636],[5.183224,44.219929],[5.18288,44.220147],[5.182693,44.220095],[5.18256,44.220009],[5.182315,44.21979],[5.182258,44.219515],[5.182246,44.219341],[5.182099,44.219195],[5.181762,44.219051],[5.181484,44.218987],[5.181275,44.218998],[5.181104,44.219028],[5.180881,44.219276],[5.180672,44.219553],[5.180267,44.219674],[5.179736,44.219821],[5.179286,44.220055],[5.179181,44.220063],[5.178062,44.220145],[5.177311,44.220159],[5.176731,44.220214],[5.175933,44.220354],[5.175199,44.220635],[5.174971,44.220826],[5.174881,44.221104],[5.174931,44.221371],[5.174788,44.221669],[5.174032,44.221587],[5.173704,44.221734],[5.173428,44.222038],[5.173174,44.22251],[5.172618,44.223044],[5.171817,44.223333],[5.170869,44.223506],[5.169987,44.223994],[5.168213,44.225136],[5.168014,44.225305],[5.167848,44.225456],[5.167003,44.225831],[5.166876,44.22585],[5.166749,44.225824],[5.166454,44.225507],[5.166217,44.224894],[5.166119,44.224764],[5.166003,44.224725],[5.165858,44.224771],[5.165634,44.224894],[5.165037,44.225352],[5.164708,44.225914],[5.164199,44.226441],[5.163933,44.226585],[5.16283,44.227027],[5.162501,44.227221],[5.161925,44.227335],[5.161735,44.22742],[5.161672,44.227519],[5.161665,44.227754],[5.161649,44.228284],[5.161488,44.228845],[5.161197,44.229228],[5.160684,44.229778],[5.159563,44.229246],[5.158482,44.228949],[5.158188,44.228863],[5.157921,44.228844],[5.157013,44.229456],[5.156879,44.229839],[5.155264,44.230269],[5.154973,44.230487],[5.154917,44.230891],[5.155304,44.232384],[5.155357,44.233407],[5.155184,44.234125],[5.154943,44.234306],[5.154741,44.234689],[5.154315,44.234814],[5.153475,44.234347],[5.153419,44.233826],[5.153347,44.23358],[5.153341,44.23324],[5.153293,44.23304],[5.153148,44.232888],[5.153006,44.232788],[5.152816,44.232675],[5.152325,44.232794],[5.152256,44.232852],[5.151905,44.233189],[5.151892,44.233561],[5.151902,44.233992],[5.151897,44.234108],[5.151742,44.234233],[5.151546,44.234269],[5.151427,44.234279],[5.151311,44.234326],[5.150753,44.234692],[5.150045,44.235059],[5.149611,44.23534],[5.149504,44.23545],[5.149418,44.235582],[5.149394,44.235647],[5.149413,44.235716],[5.149463,44.235778],[5.149898,44.236095],[5.151009,44.236935],[5.151315,44.237208],[5.151381,44.23755],[5.151376,44.237834],[5.151309,44.238053],[5.151226,44.238145],[5.150834,44.238259],[5.150133,44.238793],[5.151843,44.238533],[5.152647,44.238265],[5.152831,44.238303],[5.153315,44.238745],[5.154022,44.239271],[5.154356,44.239625],[5.156265,44.240936],[5.158128,44.24218],[5.158525,44.2428],[5.158852,44.243118],[5.159608,44.243771],[5.160204,44.244388],[5.160686,44.244781],[5.161216,44.245219],[5.161821,44.24575],[5.16121,44.246195],[5.161203,44.246483],[5.161274,44.246592],[5.161381,44.246985],[5.161444,44.247214],[5.161792,44.248009],[5.16183,44.248208],[5.162046,44.24856],[5.162213,44.248922],[5.162235,44.249088],[5.162153,44.250441],[5.162167,44.25053],[5.162233,44.250597],[5.162244,44.250631],[5.161957,44.251262],[5.162208,44.252064],[5.162076,44.252522],[5.162045,44.252862],[5.161855,44.253557],[5.161887,44.253621],[5.162082,44.253771],[5.162211,44.253916],[5.162406,44.254213],[5.162428,44.254322],[5.16236,44.254506],[5.162227,44.254595],[5.162018,44.254837],[5.161929,44.254962],[5.161837,44.255137],[5.161766,44.255214],[5.161447,44.255359],[5.161076,44.255557],[5.160937,44.25559],[5.160896,44.255617],[5.16088,44.255757],[5.160832,44.25584],[5.16072,44.255971],[5.160609,44.256054],[5.160538,44.25614],[5.160048,44.25683],[5.159944,44.256867],[5.159899,44.25694],[5.159869,44.257033],[5.159897,44.257158],[5.159793,44.257373],[5.159794,44.257621],[5.159753,44.257957],[5.159766,44.257982],[5.159857,44.258042],[5.159856,44.258295],[5.160061,44.258815],[5.16007,44.258882],[5.160014,44.259055],[5.159879,44.259145],[5.159793,44.259231],[5.159741,44.259309],[5.159694,44.259435],[5.159681,44.259545],[5.159748,44.259792],[5.159543,44.26032],[5.159506,44.260824],[5.159543,44.261945],[5.159564,44.262121],[5.159714,44.262739],[5.159916,44.263309],[5.159942,44.263526],[5.160034,44.263635],[5.160061,44.263704],[5.160257,44.264768],[5.160287,44.264802],[5.160422,44.264872],[5.160456,44.264922],[5.160606,44.266377],[5.160681,44.266786],[5.16067,44.266811],[5.160627,44.26683],[5.160101,44.266933],[5.159333,44.267041],[5.158001,44.267135],[5.157789,44.267143],[5.157622,44.267122],[5.157579,44.267152],[5.157369,44.267469],[5.15734,44.267488],[5.157271,44.2675],[5.157184,44.267501],[5.157105,44.267479],[5.157063,44.267447],[5.156985,44.267336],[5.156938,44.267313],[5.156158,44.267392],[5.155541,44.267389],[5.155144,44.267421],[5.15431,44.267455],[5.152293,44.268119],[5.151736,44.268267],[5.150956,44.268443],[5.148433,44.269487],[5.148064,44.269537],[5.147524,44.269621],[5.147499,44.269954],[5.14799,44.270673],[5.147402,44.271073],[5.147006,44.271187],[5.146766,44.271527],[5.146736,44.27167],[5.146707,44.271736],[5.146632,44.271852],[5.146493,44.271975],[5.146381,44.272121],[5.146505,44.272149],[5.146711,44.27213],[5.146822,44.272202],[5.146859,44.272327],[5.146854,44.272526],[5.146809,44.272722],[5.146826,44.272863],[5.146796,44.272947],[5.14678,44.273118],[5.146897,44.273453],[5.146858,44.273746],[5.146975,44.274824],[5.146881,44.275109],[5.146847,44.275339],[5.14705,44.27594],[5.147524,44.276762],[5.147651,44.277099],[5.147743,44.277497],[5.147808,44.277613],[5.147901,44.278001],[5.148055,44.278825],[5.148277,44.28],[5.1487,44.280732],[5.148759,44.280732],[5.149825,44.281916],[5.151741,44.282785],[5.15354,44.28372],[5.153612,44.284025],[5.153727,44.284204],[5.154247,44.284671],[5.154366,44.284725],[5.154519,44.284887],[5.158887,44.285844],[5.159476,44.28615],[5.160002,44.28656],[5.160325,44.286676],[5.160913,44.287255],[5.161117,44.287387],[5.16262,44.287341],[5.162756,44.287442],[5.162452,44.287976],[5.16204,44.288617],[5.161223,44.288917],[5.168087,44.289835],[5.168336,44.290126],[5.168692,44.29096],[5.16849,44.292327],[5.168915,44.293772],[5.16847,44.295491],[5.168552,44.295835],[5.16884,44.296019],[5.168882,44.296335],[5.16919,44.296978],[5.169756,44.297497],[5.170045,44.29808],[5.170127,44.298752],[5.170252,44.299137],[5.170154,44.299748],[5.169755,44.300521],[5.16968,44.30081],[5.169486,44.301008],[5.169343,44.301216],[5.169282,44.301443],[5.170157,44.302235],[5.170275,44.303479],[5.170451,44.303697],[5.170933,44.304744],[5.171632,44.305428],[5.17178,44.305494],[5.17248,44.305795],[5.17277,44.306173],[5.172866,44.306665],[5.17318,44.307072],[5.173531,44.307409],[5.173836,44.307628],[5.173878,44.30772],[5.173867,44.308333],[5.173755,44.308506],[5.173567,44.308619],[5.173181,44.308882],[5.172658,44.309295],[5.171154,44.3094],[5.170042,44.31193],[5.1701,44.312587],[5.169953,44.313],[5.169181,44.31391],[5.168649,44.314119],[5.168837,44.314129],[5.168636,44.314141],[5.168381,44.314554],[5.167695,44.31485],[5.167003,44.314943],[5.166443,44.314847],[5.165782,44.31465],[5.165315,44.314435],[5.165039,44.314251],[5.16414,44.314023],[5.163603,44.313795],[5.16287,44.313822],[5.160393,44.313025],[5.157678,44.311804],[5.156702,44.311526],[5.154383,44.311077],[5.153887,44.310959],[5.153053,44.310693],[5.152012,44.310268],[5.15068,44.309578],[5.152011,44.308948],[5.152112,44.308774],[5.152134,44.308611],[5.152158,44.308533],[5.153058,44.307629],[5.153421,44.307172],[5.153563,44.307001],[5.153529,44.306784],[5.153472,44.306775],[5.153427,44.306649],[5.153484,44.306551],[5.153611,44.306348],[5.153607,44.306152],[5.153975,44.305719],[5.15408,44.305665],[5.154111,44.30552],[5.154197,44.305391],[5.154304,44.305356],[5.154274,44.305309],[5.154114,44.305251],[5.154058,44.305251],[5.154039,44.305199],[5.154086,44.305095],[5.154301,44.304915],[5.154435,44.304819],[5.154473,44.304756],[5.154418,44.304724],[5.154378,44.304684],[5.154563,44.304537],[5.154486,44.304387],[5.15451,44.304315],[5.154645,44.304129],[5.154702,44.303938],[5.154777,44.303827],[5.154854,44.303764],[5.154888,44.303693],[5.154937,44.303461],[5.154992,44.303004],[5.154927,44.302886],[5.15497,44.302605],[5.154851,44.302454],[5.154941,44.302023],[5.154618,44.30195],[5.154327,44.301967],[5.15364,44.302088],[5.152616,44.301745],[5.151994,44.301745],[5.151826,44.301819],[5.151774,44.30219],[5.151489,44.302227],[5.150828,44.301958],[5.1504,44.301921],[5.150219,44.301986],[5.149973,44.301939],[5.149817,44.301772],[5.149416,44.301457],[5.149027,44.300854],[5.148638,44.300502],[5.147848,44.300316],[5.147472,44.30001],[5.14729,44.299584],[5.146863,44.299241],[5.145282,44.298443],[5.145072,44.298225],[5.143507,44.297274],[5.142742,44.296987],[5.14232,44.296556],[5.141885,44.296436],[5.140961,44.29623],[5.140486,44.296452],[5.140021,44.296194],[5.139633,44.296222],[5.138907,44.295874],[5.137974,44.295299],[5.13752,44.294742],[5.137349,44.294689],[5.136574,44.294381],[5.135652,44.293988],[5.135229,44.293844],[5.134924,44.293929],[5.134774,44.293885],[5.134319,44.293537],[5.133608,44.292818],[5.133347,44.292702],[5.131948,44.29285],[5.131252,44.292404],[5.130779,44.292351],[5.130428,44.292188],[5.129985,44.291678],[5.129188,44.290949],[5.126484,44.289637],[5.126175,44.289118],[5.125801,44.288956],[5.125415,44.288772],[5.12508,44.288521],[5.12372,44.288333],[5.123344,44.288333],[5.121672,44.288036],[5.120428,44.287535],[5.119171,44.286951],[5.117772,44.285893],[5.11667,44.285291],[5.115802,44.284261],[5.115167,44.283973],[5.113314,44.283389],[5.111643,44.2826],[5.111484,44.282524],[5.109353,44.281495],[5.107834,44.280846],[5.108158,44.277299],[5.107247,44.277401],[5.107117,44.277436],[5.1063,44.277625],[5.105293,44.277693],[5.105034,44.27875],[5.10449,44.279502],[5.104154,44.28004],[5.102363,44.280763],[5.100745,44.281209],[5.098801,44.28183],[5.094356,44.282795],[5.092296,44.283148],[5.086322,44.28401],[5.085947,44.283667],[5.085304,44.282862],[5.083824,44.282685],[5.083154,44.283054],[5.081988,44.283517],[5.07648,44.283934],[5.075321,44.285697],[5.074958,44.286052],[5.074728,44.28619],[5.074444,44.286654],[5.07269,44.287563],[5.072244,44.287963],[5.071082,44.288875],[5.070722,44.289006],[5.070385,44.28972],[5.069983,44.290426],[5.069762,44.291021],[5.069489,44.292359],[5.068753,44.293847],[5.068129,44.296341],[5.068126,44.296708],[5.068211,44.297963],[5.067792,44.300151],[5.064013,44.304585],[5.063909,44.304744],[5.062307,44.306386],[5.062123,44.306572],[5.061306,44.307939],[5.060429,44.308004],[5.059145,44.306985],[5.058545,44.306733],[5.057671,44.306341],[5.05661,44.30606],[5.055978,44.305525],[5.055474,44.305115],[5.054379,44.304673],[5.053117,44.304165],[5.051285,44.303639],[5.050465,44.303106],[5.049522,44.302688],[5.048741,44.302407],[5.047753,44.302166],[5.046088,44.30152],[5.045182,44.301251],[5.043604,44.301275],[5.042011,44.300616],[5.041091,44.30063],[5.040303,44.300463],[5.038789,44.300102],[5.03811,44.299589],[5.036803,44.299646],[5.035227,44.299411],[5.033214,44.298692],[5.031501,44.298363],[5.029516,44.297868],[5.028434,44.297549],[5.027552,44.297485],[5.0258,44.296845],[5.023404,44.295997],[5.022479,44.295966],[5.02184,44.295756],[5.020894,44.295162],[5.020357,44.294613],[5.019821,44.294265],[5.018474,44.293529],[5.017006,44.292741],[5.015632,44.292281],[5.013904,44.291402],[5.012,44.290643],[5.011034,44.290317],[5.009834,44.289915],[5.009038,44.289235],[5.00731,44.288276],[5.005736,44.28743],[5.004699,44.286858],[5.003465,44.286379],[5.002035,44.286096],[4.997875,44.285655],[4.995658,44.285704],[4.993314,44.285631],[4.991582,44.285829],[4.989407,44.285957],[4.987189,44.285859],[4.986493,44.285756],[4.985892,44.285614],[4.985043,44.28532],[4.982783,44.284736],[4.981659,44.28437],[4.979677,44.283736],[4.9792,44.28361],[4.97803,44.2832],[4.976154,44.282654],[4.974911,44.282197],[4.973346,44.281617],[4.972217,44.280889],[4.97104,44.280399],[4.970616,44.278599],[4.965171,44.276583],[4.960976,44.274547],[4.955397,44.272719],[4.95198,44.271332],[4.949931,44.270887],[4.946047,44.26995],[4.943177,44.26912],[4.937357,44.266108],[4.935007,44.264464],[4.934208,44.263715],[4.934143,44.263069],[4.933295,44.262221],[4.932803,44.262287],[4.930204,44.262487],[4.928317,44.262633],[4.9282,44.262642],[4.927439,44.262402],[4.925947,44.261916],[4.924631,44.261482],[4.924068,44.261313],[4.923246,44.261452],[4.922549,44.260255],[4.922259,44.259715],[4.922204,44.259727],[4.919715,44.259986],[4.919074,44.26005],[4.918093,44.260146],[4.916342,44.260174],[4.915506,44.260193],[4.914551,44.260317],[4.913486,44.260471],[4.912884,44.260551],[4.912522,44.260575],[4.911871,44.260529],[4.903301,44.260232],[4.902573,44.260248],[4.901919,44.260255],[4.901625,44.260218],[4.901364,44.260126],[4.900843,44.259841],[4.900769,44.259757],[4.900762,44.259643],[4.900357,44.258422],[4.900227,44.258058],[4.899842,44.256867],[4.899796,44.256816],[4.899688,44.256804],[4.89948,44.256833],[4.898974,44.256912],[4.898147,44.257032],[4.897102,44.257221],[4.89649,44.257323],[4.895581,44.257503],[4.895516,44.257519],[4.896369,44.258727],[4.896962,44.259729],[4.897337,44.260026],[4.898555,44.261004],[4.899271,44.261594],[4.90046,44.262795],[4.901668,44.264081],[4.90114,44.264116],[4.900407,44.264165],[4.897406,44.264387],[4.897068,44.264395],[4.896805,44.264356],[4.896389,44.264322],[4.896219,44.264292],[4.893678,44.263422],[4.892494,44.263051],[4.892044,44.262928],[4.891467,44.262807],[4.890959,44.262737],[4.890666,44.262671],[4.889837,44.262447],[4.888982,44.262219],[4.888217,44.262017],[4.887737,44.261857],[4.88675,44.261727],[4.885672,44.261584],[4.884825,44.261472],[4.88471,44.261474],[4.884327,44.261512],[4.884078,44.261572],[4.883844,44.261581],[4.882412,44.261792],[4.88131,44.26165],[4.880196,44.261523],[4.880099,44.261699],[4.878199,44.26111],[4.878153,44.261093],[4.876996,44.260684],[4.875644,44.260173],[4.874716,44.259919],[4.874339,44.259816],[4.874076,44.259744],[4.873965,44.259667],[4.873368,44.258901],[4.87295,44.258583],[4.872455,44.258209],[4.871846,44.257591],[4.871527,44.257324],[4.870831,44.256596],[4.870752,44.256536],[4.869863,44.256321],[4.869242,44.256181],[4.868735,44.256058],[4.868684,44.256043],[4.867676,44.255833],[4.867592,44.255809],[4.867547,44.255772],[4.867161,44.255032],[4.866793,44.254347],[4.866656,44.254112],[4.866563,44.253951],[4.866419,44.253413],[4.866364,44.253205],[4.866246,44.252531],[4.866225,44.252294],[4.866003,44.249834],[4.865974,44.249581],[4.865962,44.249514],[4.865962,44.249472],[4.865604,44.249474],[4.864558,44.249482],[4.864284,44.249484],[4.864087,44.249469],[4.864068,44.249467],[4.864025,44.249461],[4.863959,44.24945],[4.863901,44.249438],[4.863827,44.249423],[4.863755,44.249405],[4.863684,44.249391],[4.863586,44.249368],[4.863489,44.249356],[4.863415,44.24934],[4.863339,44.24933],[4.863246,44.249316],[4.86315,44.249303],[4.862963,44.249275],[4.86281,44.249259],[4.862704,44.249246],[4.862594,44.249223],[4.862431,44.249193],[4.862308,44.249178],[4.862186,44.249159],[4.862,44.249133],[4.861867,44.24911],[4.861684,44.249081],[4.861391,44.24904],[4.861046,44.248994],[4.86068,44.248947],[4.860285,44.248896],[4.859319,44.248768],[4.859273,44.248761],[4.859173,44.248749],[4.859022,44.248714],[4.858892,44.248689],[4.858793,44.248644],[4.858673,44.248577],[4.858508,44.248483],[4.858136,44.248291],[4.857755,44.248075],[4.85769,44.24804],[4.857341,44.247852],[4.856967,44.247661],[4.856869,44.247633],[4.856706,44.247626],[4.856781,44.247476],[4.856848,44.247332],[4.856877,44.247183],[4.856913,44.247012],[4.856928,44.246731],[4.856969,44.246166],[4.857026,44.245871],[4.8568,44.245775],[4.856287,44.245633],[4.855811,44.245331],[4.854823,44.244827],[4.852029,44.243481],[4.850351,44.242685],[4.850045,44.242543],[4.848614,44.24197],[4.847465,44.241477],[4.847214,44.241237],[4.846708,44.240762],[4.846628,44.240681],[4.844847,44.241322],[4.844023,44.241735],[4.843718,44.241781],[4.843556,44.241805],[4.841446,44.239523],[4.841407,44.238795],[4.841112,44.238144],[4.840805,44.235722],[4.840511,44.235195],[4.840337,44.235176],[4.837771,44.23644],[4.837491,44.236526],[4.836729,44.23576],[4.833495,44.232936],[4.833268,44.232811],[4.832279,44.231902],[4.831473,44.231476],[4.829477,44.23042],[4.827695,44.230465],[4.827,44.229345],[4.82684,44.228694],[4.826693,44.22833],[4.825591,44.228567],[4.821229,44.228966],[4.817503,44.229646],[4.81571,44.231619],[4.815566,44.231823],[4.814193,44.232067],[4.813139,44.237354],[4.812581,44.240155],[4.8121,44.241965],[4.812621,44.244109],[4.813303,44.245583],[4.813584,44.247175],[4.812996,44.248991],[4.8121,44.251212],[4.813062,44.252714],[4.813116,44.253183],[4.812608,44.25504],[4.812354,44.255835],[4.812354,44.256562],[4.812581,44.257165],[4.812659,44.257728],[4.809802,44.263664],[4.807717,44.265625],[4.806127,44.267405],[4.805338,44.268678],[4.804443,44.269147],[4.803975,44.269214],[4.805873,44.272199],[4.806556,44.273189],[4.806263,44.273896],[4.803997,44.277905],[4.803309,44.278191],[4.80312,44.279921],[4.803063,44.28109],[4.803046,44.281427],[4.80308,44.282762],[4.803025,44.285544],[4.803414,44.286158],[4.803974,44.287379],[4.804613,44.287562],[4.804591,44.28881],[4.804719,44.289973],[4.804886,44.291878],[4.80492,44.292836],[4.804943,44.293104],[4.804839,44.2934],[4.804307,44.294438],[4.803563,44.295361],[4.803356,44.295913],[4.803214,44.296608],[4.803046,44.297522],[4.803345,44.298587],[4.803584,44.299372],[4.803669,44.299927],[4.80363,44.300053],[4.803648,44.300203],[4.804612,44.303883],[4.800652,44.303505],[4.799743,44.303427],[4.799418,44.303475],[4.799077,44.303521],[4.798709,44.303772],[4.79657,44.304845],[4.794976,44.305808],[4.794352,44.306169],[4.793905,44.306518],[4.793554,44.306741],[4.792792,44.306769],[4.792338,44.306903],[4.791964,44.307177],[4.791144,44.307413],[4.790567,44.307656],[4.789592,44.307611],[4.789137,44.309215],[4.788848,44.310347],[4.788645,44.310839],[4.788588,44.311081],[4.788575,44.311259],[4.788453,44.311671],[4.788465,44.311847],[4.78853,44.312291],[4.788686,44.312905],[4.788879,44.313307],[4.788925,44.313549],[4.788229,44.313508],[4.787455,44.313567],[4.785986,44.314001],[4.784912,44.314365],[4.783633,44.314867],[4.782504,44.315635],[4.782174,44.31595],[4.781155,44.316807],[4.780137,44.318038],[4.779437,44.318335],[4.778142,44.318323],[4.777853,44.318382],[4.776848,44.318412],[4.77638,44.318294],[4.776091,44.318156],[4.775485,44.317811],[4.774068,44.317378],[4.77305,44.31726],[4.771426,44.317211],[4.771307,44.317311],[4.77082,44.317861],[4.768756,44.319574],[4.768412,44.320086],[4.768409,44.320232],[4.768398,44.320746],[4.76815,44.321238],[4.766733,44.322134],[4.765783,44.322478],[4.765081,44.322902],[4.763829,44.324585],[4.762963,44.325108],[4.762329,44.325363],[4.761283,44.325442],[4.760514,44.325333],[4.760306,44.325304],[4.755351,44.325383],[4.75425,44.325284],[4.750939,44.325293],[4.750507,44.325294],[4.749282,44.325068],[4.748523,44.325067],[4.748126,44.325156],[4.74601,44.325355],[4.745366,44.325424],[4.74299,44.325712],[4.742154,44.325186],[4.741754,44.325137],[4.741534,44.325245],[4.738782,44.325649],[4.735795,44.325806],[4.7338,44.325688],[4.733498,44.325815],[4.731268,44.325886],[4.730447,44.32604],[4.726215,44.326167],[4.72427,44.32623],[4.722155,44.326768],[4.721556,44.326796],[4.71962,44.326876],[4.718564,44.32687],[4.717756,44.326859],[4.717889,44.326561],[4.718092,44.326275],[4.718532,44.325679],[4.717771,44.325667],[4.713749,44.325563],[4.713581,44.3253],[4.713168,44.324765],[4.71286,44.32436],[4.712623,44.324096],[4.712364,44.323817],[4.712419,44.323592],[4.712473,44.323376],[4.712522,44.323118],[4.712547,44.32299],[4.712589,44.322769],[4.71267,44.322333],[4.7127,44.322206],[4.712904,44.321427],[4.71299,44.321109],[4.71308,44.320563],[4.710461,44.320578],[4.707927,44.320621],[4.706812,44.320634],[4.705697,44.320648],[4.705421,44.320653],[4.70454,44.320644],[4.703796,44.320667],[4.701913,44.320705],[4.700786,44.320731],[4.700561,44.320737],[4.700405,44.320746],[4.699921,44.320791],[4.699704,44.320807],[4.69925,44.320809],[4.698818,44.320812],[4.69855,44.320823],[4.698323,44.320823],[4.698214,44.320837],[4.698007,44.32084],[4.697864,44.320848],[4.697369,44.320894],[4.696997,44.320901],[4.696628,44.320904],[4.695733,44.320886],[4.694727,44.32086],[4.694049,44.320823],[4.693268,44.320754],[4.693107,44.32074],[4.691758,44.320673],[4.690425,44.320621],[4.689123,44.320565],[4.68693,44.32047],[4.684569,44.320457],[4.683635,44.320413],[4.682909,44.320384],[4.682098,44.320412],[4.678974,44.320504],[4.678632,44.320701],[4.676886,44.322599],[4.676636,44.322665],[4.675533,44.323595],[4.675231,44.323989],[4.673282,44.32417],[4.672092,44.324563],[4.671514,44.324816],[4.671422,44.32476],[4.671317,44.323661],[4.670647,44.323238],[4.669754,44.322862],[4.66957,44.322824],[4.660718,44.326244],[4.659142,44.326819],[4.656203,44.32789],[4.650755,44.329105],[4.650848,44.328774],[4.650961,44.328309],[4.651068,44.32786],[4.651153,44.32755],[4.651224,44.327296],[4.651309,44.32697],[4.65141,44.326487],[4.651508,44.325826],[4.651615,44.325209],[4.651647,44.324821],[4.651666,44.324429],[4.651667,44.324022],[4.651539,44.32347],[4.651486,44.323094],[4.651454,44.322802],[4.65141,44.322633],[4.651369,44.322457],[4.651312,44.322249],[4.651241,44.32182],[4.651155,44.321436],[4.651082,44.321237],[4.650957,44.320294],[4.650665,44.318559],[4.650369,44.317392],[4.649857,44.315843],[4.649778,44.315323],[4.649723,44.314227],[4.649738,44.313315],[4.649799,44.312471],[4.649917,44.311417],[4.650081,44.310464],[4.650519,44.309429],[4.651982,44.30681],[4.652463,44.305869],[4.652716,44.304857],[4.653374,44.303265],[4.653478,44.301821],[4.653545,44.300286],[4.653578,44.299535],[4.653484,44.298414],[4.653183,44.296264],[4.65308,44.294845],[4.652906,44.293641],[4.652579,44.291349],[4.652466,44.290485],[4.652411,44.290029],[4.652256,44.289508],[4.652002,44.288923],[4.651818,44.288158],[4.651633,44.287572],[4.651506,44.287064],[4.651467,44.286681],[4.651317,44.286204],[4.651274,44.285698],[4.651138,44.285215],[4.651059,44.284745],[4.65091,44.284222],[4.650909,44.283761],[4.650889,44.283162],[4.650845,44.282487],[4.650931,44.281473],[4.650904,44.280522],[4.651017,44.279337],[4.651138,44.278526],[4.651145,44.277971],[4.651295,44.277479],[4.651305,44.277178],[4.65131,44.276703],[4.651373,44.276259],[4.651158,44.275279],[4.651105,44.27509],[4.651019,44.2748],[4.650927,44.27451],[4.650692,44.273867],[4.650503,44.273358],[4.650399,44.273102],[4.65023,44.272674],[4.650065,44.272246],[4.649879,44.271713],[4.649752,44.271309],[4.649652,44.270926],[4.649488,44.270155],[4.649118,44.268708],[4.648838,44.267406],[4.648775,44.266701],[4.64867,44.265324],[4.648568,44.263718],[4.648828,44.262438],[4.649505,44.261057],[4.65061,44.259367],[4.65082,44.259089],[4.651273,44.258425],[4.651959,44.257551],[4.652364,44.257028],[4.652558,44.256612],[4.652927,44.25612],[4.653137,44.25566],[4.653421,44.255244],[4.653761,44.254815],[4.654066,44.254437],[4.65416,44.254291],[4.655126,44.253374],[4.655979,44.252747],[4.65733,44.251409],[4.658883,44.249815],[4.660062,44.248676],[4.660594,44.248222],[4.661426,44.247579],[4.661933,44.247211],[4.663618,44.245985],[4.664716,44.245217],[4.665706,44.244572],[4.667688,44.243326],[4.670304,44.241772],[4.671557,44.241005],[4.672006,44.240698],[4.67316,44.23984],[4.673539,44.239534],[4.674599,44.238589],[4.675035,44.238176],[4.675517,44.23768],[4.67667,44.236313],[4.677434,44.23517],[4.677655,44.234753],[4.677903,44.234175],[4.677994,44.233914],[4.67809,44.233568],[4.67821,44.232849],[4.678227,44.232634],[4.67822,44.231488],[4.67812,44.230528],[4.678078,44.23028],[4.677659,44.228826],[4.677253,44.227699],[4.676923,44.226896],[4.67583,44.224642],[4.673692,44.220365],[4.673517,44.219962],[4.673342,44.219434],[4.672995,44.218554],[4.673006,44.21745],[4.673241,44.215794],[4.674052,44.214501],[4.675177,44.213389],[4.676855,44.212586],[4.678081,44.212189],[4.679311,44.212136],[4.679694,44.212095],[4.680098,44.212087],[4.68182,44.21227],[4.682194,44.212322],[4.686708,44.21336],[4.68833,44.213917],[4.690648,44.214619],[4.691153,44.214719],[4.694021,44.215503],[4.695889,44.215753],[4.697671,44.215866],[4.699869,44.21586],[4.700772,44.215856],[4.701518,44.215769],[4.701747,44.215776],[4.702378,44.215748],[4.70336,44.215388],[4.703759,44.21532],[4.704265,44.215208],[4.704915,44.215011],[4.705225,44.21489],[4.705752,44.214644],[4.707308,44.213682],[4.707348,44.213664],[4.707988,44.213113],[4.708791,44.21214],[4.709696,44.209922],[4.709726,44.209806],[4.709822,44.208586],[4.709554,44.207442],[4.709212,44.206605],[4.708162,44.205009],[4.707723,44.204285],[4.706561,44.202976],[4.705707,44.201968],[4.705218,44.201416],[4.704789,44.200687],[4.704467,44.200042],[4.704433,44.199899],[4.704412,44.199688],[4.704339,44.198134],[4.704424,44.197438],[4.704558,44.196345],[4.704665,44.1958],[4.705061,44.194472],[4.705703,44.193074],[4.705781,44.192978],[4.708818,44.191943],[4.709227,44.19182],[4.70959,44.191741],[4.710329,44.191627],[4.711241,44.191584],[4.711674,44.191532],[4.713178,44.191556],[4.714185,44.191489],[4.714368,44.191447],[4.715126,44.191214],[4.715718,44.191002],[4.715986,44.190889],[4.717056,44.190387],[4.717666,44.190066],[4.718486,44.189867],[4.718693,44.189736],[4.718958,44.189618],[4.719274,44.1895],[4.719831,44.18934],[4.719978,44.18928],[4.721174,44.188387],[4.722055,44.18776],[4.722232,44.187597],[4.722345,44.187409],[4.722364,44.18727],[4.722304,44.186339],[4.722063,44.184903],[4.722114,44.18446],[4.722192,44.184093],[4.72219,44.183994],[4.722102,44.183834],[4.721463,44.18299],[4.721183,44.1825],[4.721032,44.18234],[4.720347,44.181019],[4.720159,44.180584],[4.720077,44.180283],[4.719995,44.17967],[4.71998,44.178938],[4.719873,44.178355],[4.71987,44.178218],[4.719922,44.177926],[4.719905,44.177861],[4.719768,44.177648],[4.719705,44.177514],[4.719694,44.17746],[4.719731,44.177344],[4.719708,44.177215],[4.719664,44.177184],[4.719591,44.17718],[4.718461,44.177156],[4.717837,44.177123],[4.717194,44.177062],[4.716657,44.176925],[4.716223,44.176816],[4.716549,44.175975],[4.716676,44.175297],[4.716851,44.174542],[4.716954,44.173728],[4.717133,44.17277],[4.717217,44.171787],[4.717326,44.170646],[4.717217,44.169925],[4.717105,44.168923],[4.716977,44.167818],[4.71668,44.166415],[4.71664,44.165737],[4.716482,44.164307],[4.71664,44.16258],[4.717068,44.15932],[4.7182,44.155224],[4.719107,44.152512],[4.719504,44.151607],[4.71956,44.151435],[4.720144,44.14785],[4.719834,44.145716],[4.719251,44.144136],[4.718315,44.142603],[4.71807,44.142258],[4.717496,44.141562],[4.717263,44.141308],[4.715918,44.139985],[4.714622,44.138492],[4.712562,44.136067],[4.711694,44.134847],[4.711333,44.132878],[4.711315,44.132699],[4.711684,44.127216],[4.711347,44.124752],[4.71114,44.122853],[4.71108,44.121525],[4.711111,44.120586],[4.71104,44.119428],[4.71098,44.119257],[4.710155,44.117594],[4.708549,44.115641],[4.707443,44.114226],[4.707099,44.113531],[4.706559,44.112077],[4.706505,44.111868],[4.70619,44.110119],[4.706151,44.109766],[4.706176,44.1079],[4.706213,44.107609],[4.706406,44.106074],[4.706599,44.105468],[4.706737,44.105339],[4.708001,44.102918],[4.70812,44.102744],[4.708811,44.101868],[4.710704,44.100178],[4.712503,44.099688],[4.713716,44.099018],[4.714487,44.098186],[4.715753,44.096784],[4.717066,44.09535],[4.71821,44.093825],[4.719185,44.09243],[4.71969,44.091213],[4.719851,44.090258],[4.719862,44.089341],[4.719848,44.08861],[4.719817,44.087838],[4.719636,44.085786],[4.719923,44.083149],[4.720852,44.081259],[4.722895,44.079476],[4.72301,44.079433],[4.725857,44.078654],[4.726024,44.078625],[4.728132,44.078751],[4.730478,44.079367],[4.730637,44.079453],[4.734882,44.082396],[4.735452,44.082691],[4.7377,44.083788],[4.739083,44.084316],[4.74155,44.084907],[4.743712,44.085351],[4.744637,44.085598],[4.74567,44.085974],[4.746145,44.086116],[4.747632,44.086632],[4.749268,44.087247],[4.750443,44.087651],[4.751666,44.088012],[4.752918,44.088315],[4.754217,44.088474],[4.755028,44.088452],[4.756687,44.088284],[4.758288,44.087996],[4.75962,44.087531],[4.760057,44.087317],[4.760413,44.08704],[4.760675,44.086585],[4.760741,44.086115],[4.76069,44.085377],[4.760471,44.084316],[4.760195,44.083234],[4.759904,44.081744],[4.759955,44.080349],[4.759879,44.078607],[4.759421,44.078503],[4.759072,44.078414],[4.759418,44.077953],[4.759734,44.077518],[4.760655,44.076698],[4.760954,44.076307],[4.762439,44.074911],[4.765169,44.073023],[4.765457,44.072836],[4.765808,44.072705],[4.767481,44.07216],[4.767967,44.071972],[4.768122,44.071886],[4.768228,44.071848],[4.768362,44.071774],[4.768515,44.071666],[4.768707,44.071587],[4.771162,44.070953],[4.772942,44.07068],[4.773194,44.070615],[4.781328,44.068668],[4.78655,44.065892],[4.787309,44.065275],[4.78755,44.06471],[4.787776,44.063951],[4.788087,44.063042],[4.788202,44.062357],[4.788262,44.0616],[4.788248,44.061045],[4.788099,44.060329],[4.787947,44.059365],[4.787682,44.057969],[4.787285,44.057088],[4.787265,44.054656],[4.787891,44.053062],[4.787909,44.052987],[4.788001,44.052703],[4.788284,44.0524],[4.789099,44.051823],[4.789729,44.051346],[4.790137,44.051076],[4.790471,44.050775],[4.790986,44.050474],[4.791168,44.050311],[4.791376,44.05016],[4.791781,44.049924],[4.793311,44.049118],[4.793634,44.048958],[4.79401,44.048802],[4.794843,44.048343],[4.795245,44.048124],[4.795614,44.047885],[4.796381,44.047315],[4.796903,44.047002],[4.797276,44.046818],[4.797971,44.046555],[4.798518,44.046285],[4.799675,44.045569],[4.802143,44.043864],[4.803698,44.042769],[4.805416,44.041681],[4.806188,44.041173],[4.807073,44.040583],[4.808118,44.039901],[4.80962,44.038565],[4.811561,44.036805],[4.814279,44.034428],[4.815765,44.032557],[4.816586,44.031133],[4.817094,44.029545],[4.817356,44.02823],[4.817324,44.027369],[4.817573,44.025768],[4.818044,44.0234],[4.818473,44.021047],[4.818677,44.019273],[4.818816,44.018717],[4.818911,44.018394],[4.818976,44.018112],[4.819166,44.017861],[4.819431,44.017534],[4.819759,44.01723],[4.820453,44.01669],[4.820881,44.01653],[4.821796,44.016285],[4.823461,44.016111],[4.824664,44.016032],[4.826298,44.016192],[4.82678,44.016238],[4.827826,44.016227],[4.829161,44.016121],[4.830986,44.015911],[4.832205,44.015832],[4.833373,44.015735],[4.835074,44.015473],[4.837013,44.015041],[4.837766,44.014773],[4.840372,44.013395],[4.841279,44.012709],[4.841795,44.012314],[4.842235,44.011875],[4.842637,44.011293],[4.843208,44.010213],[4.843776,44.008284],[4.844166,44.005517],[4.84431,44.002761],[4.844131,44.000777],[4.844605,43.998713],[4.845025,43.997604],[4.845534,43.996742],[4.845194,43.995502],[4.845141,43.995296],[4.845228,43.995199],[4.845225,43.995161],[4.845199,43.995113],[4.844985,43.994736],[4.844846,43.994081],[4.844833,43.99315],[4.844851,43.992471],[4.844786,43.991274],[4.844706,43.990615],[4.844611,43.990197],[4.844508,43.989832],[4.844416,43.989573],[4.84435,43.989437],[4.844164,43.989071],[4.843861,43.988579],[4.843242,43.987591],[4.842966,43.98729],[4.842891,43.98728],[4.84272,43.987051],[4.842459,43.986828],[4.841219,43.986103],[4.840643,43.985916],[4.839125,43.985665],[4.837744,43.985451],[4.837177,43.985316],[4.836127,43.985126],[4.835154,43.985087],[4.83485,43.985096],[4.83336,43.985146],[4.832223,43.985252],[4.831462,43.985394],[4.830525,43.985605],[4.828443,43.986049],[4.826873,43.986493],[4.826163,43.986728],[4.825823,43.986819],[4.825293,43.986909],[4.824948,43.986972],[4.824608,43.987074],[4.824337,43.987194],[4.823957,43.987321],[4.823339,43.98746],[4.822723,43.987554],[4.822307,43.987628],[4.821715,43.987793],[4.820956,43.988041],[4.819968,43.988306],[4.818377,43.988628],[4.817889,43.988685],[4.816235,43.988829],[4.815811,43.98884],[4.815371,43.988771],[4.814058,43.988411],[4.81309,43.988031],[4.811978,43.987079],[4.811357,43.985954],[4.811062,43.985312],[4.810966,43.985004],[4.810671,43.984134],[4.810524,43.983516],[4.8103,43.982562],[4.810133,43.981778],[4.810088,43.981325],[4.810009,43.980514],[4.809994,43.979791],[4.81003,43.979124],[4.810087,43.978061],[4.810136,43.977528],[4.810227,43.976971],[4.810356,43.976609],[4.810529,43.97619],[4.810979,43.975622],[4.811121,43.97537],[4.811758,43.974241],[4.812188,43.973479],[4.812518,43.972993],[4.813283,43.97189],[4.813875,43.971026],[4.814353,43.970208],[4.81455,43.969765],[4.814776,43.969106],[4.81506,43.968055],[4.815175,43.967536],[4.8154,43.96608],[4.815423,43.965411],[4.815391,43.965177],[4.81516,43.964496],[4.814473,43.96352],[4.813403,43.962537],[4.812638,43.961892],[4.812218,43.961592],[4.811378,43.961087],[4.811125,43.960964],[4.810111,43.960479],[4.809407,43.960192],[4.807291,43.959288],[4.806929,43.959168],[4.805906,43.958939],[4.8043,43.958588],[4.803509,43.958355],[4.800804,43.957608],[4.800386,43.957603],[4.79995,43.957619],[4.799422,43.957611],[4.798537,43.957368],[4.798183,43.957225],[4.79768,43.956966],[4.797196,43.956706],[4.79675,43.956431],[4.794836,43.955185],[4.793794,43.954518],[4.793384,43.95421],[4.793034,43.953882],[4.792977,43.953816],[4.792419,43.953182],[4.792146,43.952831],[4.791998,43.952572],[4.791868,43.952312],[4.79111,43.950805],[4.790425,43.949557],[4.789576,43.948191],[4.788847,43.947232],[4.78859,43.946912],[4.788135,43.94637],[4.787169,43.945285],[4.786161,43.944172],[4.785414,43.943563],[4.784221,43.942728],[4.783211,43.941975],[4.782833,43.941674],[4.782498,43.941366],[4.782331,43.941074],[4.782242,43.940826],[4.78214,43.940716],[4.781334,43.940304],[4.780922,43.940082],[4.780808,43.939954],[4.780533,43.939401],[4.78032,43.939012],[4.780144,43.938842],[4.779527,43.938364],[4.778357,43.937565],[4.776809,43.93678],[4.775433,43.936171],[4.774486,43.935833],[4.773169,43.935627],[4.77284,43.935547],[4.771659,43.93501],[4.769161,43.933968],[4.768849,43.933834],[4.768427,43.933871],[4.766652,43.934144],[4.765157,43.934201],[4.764814,43.934261],[4.763718,43.934554],[4.762797,43.934812],[4.761689,43.93489],[4.760287,43.934718],[4.758344,43.934456],[4.757451,43.934242],[4.756836,43.934061],[4.75402,43.933233],[4.752519,43.932804],[4.751349,43.932514],[4.749561,43.931872],[4.74906,43.93163],[4.747958,43.93121],[4.74711,43.930851],[4.746157,43.930323],[4.74505,43.929631],[4.744308,43.929113],[4.743456,43.928487],[4.742972,43.927943],[4.742775,43.927805],[4.741932,43.926938],[4.74124,43.926197],[4.739631,43.924588],[4.743394,43.92345],[4.744666,43.923343],[4.748871,43.922929],[4.761291,43.921427],[4.774051,43.919498],[4.787775,43.917963],[4.790986,43.917214],[4.802467,43.915526],[4.811106,43.91424],[4.822586,43.912835],[4.853161,43.911379],[4.881157,43.901783],[4.88272,43.900881],[4.885239,43.900347],[4.893646,43.894653],[4.902657,43.888347],[4.90821,43.887382],[4.915151,43.887642],[4.916297,43.886649],[4.916305,43.886653],[4.916373,43.88669],[4.917536,43.88731],[4.921797,43.88782],[4.92525,43.886133],[4.930863,43.884321],[4.934899,43.882679],[4.946618,43.877901],[4.952711,43.875984],[4.965906,43.871427],[4.966614,43.871226],[4.975915,43.866476],[4.983489,43.859066],[4.984216,43.858356],[4.990852,43.851864],[4.99212,43.850464],[4.997221,43.844933],[4.999377,43.844102],[5.001663,43.842385],[5.003855,43.840881],[5.004246,43.840664],[5.008151,43.838493],[5.017663,43.83357],[5.026999,43.828964],[5.030067,43.8272],[5.03542,43.820115],[5.035429,43.820099],[5.041187,43.811177],[5.042222,43.806428],[5.043173,43.802733],[5.042487,43.798996],[5.042452,43.79852],[5.042562,43.797192],[5.043024,43.795486],[5.044021,43.793618],[5.044986,43.792407],[5.045593,43.791781],[5.046301,43.791147],[5.047837,43.78997],[5.048936,43.789291],[5.049769,43.788847],[5.050936,43.788316],[5.055033,43.786638],[5.055678,43.786409],[5.058618,43.785158],[5.059113,43.784948],[5.059614,43.784743],[5.060368,43.784434],[5.064293,43.782827],[5.070899,43.780124],[5.090773,43.772113],[5.123831,43.758707],[5.138734,43.752704],[5.140126,43.752133],[5.160799,43.743823],[5.17403,43.738491],[5.174474,43.738365],[5.187543,43.735115],[5.193803,43.736714],[5.201692,43.73881],[5.211794,43.742436],[5.217186,43.743807],[5.222835,43.74558],[5.229483,43.747661],[5.236322,43.747724],[5.237546,43.747717],[5.24753,43.748707],[5.256028,43.747272],[5.260584,43.746224],[5.262862,43.745491],[5.264917,43.745029],[5.268104,43.744033],[5.273683,43.742293],[5.27553,43.742084],[5.280966,43.741451],[5.286558,43.740817],[5.291186,43.740427],[5.294128,43.739125],[5.296084,43.738732],[5.298394,43.738537],[5.305827,43.73801],[5.308268,43.737874],[5.312996,43.736912],[5.316742,43.736136],[5.325839,43.729051],[5.326243,43.728724],[5.330011,43.726416],[5.333348,43.724183],[5.339024,43.720205],[5.343451,43.718512],[5.34901,43.716397],[5.349593,43.716188],[5.358384,43.713267],[5.362784,43.711813],[5.364206,43.711462],[5.36533,43.711072],[5.370772,43.709164],[5.374473,43.708187],[5.377389,43.706468],[5.379499,43.705256],[5.381796,43.703944],[5.382817,43.703433],[5.384272,43.70307],[5.386069,43.702632],[5.387714,43.702239],[5.391043,43.701417],[5.392389,43.700906],[5.398945,43.698376],[5.400828,43.697563],[5.401383,43.697267],[5.405267,43.696248],[5.407555,43.695331],[5.412983,43.693204],[5.41673,43.690268],[5.420078,43.688606],[5.421809,43.687734],[5.423721,43.686756],[5.427705,43.686052],[5.428327,43.685747],[5.433428,43.683261],[5.434009,43.68305],[5.437758,43.681691],[5.439294,43.681097],[5.444183,43.679911],[5.449105,43.679648],[5.450145,43.679571],[5.453188,43.678641],[5.455068,43.677925],[5.456338,43.677678],[5.460956,43.676014],[5.462282,43.675559],[5.465518,43.674244],[5.470357,43.673179],[5.472704,43.672586],[5.475077,43.671366],[5.476637,43.670523],[5.479141,43.669931],[5.481954,43.669589],[5.485965,43.668232],[5.488142,43.667448],[5.495705,43.666892],[5.496366,43.666796],[5.496476,43.666779],[5.500869,43.66618],[5.503708,43.665761],[5.507123,43.664833],[5.512021,43.663478],[5.519162,43.661323],[5.519575,43.661242],[5.521279,43.661051],[5.532334,43.659214],[5.543699,43.660945],[5.54978,43.65977],[5.549994,43.659726],[5.553386,43.660483],[5.558238,43.661367],[5.574584,43.662194],[5.579425,43.661768],[5.582646,43.661674],[5.585073,43.661544],[5.587344,43.661423],[5.594868,43.659702],[5.601303,43.659183],[5.602519,43.659085],[5.604026,43.658962],[5.605383,43.658849],[5.606392,43.658772],[5.607044,43.658673],[5.607155,43.658765],[5.607204,43.65886],[5.60845,43.660411],[5.609115,43.661069],[5.609782,43.66151],[5.610575,43.661925],[5.611665,43.662625],[5.613423,43.663791],[5.613709,43.663962],[5.614288,43.664159],[5.615283,43.664421],[5.616665,43.664745],[5.620338,43.665603],[5.622427,43.666177],[5.623442,43.66628],[5.624117,43.666388],[5.625601,43.666492],[5.62657,43.666653],[5.62734,43.666816],[5.628853,43.667117],[5.629324,43.667205],[5.629921,43.667255],[5.630497,43.667245],[5.631109,43.667265],[5.631593,43.667414],[5.633741,43.668307],[5.635327,43.66905],[5.635786,43.669327],[5.636645,43.669896],[5.638836,43.671235],[5.639663,43.671626],[5.640591,43.671937],[5.641806,43.672177],[5.64232,43.672328],[5.642619,43.672472],[5.643185,43.672836],[5.64373,43.673235],[5.644954,43.674276],[5.645774,43.674693],[5.64683,43.675317],[5.64771,43.675879],[5.647986,43.676154],[5.648472,43.676758],[5.648929,43.677427],[5.649551,43.678025],[5.650799,43.678939],[5.651888,43.679651],[5.652559,43.680537],[5.653027,43.681065],[5.653534,43.681528],[5.654104,43.682312],[5.65472,43.682805],[5.655475,43.68393],[5.655786,43.684297],[5.656801,43.685185],[5.657104,43.685414],[5.657996,43.685953],[5.658705,43.686314],[5.659071,43.68649],[5.65936,43.68662],[5.660002,43.686908],[5.661188,43.687352],[5.663548,43.687815],[5.664282,43.688031],[5.664689,43.688194],[5.666052,43.689291],[5.666981,43.689824],[5.667159,43.689902],[5.667356,43.689993],[5.668317,43.690419],[5.668979,43.690695],[5.669437,43.690946],[5.669676,43.69115],[5.670055,43.691551],[5.670473,43.691987],[5.670689,43.692218],[5.671088,43.692594],[5.671403,43.69282],[5.671729,43.693015],[5.672556,43.693421],[5.673104,43.693582],[5.673528,43.693669],[5.67395,43.693651],[5.67555,43.693125],[5.676021,43.693012],[5.676511,43.692958],[5.676726,43.692946],[5.67709,43.69292],[5.677923,43.692923],[5.67914,43.693025],[5.679705,43.693051],[5.680738,43.693054],[5.682805,43.692808],[5.683368,43.692738],[5.692985,43.691581],[5.69887,43.690884],[5.705913,43.690088],[5.706844,43.690033],[5.707662,43.690011],[5.708621,43.690046],[5.709857,43.69016],[5.71115,43.690395],[5.711824,43.690557],[5.713141,43.690985],[5.713912,43.691288],[5.715205,43.691958],[5.715865,43.692338],[5.716641,43.692881],[5.717039,43.693241],[5.717599,43.69374],[5.71834,43.694513],[5.720611,43.697156],[5.721181,43.697828],[5.722066,43.698755],[5.728265,43.706331],[5.728761,43.707704],[5.729117,43.71135],[5.73154,43.713936],[5.735292,43.716673],[5.735747,43.716909],[5.739303,43.717707],[5.746599,43.719386],[5.753272,43.724402],[5.758353,43.730577],[5.7541,43.734724],[5.753872,43.73524],[5.753683,43.735434],[5.753605,43.735814],[5.753669,43.736058],[5.75352,43.736266],[5.753077,43.736562],[5.751245,43.737887],[5.74902,43.740556],[5.748759,43.740783],[5.744969,43.74306],[5.744554,43.743365],[5.744073,43.743536],[5.743499,43.743654],[5.74342,43.743673],[5.743397,43.743679],[5.743126,43.743745],[5.742892,43.743837],[5.742729,43.743924],[5.742641,43.744047],[5.742312,43.744267],[5.742101,43.744478],[5.741915,43.744589],[5.741684,43.74467],[5.7414,43.744792],[5.741192,43.744927],[5.741036,43.745071],[5.740987,43.745192],[5.740773,43.745237],[5.740003,43.745333],[5.739822,43.745309],[5.739659,43.745255],[5.739568,43.745255],[5.739472,43.745288],[5.739078,43.745805],[5.738973,43.745899],[5.738659,43.746111],[5.738242,43.746349],[5.737802,43.746553],[5.737108,43.746727],[5.737039,43.746726],[5.737018,43.746679],[5.737123,43.746592],[5.737245,43.746536],[5.737202,43.746439],[5.736852,43.746527],[5.736555,43.746652],[5.735162,43.747069],[5.734898,43.747114],[5.734602,43.7471],[5.734565,43.747067],[5.734554,43.747029],[5.734593,43.747],[5.734749,43.746975],[5.734837,43.746931],[5.734854,43.746888],[5.734579,43.746693],[5.734502,43.74667],[5.734329,43.746664],[5.734195,43.746686],[5.734091,43.746728],[5.734051,43.7468],[5.734042,43.746866],[5.733966,43.746905],[5.733819,43.747028],[5.733758,43.747114],[5.733647,43.747204],[5.733479,43.747291],[5.73319,43.747402],[5.732841,43.747505],[5.732677,43.747494],[5.732579,43.747534],[5.732512,43.747725],[5.732459,43.747795],[5.732336,43.747837],[5.732039,43.74786],[5.731874,43.747837],[5.731518,43.747868],[5.731267,43.747928],[5.730792,43.748086],[5.73043,43.748231],[5.730359,43.748299],[5.730324,43.7484],[5.730321,43.748523],[5.730278,43.748641],[5.730174,43.748692],[5.730028,43.748732],[5.729956,43.748787],[5.729885,43.749026],[5.729827,43.749105],[5.729699,43.749175],[5.729514,43.749237],[5.729362,43.749264],[5.72927,43.749317],[5.72923,43.749384],[5.729212,43.749553],[5.729168,43.749669],[5.729024,43.74978],[5.728995,43.749831],[5.728844,43.749942],[5.728766,43.749992],[5.728675,43.750009],[5.728569,43.750007],[5.728106,43.749832],[5.727967,43.749802],[5.727704,43.749837],[5.72744,43.749929],[5.727259,43.750011],[5.72701,43.750203],[5.72697,43.750329],[5.726918,43.750397],[5.726826,43.750436],[5.726713,43.750441],[5.726531,43.750362],[5.726367,43.750351],[5.726159,43.750401],[5.72609,43.750498],[5.726122,43.750664],[5.7261,43.750729],[5.72604,43.750781],[5.725704,43.750961],[5.725649,43.751027],[5.725598,43.751143],[5.725481,43.751534],[5.725372,43.751654],[5.725251,43.75173],[5.724883,43.751775],[5.724608,43.751862],[5.724105,43.752136],[5.723921,43.752252],[5.723588,43.752541],[5.723443,43.752623],[5.723135,43.752755],[5.722987,43.75284],[5.722871,43.752948],[5.722523,43.753362],[5.72199,43.753723],[5.721837,43.75376],[5.721183,43.753707],[5.72092,43.753725],[5.720761,43.753756],[5.720511,43.753834],[5.720391,43.753922],[5.720369,43.754021],[5.720264,43.754078],[5.720054,43.754092],[5.719962,43.754129],[5.719572,43.754386],[5.719019,43.754645],[5.718401,43.754983],[5.717927,43.75517],[5.717616,43.755262],[5.716698,43.755443],[5.716599,43.755499],[5.716398,43.755671],[5.716259,43.75582],[5.71615,43.755998],[5.715766,43.757733],[5.714559,43.762746],[5.714277,43.764306],[5.713877,43.766998],[5.713898,43.773285],[5.713121,43.776598],[5.712677,43.778644],[5.713345,43.779626],[5.713118,43.780256],[5.713141,43.780327],[5.713077,43.780367],[5.712802,43.781097],[5.712804,43.781179],[5.712256,43.781189],[5.711869,43.781163],[5.711591,43.781097],[5.711116,43.78085],[5.710683,43.780593],[5.710121,43.780204],[5.709529,43.779941],[5.708708,43.779672],[5.707806,43.779409],[5.707258,43.779279],[5.706544,43.779445],[5.705708,43.77952],[5.705361,43.779564],[5.704823,43.7796],[5.704144,43.779703],[5.704032,43.780035],[5.704137,43.780468],[5.704057,43.780623],[5.70336,43.781033],[5.702846,43.781121],[5.702551,43.78119],[5.702364,43.781368],[5.702173,43.781764],[5.702079,43.782066],[5.701277,43.782591],[5.700846,43.782855],[5.700516,43.783353],[5.70031,43.783482],[5.700034,43.783598],[5.699696,43.783649],[5.698831,43.783895],[5.698699,43.783865],[5.698507,43.783714],[5.698227,43.783666],[5.698027,43.783698],[5.697108,43.784119],[5.696834,43.784286],[5.696707,43.784339],[5.695997,43.784321],[5.695957,43.78432],[5.695344,43.784227],[5.695139,43.784172],[5.694876,43.784075],[5.694792,43.784083],[5.694602,43.784365],[5.694413,43.784556],[5.694228,43.784582],[5.693974,43.784574],[5.693607,43.784535],[5.692238,43.784544],[5.692058,43.784575],[5.691745,43.7847],[5.69139,43.784908],[5.691115,43.78503],[5.690954,43.785056],[5.690615,43.785067],[5.690463,43.785123],[5.689807,43.785224],[5.689143,43.785404],[5.688825,43.785536],[5.688175,43.786082],[5.687958,43.786194],[5.687604,43.786246],[5.687175,43.786341],[5.686844,43.7865],[5.686524,43.786714],[5.686397,43.786854],[5.686229,43.78695],[5.685858,43.787019],[5.685517,43.787311],[5.68525,43.787754],[5.685142,43.78815],[5.684826,43.788413],[5.684401,43.788944],[5.683911,43.789271],[5.684005,43.789376],[5.684863,43.789992],[5.684782,43.790156],[5.684665,43.790394],[5.684538,43.790565],[5.684011,43.790934],[5.684031,43.791189],[5.683786,43.791971],[5.683731,43.792053],[5.683587,43.792188],[5.683023,43.792521],[5.682533,43.792846],[5.682348,43.793006],[5.682214,43.793156],[5.682016,43.793534],[5.681876,43.79399],[5.681767,43.794416],[5.681616,43.795241],[5.68153,43.79535],[5.681112,43.795637],[5.680923,43.795787],[5.680775,43.795939],[5.680652,43.796092],[5.680285,43.796661],[5.680108,43.797157],[5.680083,43.797369],[5.680087,43.797514],[5.680154,43.797916],[5.680325,43.798414],[5.67785,43.801148],[5.677616,43.801436],[5.677405,43.801806],[5.677296,43.801955],[5.675426,43.803714],[5.674923,43.804009],[5.67455,43.80428],[5.674331,43.80451],[5.674147,43.804784],[5.674164,43.805114],[5.674222,43.805479],[5.67423,43.805653],[5.674356,43.806169],[5.67439,43.806241],[5.674721,43.80642],[5.674456,43.806744],[5.674386,43.806806],[5.674096,43.807239],[5.674209,43.807586],[5.668078,43.809217],[5.665432,43.81072],[5.664266,43.812718],[5.663943,43.812976],[5.660228,43.815691],[5.660073,43.81584],[5.659745,43.816082],[5.659409,43.816358],[5.65842,43.817269],[5.657639,43.817694],[5.657501,43.818099],[5.657048,43.818823],[5.656975,43.818922],[5.65689,43.818992],[5.65669,43.819097],[5.656611,43.819159],[5.656407,43.819473],[5.656474,43.819645],[5.656437,43.819733],[5.656319,43.820901],[5.655931,43.821774],[5.655817,43.822309],[5.655764,43.822481],[5.655512,43.823026],[5.655394,43.823213],[5.655208,43.823403],[5.654587,43.824316],[5.65452,43.82457],[5.654506,43.824746],[5.654575,43.825044],[5.650993,43.825573],[5.646059,43.826338],[5.644883,43.826435],[5.644195,43.826513],[5.643356,43.826661],[5.642926,43.826777],[5.64191,43.827096],[5.639777,43.827654],[5.638117,43.827495],[5.637525,43.827481],[5.637367,43.827493],[5.636292,43.827716],[5.635662,43.82783],[5.635172,43.828039],[5.634448,43.828253],[5.633943,43.828445],[5.633828,43.828477],[5.633234,43.828543],[5.633051,43.828583],[5.632053,43.828893],[5.631493,43.829103],[5.629285,43.829886],[5.629155,43.82995],[5.627853,43.831176],[5.625756,43.831269],[5.623794,43.83105],[5.622035,43.82954],[5.617117,43.830264],[5.614339,43.827659],[5.612736,43.828238],[5.612547,43.828289],[5.611849,43.828423],[5.611162,43.828552],[5.611045,43.828562],[5.607282,43.828352],[5.604811,43.828387],[5.604218,43.828094],[5.603561,43.827738],[5.601364,43.826188],[5.600867,43.826227],[5.595269,43.829179],[5.594323,43.829244],[5.591573,43.829378],[5.589347,43.826909],[5.588548,43.826765],[5.587705,43.827144],[5.586589,43.827168],[5.585986,43.827165],[5.585377,43.827237],[5.58505,43.827249],[5.584755,43.82733],[5.583922,43.827501],[5.583247,43.827698],[5.58297,43.827798],[5.582006,43.828306],[5.581772,43.828383],[5.580174,43.828792],[5.580105,43.828859],[5.579657,43.828917],[5.579107,43.829168],[5.578094,43.829673],[5.576708,43.82997],[5.575792,43.829957],[5.574244,43.82978],[5.57346,43.829567],[5.571271,43.828916],[5.569038,43.828116],[5.568207,43.827782],[5.567981,43.827641],[5.567484,43.827038],[5.567322,43.826815],[5.567015,43.826216],[5.565853,43.823571],[5.564353,43.820245],[5.564078,43.819548],[5.559433,43.821294],[5.552859,43.818548],[5.550735,43.817278],[5.549126,43.816926],[5.545657,43.817292],[5.544425,43.818377],[5.546154,43.827649],[5.546247,43.828041],[5.546795,43.829184],[5.5479,43.831387],[5.548878,43.833389],[5.548864,43.833574],[5.548753,43.83423],[5.548126,43.837626],[5.548643,43.839721],[5.548606,43.842108],[5.548585,43.846074],[5.54871,43.851257],[5.548764,43.851185],[5.548924,43.85104],[5.549023,43.850984],[5.549472,43.850947],[5.549626,43.850964],[5.550054,43.851051],[5.550929,43.851042],[5.551033,43.851051],[5.551796,43.851242],[5.552517,43.851562],[5.552668,43.851633],[5.552852,43.851797],[5.553796,43.852758],[5.553978,43.852838],[5.554366,43.852865],[5.554708,43.852869],[5.555263,43.85329],[5.555383,43.853315],[5.556227,43.854195],[5.557004,43.854759],[5.557839,43.855486],[5.559679,43.856244],[5.561038,43.856851],[5.561678,43.85717],[5.561471,43.857324],[5.561579,43.857384],[5.561672,43.857421],[5.561774,43.857437],[5.562182,43.85742],[5.562824,43.857551],[5.563035,43.857634],[5.563225,43.857773],[5.563595,43.858003],[5.563748,43.858169],[5.563962,43.858478],[5.564183,43.858701],[5.564449,43.859004],[5.56469,43.859398],[5.565075,43.86011],[5.565328,43.86045],[5.565768,43.860946],[5.566028,43.861202],[5.566912,43.861823],[5.567435,43.862068],[5.567845,43.862225],[5.568286,43.86234],[5.568647,43.862409],[5.568914,43.86243],[5.569036,43.862412],[5.569157,43.862376],[5.569345,43.862253],[5.569484,43.862183],[5.570214,43.861998],[5.570645,43.861939],[5.570795,43.861958],[5.571276,43.86186],[5.571483,43.861845],[5.572007,43.861929],[5.572238,43.862002],[5.57271,43.862222],[5.572867,43.862374],[5.573138,43.862708],[5.573295,43.862955],[5.573288,43.863062],[5.573201,43.863375],[5.573528,43.864272],[5.57355,43.864379],[5.573547,43.864521],[5.573349,43.864968],[5.573366,43.865186],[5.573463,43.865609],[5.573649,43.866011],[5.573857,43.866383],[5.573979,43.866667],[5.574225,43.867139],[5.574515,43.867511],[5.574826,43.868142],[5.57516,43.868556],[5.575455,43.869007],[5.57573,43.869359],[5.575907,43.869695],[5.576091,43.869983],[5.576238,43.870336],[5.576566,43.870917],[5.576846,43.871235],[5.57727,43.871834],[5.577949,43.872646],[5.578166,43.872836],[5.578606,43.873143],[5.579288,43.873427],[5.579363,43.873472],[5.579842,43.873946],[5.580321,43.874575],[5.580504,43.874786],[5.580696,43.874961],[5.581128,43.875264],[5.581364,43.875401],[5.582137,43.875744],[5.583013,43.876297],[5.583471,43.876638],[5.58385,43.876895],[5.583903,43.87696],[5.583908,43.877033],[5.583811,43.877211],[5.58355,43.877524],[5.583456,43.8777],[5.583273,43.878148],[5.583232,43.878297],[5.583229,43.878384],[5.583345,43.878777],[5.583579,43.879282],[5.583657,43.879424],[5.584105,43.880083],[5.584263,43.88027],[5.584394,43.880384],[5.584474,43.880434],[5.584649,43.880507],[5.584838,43.88054],[5.585438,43.880508],[5.585893,43.880506],[5.586079,43.88055],[5.586687,43.880847],[5.586902,43.881045],[5.586982,43.881173],[5.587043,43.881341],[5.587149,43.881758],[5.587215,43.882125],[5.58727,43.882665],[5.587263,43.882874],[5.587085,43.883513],[5.586912,43.884025],[5.586873,43.884243],[5.586724,43.884386],[5.586787,43.8847],[5.586873,43.884901],[5.587107,43.885354],[5.587237,43.885559],[5.587463,43.88588],[5.58749,43.885912],[5.58762,43.886176],[5.587819,43.886388],[5.588061,43.886465],[5.588282,43.886484],[5.588374,43.88643],[5.588674,43.886306],[5.589104,43.886287],[5.589272,43.886624],[5.589359,43.886902],[5.58968,43.887095],[5.59011,43.88714],[5.590279,43.887164],[5.589836,43.888279],[5.590792,43.890009],[5.590757,43.890788],[5.591709,43.891443],[5.59235,43.891764],[5.593807,43.892681],[5.594181,43.893134],[5.594267,43.893304],[5.594487,43.893471],[5.594553,43.893542],[5.594634,43.893636],[5.594725,43.893848],[5.595258,43.894417],[5.595309,43.89479],[5.595479,43.895185],[5.595746,43.895624],[5.596966,43.897313],[5.597675,43.89855],[5.59772,43.899165],[5.597984,43.900225],[5.597828,43.902743],[5.598023,43.903442],[5.599209,43.904726],[5.599611,43.90539],[5.600439,43.906187],[5.600604,43.906553],[5.600765,43.906735],[5.601184,43.907093],[5.603373,43.908502],[5.604374,43.909371],[5.605246,43.910249],[5.606085,43.911451],[5.6066,43.912313],[5.606911,43.912924],[5.607328,43.913822],[5.607693,43.914342],[5.608041,43.914653],[5.608288,43.914911],[5.608188,43.915378],[5.606563,43.916268],[5.606503,43.916301],[5.60651,43.916584],[5.606463,43.916648],[5.606386,43.916701],[5.606294,43.916731],[5.606194,43.916738],[5.605904,43.916704],[5.605129,43.915935],[5.605037,43.91566],[5.600357,43.916526],[5.597394,43.916961],[5.595996,43.917144],[5.594201,43.917025],[5.593149,43.916945],[5.591233,43.916746],[5.58919,43.916339],[5.585032,43.915546],[5.583132,43.915137],[5.581576,43.914854],[5.581577,43.914954],[5.581606,43.920143],[5.581634,43.920224],[5.581448,43.92086],[5.581433,43.92107],[5.581469,43.921245],[5.581517,43.921714],[5.581548,43.922074],[5.581539,43.922241],[5.581652,43.922745],[5.581726,43.922884],[5.581767,43.923029],[5.581779,43.923165],[5.581761,43.923418],[5.581894,43.923603],[5.581972,43.923758],[5.582135,43.923901],[5.582023,43.924161],[5.582053,43.924418],[5.581977,43.924709],[5.581501,43.925067],[5.581365,43.925121],[5.581012,43.925413],[5.580853,43.9256],[5.580817,43.925667],[5.580776,43.92583],[5.580681,43.925926],[5.580109,43.926357],[5.58002,43.926496],[5.579837,43.926612],[5.57973,43.926749],[5.579702,43.926816],[5.579694,43.926986],[5.579647,43.927205],[5.578996,43.927649],[5.578271,43.928255],[5.578107,43.928338],[5.577678,43.928494],[5.577473,43.928971],[5.577372,43.929069],[5.577323,43.929153],[5.577145,43.929318],[5.576698,43.92961],[5.576335,43.929796],[5.576009,43.930097],[5.575504,43.930602],[5.575021,43.930946],[5.574645,43.931149],[5.574509,43.93124],[5.574389,43.931351],[5.574304,43.931466],[5.574112,43.931636],[5.573872,43.931909],[5.573778,43.931989],[5.573465,43.932173],[5.573049,43.932484],[5.572616,43.932745],[5.571822,43.93334],[5.57052,43.934499],[5.57047,43.934573],[5.569378,43.935405],[5.568536,43.936218],[5.567597,43.937179],[5.567698,43.937215],[5.567972,43.937725],[5.567943,43.937876],[5.568356,43.938554],[5.569816,43.94018],[5.569845,43.940696],[5.570041,43.941043],[5.569182,43.941714],[5.568506,43.942773],[5.568234,43.942879],[5.56782,43.942827],[5.56712,43.942489],[5.567048,43.942433],[5.566979,43.942318],[5.565837,43.941716],[5.564899,43.942102],[5.564439,43.94229],[5.564309,43.942323],[5.564168,43.942358],[5.563198,43.942508],[5.561606,43.942591],[5.560957,43.942701],[5.559494,43.942743],[5.558764,43.942579],[5.558367,43.942366],[5.557392,43.942124],[5.556339,43.941985],[5.556151,43.941972],[5.555213,43.941755],[5.554156,43.941641],[5.551996,43.94104],[5.551102,43.940727],[5.549936,43.940457],[5.548925,43.940388],[5.545405,43.939383],[5.545288,43.939222],[5.545134,43.93909],[5.544885,43.9389],[5.536893,43.942704],[5.534209,43.943991],[5.531416,43.944902],[5.529294,43.945995],[5.527866,43.946741],[5.526401,43.947501],[5.526018,43.947289],[5.525607,43.947155],[5.525121,43.946913],[5.524185,43.946375],[5.523947,43.946277],[5.52359,43.94621],[5.523505,43.946148],[5.523192,43.945829],[5.523113,43.945777],[5.523005,43.94563],[5.522745,43.945482],[5.52252,43.945283],[5.522045,43.94501],[5.521624,43.944799],[5.521417,43.944804],[5.521289,43.944772],[5.521074,43.944759],[5.520825,43.944812],[5.520533,43.94477],[5.520363,43.944779],[5.52026,43.944746],[5.520129,43.944768],[5.519967,43.94479],[5.519558,43.944934],[5.51941,43.944874],[5.519311,43.94479],[5.519283,43.944732],[5.51923,43.944797],[5.514804,43.944985],[5.512683,43.945325],[5.512496,43.945891],[5.512346,43.946501],[5.512292,43.946548],[5.511951,43.94725],[5.511866,43.9479],[5.511718,43.948564],[5.511627,43.948617],[5.511139,43.949059],[5.510764,43.949588],[5.510278,43.949925],[5.509827,43.950466],[5.509979,43.950699],[5.510025,43.951103],[5.509935,43.951297],[5.50973,43.951366],[5.509657,43.95141],[5.509625,43.951524],[5.509727,43.952009],[5.509595,43.952956],[5.509378,43.953622],[5.509454,43.95423],[5.509385,43.954934],[5.509146,43.955278],[5.509182,43.955713],[5.508591,43.956183],[5.5081,43.956677],[5.507581,43.957341],[5.507819,43.958109],[5.508001,43.958513],[5.508327,43.958851],[5.50844,43.959132],[5.50844,43.959586],[5.508596,43.959742],[5.508803,43.960154],[5.508839,43.960367],[5.509027,43.961127],[5.509258,43.96153],[5.509389,43.9619],[5.50953,43.962003],[5.509694,43.962087],[5.509751,43.962219],[5.509948,43.962445],[5.509923,43.962917],[5.510462,43.963996],[5.511236,43.965471],[5.512449,43.967758],[5.512555,43.969063],[5.512746,43.969867],[5.512851,43.971599],[5.512721,43.972395],[5.512919,43.972407],[5.513112,43.973321],[5.516809,43.984518],[5.51721,43.985888],[5.517639,43.987584],[5.517731,43.99091],[5.517649,43.991024],[5.517721,43.991207],[5.517662,43.991455],[5.517685,43.991614],[5.51801,43.992641],[5.518258,43.992881],[5.518297,43.99298],[5.518418,43.993078],[5.518596,43.993347],[5.518856,43.993611],[5.518895,43.993805],[5.518979,43.993924],[5.519014,43.994041],[5.519297,43.994377],[5.51935,43.994657],[5.519591,43.994939],[5.519868,43.995164],[5.520402,43.995417],[5.520537,43.995507],[5.520902,43.995584],[5.521201,43.995603],[5.521978,43.995912],[5.522916,43.996073],[5.524081,43.996159],[5.524176,43.996222],[5.524636,43.997255],[5.524389,44.002169],[5.524412,44.002235],[5.526721,44.00551],[5.52803,44.007215],[5.531229,44.009127],[5.532027,44.009987],[5.533519,44.011174],[5.535619,44.012844],[5.535707,44.012859],[5.53573,44.013123],[5.535827,44.013405],[5.536786,44.015192],[5.537549,44.016485],[5.538326,44.017686],[5.538292,44.017767],[5.539553,44.019094],[5.539691,44.019333],[5.540133,44.020558],[5.540225,44.020921],[5.541033,44.021788],[5.541336,44.022061],[5.541508,44.022296],[5.542008,44.023077],[5.54244,44.023938],[5.54319,44.025161],[5.543584,44.025949],[5.543636,44.028183],[5.543672,44.028392],[5.543564,44.02932],[5.543586,44.030028],[5.543536,44.030342],[5.543583,44.031373],[5.543681,44.031491],[5.543654,44.031605],[5.543847,44.031942],[5.54387,44.032056],[5.544396,44.032864],[5.544296,44.033623],[5.543622,44.036249],[5.543948,44.037969],[5.544044,44.040176],[5.544087,44.040397],[5.54397,44.040995],[5.544052,44.0416],[5.544102,44.042667],[5.544289,44.043196],[5.544405,44.045187],[5.544283,44.046337],[5.544369,44.046845],[5.545266,44.049273],[5.54537,44.04931],[5.54549,44.049701],[5.544897,44.053192],[5.544878,44.053421],[5.544544,44.053966],[5.544221,44.054578],[5.543886,44.055832],[5.543896,44.056136],[5.54392,44.056892],[5.543744,44.057639],[5.543161,44.059598],[5.54318,44.059804],[5.54312,44.059996],[5.54309,44.060292],[5.542826,44.061131],[5.542823,44.061506],[5.542693,44.061827],[5.542762,44.062384],[5.542749,44.063015],[5.542706,44.063351],[5.542973,44.063851],[5.543226,44.064241],[5.543427,44.064676],[5.543825,44.06529],[5.544122,44.065633],[5.544609,44.066775],[5.545104,44.067621],[5.545204,44.068187],[5.544842,44.070084],[5.539038,44.068462],[5.537736,44.068507],[5.536357,44.068779],[5.533832,44.068264],[5.532196,44.067532],[5.529861,44.066874],[5.528143,44.066462],[5.52769,44.066166],[5.52729,44.066023],[5.527234,44.065983],[5.527012,44.066],[5.52604,44.065704],[5.525734,44.065699],[5.523533,44.064921],[5.523077,44.064861],[5.521946,44.064883],[5.521651,44.064829],[5.521359,44.06483],[5.518602,44.064341],[5.517823,44.064033],[5.517057,44.063801],[5.516796,44.063779],[5.515955,44.063592],[5.515657,44.063573],[5.515428,44.063652],[5.514569,44.0637],[5.513334,44.063848],[5.512179,44.063889],[5.511961,44.063858],[5.51063,44.063923],[5.509373,44.064029],[5.507505,44.063773],[5.506557,44.063752],[5.504996,44.063568],[5.503632,44.063634],[5.502633,44.063531],[5.502706,44.064199],[5.502366,44.06515],[5.501901,44.066067],[5.501322,44.06678],[5.498317,44.072415],[5.498209,44.072955],[5.498151,44.073903],[5.498253,44.073986],[5.498122,44.074381],[5.498126,44.07452],[5.498051,44.074667],[5.498094,44.075352],[5.497911,44.076343],[5.497844,44.076993],[5.497805,44.077644],[5.49777,44.077777],[5.498054,44.078568],[5.498034,44.079133],[5.49802,44.079488],[5.498271,44.081079],[5.498252,44.081194],[5.498407,44.081604],[5.498617,44.082409],[5.499259,44.083196],[5.499448,44.083372],[5.499184,44.085692],[5.499057,44.087389],[5.499205,44.088274],[5.498939,44.088924],[5.49885,44.090531],[5.498871,44.091002],[5.500375,44.093661],[5.500445,44.094019],[5.50059,44.096274],[5.500441,44.097708],[5.500583,44.100279],[5.496423,44.103086],[5.497257,44.103666],[5.497497,44.103773],[5.498036,44.104353],[5.498586,44.104812],[5.499114,44.105032],[5.499669,44.105419],[5.499377,44.105728],[5.499763,44.105945],[5.499655,44.106255],[5.499502,44.107739],[5.49904,44.10817],[5.499235,44.112292],[5.499329,44.115861],[5.498996,44.115936],[5.495731,44.115681],[5.495331,44.115303],[5.494777,44.115181],[5.494625,44.115327],[5.489732,44.116564],[5.486922,44.116978],[5.484664,44.11723],[5.483048,44.117966],[5.48172,44.118114],[5.480627,44.118188],[5.478359,44.118183],[5.476348,44.118275],[5.475845,44.118298],[5.475747,44.118302],[5.474752,44.118348],[5.473989,44.118436],[5.47308,44.118554],[5.47291,44.118576],[5.472906,44.118667],[5.469995,44.119111],[5.466917,44.118577],[5.465298,44.118584],[5.463891,44.118475],[5.463304,44.118332],[5.462743,44.1183],[5.462127,44.118429],[5.461793,44.118446],[5.461408,44.11829],[5.460373,44.118339],[5.457779,44.118893],[5.457263,44.118881],[5.456551,44.119045],[5.455179,44.119111],[5.454637,44.119282],[5.45469,44.119435],[5.454123,44.120082],[5.453299,44.120498],[5.45241,44.120563],[5.451676,44.120757],[5.451019,44.121099],[5.450607,44.121515],[5.449879,44.123162],[5.449207,44.124682],[5.448845,44.125276],[5.448729,44.125656],[5.449762,44.128085],[5.449767,44.128788],[5.449233,44.130152],[5.448923,44.131283],[5.448173,44.132951],[5.447773,44.134481],[5.447463,44.13513],[5.447292,44.135936],[5.447562,44.136761],[5.445216,44.137067],[5.444415,44.137317],[5.443072,44.138263],[5.44222,44.138328],[5.440553,44.137929],[5.439494,44.137799],[5.439081,44.137985],[5.436555,44.139972],[5.436614,44.140932],[5.436896,44.141924],[5.43692,44.142807],[5.436765,44.143771],[5.437397,44.144169],[5.437527,44.144568],[5.437475,44.146023],[5.437423,44.14682],[5.436803,44.147515],[5.43661,44.148024],[5.436894,44.14845],[5.437643,44.149201],[5.437733,44.149386],[5.437552,44.149451],[5.435693,44.15085],[5.435473,44.151304],[5.435706,44.151666],[5.435942,44.152384],[5.435725,44.152333],[5.435443,44.152205],[5.435129,44.152299],[5.434887,44.152308],[5.434724,44.152299],[5.434657,44.152308],[5.434401,44.152379],[5.4342,44.152412],[5.434043,44.152437],[5.433825,44.152412],[5.433627,44.15237],[5.433438,44.152375],[5.43317,44.152391],[5.432952,44.152429],[5.432597,44.152435],[5.432323,44.15241],[5.431977,44.152218],[5.431584,44.151936],[5.431316,44.151789],[5.43115,44.151682],[5.430779,44.151442],[5.43035,44.151282],[5.430003,44.151132],[5.429778,44.150816],[5.429602,44.150545],[5.429646,44.150064],[5.429326,44.149704],[5.429112,44.149529],[5.428852,44.149375],[5.428557,44.149285],[5.428034,44.149152],[5.427796,44.14909],[5.427627,44.149048],[5.427231,44.149044],[5.427027,44.149069],[5.426824,44.149102],[5.426579,44.149127],[5.426306,44.149131],[5.425997,44.149215],[5.425916,44.149259],[5.425689,44.149324],[5.425558,44.149397],[5.425328,44.149577],[5.425218,44.149638],[5.425047,44.149702],[5.424809,44.149722],[5.424509,44.149672],[5.424344,44.149641],[5.424165,44.149584],[5.424019,44.149466],[5.423841,44.149413],[5.423488,44.149586],[5.417638,44.155121],[5.417496,44.155192],[5.417068,44.155308],[5.416732,44.155351],[5.41535,44.155403],[5.414291,44.155219],[5.413479,44.155217],[5.41289,44.155177],[5.41244,44.15505],[5.411888,44.154726],[5.411443,44.154215],[5.410319,44.153512],[5.409847,44.153425],[5.408335,44.153368],[5.405698,44.153822],[5.403913,44.153545],[5.402392,44.153326],[5.401198,44.152991],[5.400925,44.152743],[5.400279,44.152661],[5.399638,44.15257],[5.398949,44.152538],[5.398683,44.152502],[5.398046,44.152364],[5.397141,44.152159],[5.396503,44.152122],[5.39587,44.152134],[5.395315,44.152321],[5.394969,44.152406],[5.394666,44.152555],[5.394505,44.152646],[5.39411,44.152633],[5.393366,44.152559],[5.392397,44.152452],[5.392274,44.152456],[5.392187,44.152481],[5.391864,44.152674],[5.390488,44.153539],[5.390231,44.153656],[5.389644,44.153849],[5.38932,44.153916],[5.388918,44.15396],[5.388285,44.154074],[5.387405,44.154516],[5.386726,44.154921],[5.386596,44.155027],[5.386225,44.155339],[5.385801,44.155646],[5.385627,44.155716],[5.385525,44.155678],[5.385409,44.155485],[5.385345,44.155392],[5.385171,44.155315],[5.384194,44.155312],[5.383099,44.155371]]],[[[4.996378,44.320043],[4.996465,44.320042],[4.997032,44.320036],[4.997293,44.320033],[4.997509,44.319985],[4.997673,44.319872],[4.997921,44.31973],[4.99858,44.319711],[4.999389,44.319732],[5.000287,44.319783],[5.000757,44.319879],[5.000932,44.319979],[5.001177,44.320113],[5.00173,44.320381],[5.002682,44.320791],[5.004304,44.32169],[5.006516,44.322873],[5.008008,44.323627],[5.009093,44.324125],[5.009652,44.324264],[5.011804,44.324884],[5.012136,44.325004],[5.012385,44.325188],[5.012612,44.325361],[5.013065,44.325569],[5.013513,44.325737],[5.01392,44.325855],[5.012051,44.326826],[5.010042,44.327591],[5.009845,44.328037],[5.01038,44.329394],[5.010593,44.331959],[5.010091,44.332872],[5.008749,44.333823],[5.009016,44.334023],[5.009219,44.334224],[5.009339,44.334435],[5.009459,44.334876],[5.00956,44.33496],[5.00981,44.335045],[5.010886,44.335889],[5.011029,44.336112],[5.01164,44.336465],[5.012537,44.336782],[5.012854,44.336759],[5.014554,44.336923],[5.014526,44.338409],[5.014981,44.338939],[5.016202,44.339924],[5.01719,44.34037],[5.017905,44.341133],[5.018477,44.341337],[5.020034,44.341521],[5.020233,44.342504],[5.02083,44.343162],[5.021085,44.343651],[5.021435,44.343884],[5.022351,44.344954],[5.022959,44.345512],[5.023075,44.345794],[5.023424,44.346177],[5.023118,44.34708],[5.023127,44.347207],[5.023267,44.347507],[5.023182,44.347905],[5.022867,44.348142],[5.022397,44.348424],[5.02195,44.34931],[5.021707,44.349625],[5.021711,44.349755],[5.021867,44.350117],[5.021808,44.350244],[5.021947,44.351019],[5.021942,44.351264],[5.021996,44.351498],[5.022202,44.351802],[5.021886,44.351999],[5.021706,44.353149],[5.021719,44.353514],[5.02173,44.353775],[5.021639,44.354124],[5.021644,44.354396],[5.021857,44.354723],[5.022242,44.355557],[5.021916,44.356017],[5.02154,44.356364],[5.021439,44.356706],[5.021475,44.356874],[5.021641,44.356978],[5.021867,44.357538],[5.021963,44.357676],[5.022195,44.358478],[5.022696,44.359343],[5.022671,44.359593],[5.022894,44.359967],[5.02338,44.360265],[5.023913,44.360731],[5.024108,44.360829],[5.027357,44.363038],[5.032382,44.361078],[5.03499,44.363851],[5.03777,44.364355],[5.040278,44.364169],[5.041725,44.363868],[5.042198,44.36233],[5.045354,44.362973],[5.047062,44.363769],[5.048911,44.363888],[5.04957,44.363976],[5.049789,44.364264],[5.051487,44.365392],[5.052077,44.364703],[5.054725,44.364862],[5.057063,44.367654],[5.05763,44.370156],[5.057794,44.37034],[5.05845,44.370997],[5.063955,44.373076],[5.067278,44.373969],[5.068218,44.375001],[5.068704,44.375699],[5.070112,44.376399],[5.071346,44.377521],[5.071927,44.37954],[5.071969,44.380757],[5.071908,44.381016],[5.071711,44.38124],[5.071182,44.381602],[5.071017,44.382382],[5.070772,44.383332],[5.068802,44.38351],[5.068488,44.383111],[5.068235,44.382935],[5.06816,44.382586],[5.068003,44.382397],[5.067711,44.382176],[5.067335,44.381951],[5.066334,44.381788],[5.065775,44.381804],[5.06511,44.38202],[5.0647,44.38233],[5.06435,44.382506],[5.064153,44.38264],[5.064067,44.382751],[5.064107,44.382918],[5.06425,44.383044],[5.064166,44.383641],[5.062769,44.384079],[5.062236,44.384088],[5.060451,44.384319],[5.059704,44.384034],[5.059121,44.383761],[5.058717,44.383653],[5.057367,44.383498],[5.056794,44.383474],[5.055661,44.383143],[5.055547,44.383098],[5.054914,44.382617],[5.054608,44.382309],[5.053913,44.381903],[5.053571,44.381701],[5.052727,44.381701],[5.051844,44.381389],[5.051403,44.381423],[5.050885,44.381499],[5.050401,44.381671],[5.049845,44.381302],[5.048411,44.381257],[5.048099,44.381285],[5.046997,44.381523],[5.046646,44.381466],[5.046567,44.381551],[5.04648,44.38157],[5.046311,44.381539],[5.046278,44.38168],[5.046234,44.381705],[5.046146,44.381742],[5.046081,44.38194],[5.046006,44.381946],[5.045846,44.381944],[5.045731,44.381889],[5.045611,44.381871],[5.045478,44.381898],[5.045324,44.381901],[5.045234,44.381935],[5.045268,44.382049],[5.044951,44.382324],[5.044798,44.382339],[5.044363,44.383119],[5.044388,44.383189],[5.044466,44.383306],[5.044328,44.383431],[5.044304,44.383489],[5.044284,44.383987],[5.044429,44.384431],[5.044425,44.384788],[5.04432,44.384956],[5.04429,44.385341],[5.044106,44.385512],[5.043934,44.385827],[5.043766,44.385981],[5.043631,44.386213],[5.043175,44.386611],[5.042984,44.387175],[5.042419,44.387413],[5.042175,44.387474],[5.041709,44.387487],[5.041452,44.38743],[5.040966,44.387246],[5.040758,44.387268],[5.038766,44.387517],[5.037765,44.387399],[5.037532,44.387309],[5.037061,44.387],[5.03684,44.386902],[5.036726,44.386934],[5.036309,44.387209],[5.036303,44.387323],[5.036563,44.387681],[5.037116,44.388174],[5.0371,44.388318],[5.036944,44.388521],[5.036848,44.388725],[5.03691,44.389159],[5.036785,44.389277],[5.036557,44.389367],[5.036344,44.38937],[5.035908,44.389333],[5.035273,44.389161],[5.035187,44.389246],[5.035139,44.389313],[5.035164,44.389494],[5.035489,44.389956],[5.035483,44.390385],[5.035557,44.390599],[5.03554,44.390773],[5.035382,44.390872],[5.034928,44.390884],[5.03427,44.390785],[5.033458,44.390969],[5.033032,44.391151],[5.032301,44.391245],[5.03175,44.391019],[5.031289,44.390673],[5.030551,44.390824],[5.030257,44.391002],[5.02952,44.391524],[5.029254,44.391717],[5.029044,44.391822],[5.028832,44.391837],[5.028602,44.391828],[5.027677,44.39161],[5.027463,44.391564],[5.02721,44.391575],[5.027095,44.391621],[5.027083,44.391701],[5.027145,44.391967],[5.027096,44.392083],[5.026943,44.392184],[5.026473,44.392329],[5.026226,44.392318],[5.025396,44.391987],[5.022644,44.391231],[5.022036,44.391212],[5.020792,44.391202],[5.020184,44.391382],[5.019324,44.392063],[5.018556,44.393074],[5.01812,44.39331],[5.016413,44.392828],[5.015759,44.392785],[5.015553,44.393074],[5.015328,44.394606],[5.01509,44.39522],[5.014865,44.397139],[5.01482,44.397518],[5.014508,44.400098],[5.014111,44.402168],[5.013655,44.403825],[5.013441,44.40536],[5.01398,44.405723],[5.014261,44.405922],[5.014549,44.406039],[5.01488,44.406255],[5.015224,44.406361],[5.015622,44.406397],[5.016183,44.406525],[5.016454,44.406643],[5.017324,44.407111],[5.017841,44.407406],[5.017165,44.408199],[5.017192,44.408285],[5.018832,44.409234],[5.018906,44.40935],[5.019569,44.409582],[5.019872,44.409935],[5.019897,44.410061],[5.019521,44.411513],[5.019059,44.41328],[5.018828,44.414219],[5.018384,44.415976],[5.017963,44.415863],[5.011593,44.415544],[5.011153,44.413943],[5.011153,44.413019],[5.010694,44.411285],[5.010433,44.410746],[5.010199,44.410836],[5.010018,44.410884],[5.009315,44.411095],[5.008511,44.411277],[5.008011,44.411382],[5.007502,44.411463],[5.006086,44.411792],[5.005197,44.412012],[5.005112,44.412023],[5.005043,44.412035],[5.004985,44.412061],[5.002666,44.412493],[5.002057,44.41257],[5.001504,44.412628],[5.001295,44.412647],[5.001097,44.412712],[5.000772,44.412932],[5.00068,44.413],[5.00025,44.413318],[4.999734,44.413712],[4.99924,44.414103],[4.999139,44.414183],[4.999051,44.414251],[4.998944,44.414334],[4.998662,44.41456],[4.998423,44.41475],[4.997562,44.41542],[4.996986,44.415857],[4.996456,44.416241],[4.996004,44.416627],[4.995806,44.416827],[4.995723,44.416912],[4.995687,44.416947],[4.995394,44.417189],[4.994164,44.418072],[4.993482,44.418582],[4.992326,44.419388],[4.991335,44.420122],[4.990913,44.420441],[4.990556,44.420686],[4.990352,44.42094],[4.990249,44.421026],[4.989622,44.421997],[4.98916,44.422685],[4.988629,44.423173],[4.988063,44.423068],[4.985677,44.423179],[4.984607,44.423086],[4.98195,44.423436],[4.981434,44.423455],[4.978713,44.423482],[4.978403,44.42357],[4.977901,44.424007],[4.97763,44.424864],[4.97741,44.427535],[4.977101,44.428299],[4.976688,44.428747],[4.975334,44.429497],[4.974689,44.430104],[4.974222,44.430915],[4.973709,44.431292],[4.97309,44.43155],[4.972046,44.431504],[4.971258,44.431428],[4.970458,44.43135],[4.969956,44.430989],[4.969763,44.430593],[4.969918,44.430215],[4.970008,44.429681],[4.969763,44.429405],[4.96917,44.429248],[4.968989,44.429018],[4.969312,44.428364],[4.969273,44.428097],[4.969041,44.427692],[4.968422,44.427047],[4.967364,44.426503],[4.966874,44.426144],[4.966526,44.425886],[4.965648,44.425937],[4.965004,44.425776],[4.96454,44.425426],[4.964359,44.425011],[4.964527,44.424265],[4.964424,44.423851],[4.963972,44.423307],[4.963609,44.422267],[4.963299,44.421962],[4.962148,44.421759],[4.961903,44.421538],[4.961593,44.421427],[4.961192,44.421021],[4.960364,44.420457],[4.959465,44.41981],[4.957602,44.419789],[4.9569,44.42007],[4.956086,44.420079],[4.954638,44.420448],[4.954095,44.420347],[4.953849,44.420217],[4.953642,44.419562],[4.953384,44.419433],[4.952673,44.41935],[4.951904,44.419161],[4.951884,44.419109],[4.951458,44.418879],[4.950889,44.41838],[4.95005,44.418026],[4.949388,44.417531],[4.948144,44.416783],[4.947797,44.416576],[4.947269,44.41585],[4.946158,44.414834],[4.945524,44.414576],[4.94458,44.414354],[4.943275,44.414271],[4.941038,44.414714],[4.94003,44.41477],[4.939216,44.414576],[4.937605,44.413193],[4.937099,44.412877],[4.936191,44.412618],[4.93504,44.412157],[4.933886,44.411926],[4.932799,44.411871],[4.93053,44.411845],[4.929413,44.411822],[4.928412,44.411661],[4.927964,44.411433],[4.927248,44.410757],[4.926698,44.410465],[4.92611,44.409935],[4.925739,44.409085],[4.925368,44.408783],[4.924831,44.408592],[4.923833,44.408126],[4.923424,44.408098],[4.923309,44.408199],[4.922861,44.409204],[4.922414,44.409496],[4.921838,44.409496],[4.921314,44.409204],[4.920508,44.40914],[4.919766,44.408793],[4.919395,44.408098],[4.919021,44.407833],[4.9185,44.407809],[4.917727,44.406529],[4.91683,44.405342],[4.91603,44.404286],[4.915867,44.40407],[4.915577,44.403787],[4.914403,44.40193],[4.91373,44.401214],[4.913246,44.400611],[4.913057,44.400375],[4.912779,44.400061],[4.912577,44.399825],[4.912209,44.399396],[4.910248,44.397199],[4.909667,44.396728],[4.909588,44.396426],[4.909641,44.395917],[4.90994,44.39555],[4.910155,44.395314],[4.910551,44.393203],[4.91067,44.392175],[4.911147,44.391566],[4.911236,44.390955],[4.91187,44.387896],[4.911765,44.387057],[4.911345,44.38583],[4.910687,44.383809],[4.909189,44.378673],[4.908951,44.377365],[4.908493,44.376442],[4.907888,44.375903],[4.90739,44.375557],[4.907094,44.374768],[4.907074,44.374635],[4.906584,44.374084],[4.905923,44.373749],[4.905667,44.373576],[4.90486,44.373095],[4.903851,44.372768],[4.902921,44.37249],[4.902927,44.372392],[4.902725,44.371901],[4.902706,44.371846],[4.902518,44.37129],[4.902341,44.371276],[4.901319,44.370426],[4.901248,44.370297],[4.901193,44.37025],[4.901105,44.370223],[4.900614,44.369841],[4.900393,44.369678],[4.900267,44.369588],[4.900192,44.36955],[4.900146,44.369534],[4.899989,44.36952],[4.899745,44.3695],[4.8995,44.369488],[4.8991,44.369445],[4.898694,44.369404],[4.898342,44.369374],[4.898254,44.369366],[4.898022,44.369355],[4.897547,44.369331],[4.897251,44.369325],[4.896854,44.369339],[4.896231,44.369339],[4.895438,44.369327],[4.894826,44.369304],[4.894744,44.369301],[4.894712,44.36916],[4.894623,44.368956],[4.894131,44.368571],[4.893905,44.368315],[4.893632,44.368105],[4.893259,44.367984],[4.893038,44.367708],[4.893044,44.367526],[4.893172,44.367248],[4.893154,44.366912],[4.89321,44.366588],[4.892982,44.365494],[4.89288,44.36524],[4.892929,44.364846],[4.892946,44.364753],[4.893171,44.363766],[4.892897,44.363329],[4.892366,44.361676],[4.891991,44.361293],[4.891516,44.361006],[4.891152,44.360323],[4.890688,44.359723],[4.889969,44.359556],[4.889225,44.359065],[4.888801,44.358849],[4.887853,44.358465],[4.887666,44.358514],[4.887382,44.358544],[4.887101,44.358493],[4.885311,44.358113],[4.885158,44.358005],[4.884914,44.35716],[4.884941,44.356937],[4.884847,44.356542],[4.884535,44.356382],[4.88422,44.356304],[4.883998,44.356098],[4.883565,44.355865],[4.883383,44.35579],[4.883247,44.355733],[4.883157,44.355696],[4.882862,44.355754],[4.882511,44.355974],[4.882288,44.356051],[4.882108,44.35601],[4.881627,44.355795],[4.881208,44.355518],[4.880965,44.35537],[4.880524,44.355214],[4.880387,44.355105],[4.880326,44.354885],[4.880662,44.354355],[4.880968,44.354053],[4.881091,44.353886],[4.881076,44.353767],[4.8809,44.353628],[4.880556,44.353516],[4.880138,44.353475],[4.879588,44.353463],[4.877442,44.352902],[4.876997,44.352622],[4.876644,44.352411],[4.876289,44.352052],[4.876059,44.351686],[4.875614,44.351482],[4.874949,44.351261],[4.874635,44.351089],[4.874428,44.351068],[4.874363,44.351103],[4.874301,44.351389],[4.874236,44.35151],[4.874133,44.35154],[4.873247,44.351465],[4.873265,44.350854],[4.873154,44.350632],[4.872777,44.35041],[4.87209,44.349974],[4.871381,44.349475],[4.870295,44.34858],[4.870062,44.348271],[4.870243,44.347639],[4.8703,44.347417],[4.870246,44.346915],[4.870295,44.346575],[4.870201,44.346032],[4.869896,44.345469],[4.869523,44.345083],[4.874622,44.345119],[4.874788,44.345064],[4.879563,44.345285],[4.879806,44.345299],[4.879993,44.345215],[4.880333,44.345071],[4.880687,44.344938],[4.880954,44.34483],[4.881037,44.344795],[4.881067,44.344781],[4.881018,44.344756],[4.881532,44.344547],[4.881997,44.344355],[4.882464,44.344153],[4.883405,44.343841],[4.883655,44.343743],[4.884006,44.343603],[4.884258,44.343484],[4.884772,44.343263],[4.886006,44.342735],[4.886102,44.342688],[4.8862,44.34263],[4.886309,44.342557],[4.886435,44.34246],[4.886542,44.342387],[4.886721,44.342282],[4.886966,44.342164],[4.887279,44.342018],[4.887708,44.341827],[4.888342,44.341557],[4.888681,44.341428],[4.889008,44.341278],[4.890155,44.340782],[4.89031,44.340723],[4.890532,44.340633],[4.890634,44.340592],[4.890734,44.340545],[4.891483,44.340182],[4.892084,44.339865],[4.89257,44.339617],[4.893056,44.339366],[4.893597,44.33907],[4.893679,44.339026],[4.894697,44.338554],[4.895318,44.33819],[4.895398,44.338143],[4.895736,44.337994],[4.894881,44.33525],[4.894405,44.332995],[4.89338,44.333142],[4.892894,44.333169],[4.892793,44.333175],[4.892468,44.333168],[4.891983,44.333174],[4.891775,44.333176],[4.890678,44.333136],[4.889946,44.333099],[4.889453,44.333086],[4.889101,44.332463],[4.887677,44.331133],[4.885842,44.329668],[4.883507,44.327525],[4.882405,44.326242],[4.881635,44.324819],[4.882074,44.324197],[4.883159,44.32234],[4.883966,44.320747],[4.88424,44.320481],[4.884434,44.32029],[4.884624,44.319976],[4.884644,44.319842],[4.884682,44.319767],[4.884847,44.31938],[4.88514,44.318984],[4.885749,44.31846],[4.886166,44.318166],[4.886521,44.317801],[4.88763,44.316607],[4.888047,44.31629],[4.888759,44.315639],[4.889162,44.31538],[4.890064,44.314647],[4.89089,44.31386],[4.891657,44.313334],[4.891622,44.312937],[4.891489,44.31237],[4.891613,44.311538],[4.891597,44.310118],[4.891635,44.308179],[4.891538,44.307373],[4.891378,44.306782],[4.891185,44.306033],[4.890981,44.30558],[4.890412,44.304951],[4.889978,44.304559],[4.889477,44.304197],[4.889291,44.304041],[4.88929,44.304033],[4.889487,44.304061],[4.890067,44.304142],[4.890582,44.304215],[4.89144,44.304332],[4.891788,44.304397],[4.892208,44.304502],[4.893108,44.30469],[4.893817,44.304857],[4.894222,44.304952],[4.896811,44.305552],[4.897125,44.305614],[4.897644,44.305686],[4.89828,44.305717],[4.898643,44.305709],[4.899147,44.30567],[4.90072,44.305545],[4.901078,44.305537],[4.901216,44.305547],[4.902319,44.30568],[4.903564,44.305829],[4.904373,44.305925],[4.905567,44.306054],[4.906584,44.306167],[4.907455,44.306192],[4.908022,44.306336],[4.90859,44.306512],[4.909395,44.306842],[4.910124,44.307142],[4.910747,44.307295],[4.911215,44.307378],[4.911586,44.307443],[4.912648,44.307628],[4.913055,44.307666],[4.913955,44.307817],[4.914654,44.307966],[4.914865,44.308021],[4.915405,44.308162],[4.916666,44.308491],[4.917165,44.308649],[4.917379,44.308687],[4.91788,44.30874],[4.918627,44.308728],[4.918978,44.308733],[4.91978,44.308777],[4.920285,44.308831],[4.920821,44.308869],[4.921306,44.308871],[4.921905,44.308921],[4.921959,44.308859],[4.921936,44.30868],[4.924755,44.308528],[4.9287,44.307808],[4.933396,44.307094],[4.935078,44.306845],[4.936325,44.306481],[4.939288,44.306093],[4.944278,44.30593],[4.946893,44.303519],[4.947578,44.303433],[4.94825,44.303453],[4.948314,44.303387],[4.948377,44.303352],[4.949052,44.303191],[4.949567,44.302838],[4.950146,44.302427],[4.950473,44.301875],[4.950816,44.301219],[4.951003,44.301077],[4.951314,44.301016],[4.952209,44.301043],[4.952498,44.300989],[4.952702,44.301112],[4.953023,44.3012],[4.953758,44.301285],[4.955018,44.301521],[4.95527,44.301607],[4.95553,44.301747],[4.955666,44.301824],[4.955838,44.301965],[4.955967,44.302084],[4.956132,44.3022],[4.956405,44.302366],[4.956642,44.302426],[4.957089,44.30254],[4.9573,44.302593],[4.957492,44.302226],[4.9576,44.302094],[4.957975,44.301894],[4.958205,44.30171],[4.958338,44.301556],[4.958838,44.300974],[4.95925,44.300498],[4.959418,44.300218],[4.959455,44.299666],[4.959378,44.299366],[4.959383,44.299004],[4.959436,44.298875],[4.960935,44.29898],[4.96222,44.299433],[4.964941,44.299431],[4.965087,44.299363],[4.968806,44.299182],[4.970353,44.299006],[4.972828,44.299093],[4.974382,44.298056],[4.974927,44.297907],[4.980059,44.297455],[4.980782,44.296763],[4.981158,44.29657],[4.98137,44.296461],[4.982007,44.295985],[4.982477,44.295385],[4.983158,44.295032],[4.984019,44.294656],[4.984597,44.294369],[4.98503,44.294153],[4.985287,44.293916],[4.985567,44.293658],[4.986988,44.292543],[4.987135,44.292632],[4.987192,44.292925],[4.987377,44.29311],[4.98753,44.293384],[4.987965,44.293871],[4.988088,44.294183],[4.988338,44.294338],[4.988375,44.294402],[4.988289,44.294584],[4.988459,44.295527],[4.988453,44.295964],[4.988839,44.296798],[4.988522,44.297675],[4.988456,44.298187],[4.988185,44.298604],[4.988032,44.298731],[4.987913,44.299066],[4.987761,44.299362],[4.987788,44.299581],[4.987691,44.299658],[4.987632,44.299796],[4.987659,44.299992],[4.987782,44.300092],[4.987729,44.300364],[4.987755,44.300721],[4.987611,44.300975],[4.987852,44.301165],[4.987986,44.301608],[4.987898,44.301754],[4.987911,44.301854],[4.988048,44.301965],[4.988276,44.302113],[4.988234,44.302225],[4.988228,44.302587],[4.988305,44.302935],[4.988528,44.303399],[4.989135,44.30433],[4.989256,44.305154],[4.989241,44.30539],[4.989632,44.305989],[4.990055,44.307349],[4.989928,44.307585],[4.98977,44.308116],[4.989872,44.308518],[4.99055,44.309655],[4.990905,44.310071],[4.990883,44.310453],[4.991227,44.31089],[4.991005,44.311458],[4.991036,44.311734],[4.991315,44.312065],[4.991757,44.312246],[4.99227,44.312538],[4.992514,44.313091],[4.992583,44.313351],[4.992583,44.313754],[4.992605,44.313881],[4.99276,44.314],[4.99327,44.314184],[4.993565,44.314226],[4.993939,44.315006],[4.99571,44.316439],[4.996011,44.31656],[4.996301,44.316809],[4.99663,44.316964],[4.996709,44.317147],[4.996961,44.317093],[4.997261,44.317228],[4.997995,44.317409],[4.998927,44.317462],[4.999477,44.317528],[5.000148,44.317814],[5.000088,44.317936],[5.000134,44.318024],[5.000354,44.318109],[5.000834,44.31819],[5.00081,44.318299],[5.000715,44.318389],[5.000582,44.318435],[5.000402,44.318437],[5.00023,44.318398],[5.000041,44.318311],[4.999595,44.318131],[4.999322,44.318077],[4.999172,44.318074],[4.99899,44.318109],[4.998525,44.318253],[4.998348,44.318326],[4.998264,44.31836],[4.997873,44.318629],[4.997226,44.319164],[4.996822,44.319599],[4.996473,44.319966],[4.996378,44.320043]]]]},"properties":{"@id":"relation/7445","ISO3166-2":"FR-84","admin_level":"6","border_type":"departement","boundary":"administrative","name":"Vaucluse","name:ar":"\u0641\u0648\u0643\u0644\u0648\u0632","name:br":"Vauclusa","name:ca":"Valclusa","name:el":"\u0392\u03c9\u03ba\u03bb\u03cd\u03b6","name:ru":"\u0412\u043e\u043a\u043b\u044e\u0437","ref":"84","ref:INSEE":"84","ref:NUTS":"FR826","source:name:br":"ofis publik ar brezhoneg","type":"boundary","wikidata":"Q12792","wikipedia":"fr:Vaucluse (d\u00e9partement)"},"id":"Wl8Ij"}]};

        // Charger la limite départementale du Vaucluse depuis les données embarquées
        async function loadVaucluseBoundary() {
            try {
                // Utiliser les données GeoJSON embarquées
                const geojsonData = vaucluseGeoJSON;
                
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
                
                console.log('✓ Limite départementale chargée depuis les données embarquées');
                
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
            .setContent('<div style="text-align: center; padding: 10px;"><strong>Chargement des routes départementales...</strong><br><small>Récupération des tracés réels depuis OpenStreetMap</small></div>')
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
                    .setContent('<div style="padding: 10px;"><strong>⚠️ Routes non disponibles</strong><br><small>Impossible de charger depuis OpenStreetMap.<br>Vérifiez votre connexion.</small></div>')
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
        
        async function loadWeather() {
            try {
                // Coordonnées d'Avignon (chef-lieu du Vaucluse)
                const lat = 43.9493;
                const lon = 4.8055;
                
                // API Open-Meteo (gratuite, pas de clé nécessaire)
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Europe/Paris`;
                
                const response = await fetch(url);
                const data = await response.json();
                
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
                    
                    document.getElementById('weatherIcon').textContent = icon;
                    document.getElementById('weatherTemp').textContent = `${temp}°C`;
                    document.getElementById('weatherDesc').textContent = `${desc} • Avignon`;
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

        // ========== WAZE TRAFFIC ==========
        // (fonction définie globalement en haut du script)

        // Charger les données de comptage depuis Datasud ou data.gouv.fr
        async function loadTrafficCountingData() {
            console.log('🚦 === DÉBUT CHARGEMENT STATIONS DE COMPTAGE ===');
            
            // Sources de données (par ordre de priorité)
            const dataSources = [
                {
                    name: 'Datasud',
                    url: 'https://trouver.datasud.fr/dataset/73b8b0c8-5867-49e9-9adb-6c4e99e62d76/resource/bc50e6cd-e2fb-4e27-a50b-9e71bd44bf64/download/comptages-permanents-reseau-routier-departement-vaucluse.geojson'
                },
                {
                    name: 'data.gouv.fr',
                    url: 'https://static.data.gouv.fr/resources/comptages-permanents-sur-le-reseau-routier-du-departement-de-vaucluse-depuis-1996/20240724-144159/comptages-permanents-reseau-routier-departement-vaucluse.geojson'
                }
            ];

            let geojsonData = null;
            let sourceUsed = null;

            // Essayer chaque source jusqu'à en trouver une qui fonctionne
            for (const source of dataSources) {
                try {
                    console.log(`📡 Tentative de chargement depuis ${source.name}...`);
                    console.log(`   URL: ${source.url}`);
                    
                    const response = await fetch(source.url);
                    console.log(`   Status: ${response.status} ${response.statusText}`);
                    
                    if (response.ok) {
                        geojsonData = await response.json();
                        sourceUsed = source.name;
                        console.log(`✓ Données chargées depuis ${source.name}`);
                        console.log(`   Type: ${typeof geojsonData}`);
                        console.log(`   Features: ${geojsonData.features ? geojsonData.features.length : 'N/A'}`);
                        break;
                    } else {
                        console.warn(`   ❌ Échec HTTP ${response.status}`);
                    }
                } catch (error) {
                    console.warn(`❌ Échec du chargement depuis ${source.name}:`, error.message);
                }
            }

            if (!geojsonData || !geojsonData.features) {
                console.error('❌ AUCUNE SOURCE DE DONNÉES DISPONIBLE');
                console.error('   Datasud: échec');
                console.error('   data.gouv.fr: échec');
                console.warn('⚠️ Utilisation de données de démonstration (local)');

                if (window.COMPTAGES_GEOJSON && window.COMPTAGES_GEOJSON.features) {
                    geojsonData = window.COMPTAGES_GEOJSON;
                    sourceUsed = 'Données de démonstration (local préchargé)';
                } else {
                    try {
                        const localResponse = await fetch('csv/comptages_demo.geojson');
                        if (localResponse.ok) {
                            geojsonData = await localResponse.json();
                            sourceUsed = 'Données de démonstration (local)';
                        } else {
                            console.error(`❌ Échec du chargement des données locales: HTTP ${localResponse.status}`);
                        }
                    } catch (error) {
                        console.error('❌ Échec du chargement des données locales:', error);
                    }
                }
                
                if (geojsonData && geojsonData.features) {
                    L.popup()
                        .setLatLng([44.0, 5.0])
                        .setContent('<div style="padding: 15px; text-align: center;"><strong>⚠️ Stations de comptage</strong><br><small>APIs externes indisponibles<br><br><strong>5 stations de démonstration affichées</strong><br><br>Pour les données réelles, vérifiez :<br>• Connexion réseau<br>• URLs Datasud/data.gouv.fr</small></div>')
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
                const stationId = props.section_compteur;
                const year = parseInt(props.annee);
                
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
                
                const routeName = props.nom_route_cd ?? props.nom_route ?? props.route ?? props.ref ?? 'N/A';
                const sectionName = props.section_compteur ?? props.section ?? props.id_station ?? props.id ?? 'N/A';
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
            const years = Object.values(latestDataByStation).map(d => d.year);
            const latestYear = years.length ? Math.max(...years) : 'N/A';
            
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

        // Charger les données d'accidentologie depuis csv/accidents_vaucluse.geojson
        async function loadAccidentData() {
            try {
                console.log('📊 Chargement des données d\'accidentologie...');

                const accidentsGeoJSON = window.ACCIDENTS_GEOJSON;
                let dataToUse = accidentsGeoJSON;
                if (!dataToUse) {
                    const response = await fetch('csv/accidents_vaucluse.geojson');
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    dataToUse = await response.json();
                }

                if (!dataToUse || !dataToUse.features) {
                    throw new Error('Données d\'accidentologie invalides');
                }

                const stats = dataToUse.metadata?.statistiques || {};
                const features = dataToUse.features;
                
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
                
                // API Info Routière - Événements routiers
                // Format : GeoJSON des événements (chantiers, bouchons, accidents)
                const apiUrl = 'https://diffusion-numerique.info-routiere.gouv.fr/api/v2/events.geojson';
                
                const response = await fetch(apiUrl);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                
                if (!data.features || data.features.length === 0) {
                    console.log('ℹ️ Aucun événement Bison Futé actuellement dans la zone');
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
            L.circleMarker(city.coords, {
                radius: radius,
                fillColor: '#2C3E50',
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9
            }).addTo(window.map).bindPopup(`<strong>${city.name}</strong>`);
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
    
