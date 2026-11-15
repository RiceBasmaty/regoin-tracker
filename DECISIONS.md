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

## Phase 3.1: map readability (2026-11-15)

Feedback (Dmitry):
- too many city dots;
- big cities looked like villages;
- region names got lost;
- lakes were missing;
- France's regions felt meaningless;
- he wanted a way to hide all text.

Answers: no uppercase (size and weight only, like Google Maps); France option (b); small towns only at the closest zoom; major rivers yes; no other countries.

### D41. France uses its 22 historical regions
- **Decision (Dmitry):** Alsace, Lorraine, Burgundy, Upper and Lower Normandy, Brittany… the regions of 1982–2015, instead of the 13 merged regions of 2016 (Grand Est…). They're culturally meaningful.
- **How:** `data/groupings/FR.csv` groups the 96 departments plus the Métropole de Lyon. It's hand-written from the official 1982 composition, and the build fails if any department is unmatched.
  - English names, with French as the local name (Burgundy / Bourgogne).
  - The six regions whose territory is unchanged keep their current ISO codes: Île-de-France `FR-IDF`, Brittany `FR-BRE`, Corsica `FR-20R`, PACA `FR-PAC`, Pays de la Loire `FR-PDL`, Centre-Val de Loire `FR-CVL`.
  - The others get pinned fallback keys (D38).
- **Data version** goes to `2026-10.3`, and saved cities move automatically (D37).

### D42. Lakes and major rivers (Natural Earth, public domain)
- **Source:** Natural Earth 10m lakes (1,355) and river centrelines, size classes 0–6 (397 rivers: Nile, Danube, Volga, Rhine, Seine, Thames…). Each feature appears from Natural Earth's own recommended zoom. Lakes are drawn in the sea colour above land and region fills; lake and river names are in a blue tone.
- **Cost:** about 2 MB of tiles. `naciscdn.org` was added to the build environment. The files are downloaded once and reused, like GeoNames (D40).
- **Rejected:** Overture's water data (29 GB download, far more detail than needed).

### D43. Text hierarchy by size and weight; tiers for cities
- **Fonts:** Noto Sans Regular, Medium and Bold, generated by `pipeline/tools/build_fonts.py` from `@fontsource/noto-sans` (OFL) with fontTools (MIT) and `@kartore/glyphore` (MIT/Apache). Before this the map had one weight only.
- **City tiers** (`build_places.py`):

  | Tier | Which cities | Dot appears | Name |
  |---|---|---|---|
  | Capital | national capitals | zoomed out (zoom 3 at the latest) | **Bold**, ringed dot |
  | Big | 1M+, or the region centre | zoomed out | **Medium** |
  | Medium | 100k–1M | zoom 5–6 | Regular, dark |
  | Town | 15k–100k | zoom 7–8 | Regular, smaller, grey |
  | Village | <15k | zoom 10 (closest) only | Smallest, grey |

  A **region centre** is the largest city of one of *our* regions, or an official seat (GeoNames PPLA) of at least 20,000 people. GeoNames tags some hamlets as seats (West Ilsley, pop. 332).
- **Regions** use lighter grey, regular weight and slight letter spacing, with no dot, so they never look like cities.
- **Countries** are bold and largest.
- **Label priority**, the order in which collisions are won: country > your visited cities > capitals and big cities > lakes > regions > other cities > rivers. Region names now win against towns, and lake names against both.
- **Tokens:** all sizes (`--map-text-*`), fonts (`--map-font-*`) and colours (`--map-label-city`, `--map-label-region`, `--map-water-label`, `--map-river`) live in `tokens.css`, and contrast is tested in both themes. The tests caught nearly invisible dark-mode rivers.

### D44. "Map display" panel: City dots and Names
- One button on the map (the layers icon, above zoom) opens two switches:
  - **City dots:** other cities' dots and names. Your visited cities always stay.
  - **Names:** every name on the map, for a clean view.
- Both are remembered on each device. The panel is keyboard-operable, uses switch semantics for screen readers, and Esc closes it. It replaces D39's single dots button.

## Phase 3: map-first adding + better regions (2026-11-15)

### D37. One place for the data version; this release is `2026-10.2`
- `data/data-version.json` is the only place the map-data version is set. The pipeline, the app, the dev server and the tests all read it, and it keeps a short history of changes.
- **Bumped to `2026-10.2`,** because region keys changed (D36). Every published file has a new name, so CDN caches can't mix versions.
- **Saved cities are re-checked automatically.** A browser test proves a London saved under the old `GB-ENG` key moves to Greater London.

### D38. How the per-country levels (D36) were built
- **Tables:** `data/region-levels.csv` lists each country's building blocks and grouping table, with a reason per row. The build **stops** if a building block is missing from its table, so nothing can silently fall into the wrong region.
- **UK** (`data/groupings/GB.csv`, hand-written and verified by tests):
  - England's 151 units are grouped into 47 ceremonial counties, with the City of London inside Greater London.
  - Stockton-on-Tees straddles Durham and North Yorkshire and is placed in County Durham, where most of it lies.
  - Scotland's 32, Wales' 22 and Northern Ireland's 11 units are kept one-to-one with their ISO 3166-2:GB codes (Highland = `GB-HLD`).
  - UK total: 112 regions.
- **Serbia:** the 25 district units are kept one-to-one with ISO codes `RS-00` (Belgrade) to `RS-24`. Serbia's 5 other official districts are in Kosovo, which is its own territory in the neutral view (D8), so Serbia has **25** regions, not 30.
- **Slovenia, North Macedonia, Malta:** the groupings come from Wikidata (CC0) via `pipeline/tools/fetch_groupings.py`, and the output is committed. The build never calls Wikidata, so it stays reproducible offline.
  - Slovenia: 212 municipalities → 12 statistical regions, with SURS English names (Central Slovenia, Drava…) and Slovene local names.
  - North Macedonia: 71 → 8 statistical regions. Two manual rows with reasons: the City of Skopje has no code in Overture, and Prilep is missing in Wikidata.
  - **Malta:** 68 councils → Malta's **6 official regions** (Eastern, Western, Port, Northern, Southern, Gozo). These are the regions Wikidata links fully; the older 6 statistical districts are only partly linked there.
- **Keys:** a grouped region without an ISO code gets `<CC>-X` + the first 6 hex characters of sha1("CC:region name"), e.g. Greater London = `GB-XF82478`. Tests pin these keys, so they can never change silently.
- **Network:** the build environment now allows `query.wikidata.org`, `www.wikidata.org`, `commons.wikimedia.org` and `upload.wikimedia.org`. Only the groupings script and, later, the flags (Phase 4) use them.

### D40. GeoNames downloads are pinned once cached (bug found by a clean rebuild)
- **Bug:** GeoNames changes its files daily. On a re-run, the download step saw a new file size and *resumed*, gluing today's file onto yesterday's and corrupting both zips. A full clean rebuild before release caught it.
- **Fix:**
  - A cached GeoNames file is reused, which makes rebuilds identical. `download.py --refresh-geonames` fetches fresh files deliberately, always as a complete download to a temporary name, swapped in only once complete.
  - Every zip is integrity-checked, and a corrupt one is downloaded again automatically.
  - Overture files are versioned releases and still resume safely.
- **Also fixed:** `run_all.sh` now stops at the first failing step. Before, a failure inside a combined command let later steps run on missing data.

### D39. Cities on the map
- **New file `places.v<version>.pmtiles`:** all 162k cities. Each one appears from a zoom level set by its population:
  - 5M+: zoom 1
  - 1M+: zoom 2
  - 300k+: zoom 3
  - 100k+: zoom 4
  - 40k+: zoom 5
  - 15k+: zoom 6
  - 5k+: zoom 7
  - smaller: zoom 8
  - capitals appear one level earlier.

  Names appear from zoom 5 (D35: only dots when zoomed out). Visited cities are teal dots with teal names; other cities are muted grey dots, colour role `--map-place-*`.
- **Tapping a dot** (with a finger-sized margin) opens the city popup instead of the region card. The popup's button gets keyboard focus, and Esc closes it.
- **Show/hide control** (a map button above the zoom buttons, remembered per device): it hides other cities' dots and names. **Your visited cities always stay**, because they're your data. That's easy to change if wanted.
- **Region card:**
  - `places/<regionId>.json` lists every city of a region, largest first (typically 0.5 KB, at most ~96 KB). It's loaded when the card opens, and powers the quick-add buttons (the 8 largest not yet visited) and the region search.
  - Each visited city has ✕ to remove it, with Undo.
  - Adding from the card or popup doesn't move the camera, because you're already looking at the place.
- **Speed:** unchanged. Median first frame on this build machine was 2.15 s against 2.3 s for Phase 2 (D31). The edge-tiles change in Phase 5 remains the fix.

## Plan revision after Phase 2 feedback (2026-11-14)

### D35. Map-first adding, cities stay the only truth
- **Feedback (Dmitry):**
  - users browse the map and want to add from it, not only from the search bar;
  - with no city names on the map, it's easy to forget a city you visited.
- **Decision (agreed):**
  - show cities on the map as dots; names appear when zoomed in, and zoomed out only dots;
  - visited cities' dots stand out;
  - a map control hides or shows the dots;
  - tapping a city opens a small popup with Add, or Remove;
  - the region card gets quick-add chips (the region's largest cities), a region-scoped search, and remove buttons.
- **Rejected (both):** marking a region visited without a city. It would break data rule 1 and every future stat that depends on cities (list, trips, timeline).
- **Cost:** a new city-places tile layer. It's loaded after the first frame, so it doesn't count against the speed budget.

### D36. Region level chosen per country (`data/region-levels.csv`)
- **Feedback (Dmitry):**
  - UK regions (England, Scotland…) are too coarse;
  - Slovenia's 212 municipalities are too fine.

  A scan of region counts per UN country found three more outliers: North Macedonia 71, Malta 68, and Serbia, which has only 2.
- **Decision (agreed):**
  - **UK:** England's 48 ceremonial counties, Scotland's 32 council areas, Wales' 22 principal areas, Northern Ireland's 11 districts. London is one "Greater London" region, not 33 boroughs.
  - **Slovenia:** 12 statistical regions.
  - **North Macedonia:** 8 statistical regions.
  - **Malta:** 6 statistical regions.
  - **Serbia:** 29 districts + Belgrade.
  - Everything else stays as in D3.
- **How:** a per-country level table plus documented grouping tables (smaller official units → the agreed regions) where Overture has no ready-made level. That's needed for the UK ceremonial counties and the statistical regions. Keys are ISO 3166-2 where it exists, otherwise documented fallback keys (D4).
- **Saved cities:** a new data version triggers the automatic re-check (D32), so cities move to their new regions and none are lost.

## Phase 2: add a city (2026-11-14)

### D31. Speed is a separate report until Phase 4
- **Fact:** "4× slower CPU" is relative to the machine running the test, and headless Chromium draws with software graphics. Measured back to back on the same (busy, shared) build machine, the Phase 1 and Phase 2 builds gave the same result: medians 2.33 s and 2.38 s on typical 4G. Phase 2 added no load time; the machine was slower than on the day of D24.
- **Decision:** the functional browser tests (`npm run test:e2e`) no longer fail on timing. `npm run perf` reports first-frame times against the 2 s budget with ✔/⚠ (`PERF_STRICT=1` makes it fail). It becomes a hard check again in Phase 4, on the real hosting, where edge-served tiles remove ~0.6 s (D24).
- **Startup kept lean:** the search index loads on first focus of the search box, and saved cities load after the first map frame.

### D32. Visits live in IndexedDB on the device, with a safe fallback
- **Store:** database `region-tracker` v1, with object stores `visits` (key `cityId`, fields exactly as data rule 1) and `meta` (`dataVersion`). Future format changes add numbered upgrade steps; old steps are never edited.
- **Durability:** the app asks the browser for persistent storage, so data isn't evicted when space is low. If IndexedDB is unavailable (some private modes), the app keeps working in memory and says politely that cities won't be kept.
- **Tabs:** open tabs stay in sync through `BroadcastChannel`.
- **Data updates:** when `DATA_VERSION` changes, every saved city is looked up again in the new index (by id; the name picks the shard) and its region and country are updated. A city missing from the new index keeps its old values and is never deleted.

### D33. Adding a city
- **Picking a suggestion:**
  - the city is saved;
  - its region (`feature-state visited`) and country (light outline, D27) are derived and highlighted;
  - a dot is drawn (GeoJSON source `visited-cities`);
  - the camera flies there (zoom ≥ 5.5, never zooming out; it jumps instead when the device asks for reduced motion);
  - "Added X · Undo" appears for 6 s, paused while hovered or focused.
- **The search box stays focused and cleared,** ready for the next city.
- **Picking a city already on the list** only flies to it ("X is already on your list"). Saved cities show a "Visited" tag in suggestions.
- **Search box behaviour:** it follows the WAI-ARIA combobox pattern. ↑/↓ move, Enter picks (the first suggestion if none is highlighted), Esc closes the list, a second Esc clears the text, and "/" focuses the box from anywhere. Polite messages for no results, a slow connection and offline.
- **Bugs caught by the new tests and fixed:**
  - the browser's own "Esc clears a search box" behaviour ran on top of ours;
  - a list refresh lost the keyboard highlight;
  - a highlight could stay stuck if Undo was pressed mid-flight, because `isStyleLoaded()` is briefly false while tiles load;
  - on phones, the Map/Globe switch was cut off and the confirmation covered the credits.

### D34. Tokens: palette + roles (implements D26)
- `tokens.css` holds `--palette-*` raw colours and role tokens (`--color-*`, `--map-*`). Tests enforce three rules:
  - roles reference palette colours only;
  - `app.css` uses roles only (no palette names, no hex);
  - every text/background role pair meets WCAG AA in both themes. This caught the dark-mode Undo colour, now `--palette-teal-700`.

## Plan approval (2026-11-14)

### D26. Colours stay; the token system becomes palette + roles
- **Decision (Dmitry):** keep the current colours for now. Make them easy to replace when the design system is done.
- **How:** `tokens.css` gets two layers.
  - **Palette:** raw colours, e.g. `--palette-teal-600`.
  - **Roles:** what each colour is used for, e.g. `--color-accent: var(--palette-teal-600)`, `--map-visited-fill`.
  - Components and the map use **roles only**. A new design system replaces the palette, and remaps a few roles if needed; no component code changes.

### D27. Visited countries get a light outline; adding shows "Added X · Undo"
- **Decision (Dmitry):** a country with at least one visited city gets a light accent outline. Its regions still carry the fill. Adding a city shows a short confirmation with Undo.

### D28. A small counter now; a stats page after launch
- **Decision (Dmitry):** Phase 3 shows only a very small counter (cities · countries · regions). A dedicated page with timeline, single-country view and trips comes after launch. Per-country counters come with accounts (Phase 5).

### D29. Phase 4 runs on free tiers; error logging is our own endpoint
- **Decision:** there's no domain yet, so the free Cloudflare plans and the free `*.pages.dev` address. Errors from users' browsers are sent (deduplicated and rate-limited) to a small endpoint on the Worker we need for tiles anyway, and kept in Cloudflare's own logs.
- **Reason:** it's free and private (no third party sees users' data), there's no extra account or cookie notice, and it reuses infrastructure we already run.
- **Alternatives:** Sentry (richer dashboards, but a third party, and its free tier is capped). We can add it later if the volume or the need for analysis grows.

### D30. Flags in the region card (Phase 3)
- **Country flags:** an MIT-licensed SVG flag set, which renders the same on every device. Emoji flags show as letters on Windows.
- **Region flags:** a pipeline step follows each region's Wikidata link to its flag on Wikimedia Commons. It keeps only public-domain or attribution-licensed files, cleans each SVG (removes scripts), records credits, and falls back to the country flag. Expected coverage is about 60–80% of regions. The build environment will need access to `www.wikidata.org` and `commons.wikimedia.org`.

## Answered product questions (2026-11-14)

1. Disputed borders: keep Overture's neutral view (D8).
2. Pseudo-codes: show names (D17).
3. Overseas territories: separate, with their own regions; only UN member states count as countries (D16).
4. Search starts at 2 characters (D17).
