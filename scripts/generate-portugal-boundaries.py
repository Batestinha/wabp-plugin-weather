"""Extract the small offline tide-routing map from public-domain Natural Earth data."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

COMMIT = "f1890d9f152c896d250a77557a5751a93d494776"
URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{COMMIT}/geojson/ne_10m_admin_0_countries.geojson"
LIMIT = 40 * 1024 * 1024


def polygons(feature):
    geometry = feature["geometry"]
    return geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]


def edge_key(a, b):
    return tuple(sorted((tuple(a), tuple(b))))


def clip_ring(ring):
    """Retain Spain only near Portugal; the clipped polygon still excludes Spanish land."""
    points = ring[:-1]
    for axis, value, lower in [(0, -10, True), (0, -6, False), (1, 36, True), (1, 43, False)]:
        output = []
        for i, b in enumerate(points):
            a = points[i - 1]
            inside_a = a[axis] >= value if lower else a[axis] <= value
            inside_b = b[axis] >= value if lower else b[axis] <= value
            if inside_a != inside_b:
                fraction = (value - a[axis]) / (b[axis] - a[axis])
                output.append([a[j] + fraction * (b[j] - a[j]) for j in range(2)])
            if inside_b:
                output.append(b)
        points = output
    return points + [points[0]] if len(points) >= 3 else []


with urlopen(URL, timeout=45) as response:
    raw = response.read(LIMIT + 1)
if len(raw) > LIMIT:
    raise ValueError("Natural Earth input exceeds the download limit")
features = json.loads(raw)["features"]
countries = {f["properties"]["ADM0_A3"]: polygons(f) for f in features if f["properties"]["ADM0_A3"] in ("PRT", "ESP")}
portugal, spain = countries["PRT"], countries["ESP"]
spanish_edges = {edge_key(a, b) for polygon in spain for ring in polygon for a, b in zip(ring, ring[1:])}
coast = []
border_edges = 0
for polygon in portugal:
    for ring in polygon:
        line = []
        for a, b in zip(ring, ring[1:]):
            if edge_key(a, b) in spanish_edges:
                border_edges += 1
                if line:
                    coast.append(line)
                    line = []
            else:
                if not line:
                    line.append(a)
                line.append(b)
        if line:
            coast.append(line)
if border_edges < 50:
    raise ValueError("Expected the shared Portugal/Spain land border")
nearby_spain = [[clipped for ring in polygon if (clipped := clip_ring(ring))] for polygon in spain]
result = {
    "source": {"url": URL, "sha256": hashlib.sha256(raw).hexdigest(), "license": "Public domain", "version": "Natural Earth 5.1.2, 1:10m"},
    "portugal": portugal,
    "spainNearBorder": [polygon for polygon in nearby_spain if polygon],
    "coast": coast,
}
target = Path(__file__).resolve().parents[1] / "src/data/portugal-boundaries.json"
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(result, separators=(",", ":")) + "\n")
print(json.dumps({"path": str(target), "bytes": target.stat().st_size, "portugalPolygons": len(portugal), "landBorderEdges": border_edges, "sourceSha256": result["source"]["sha256"]}))
