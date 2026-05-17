#!/usr/bin/env python3
"""Update non-OSM local data files used by the static demo."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "external"
APP_NAME = os.environ.get("APP_NAME", "demo-inforoute-084")
APP_VERSION = os.environ.get("APP_VERSION", "0.1.0")
REPOSITORY = os.environ.get("APP_REPOSITORY", "https://github.com/thepriben/demo-inforoute-084")
USER_AGENT = os.environ.get("APP_USER_AGENT", f"{APP_NAME}/{APP_VERSION} ({REPOSITORY})")

TRAFFIC_COUNTING_URL = (
    "https://www.data.gouv.fr/api/1/datasets/r/"
    "a43b0841-856b-44f5-b4a7-74c5275b13a0"
)
ROAD_EVENTS_URL = "https://diffusion-numerique.info-routiere.gouv.fr/api/v2/events.geojson"
WEATHER_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude=43.9493&longitude=4.8055"
    "&current=temperature_2m,weather_code"
    "&timezone=Europe/Paris"
)


def fetch_json(url: str, timeout: int = 60) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, application/geo+json;q=0.9, */*;q=0.1",
            "User-Agent": USER_AGENT,
        },
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def metadata(source_name: str, source_url: str) -> dict[str, str]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_name": source_name,
        "source_url": source_url,
        "user_agent": USER_AGENT,
    }


def as_feature_collection(data: dict[str, Any], source_name: str, source_url: str) -> dict[str, Any]:
    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        raise ValueError(f"{source_name}: expected a GeoJSON FeatureCollection")

    data["_cache"] = metadata(source_name, source_url)
    return data


def empty_feature_collection(source_name: str, source_url: str, error: Exception) -> dict[str, Any]:
    data = {
        "type": "FeatureCollection",
        "features": [],
        "_cache": metadata(source_name, source_url),
    }
    data["_cache"]["error"] = str(error)
    return data


def write_json_if_changed(path: Path, data: dict[str, Any]) -> bool:
    content = json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False

    path.write_text(content, encoding="utf-8")
    return True


def update_geojson(name: str, source_name: str, source_url: str, allow_empty: bool = False) -> bool:
    output_path = DATA_DIR / name

    try:
        data = as_feature_collection(fetch_json(source_url), source_name, source_url)
    except Exception as error:
        if not allow_empty:
            raise
        print(f"{name}: source unavailable, writing empty GeoJSON: {error}", file=sys.stderr)
        data = empty_feature_collection(source_name, source_url, error)

    changed = write_json_if_changed(output_path, data)
    state = "updated" if changed else "unchanged"
    print(f"{output_path.relative_to(ROOT)}: {state}, {len(data['features'])} features")
    return changed


def update_weather() -> bool:
    data = fetch_json(WEATHER_URL, timeout=30)
    data["_cache"] = metadata("Open-Meteo Avignon current weather", WEATHER_URL)

    output_path = DATA_DIR / "weather-avignon.json"
    changed = write_json_if_changed(output_path, data)
    state = "updated" if changed else "unchanged"
    current = data.get("current") or {}
    print(
        f"{output_path.relative_to(ROOT)}: {state}, "
        f"{current.get('temperature_2m', 'n/a')} degC"
    )
    return changed


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    update_geojson(
        "traffic-counting.geojson",
        "data.gouv.fr - Comptages permanents CD84",
        TRAFFIC_COUNTING_URL,
    )
    update_geojson(
        "road-events.geojson",
        "Info Routiere - Evenements routiers",
        ROAD_EVENTS_URL,
        allow_empty=True,
    )
    update_weather()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
