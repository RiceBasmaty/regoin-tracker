"""Step 2: build the region + country layers from Overture divisions.

Rules (see DECISIONS.md):
* A "region" is an Overture `region` division (= OSM admin_level 4 in most countries,
  the first level below the country). Keyed by its ISO 3166-2 code.
* Countries without region divisions fall back to the next level down that exists
  (Overture has no level 3 "macroregion" data; we check `macrocounty` (~5), then
  `county` (~6)), else the whole country becomes one region keyed by its country code.
* Regions without an ISO code get the stable fallback key `<CC>-X<first 6 hex of the
  Overture division id>` (always longer than any real ISO suffix, so it cannot collide).
* Only `land` areas are used (coastline-clipped, what people see on a map).
* If a country's chosen regions cover less than MIN_REGION_COVERAGE of its land
  (e.g. Overture only maps 2 tiny districts of the West Bank), the whole country
  becomes one region instead: half-mapped regions would mis-file most cities.
* data/region-overrides.csv is applied last.

Outputs (in build/):
  regions.parquet / countries.parquet  geometries for the city join
  regions.geojsonl / countries.geojsonl  input for tippecanoe
  regions.meta.json / countries.meta.json  names, bbox, label point (published)
"""
import csv
import json
import sys

import geopandas as gpd
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import shapely

import config as C
from textnorm import normalize

COLS = ["id", "division_id", "subtype", "class", "country", "region", "names", "geometry"]
SUBTYPES = ["country", "dependency", "region", "macrocounty", "county"]
MIN_REGION_COVERAGE = 0.5
EQUAL_AREA = "EPSG:6933"


def display_name(names):
    if not names:
        return None, None
    common = dict(names["common"]) if names.get("common") is not None else {}
    en, local = common.get("en"), names["primary"]
    # Prefer the local spelling when it is the same name with accents ("Île-de-France", not "Ile-de-France").
    if not en or normalize(en) == normalize(local):
        return local, local
    return en, local


def load_areas():
    files = sorted(C.OVERTURE_CACHE.glob("division_area-*.parquet"))
    if not files:
        sys.exit("No Overture files; run download.py first")
    tables = [pq.read_table(f, columns=COLS, filters=[("subtype", "in", SUBTYPES), ("class", "=", "land")]) for f in files]
    df = pa.concat_tables(tables).to_pandas()
    df["geometry"] = shapely.make_valid(shapely.from_wkb(df["geometry"].values))
    names = df["names"].map(display_name)
    df["name"] = names.map(lambda x: x[0])
    df["name_local"] = names.map(lambda x: x[1])
    return gpd.GeoDataFrame(df.drop(columns=["names", "class"]), geometry="geometry", crs="EPSG:4326")


def fallback_id(cc, division_id):
    return f"{cc}-X{division_id.replace('-', '')[:6].upper()}"


def load_overrides():
    rows = []
    with open(C.OVERRIDES, encoding="utf-8") as f:
        lines = [l for l in f if not l.startswith("#")]
    for r in csv.DictReader(lines):
        if not r.get("reason", "").strip():
            sys.exit(f"Override without reason: {r}")
        rows.append(r)
    return rows


def main():
    C.BUILD.mkdir(parents=True, exist_ok=True)
    areas = load_areas()
    report = {"fallback_level": {}, "whole_country": [], "no_iso": 0, "overrides_applied": []}

    # ---- countries (incl. dependencies and Overture's disputed "X?" territories) ----
    countries = areas[areas.subtype.isin(["country", "dependency"])].copy()
    countries = countries.dissolve(by="country", aggfunc={"name": "first", "name_local": "first", "subtype": "first"}).reset_index()
    countries = countries.rename(columns={"country": "cc"})

    # ---- regions, with level fallback per country ----
    parts = []
    for cc in sorted(countries.cc):
        sub = areas[areas.country == cc]
        chosen = None
        for level in ["region", "macrocounty", "county"]:
            lv = sub[sub.subtype == level]
            if len(lv):
                chosen = lv.copy()
                if level != "region":
                    report["fallback_level"][cc] = level
                break
        if chosen is None:   # no subdivisions at all: the country is its own single region
            c = countries[countries.cc == cc].iloc[0]
            chosen = gpd.GeoDataFrame([{"division_id": None, "country": cc, "region": cc, "name": c["name"],
                                        "name_local": c["name_local"], "geometry": c.geometry, "subtype": "country"}],
                                      geometry="geometry", crs="EPSG:4326")
            report["whole_country"].append(cc)
        parts.append(chosen)
    regions = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), geometry="geometry", crs="EPSG:4326")

    # Coverage check: share of each country's land covered by its regions.
    reg_area = regions.to_crs(EQUAL_AREA).area.groupby(regions.country).sum()
    cty_area = countries.set_index("cc").to_crs(EQUAL_AREA).area
    coverage = (reg_area / cty_area).fillna(0)
    report["coverage_below_99pct"] = {cc: round(v, 3) for cc, v in coverage.sort_values().items() if v < 0.99}
    low = [cc for cc, v in coverage.items() if v < MIN_REGION_COVERAGE and cc not in report["whole_country"]]
    for cc in low:
        c = countries[countries.cc == cc].iloc[0]
        regions = regions[regions.country != cc]
        regions = pd.concat([regions, gpd.GeoDataFrame([{"division_id": None, "country": cc, "region": cc, "name": c["name"],
                             "name_local": c["name_local"], "geometry": c.geometry, "subtype": "country"}],
                             geometry="geometry", crs="EPSG:4326")], ignore_index=True)
        report["whole_country"].append(cc)
        report["fallback_level"].pop(cc, None)
    report["low_coverage_made_whole_country"] = low

    # ISO key or documented fallback
    no_iso = regions.region.isna() | (regions.region == "")
    report["no_iso"] = int(no_iso.sum())
    regions.loc[no_iso, "region"] = [fallback_id(c, d) for c, d in zip(regions.loc[no_iso, "country"], regions.loc[no_iso, "division_id"])]
    # Some region areas carry an ISO code from another country (e.g. a dependency's
    # districts using the parent's code); keep the code but the area belongs to `country`.
    regions = regions.rename(columns={"region": "rid", "country": "cc", "subtype": "level"})

    # ---- overrides ----
    for o in load_overrides():
        m = (regions.rid == o["match"]) | (regions.division_id == o["match"])
        if not m.any():
            sys.exit(f"Override matches nothing: {o}")
        col = {"set_id": "rid", "set_name": "name", "set_country": "cc"}[o["action"]]
        regions.loc[m, col] = o["value"]
        report["overrides_applied"].append(o)

    # Same key on several areas (e.g. a region split in two land parts) -> merge them.
    if regions.rid.duplicated().any():
        dups = sorted(regions.rid[regions.rid.duplicated()].unique())
        report["merged_duplicate_keys"] = dups
        regions = regions.dissolve(by="rid", aggfunc={"cc": "first", "name": "first", "name_local": "first",
                                                     "level": "first", "division_id": "first"}).reset_index()

    for name, gdf, key in [("regions", regions, "rid"), ("countries", countries, "cc")]:
        gdf = gdf.sort_values(key).reset_index(drop=True)
        gdf.to_parquet(C.BUILD / f"{name}.parquet")
        b = gdf.geometry.bounds.round(4)
        lp = shapely.point_on_surface(gdf.geometry.values)
        meta = {}
        for i, r in gdf.iterrows():
            rec = {"name": r["name"], "local": r["name_local"] if r["name_local"] != r["name"] else None,
                   "bbox": [b.minx[i], b.miny[i], b.maxx[i], b.maxy[i]],
                   "label": [round(shapely.get_x(lp[i]), 4), round(shapely.get_y(lp[i]), 4)]}
            if name == "regions":
                rec["cc"] = r["cc"]
            meta[r[key]] = {k: v for k, v in rec.items() if v is not None}
        if name == "countries":
            counts = regions.cc.value_counts()
            un = {l.strip() for l in C.UN_MEMBERS.read_text().splitlines() if l.strip() and not l.startswith("#")}
            missing = un - set(meta)
            if missing:
                sys.exit(f"UN member states missing from Overture countries: {sorted(missing)}")
            for cc in meta:
                meta[cc]["regions"] = int(counts.get(cc, 0))
                # Only UN member states count as "countries"; everything else is a territory.
                meta[cc]["un"] = cc in un
        (C.BUILD / f"{name}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
        # GeoJSON lines for tippecanoe: keep tile attributes minimal (id + country).
        with open(C.BUILD / f"{name}.geojsonl", "w", encoding="utf-8") as out:
            for i, r in gdf.iterrows():
                props = {"id": r[key]} if name == "countries" else {"id": r["rid"], "cc": r["cc"]}
                out.write(json.dumps({"type": "Feature", "properties": props,
                                      "geometry": shapely.geometry.mapping(r.geometry)}, separators=(",", ":")) + "\n")

    report["counts"] = {"countries": len(countries), "regions": len(regions)}
    (C.BUILD / "regions.report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps({k: v for k, v in report.items() if k != "overrides_applied"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
