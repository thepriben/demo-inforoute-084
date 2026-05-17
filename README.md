# Demo Inforoute 084

Site statique de démonstration pour visualiser le réseau routier départemental du Vaucluse.

## Données GeoJSON

Les donnees OSM utilisees par la carte sont servies en GeoJSON statique dans `data/osm/*.geojson`. Le rafraichissement fait les vraies requetes Overpass, puis convertit le resultat en GeoJSON:

```bash
python3 scripts/refresh_overpass_cache.py
```

Le script envoie un `User-Agent` explicite a Overpass:

```text
demo-inforoute-084/0.1.0 (https://github.com/thepriben/demo-inforoute-084)
```

Le site reste compatible GitHub Pages: le navigateur ne requete plus Overpass au runtime, il lit uniquement les GeoJSON statiques.

## Publication GitHub Pages

1. Creer le depot `thepriben/demo-inforoute-084`.
2. Pousser cette arborescence sur la branche `main`.
3. Dans GitHub, activer Pages avec la source `GitHub Actions`.
4. L'action `Deploy GitHub Pages` publie automatiquement le site.
5. L'action `Refresh Overpass Cache` peut etre lancee manuellement et tourne aussi chaque lundi.

## Lancement local

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.
