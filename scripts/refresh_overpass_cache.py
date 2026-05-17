#!/usr/bin/env python3
"""Refresh static GeoJSON files from Overpass for the GitHub Pages site."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "osm"
ENDPOINT = os.environ.get("OVERPASS_ENDPOINT", "https://overpass-api.de/api/interpreter")
APP_NAME = os.environ.get("APP_NAME", "demo-inforoute-084")
APP_VERSION = os.environ.get("APP_VERSION", "0.1.0")
REPOSITORY = os.environ.get("APP_REPOSITORY", "https://github.com/thepriben/demo-inforoute-084")
USER_AGENT = os.environ.get("OVERPASS_USER_AGENT", f"{APP_NAME}/{APP_VERSION} ({REPOSITORY})")


QUERIES = {
    "departmental-roads": """
        [out:json][timeout:60];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          way(area.dept)["highway"]["ref"~"^D ?[0-9]+$"];
          relation(area.dept)["type"="route"]["route"="road"]["ref"~"^D ?[0-9]+$"];
        );
        out geom;
        out tags;
    """,
    "construction-roads": """
        [out:json][timeout:60];
        (
          area["ISO3166-2"="FR-84"]->.dept;
          way(area.dept)["highway"="construction"];
          way(area.dept)["construction"="highway"];
          way(area.dept)["construction"]["highway"];
          way(area.dept)["construction:highway"];
          way(area.dept)["highway"="proposed"];
          way(area.dept)["proposed"="highway"];
          way(area.dept)["proposed:highway"];
          way(43.6,4.5,44.4,5.9)["highway"="construction"];
          way(43.6,4.5,44.4,5.9)["construction"]["highway"];
          way(43.6,4.5,44.4,5.9)["highway"="proposed"];
        );
        out geom;
    """,
    "communes-vaucluse": """
        [out:json][timeout:60];
        area["ISO3166-2"="FR-84"]->.dept;
        relation(area.dept)["boundary"="administrative"]["admin_level"="8"];
        out geom;
    """,
}


def request_overpass(query: str) -> dict[str, Any]:
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_ref(value: str | None) -> str:
    if not value:
        return ""
    return value.replace(" ", "").upper()


def point_key(coord: list[float]) -> tuple[float, float]:
    return round(coord[0], 7), round(coord[1], 7)


def element_properties(element: dict[str, Any]) -> dict[str, Any]:
    properties = dict(element.get("tags") or {})
    properties["osm_type"] = element.get("type")
    properties["osm_id"] = element.get("id")
    properties["@id"] = f"{element.get('type')}/{element.get('id')}"
    return properties


def way_to_feature(element: dict[str, Any], extra_properties: dict[str, Any] | None = None) -> dict[str, Any] | None:
    coordinates = [
        [point["lon"], point["lat"]]
        for point in element.get("geometry", [])
        if "lon" in point and "lat" in point
    ]

    if len(coordinates) < 2:
        return None

    properties = element_properties(element)
    if extra_properties:
        properties.update(extra_properties)

    return {
        "type": "Feature",
        "id": properties["@id"],
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "properties": properties,
    }


def assemble_rings(segments: list[list[list[float]]]) -> list[list[list[float]]]:
    pending = [segment[:] for segment in segments if len(segment) >= 2]
    rings: list[list[list[float]]] = []

    while pending:
        ring = pending.pop(0)
        changed = True

        while point_key(ring[0]) != point_key(ring[-1]) and changed:
            changed = False
            for index, segment in enumerate(pending):
                if point_key(ring[-1]) == point_key(segment[0]):
                    ring.extend(segment[1:])
                elif point_key(ring[-1]) == point_key(segment[-1]):
                    ring.extend(reversed(segment[:-1]))
                elif point_key(ring[0]) == point_key(segment[-1]):
                    ring = segment[:-1] + ring
                elif point_key(ring[0]) == point_key(segment[0]):
                    ring = list(reversed(segment[1:])) + ring
                else:
                    continue

                pending.pop(index)
                changed = True
                break

        if point_key(ring[0]) != point_key(ring[-1]):
            ring.append(ring[0])

        if len(ring) >= 4:
            rings.append(ring)

    return rings


def relation_member_segments(relation: dict[str, Any], role: str) -> list[list[list[float]]]:
    segments: list[list[list[float]]] = []

    for member in relation.get("members", []):
        if member.get("role") != role:
            continue

        coordinates = [
            [point["lon"], point["lat"]]
            for point in member.get("geometry", [])
            if "lon" in point and "lat" in point
        ]

        if len(coordinates) >= 2:
            segments.append(coordinates)

    return segments


def relation_to_polygon_feature(relation: dict[str, Any]) -> dict[str, Any] | None:
    outer_rings = assemble_rings(relation_member_segments(relation, "outer"))
    inner_rings = assemble_rings(relation_member_segments(relation, "inner"))

    if not outer_rings:
        return None

    properties = element_properties(relation)

    if len(outer_rings) == 1:
        geometry = {
            "type": "Polygon",
            "coordinates": [outer_rings[0], *inner_rings],
        }
    else:
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [[ring] for ring in outer_rings],
        }

    return {
        "type": "Feature",
        "id": properties["@id"],
        "geometry": geometry,
        "properties": properties,
    }


def collection(features: list[dict[str, Any]], source_elements_count: int) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": features,
        "_cache": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "endpoint": ENDPOINT,
            "user_agent": USER_AGENT,
            "source_format": "overpass-json",
            "source_elements": source_elements_count,
        },
    }


def departmental_roads_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    elements = data.get("elements", [])
    relations_by_ref = {
        normalize_ref(element.get("tags", {}).get("ref")): element
        for element in elements
        if element.get("type") == "relation" and element.get("tags", {}).get("ref")
    }

    features: list[dict[str, Any]] = []
    for element in elements:
        if element.get("type") != "way":
            continue

        ref = normalize_ref(element.get("tags", {}).get("ref"))
        relation = relations_by_ref.get(ref)
        extra_properties: dict[str, Any] = {}

        if relation:
            extra_properties.update(
                {
                    "has_relation": True,
                    "relation_id": relation.get("id"),
                    "relation_tags": relation.get("tags") or {},
                }
            )
        else:
            extra_properties["has_relation"] = False

        feature = way_to_feature(element, extra_properties)
        if feature:
            features.append(feature)

    return collection(features, len(elements))


def construction_roads_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features = [
        feature
        for element in data.get("elements", [])
        if element.get("type") == "way"
        for feature in [way_to_feature(element)]
        if feature
    ]
    return collection(features, len(data.get("elements", [])))


def communes_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features = [
        feature
        for element in data.get("elements", [])
        if element.get("type") == "relation"
        for feature in [relation_to_polygon_feature(element)]
        if feature
    ]
    return collection(features, len(data.get("elements", [])))


CONVERTERS = {
    "departmental-roads": departmental_roads_to_geojson,
    "construction-roads": construction_roads_to_geojson,
    "communes-vaucluse": communes_to_geojson,
}


def write_json_if_changed(path: Path, data: dict[str, Any]) -> bool:
    content = json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False

    path.write_text(content, encoding="utf-8")
    return True


def refresh_cache(name: str, query: str) -> bool:
    last_error: Exception | None = None

    for attempt in range(1, 4):
        try:
            overpass_data = request_overpass(query)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt == 3:
                raise
            wait_seconds = attempt * 5
            print(f"{name}: retry in {wait_seconds}s after {error}", file=sys.stderr)
            time.sleep(wait_seconds)
    else:
        raise RuntimeError(f"{name}: {last_error}")

    geojson = CONVERTERS[name](overpass_data)
    output_path = DATA_DIR / f"{name}.geojson"
    changed = write_json_if_changed(output_path, geojson)
    features_count = len(geojson.get("features", []))
    state = "updated" if changed else "unchanged"
    print(f"{output_path.relative_to(ROOT)}: {state}, {features_count} features")
    return changed


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Overpass endpoint: {ENDPOINT}")
    print(f"User-Agent: {USER_AGENT}")

    changed = False
    for name, query in QUERIES.items():
        changed = refresh_cache(name, query) or changed

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
