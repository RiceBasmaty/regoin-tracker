"""Step 3: city index with precomputed regions, sharded for search.

1. Read GeoNames cities1000 (+ alternate names, filtered).
2. Spatial join: each city -> the land region polygon that contains it.
   Cities just off the coastline polygon (ports, small islands, river mouths)
   snap to the nearest region within COASTAL_SNAP_KM, preferring a region of the
   city's own GeoNames country; a wider same-country search is the last resort.
3. The region's country (not GeoNames') becomes the city's country, so cities,
   regions and countries can never disagree. Disagreements are listed in the report.
4. Search keys: every useful name, normalised (see textnorm.py), written into
   small shards by the first 2 (or 3) letters. The browser loads one shard per query.

Outputs: dist/data/v<VERSION>/search/<prefix>.json, search/manifest.json,
         build/cities.parquet (full table, for tests), build/cities.report.json
"""
import io
import json
import math
import re
import zipfile
from collections import defaultdict

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

import config as C
from textnorm import normalize

GN_COLS = ["geonameid", "name", "asciiname", "alternatenames", "lat", "lon", "fclass", "fcode", "cc", "cc2",
           "admin1", "admin2", "admin3", "admin4", "population", "elevation", "dem", "tz", "modified"]
# alternate-name "languages" that are really codes/links, not names people type
JUNK_LANGS = {"link", "wkdt", "iata", "icao", "faac", "post", "abbr", "unlc", "tcid", "fr_1793", "phon", "piny", "uicn"}
# Big cities are also searchable in widely used languages; smaller ones in English + local languages.
ALL_LANGS_MIN_POP = 100_000
MAJOR_LANGS = {"ar", "bn", "cs", "da", "de", "el", "es", "fa", "fi", "fr", "he", "hi", "hu", "id", "it", "ja", "ko",
               "ms", "nl", "no", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "zh"}
# Key classes; their ranking weight is C.KEY_WEIGHTS[class] (shipped in the manifest).
MAIN, LOCAL_ALT, FOREIGN_ALT, LATER_WORD, UNTAGGED_ALT = 0, 1, 2, 3, 4
NON_ISO = re.compile(r"^X[A-Z]$")   # ISO 3166-1 "user-assigned" range used by Overture for disputed areas
NUMBERED = re.compile(r"^([0-9]+|[ivxlc]+)$")   # '15', 'xi' (Roman numerals)
MAX_KEYS_PER_CITY = 40
EARTH_KM = 6371.0088


def haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(a))


def load_cities():
    with zipfile.ZipFile(C.GEONAMES_CACHE / "cities1000.zip") as z:
        df = pd.read_csv(z.open("cities1000.txt"), sep="\t", names=GN_COLS, header=None, quoting=3,
                         keep_default_na=False, dtype={"cc": str, "admin1": str},
                         usecols=["geonameid", "name", "asciiname", "lat", "lon", "fcode", "cc", "population"])
    # Historical / abandoned places are not cities you can visit today, and PPLX are
    # sections of a city (Paris arrondissements, "East New York"), not cities.
    df = df[~df.fcode.isin(["PPLH", "PPLQ", "PPLW", "PPLCH", "PPLX"])]
    df["population"] = df.population.clip(lower=0)
    return df.reset_index(drop=True)


def country_languages():
    langs = {}
    for line in (C.GEONAMES_CACHE / "countryInfo.txt").read_text("utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        f = line.split("\t")
        langs[f[0]] = {l.split("-")[0] for l in f[15].split(",") if l}
    return langs


def load_alt_names(cities):
    ids = set(cities.geonameid)
    with zipfile.ZipFile(C.GEONAMES_CACHE / "alternateNamesV2.zip") as z:
        reader = pd.read_csv(z.open("alternateNamesV2.txt"), sep="\t", header=None, quoting=3, keep_default_na=False,
                             usecols=[1, 2, 3, 4, 6, 7], names=["gid", "lang", "alt", "pref", "colloq", "hist"],
                             dtype=str, chunksize=2_000_000)
        parts = []
        for ch in reader:
            ch["gid"] = ch.gid.astype(int)
            ch = ch[ch.gid.isin(ids) & ~ch.lang.isin(JUNK_LANGS) & (ch.colloq != "1") & (ch.hist != "1")]
            parts.append(ch[["gid", "lang", "alt", "pref"]])
    return pd.concat(parts, ignore_index=True)


def load_city_overrides():
    import csv
    with open(C.CITY_OVERRIDES, encoding="utf-8") as f:
        rows = list(csv.DictReader(l for l in f if not l.startswith("#")))
    out = {}
    for r in rows:
        if not r.get("reason", "").strip():
            raise SystemExit(f"city override without reason: {r}")
        out[int(r["geonameid"])] = (r["region_id"].strip(), r["reason"])
    return out


def assign_regions(cities, report):
    regions = gpd.read_parquet(C.BUILD / "regions.parquet")
    pts = gpd.GeoDataFrame(cities[["geonameid", "cc"]], geometry=gpd.points_from_xy(cities.lon, cities.lat), crs="EPSG:4326")
    hit = gpd.sjoin(pts, regions[["rid", "cc", "geometry"]].rename(columns={"cc": "rcc"}), predicate="intersects", how="left")
    # A point exactly on a shared border touches two regions: keep the first (sorted -> deterministic).
    hit = hit.sort_values(["geonameid", "rid"]).drop_duplicates("geonameid")
    cities = cities.merge(hit[["geonameid", "rid", "rcc"]], on="geonameid", how="left")
    cities["how"] = np.where(cities.rid.notna(), "inside", None)

    # Snap the rest to the nearest region. "Home country" = the Overture country polygon
    # the point lies in (falls back to GeoNames' country for points in the sea), so a
    # city in a gap between regions never snaps across a border.
    countries = gpd.read_parquet(C.BUILD / "countries.parquet")
    todo = cities.index[cities.rid.isna()]
    home = gpd.sjoin(pts.loc[todo, ["geometry"]], countries[["cc", "geometry"]], predicate="intersects", how="left")
    home = home[~home.index.duplicated()]["cc"]
    sindex = regions.sindex
    for i in todo:
        lon, lat = cities.at[i, "lon"], cities.at[i, "lat"]
        cc = home.get(i) if isinstance(home.get(i), str) else cities.at[i, "cc"]
        best = None
        for radius_km, same_cc_only in [(C.COASTAL_SNAP_KM, False), (150, True)]:
            dlat = radius_km / 111.0
            dlon = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.05))
            cand = sindex.query(shapely.box(lon - dlon, lat - dlat, lon + dlon, lat + dlat))
            p = shapely.Point(lon, lat)
            options = []
            for j in cand:
                r = regions.iloc[j]
                if same_cc_only and r.cc != cc:
                    continue
                q = shapely.shortest_line(p, r.geometry).coords[1]
                d = haversine_km(lon, lat, q[0], q[1])
                if d <= radius_km:
                    options.append((r.cc != cc, d, r.rid, r.cc))   # same-country first, then nearest
            if options:
                best = min(options)
                break
        if best:
            cities.at[i, "rid"], cities.at[i, "rcc"] = best[2], best[3]
            cities.at[i, "how"] = f"snapped {best[1]:.1f} km"
    # Manual fixes for cities whose GeoNames point is wrong (data/city-overrides.csv).
    overrides = load_city_overrides()
    valid = set(regions.rid)
    rcc = dict(zip(regions.rid, regions.cc))
    for gid, (rid, reason) in overrides.items():
        if rid not in valid:
            raise SystemExit(f"city override {gid}: unknown region {rid}")
        m = cities.geonameid == gid
        if not m.any():
            raise SystemExit(f"city override {gid}: city not in cities1000")
        cities.loc[m, ["rid", "rcc", "how"]] = [rid, rcc[rid], "override"]
    report["city_overrides_applied"] = len(overrides)
    report["region_assignment"] = {
        "inside_polygon": int((cities.how == "inside").sum()),
        "snapped": int(cities.how.fillna("").str.startswith("snapped").sum()),
        "unassigned": int(cities.rid.isna().sum()),
    }
    report["unassigned_examples"] = cities[cities.rid.isna()][["geonameid", "name", "cc", "lat", "lon", "population"]].head(50).to_dict("records")
    cities = cities[cities.rid.notna()].copy()
    mism = cities[cities.cc != cities.rcc]
    report["country_differs_from_geonames"] = {
        "count": int(len(mism)),
        "by_pair": {f"{a}->{b}": int(n) for (a, b), n in mism.groupby(["cc", "rcc"]).size().sort_values(ascending=False).head(40).items()},
    }
    cities["gn_cc"] = cities.cc
    cities["cc"] = cities.rcc
    return cities.drop(columns=["rcc"])


def drop_city_districts(cities, report, max_km=15):
    """Remove numbered city districts that GeoNames lists as separate places ("Paris 15 Vaugirard",
    "Praha 5", "Budapest XI. kerület"): the name is a bigger city's name followed by a number,
    and the place lies within max_km of that city in the same region. Real towns that share a
    name prefix ("Arlington Heights", "New York Mills") are not numbered and always stay."""
    norm = cities.name.map(normalize)
    by_name = defaultdict(list)
    for i, n in zip(cities.index, norm):
        by_name[n].append(i)
    drop = []
    for i, n in zip(cities.index, norm):
        words = n.split(" ")
        for w in range(1, len(words)):
            if not NUMBERED.match(words[w]):
                continue
            for j in by_name.get(" ".join(words[:w]), ()):
                if (cities.at[j, "population"] > cities.at[i, "population"] and cities.at[j, "rid"] == cities.at[i, "rid"]
                        and haversine_km(cities.at[i, "lon"], cities.at[i, "lat"], cities.at[j, "lon"], cities.at[j, "lat"]) <= max_km):
                    drop.append(i)
                    break
            else:
                continue
            break
    report["dropped_city_districts"] = {"count": len(drop), "examples": sorted(cities.loc[drop, "name"].tolist())[:40]}
    return cities.drop(index=drop)


def build_keys(cities, alts):
    """Return {geonameid: [(key, class, original spelling)]}.

    MAIN        city name, ASCII name, English / preferred names
    LOCAL_ALT   other names in the country's languages
    UNTAGGED_ALT names with no language tag (variants, old romanisations)
    FOREIGN_ALT names in other major languages (cities >= ALL_LANGS_MIN_POP only)
    LATER_WORD  a main name starting from its 2nd/3rd... word ("york" -> New York)
    """
    langs = country_languages()
    pop = dict(zip(cities.geonameid, cities.population))
    cc_of = dict(zip(cities.geonameid, cities.gn_cc))
    names = defaultdict(list)          # gid -> [(class, raw name)]
    for gid, n, a in zip(cities.geonameid, cities.name, cities.asciiname):
        names[gid] += [(MAIN, n), (MAIN, a)]
    for gid, lang, alt, pref in zip(alts.gid, alts.lang, alts.alt, alts.pref):
        if gid not in pop:
            continue
        lang = lang.split("-")[0]
        if lang == "en" or (pref == "1" and lang in langs.get(cc_of[gid], ())):
            cls = MAIN
        elif lang in langs.get(cc_of[gid], ()):
            cls = LOCAL_ALT
        elif lang == "":
            cls = UNTAGGED_ALT     # often old romanisations ("P'an-yü"): searchable, ranked low
        elif lang in MAJOR_LANGS and pop[gid] >= ALL_LANGS_MIN_POP:
            cls = FOREIGN_ALT
        else:
            continue
        names[gid].append((cls, alt))
    keys = {}
    for gid, lst in names.items():
        seen, out = set(), []
        # Spelling shown for a key: prefer an accented one ("Göteborg" over "Goteborg"),
        # whatever kind of name it came from; the ranking still uses the best kind.
        spelling = {normalize(lst[0][1]): lst[0][1]}   # lst[0] is the city's own name: it always wins
        for cls, raw in sorted(lst, key=lambda x: (x[1].isascii(), x[0])):
            spelling.setdefault(normalize(raw), raw)
        for cls, raw in sorted(lst, key=lambda x: x[0]):
            k = normalize(raw)
            if len(k) < C.MIN_CHARS or k in seen:
                continue
            # A 2-character key must be the city's main name or non-Latin script (東京);
            # 2-letter Latin alternates are abbreviations or old forms ("Pa" for Chongqing).
            if len(k) < 3 and cls != MAIN and k.isascii():
                continue
            seen.add(k)
            out.append((k, cls, spelling[k]))
            if len(seen) >= MAX_KEYS_PER_CITY:
                break
        for k in {normalize(r) for c, r in lst if c == MAIN}:
            words = k.split(" ")
            for w in range(1, len(words)):
                sub = " ".join(words[w:])
                if len(sub) >= 3 and sub not in seen:
                    seen.add(sub)
                    out.append((sub, LATER_WORD, None))
        keys[gid] = out
    return keys


def shard_name(prefix):
    return prefix if prefix.isascii() and prefix.isalnum() else "x" + prefix.encode("utf-8").hex()


def city_score(pop, exact, cls):
    """Ranking score; the browser uses the same constants (from the manifest)."""
    return max(pop, 1) * (C.SCORE_EXACT if exact else 1) * C.KEY_WEIGHTS[cls]


def write_shards(cities, keys, region_meta, country_meta, report):
    """Shards are keyed by the first 2 letters of a search key. A shard with more than
    SHARD_MAX_ENTRIES entries is split by one more letter (recursively). For a split
    prefix P (3+ letters) we also write a "head" shard used when the query is exactly P:
    it holds every key equal to P plus the HEAD_CITIES best-scoring other cities, which
    provably contains the same top suggestions as the full list (see DECISIONS.md)."""
    out_dir = C.DIST / "search"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.json"):
        old.unlink()
    city = cities.set_index("geonameid")
    pop = city.population.to_dict()
    name = city.name.to_dict()
    rid_of = city.rid.to_dict()
    groups = defaultdict(list)                       # 2-char prefix -> [(key, tier, gid, raw)]
    for gid, ks in keys.items():
        for k, tier, raw in ks:
            groups[k[:2]].append((k, tier, gid, raw))
    split, sizes = set(), []

    def emit(prefix, lst):
        lst = sorted(lst, key=lambda e: (e[0], e[1], -pop[e[2]], e[2]))
        gids = sorted({e[2] for e in lst}, key=lambda g: (-pop[g], g))
        idx = {g: i for i, g in enumerate(gids)}
        rids = sorted({rid_of[g] for g in gids})
        ridx = {r: i for i, r in enumerate(rids)}
        doc = {
            "v": C.DATA_VERSION,
            "p": prefix,
            # regions used in this shard: [key, display name]
            "r": [[r, region_meta[r]["name"]] for r in rids],
            # display names for territories without a real ISO country code (Overture "X?" codes,
            # e.g. XG -> "Gaza Strip"): suggestions show the name, never the code
            "n": {cc: country_meta[cc]["name"] for cc in sorted({city.at[g, "cc"] for g in gids}) if NON_ISO.match(cc)},
            # cities: [geonameid, name, regionIndex, country, lat, lon, population]
            "c": [[int(g), name[g], ridx[rid_of[g]], city.at[g, "cc"], round(float(city.at[g, "lat"]), 5),
                   round(float(city.at[g, "lon"]), 5), int(pop[g])] for g in gids],
            # keys, sorted: [normalised key, cityIndex, key class (weight = manifest.score.weights[class]), original spelling if not the city name]
            "k": [[k, idx[g], t] + ([raw] if raw and raw != name[g] else []) for k, t, g, raw in lst],
        }
        body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
        (out_dir / f"{shard_name(prefix)}.json").write_text(body, encoding="utf-8")
        sizes.append(len(body.encode()))

    def build(prefix, lst):
        n = len(prefix)
        if len(lst) <= C.SHARD_MAX_ENTRIES or n >= C.SHARD_MAX_PREFIX:
            emit(prefix, lst)
            return
        split.add(prefix)
        if n >= C.MIN_CHARS:   # head shard for a query that is exactly `prefix`
            exact = [e for e in lst if e[0] == prefix]
            best = {}
            for k, t, g, _ in lst:
                if k != prefix:
                    best[g] = max(best.get(g, 0), city_score(pop[g], False, t))
            top = set(sorted(best, key=lambda g: (-best[g], g))[: C.HEAD_CITIES])
            emit(prefix, exact + [e for e in lst if e[0] != prefix and e[2] in top])
        children = defaultdict(list)
        for e in lst:
            if len(e[0]) > n:            # keys equal to prefix only matter for the head shard
                children[e[0][: n + 1]].append(e)
        for child, sub in children.items():
            build(child, sub)

    for p2, lst in groups.items():
        build(p2, lst)
    manifest = {"v": C.DATA_VERSION, "minChars": C.MIN_CHARS, "split": sorted(split), "maxSuggestions": C.MAX_SUGGESTIONS,
                "score": {"exact": C.SCORE_EXACT, "weights": C.KEY_WEIGHTS}}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    sizes = np.array(sizes)
    report["shards"] = {"count": len(sizes), "split_prefixes": len(split), "total_mb": round(sizes.sum() / 1e6, 1),
                        "median_kb": round(float(np.median(sizes)) / 1e3, 1), "p99_kb": round(float(np.percentile(sizes, 99)) / 1e3, 1),
                        "max_kb": round(sizes.max() / 1e3, 1)}


def main():
    report = {}
    cities = load_cities()
    report["cities_in"] = len(cities)
    cities = assign_regions(cities, report)
    cities = drop_city_districts(cities, report)
    alts = load_alt_names(cities)
    keys = build_keys(cities, alts)
    region_meta = json.loads((C.BUILD / "regions.meta.json").read_text("utf-8"))
    country_meta = json.loads((C.BUILD / "countries.meta.json").read_text("utf-8"))
    write_shards(cities, keys, region_meta, country_meta, report)
    report["cities_out"] = len(cities)
    report["search_keys"] = sum(len(v) for v in keys.values())
    cities.to_parquet(C.BUILD / "cities.parquet")
    (C.BUILD / "cities.report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    print(json.dumps({k: v for k, v in report.items() if k not in ("unassigned_examples",)}, ensure_ascii=False, default=str, indent=1))


if __name__ == "__main__":
    main()
