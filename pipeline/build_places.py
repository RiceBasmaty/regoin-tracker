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

# City tiers (D43): one text/dot hierarchy, from national capitals down to villages.
CAPITAL, BIG, MEDIUM, TOWN, VILLAGE = 1, 2, 3, 4, 5
MIN_SEAT_POP = 20_000
# (minimum population, minzoom) - first match wins. Zoomed out: only big cities (and your visited
# ones); medium cities from zoom 5-6, towns from 7-8, villages only at the closest zoom (D43).
ZOOM_BY_POP = [(5_000_000, 1), (1_000_000, 2), (300_000, 5), (100_000, 6), (40_000, 7), (15_000, 8), (0, 10)]


def tier(pop, fcode, is_centre):
    if fcode == "PPLC":
        return CAPITAL
    if pop >= 1_000_000 or is_centre:
        return BIG
    if pop >= 100_000:
        return MEDIUM
    return TOWN if pop >= 15_000 else VILLAGE


def minzoom(pop, fcode, is_centre=False):
    z = next(z for p, z in ZOOM_BY_POP if pop >= p)
    if fcode == "PPLC":
        return min(max(1, z - 1), 3)                  # every capital by zoom 3
    if is_centre and pop < 1_000_000:
        return min(max(3, z - 2), 8)                  # region centres earlier than their size alone
    return z


def main():
    cities = pd.read_parquet(C.BUILD / "cities.parquet")
    cities = cities.sort_values(["population", "geonameid"], ascending=[False, True])
    # Region centre: the largest city of one of OUR regions (so UK counties, French historical
    # regions etc. each get one), or an official seat (GeoNames PPLA) of real size. GeoNames marks
    # some hamlets as seats (e.g. West Ilsley, pop. 332), so seats need >= MIN_SEAT_POP people.
    largest = set(cities.drop_duplicates("rid").geonameid)
    cities["centre"] = (cities.fcode.eq("PPLA") & (cities.population >= MIN_SEAT_POP)) | cities.geonameid.isin(largest)

    with open(C.BUILD / "places.geojsonl", "w", encoding="utf-8") as out:
        for r in cities.itertuples():
            out.write(json.dumps({
                "type": "Feature",
                "tippecanoe": {"minzoom": minzoom(r.population, r.fcode, r.centre)},
                "properties": {"id": int(r.geonameid), "name": r.name, "pop": int(r.population), "rid": r.rid,
                               "tier": tier(r.population, r.fcode, r.centre)},
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
              "by_minzoom": cities.apply(lambda r: minzoom(r.population, r.fcode, r.centre), axis=1).value_counts().sort_index().to_dict(),
              "by_tier": cities.apply(lambda r: tier(r.population, r.fcode, r.centre), axis=1).value_counts().sort_index().to_dict()}
    (C.BUILD / "places.report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
