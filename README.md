> Concepteur du projet : Jean-Louis Zimmermann @[JLZIMMERMANN](https://github.com/JLZIMMERMANN).

---

<img width="1915" height="951" alt="image" src="https://github.com/user-attachments/assets/a0abcb01-5bd8-48db-afe9-19465384e6df" />

---

# Démo Inforoute 084

Prototype de carte web pour explorer le réseau routier départemental du Vaucluse. L'objectif est de montrer, de façon concrète, ce qu'un outil léger pourrait apporter à un service routes du Conseil départemental de Vaucluse : lecture rapide du réseau, croisement avec l'accidentologie, repérage des points de comptage et première vérification de la qualité des données OpenStreetMap.

## Ce que montre la carte

- Le réseau départemental du Vaucluse, avec une hiérarchie simple : réseau régional, territorial et local.
- La limite du département et les communes, pour replacer les routes dans leur contexte territorial.
- Les stations de comptage CD84, classées par niveau de trafic.
- L'accidentologie fournie pour 2024, affichable à la demande pour ne pas surcharger la carte.
- Les routes en construction ou en projet issues du cache OSM.
- Une météo actuelle sur Avignon, utile comme signal opérationnel rapide.
- Un panneau de qualité OSM pour repérer les tronçons qui ont ou non une relation OSM exploitable.

## Intérêt pour le CD84

Le prototype sert surtout à rendre les données routières lisibles dans une interface unique. Pour un agent ou un responsable métier, il permet de répondre rapidement à des questions simples :

- Où sont les routes départementales les plus structurantes ?
- Quelles routes portent les plus forts trafics selon les comptages disponibles ?
- Où les accidents du millésime chargé se concentrent-ils ?
- Quelles communes sont concernées par une route ou un axe ?
- Quels tronçons OSM sont bien documentés, et lesquels méritent une correction ?
- Est-ce qu'un fichier publié sur data.gouv.fr ou une extraction OSM peut être exploité sans appeler des API à chaque visite ?

## Fraîcheur des données

La page indique les données externes rafraîchies toutes les 3 heures. Le principe est volontairement simple : le navigateur lit des fichiers GeoJSON locaux, et les scripts de mise à jour régénèrent ces fichiers.

- Données statiques : routes, limite départementale, communes, accidentologie et fallback de démonstration.
- Données rafraîchies toutes les 3 h : comptages CD84 depuis data.gouv.fr et événements Info Routière.
- Donnée dynamique directe : météo Open-Meteo, demandée par le navigateur au chargement puis toutes les 10 minutes.
- Overpass API : jamais appelé par le navigateur. Il sert uniquement dans le script d'actualisation OSM.

## Cohérence des millésimes

État du jeu de données versionné dans ce dépôt :

| Donnée | Source | Millésime ou fraîcheur | Commentaire |
| --- | --- | --- | --- |
| Routes départementales | OpenStreetMap | cache du 2026-05-17 22:52 UTC | Données réseau, pas un millésime administratif CD84. |
| Routes en construction | OpenStreetMap | cache du 2026-05-17 22:53 UTC | Quelques ouvertures indiquées entre 2025 et 2027 selon les tags OSM. |
| Communes | OpenStreetMap | cache du 2026-05-17 22:53 UTC | 151 communes ; les tags de population pointent vers 2021. |
| Limite du Vaucluse | OpenStreetMap | GeoJSON local | Limite départementale 84, figée dans `data/static/`. |
| Accidentologie | Fichier fourni / BAAC | 2024 | 113 accidents, tous datés de 2024. |
| Comptages CD84 | data.gouv.fr | 1996-2025 | 3 098 observations ; la carte affiche la dernière année disponible par station. |
| Événements routiers | Info Routière | cache toutes les 3 h | Le cache actuel contient 0 événement ; la source était indisponible au dernier rafraîchissement local. |
| Météo | Open-Meteo | temps courant | Appel direct, non versionné. |

## Lancer la démo en local

```bash
python3 -m http.server 8080
```

Puis ouvrir :

```text
http://localhost:8080/
```

## Topo technique

L'architecture des données est séparée par usage :

- `data/osm/` : GeoJSON issus d'OpenStreetMap et générés par Overpass via un script.
- `data/static/` : GeoJSON figés, comme la limite du Vaucluse et l'accidentologie 2024.
- `data/external/` : GeoJSON rafraîchis automatiquement depuis des sources externes.
- `data/demo/` : données de secours pour garder une carte exploitable si une source manque.

`js/config.js` centralise les chemins de fichiers et les sources dynamiques. `js/api.js` fournit un chargeur JSON/GeoJSON avec cache navigateur. `js/app.js` ne contient plus de gros blocs GeoJSON embarqués : il lit les fichiers déclarés dans la configuration.

Deux scripts Python maintiennent les données :

```bash
python3 scripts/update_osm_geojson.py
python3 scripts/update_external_data.py
```

`scripts/update_osm_geojson.py` interroge Overpass avec un `User-Agent` explicite :

```text
demo-inforoute-084/0.1.0 (https://github.com/thepriben/demo-inforoute-084)
```

`scripts/update_external_data.py` matérialise les données data.gouv.fr et Info Routière dans `data/external/`. Si Info Routière est indisponible, le script conserve un GeoJSON vide avec l'erreur dans `_cache`, ce qui évite de casser la page.
