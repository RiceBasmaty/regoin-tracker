"""Step 3c: lakes and major rivers for orientation (Natural Earth, public domain; D42).

Output build/water-*.geojsonl -> one tile file water.v<VERSION>.pmtiles with three layers:
  lakes        lake polygons (drawn in the sea colour, above land and region fills)
  rivers       major rivers only (Natural Earth scalerank <= MAX_RIVER_RANK)
  water_labels one point per named lake (label placement), shown from Natural Earth's min_label
Natural Earth's own min_zoom decides when each feature appears, so the map fills in gradually.
"""
import json

import geopandas as gpd
import shapely

import config as C

MAX_RIVER_RANK = 6      # Nile/Danube (1-2) ... Rhine/Seine (4) ... Thames (6); smaller streams left out


def tc(minzoom):
    return {"minzoom": max(0, int(minzoom))}


def main():
    lakes = gpd.read_file(C.NATURAL_EARTH_CACHE / "ne_10m_lakes.zip")
    rivers = gpd.read_file(C.NATURAL_EARTH_CACHE / "ne_10m_rivers_lake_centerlines.zip")
    rivers = rivers[(rivers.scalerank <= MAX_RIVER_RANK) & (rivers.featurecla == "River")]
    lakes["geometry"] = shapely.make_valid(lakes.geometry.values)
    area = lakes.to_crs("EPSG:6933").area / 1e6

    def write(path, feats):
        with open(path, "w", encoding="utf-8") as f:
            for ft in feats:
                f.write(json.dumps(ft, ensure_ascii=False, separators=(",", ":")) + "\n")

    write(C.BUILD / "water-lakes.geojsonl", (
        {"type": "Feature", "tippecanoe": tc(r.min_zoom), "properties": {},
         "geometry": shapely.geometry.mapping(r.geometry)} for r in lakes.itertuples()))
    write(C.BUILD / "water-rivers.geojsonl", (
        {"type": "Feature", "tippecanoe": tc(r.min_zoom),
         "properties": {"name": r.name if isinstance(r.name, str) else "", "rank": int(r.scalerank)},
         "geometry": shapely.geometry.mapping(r.geometry)} for r in rivers.itertuples()))
    named = lakes[lakes["name"].map(lambda n: isinstance(n, str) and n != "")]
    pts = shapely.point_on_surface(named.geometry.values)
    write(C.BUILD / "water-labels.geojsonl", (
        {"type": "Feature", "tippecanoe": tc(r.min_label),
         "properties": {"name": r.name, "area": round(float(area[r.Index]), 1)},
         "geometry": shapely.geometry.mapping(p)} for r, p in zip(named.itertuples(), pts)))
    report = {"lakes": len(lakes), "named_lakes": len(named), "rivers": len(rivers)}
    (C.BUILD / "water.report.json").write_text(json.dumps(report))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
