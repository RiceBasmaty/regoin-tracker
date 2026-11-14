# Decisions

Newest first within each phase. Format: decision, reason, alternatives considered.

## Phase 0: data pipeline (2026-11-14)

### D1. Python for the pipeline, plain JavaScript for shared app logic
- **Decision:** The build steps are Python (pyarrow, geopandas, shapely). The code the app reuses (`shared/*.js`) is plain ES modules with zero dependencies.
- **Reason:** Python has the best-tested geometry tools, and the pipeline only runs on our machine. The browser code stays tiny and framework-free, so Phase 1 can use any build tool.
- **Alternatives:** DuckDB with its spatial extension (fast, but its extensions are downloaded at runtime: one more thing to pin, and it was blocked here). An all-Node pipeline (weaker geometry libraries).

### D2. tippecanoe 2.79.0 for map tiles, installed from conda-forge
- **Decision:** Polygons are turned into PMTiles with tippecanoe, pinned and installed via micromamba from conda-forge (`pipeline/setup.sh`).
- **Reason:** tippecanoe is the industry standard and keeps shared borders identical when simplifying (`--detect-shared-borders`), so there are no slivers between regions. conda-forge supplies a prebuilt binary on Linux and macOS.
- **Alternatives:** Writing tiles ourselves in Python (more code to maintain). Building tippecanoe from source (GitHub downloads were blocked here; slower).

### D3. What counts as a "region"
- **Decision:** A region is an Overture `region` division. That's the first level below the country, the same thing OSM tags `admin_level=4` in most countries. Fallback chain: `region` → `macrocounty` → `county` → the whole country as one region. Only coastline-clipped `land` shapes are used.
- **Reason:** Overture describes levels by type, not by OSM number, and the `region` type comes with the ISO 3166-2 code we need as a key. Overture has no level-3 ("macroregion") data in this release, so the chain starts at the next level down.
- **Effect:** 3,975 regions in 272 countries and territories. Countries with no subdivisions (the Vatican, Gibraltar, the Falklands, Antarctica…) are one region each. Cocos Islands, Gaza, the Paracels, the Spratlys and the Kurils use `county`. The full list is in `build/regions.report.json`.

### D4. Region keys: ISO 3166-2, else a documented fallback
- **Decision:** The key is the ISO 3166-2 code (`FR-IDF`). Where ISO has none (371 regions, mostly small island districts), the key is `<CC>-X<first 6 hex characters of the Overture division id>`, e.g. `MC-X044806`. A whole-country region's key is the country code itself (`VA`).
- **Reason:** Real ISO suffixes are at most 3 characters, so a 7-character `X…` suffix can never clash with one. Overture division ids are designed to stay stable across releases, so the fallback keys stay stable too. A test checks that every key matches one of these patterns.

### D5. Half-mapped countries become a single region
- **Decision:** If a country's regions cover less than 50% of its land, the whole country becomes one region. Today this applies to the West Bank (0.4% covered), São Tomé and Príncipe (14%) and Macau (32%).
- **Reason:** Otherwise most cities fall outside every region and get pushed into a neighbouring country. Nablus and Ramallah were being filed under Israel before this rule.
- **Alternatives:** Inventing a "rest of country" region (confusing for users). Hand-drawing regions (not maintainable).

### D6. Cities: GeoNames `cities1000`
- **Decision:** ~162,000 places with 1,000+ people (or an administrative seat), with alternate names from `alternateNamesV2`.
- **Reason:** GeoNames gives reliable population figures (needed for ranking) and names tagged by language (needed for "Moskva" and "Moscow"). CC BY 4.0 allows commercial use with attribution.
- **Alternatives:** Overture localities (same licence family as the borders, but population coverage is patchy, which hurts the "Paris FR before Paris TX" ranking).
- **Excluded:** places GeoNames marks as historical or abandoned; city sections (`PPLX`, e.g. "East New York"); and numbered districts named after a bigger city within 15 km in the same region ("Paris 15 Vaugirard", "Marseille 03"): 41 places.

### D7. A city's region is precomputed; its country comes from the region
- **Decision:** At build time each city is placed in the region polygon containing it. A city just off the coastline polygon (ports, islands, river mouths) snaps to the nearest region of the country it lies in, within 25 km, or within 150 km of the same country as a last resort. The city's country is then the region's country, not GeoNames' country.
- **Reason:** It meets data rule 4 (no geometry in the browser), and cities, regions and countries can never disagree. Result: 99.65% of cities fall inside a polygon, 567 snap, none are left without a region. The 463 cities whose country differs from GeoNames are listed in `build/cities.report.json`. Most are in disputed areas (see D8) or sit within a few hundred metres of a border.

### D8. Disputed territories: Overture's default view for now ⚠️ *needs Dmitry*
- **Fact:** CLAUDE.md asks for the de facto (who controls it) view. This Overture release ships **no perspective data** (`perspectives` is empty on every division). Its default view puts disputed areas in separate pseudo-countries with `X?` codes: Kosovo `XK`, West Bank `XW`, Gaza `XG`, Golan `XH`, the Kurils `XU`/`XI`/`XO`/`XA`, Abyei, Bir Tawil and others. Crimea and Sevastopol are inside Ukraine (`UA-43`, `UA-40`).
- **Decision for Phase 0:** ship Overture's view unchanged and record it.
- **Reason:** A true de facto view would mean maintaining our own list of territorial claims, a political and legal call that's the product owner's to make. Region overrides (`data/region-overrides.csv`, `set_country`) make it a data change later, not a code change.

### D9. Two override tables, each row with a reason
- `data/region-overrides.csv`: change a region's key, name or country. It's currently empty.
- `data/city-overrides.csv`: force a city into a region when its GeoNames point is wrong. It currently has one row: Caracas, whose point sits in Chacao (Miranda); it moves to Distrito Capital.
- The build refuses rows without a reason, and rows that match nothing.

### D10. Search: what is matched and how it's ranked
- **Matching:** the query is normalised (accents and case removed, `ß→ss`, `ø→o`, punctuation becomes a space) and compared as a prefix against each city's names:
  - its main and English names;
  - names in its country's languages, or with no language tag;
  - names in ~30 widely used languages, for cities over 100,000 people only;
  - a name starting from its 2nd word, so `york` finds New York.

  At most 40 names per city. Suggestions start at 3 characters (CLAUDE.md).
- **Ranking:** score = population × 20 if the query equals the whole name × a weight for the kind of name matched (main name 1, local name 0.3, foreign language 0.1, later word 0.2). The constants live in `pipeline/config.py` and ship in the search manifest, so tuning them doesn't need an app release.
- **Why:** pure population ranking made "san" return Shanghai (via its Lithuanian name) and Sydney (via its Latin name). These weights keep "Paris, Île-de-France, FR" first, "Bath, England" before Bathinda, and Santiago and São Paulo at the top of "san".
- **Display:** `City, Region, CC`. When the user matched an alternate name, the suggestion also carries it (`Gothenburg … [matched "Göteborg"]`), so Phase 2 can show it.

### D11. Search index split into small files ("shards")
- **Decision:** Keys are grouped by their first 2 letters (`pa.json`). A group with more than 600 keys is split by one more letter, recursively (`san` → `sant` → …, up to 12 letters). For a split prefix of 3+ letters, a small **head** file holds every exact match plus the 40 best other cities. That result is provably identical to searching the full list; a test checks it for all 269 split prefixes. Non-Latin prefixes use hex file names (`мо` → `xd0bcd0be.json`).
- **Reason:** One keystroke loads one file: median 0.2 KB, largest ~66 KB (~22 KB compressed), so suggestions stay well under 100 ms on 4G. Searching a cached file takes under 5 ms.
- **Cost:** ~21,000 small files. Fine for R2 and a CDN, and uploads are scripted in Phase 4.
- **Alternatives:** One big file (~40 MB, too slow on phones). A search server (costs money, can be overloaded, against the static-first plan).

### D12. One normaliser, two languages, enforced by a test
- `pipeline/textnorm.py` builds the index and `shared/normalize.js` queries it. Both read the same `shared/fold-map.json`. A test runs both on 20,000 real place names and fails on any difference.

### D13. Map tiles carry only keys; names live in JSON
- Tiles hold `id` (region key) and `cc` only. The map colours visited regions with MapLibre `feature-state`, using `promoteId: "id"`. Names, bounding boxes and label points are in `regions.v2026-10.json`. That keeps tiles small (world view ~300 KB) and lets names be fixed without rebuilding tiles. Regions go up to zoom 10 and countries to zoom 8; the map scales them beyond that.

### D14. Versioned, reproducible outputs
- Everything is pinned in `pipeline/config.py` and `pipeline/requirements.txt`, and every output sits under `dist/data/v2026-10/` with the version in the file names. GeoNames has no releases, so `manifest.json` records each input file's SHA-256 and the download date.

### D15. Cloud build environment
- I created a personal cloud environment (`regoin-tracker`) that also allows `download.geonames.org`, because the default one blocked it. No secrets are involved.

## Open product questions (for Dmitry)

1. **Disputed borders (D8):** keep Overture's neutral view, or should I maintain a de facto list (e.g. Crimea → Russia, the Kurils → Russia, Golan → Israel)?
2. **Pseudo-country codes in suggestions:** Gaza shows as `Gaza, Gaza Strip, XG`. Show the territory name instead of the code where no ISO code exists?
3. **Overseas territories:** Réunion, Guadeloupe, Puerto Rico, Greenland and others are their own "countries" (they have their own ISO codes, as in Overture and GeoNames). Should they also count toward France, the USA and Denmark in the stats?
4. **2-character names:** the 3-character rule means `東京` (Tokyo in Japanese) and towns like `Ub` can't be found by those spellings. Allow 2 characters for Chinese and Japanese script?
