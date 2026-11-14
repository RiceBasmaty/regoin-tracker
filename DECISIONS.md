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

### D8. Disputed territories: Overture's neutral view ✅ *confirmed by Dmitry 2026-11-14*
- **Fact:** CLAUDE.md asks for the de facto (who controls it) view. This Overture release ships **no perspective data** (`perspectives` is empty on every division). Its default view puts disputed areas in separate pseudo-countries with `X?` codes: Kosovo `XK`, West Bank `XW`, Gaza `XG`, Golan `XH`, the Kurils `XU`/`XI`/`XO`/`XA`, Abyei, Bir Tawil and others. Crimea and Sevastopol are inside Ukraine (`UA-43`, `UA-40`).
- **Decision:** ship Overture's neutral view unchanged. Dmitry confirmed this on 2026-11-14. It replaces the "de facto" default in CLAUDE.md.
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

  At most 40 names per city. Suggestions start at **2** characters (D17).
- **Ranking:** score = population × 20 if the query equals the whole name × a weight for the kind of name matched (main name 1, local-language name 0.3, foreign language 0.1, later word 0.2, name without a language tag 0.1). The constants live in `pipeline/config.py` and ship in the search manifest, so tuning them doesn't need an app release.
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

### D16. Countries are UN member states; everything else is a territory ✅ *Dmitry, 2026-11-14*
- **Decision:** "Countries visited" counts only the 193 UN member states (`data/un-member-states.txt`, flagged `un: true` in `countries.v2026-10.json`). Dependencies (Puerto Rico, Réunion, Greenland…), the observer state Vatican City and disputed territories (Kosovo, Gaza Strip…) keep their own regions and appear in the progress list, but count as territories, not countries. They are not merged into France, the USA or Denmark.
- **Effect:** `stats()` returns `countries` (UN members) and `territories` separately. The build stops if any UN member is missing from the boundary data.

### D17. Suggestions from the 2nd character; names instead of pseudo-codes ✅ *Dmitry, 2026-11-14*
- **Decision:** suggestions start at 2 characters, so `東京` (Tokyo) and `Ub` are findable. The CLAUDE.md flow was updated to match.
- **Guard against noise:** a 2-character key is indexed only if it's a city's main name or written in a non-Latin script. 2-letter Latin alternates are mostly abbreviations or old forms (Chongqing was matching "Pa"). Names with no language tag (often old romanisations like "P'an-yü") now weigh 0.1 instead of 0.3.
- **Pseudo-codes:** territories with Overture's `X?` codes show their name in suggestions (`Gaza, Gaza Governorate, Gaza Strip`; `Pristina, District of Prishtina, Kosovo`), never the code. When the region and territory names are the same, the name is shown once.

## Phase 1: map shell (2026-11-14)

### D18. Plain JavaScript + Vite; MapLibre 6 and PMTiles; versions pinned
- **Decision:** No UI framework. The app is small ES modules in `app/src/`, built with Vite 8.3.5. Map: MapLibre GL JS 6.16.0 and pmtiles 4.5.0. All versions are pinned exactly and were at least two weeks old when chosen, so they've had time to get bug-fixed.
- **Reason:** The smallest bundle and the fewest moving parts to keep updated for years. The whole app is ~300 KB compressed, and almost all of that is MapLibre itself.
- **Alternatives:** React/Svelte (more to update, little benefit for a map plus a few panels).
- **Gotcha recorded:** MapLibre 6 finds its background "worker" script at runtime, which bundlers can't see. We import it explicitly (`?url`) and call `setWorkerUrl`. A build step also adds a preload hint so it downloads in parallel with the main script.

### D19. Our own minimal basemap, no third-party map service
- **Decision:** The background colour is the sea, our `countries` tiles are the land, and our region and country lines sit on top. Country labels (and region labels from zoom 4.5) come from the metadata JSON. Label fonts are Noto Sans glyphs we host ourselves (from `smp-noto-glyphs`, MIT; font under OFL). Only the Latin, Greek and Cyrillic ranges are shipped (~750 KB on disk, and only the ranges a label needs are fetched). Chinese, Japanese and Korean labels use the device's fonts.
- **Reason:** No outside dependency can go down, rate-limit us or start charging. It's the calm, minimal look the brief asks for, and it costs nothing at any traffic level.
- **Alternatives:** OpenFreeMap or Protomaps basemaps (more detail than we need, and an outside dependency). They remain an option for street-level detail later.
- **Licence check:** a glyph generator without a stated licence (`maplibre-font-maker-node`) was rejected.

### D20. One design-tokens file drives the UI and the map
- **Decision:** `app/src/styles/tokens.css` holds every colour, type size, spacing value, radius, shadow and the timing of animations, including `--map-*` colours. The map style reads them at runtime (`readMapTokens`), and `style.js` contains no colours (a test enforces this). Dark theme follows the device setting, or `data-theme` on `<html>`.
- **Guard:** `tests/tokens.test.js` checks WCAG 2.1 AA contrast for every text/background pair in both themes, and that the two copies of the dark theme are identical.

### D21. A region "card" rather than a map-anchored popup
- **Decision:** Clicking a region highlights it and opens a card. On desktop it floats top-left; on phones it's a bottom sheet. It shows the region name, the local name when it differs, the country, a "Territory" tag for non-UN places, visited status and the visited cities. Hovering on desktop shows a small name tooltip. Esc, the close button or a click on the sea closes the card.
- **Reason:** An anchored popup covers the map exactly where you clicked, gets cramped with a list of cities, and is awkward on phones. A card has room and stays readable.

### D22. Globe by default, remembered per device; no rotation or tilt
- **Decision:** The first view is the globe, sized to fill ~85% of the screen. The Map/Globe choice is saved in the browser (per device; user data stays in IndexedDB later). Rotation and tilt are off, so the map stays calm and north-up.

### D23. Errors are visible and polite
- Tiles fail → "Some map data didn't load. [Try again]".
- Offline → "You're offline…", which clears itself when the connection returns.
- Names fail → "Region names couldn't load. [Try again]".
- No WebGL → a plain explanation instead of a blank page.
- Cancelled tile requests (normal while the map moves) are deliberately ignored.

### D24. Speed budget: how we measure it, and where we stand
- **Definition:** "Mid-range phone on 4G" = 4× slower CPU, 9 Mbit/s down, 1.5 Mbit/s up, 60 ms latency. The e2e test enforces first map frame < 2 s with this profile. The stricter Lighthouse "slow 4G" (1.6 Mbit/s, 150 ms) is measured and reported, not enforced.
- **Today (headless Chromium with software graphics, so pessimistic):** typical 4G ≈ **1.9 s** (median of 3; single runs vary 1.8–2.1 s) ✅, a thin margin. Slow 4G ≈ 4.3 s: about 600 KB must arrive at 1.6 Mbit/s, and each PMTiles lookup costs a full round trip.
- **What we did:** coarser geometry for zoomed-out tiles (`--low-detail=10`; world tile 138 → 73 KB), worker preload, and labels and names loaded after the first frame.
- **Planned for Phase 4:** serve tiles as plain cached URLs from Cloudflare's edge (a small Worker reading the PMTiles file in R2, the standard setup). That removes the header → directory → tile round trips, plus a ~0.5 s gap where a busy phone decodes the PMTiles directory. Expected gain: ~0.6 s on typical 4G, more on slow networks. Until then the margin is thin, so the e2e check uses the median of 3 runs.

### D25. Land area added to region and country metadata
- `area` (km²) is in `regions.v2026-10.json` and `countries.v2026-10.json`. Labels use it, so big countries win label space when zoomed out (scattered island groups no longer crowd the globe). It's also ready for "area visited" stats later.

### Known gaps, scheduled
- Selecting a region by keyboard alone isn't possible yet. Arrow keys, + and − move the map, and Phase 2's search is the keyboard path to a place. Full keyboard and screen-reader review is in Phase 3.
- Security headers (CSP: MapLibre needs `worker-src` for its module worker), cache headers and CDN compression come in Phase 4.

## Answered product questions (2026-11-14)

1. Disputed borders: keep Overture's neutral view (D8).
2. Pseudo-codes: show names (D17).
3. Overseas territories: separate, with their own regions; only UN member states count as countries (D16).
4. Search starts at 2 characters (D17).
