"""Step 3b: city places for the map and the region card (D35).

1. build/places.geojsonl -> tippecanoe -> places.v<VERSION>.pmtiles (layer "places").
   Each city has a minzoom from its population, so big cities show on the zoomed-out globe
   and small towns only when zoomed in. Capitals show one zoom level earlier.
2. places/<regionId>.json: every city of a region, largest first. The region card uses it for
   one-tap "add a city here" chips and for searching within the region.
"""
import json
import shutil

import pandas as pd

import config as C

# (minimum population, minzoom) - first match wins
ZOOM_BY_POP = [(5_000_000, 1), (1_000_000, 2), (300_000, 3), (100_000, 4), (40_000, 5), (15_000, 6), (5_000, 7), (0, 8)]


def minzoom(pop, fcode):
    z = next(z for p, z in ZOOM_BY_POP if pop >= p)
    return max(1, z - 1) if fcode == "PPLC" else z


def main():
    cities = pd.read_parquet(C.BUILD / "cities.parquet")
    cities = cities.sort_values(["population", "geonameid"], ascending=[False, True])

    with open(C.BUILD / "places.geojsonl", "w", encoding="utf-8") as out:
        for r in cities.itertuples():
            out.write(json.dumps({
                "type": "Feature",
                "tippecanoe": {"minzoom": minzoom(r.population, r.fcode)},
                "properties": {"id": int(r.geonameid), "name": r.name, "pop": int(r.population), "rid": r.rid},
                "geometry": {"type": "Point", "coordinates": [round(r.lon, 5), round(r.lat, 5)]},
            }, ensure_ascii=False, separators=(",", ":")) + "\n")

    out_dir = C.DIST / "places"
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    sizes = []
    for rid, g in cities.groupby("rid", sort=True):
        doc = {"v": C.DATA_VERSION, "r": rid,
               # [geonameid, name, lat, lon, population], largest first
               "c": [[int(r.geonameid), r.name, round(r.lat, 5), round(r.lon, 5), int(r.population)] for r in g.itertuples()]}
        body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
        (out_dir / f"{rid}.json").write_text(body, encoding="utf-8")
        sizes.append(len(body.encode()))
    report = {"places": len(cities), "region_files": len(sizes), "max_kb": round(max(sizes) / 1e3, 1),
              "median_kb": round(sorted(sizes)[len(sizes) // 2] / 1e3, 1),
              "by_minzoom": cities.apply(lambda r: minzoom(r.population, r.fcode), axis=1).value_counts().sort_index().to_dict()}
    (C.BUILD / "places.report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
