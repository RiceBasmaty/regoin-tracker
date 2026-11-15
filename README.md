# Region Tracker

Log the cities you've visited; each one fills in its region and country on a world map (flat or globe).
Product brief and rules: [`CLAUDE.md`](CLAUDE.md). The plan for the remaining phases: [`ROADMAP.md`](ROADMAP.md). Why things are built the way they are: [`DECISIONS.md`](DECISIONS.md).

**Status:**
- Phase 0 (data pipeline): done.
- Phase 1 (map shell): done. Flat map and globe, hover, a region card when you click, dark mode, phone layout, error messages.
- Phase 2 (add a city): done. Search, save cities on the device, city dots, visited regions and countries, fly-to, "Added · Undo".
- Phase 3.1 (map readability): done. Text hierarchy by size and weight, fewer dots, lakes and major rivers, France's 22 historical regions, and a "Map display" panel (city dots / names).
- Phase 3 (map-first adding + better regions): done. Cities on the map, tap a city to add it, quick-add and region search in the region card, remove from the card, UK counties, and statistical regions for Slovenia, North Macedonia and Malta, plus Serbian districts.

## What Phase 0 produces

Running the pipeline creates `dist/data/v<version>/`, where the version is set in `data/data-version.json` (now `2026-10.2`). That folder gets uploaded to the CDN as-is:

| File | What it is | Size |
|---|---|---|
| `regions.v….pmtiles` | Map tiles for ~3,800 regions (French régions, Swedish län, US states, English counties…); each shape carries only its key (`FR-IDF`) and country | ~44 MB (a phone loads only the few tiles it shows) |
| `countries.v….pmtiles` | Map tiles for 272 countries/territories | ~7 MB |
| `places.v….pmtiles` | All 162k cities as map dots with a tier (capital, big, medium, town, village) for the text hierarchy | ~14 MB |
| `water.v….pmtiles` | Lakes, major rivers and lake names (Natural Earth) | ~2 MB |
| `regions.v….json` | For every region: name, local name, country, land area, bounding box, label point | ~0.5 MB |
| `countries.v….json` | For every country: name, number of regions, UN member or territory | small |
| `places/<region>.json` | Every city of one region, largest first (region card: quick-add and search) | ~3,700 files, typically 0.5 KB |
| `search/*.json` | City search index split into ~24,000 small files by first letters; one search loads one file | ~42 MB total |
| `manifest.json` | Sizes, checksums, input files, licences | |

Which countries use a different region level, and how their regions are grouped: `data/region-levels.csv` and `data/groupings/`.

The shared browser/Node code lives in `shared/`:
- `normalize.js` strips accents and folds case, so `goteborg` = `Göteborg`. It's identical to `pipeline/textnorm.py`, and a test enforces that.
- `search.js` turns a typed query into ranked suggestions such as `Paris, Île-de-France, FR`.
- `visits.js` handles the visited-cities list and derives visited regions and countries from it, plus stats.

## First-time setup on a Mac

1. Install [Homebrew](https://brew.sh) if you don't have it, then install Python and Node:
   ```bash
   brew install python@3.13 node@22
   ```
2. Get the code, and switch to the working branch:
   ```bash
   git clone https://github.com/RiceBasmaty/regoin-tracker.git && cd regoin-tracker && git checkout claude/epic-galileo-d6ziok
   ```
3. Build the map data once. This takes about 20 minutes and downloads ~5 GB:
   ```bash
   pipeline/run_all.sh
   ```
4. Start the app and open http://localhost:5173:
   ```bash
   npm install && npm run dev
   ```

If the page says *"Map data hasn't been built on this computer yet"*, step 3 hasn't finished. Run it, then reload the page.

## Run the app (Phase 1)

The app needs the pipeline output in `dist/data/` (build it once with `pipeline/run_all.sh`, below).

```bash
npm install          # once
npm run dev          # http://localhost:5173 , live reload while editing
npm run build        # production build into dist/app/
npm run preview      # serve the production build at http://localhost:4173
npm run test:e2e     # real-browser checks of every user flow; screenshots in tests/e2e/screenshots/
npm run perf         # speed report: first map frame on an emulated mid-range phone (4G, slow 4G)
```

In the browser console, `regionTracker.map` and `regionTracker.state` help with troubleshooting. Load timing appears as `rt:map-loaded` and `rt:map-ready` in DevTools → Performance.

Where things are:
- **Map fonts:** `app/public/fonts/` (Noto Sans Regular, Medium and Bold), rebuilt by `pipeline/tools/build_fonts.py`.
- **Look and feel:** `app/src/styles/tokens.css`. This includes the map's text sizes (`--map-text-*`) and fonts (`--map-font-*`). Raw colours are in the *palette* section and their uses are in the *roles* section; to restyle, change the palette. The map reads its colours from there too.
- **Saved cities:** stored in the browser (IndexedDB) by `app/src/data/storage.js` and `visits-store.js`. To start fresh: DevTools → Application → Storage → Clear site data.
- **Map layers:** `app/src/map/style.js`.
- **Card text:** `app/src/ui/region-model.js`.
- **Data location:** `app/src/config.js` (set `VITE_DATA_BASE_URL` for a CDN).

## Run the data pipeline

Requirements: Linux or macOS, Python 3.11+, Node 22+, about 6 GB of free disk, and internet access to
`overturemaps-us-west-2.s3.amazonaws.com`, `download.geonames.org`, `conda.anaconda.org` and PyPI.

```bash
pipeline/run_all.sh            # everything: tools, download, build, tests
pipeline/run_all.sh --clean    # same, after deleting previous output
```

| Step | First run | Re-run |
|---|---|---|
| Install tools (pinned) | ~1 min | seconds |
| Download (~4.7 GB Overture + ~220 MB GeoNames) | 3–15 min, depending on connection | skipped (cached, size-checked) |
| Build regions → cities → tiles → publish | ~5 min | ~5 min |
| Tests | ~30 s | ~30 s |

Run single steps from `pipeline/` with `../.venv/bin/python <step>.py`, in this order:
`download`, `build_regions`, `build_cities`, `build_tiles`, `publish`.

Tests only:

```bash
npm test               # search, normaliser, derived regions, map style, card text, colour contrast (Node)
npm run test:pipeline  # data checks: Paris→FR-IDF etc., coverage, shard sizes, tiles (Python)
```

Try the search from the terminal:

```bash
npm run demo:search -- paris goteborg moskva "new y" stockholm
```

## Troubleshooting

- **The build reports** are in `build/*.report.json`: which countries fell back to another level, which cities snapped to a region, which cities' country differs from GeoNames, shard sizes. Read these first when a number looks off.
- **After a `git pull` that changes `data/data-version.json`:** run `pipeline/run_all.sh` again (~6–10 minutes with downloads cached). The dev server tells you if the data for the current version is missing. Saved cities move to their new regions automatically.
- **A city is in the wrong region:** if the city's GeoNames point is wrong, add a row to `data/city-overrides.csv`. If the boundary is wrong, add a row to `data/region-overrides.csv`. Every row needs a reason. Then re-run.
- **Updating to a new Overture release:** change `OVERTURE_RELEASE` and `DATA_VERSION` in `pipeline/config.py`, then run `pipeline/run_all.sh --clean`. Every output file name changes, so old and new data never mix in a cache. The region-count test will flag it if a country's regions changed.
- **A download fails halfway:** just re-run. Overture files resume; GeoNames files are re-downloaded whole, and every zip is integrity-checked.
- **Fresh city data:** GeoNames is downloaded once and then reused, so rebuilds give identical results. To get today's GeoNames, run `cd pipeline && ../.venv/bin/python download.py --refresh-geonames`, then `pipeline/run_all.sh`.

## Layout

```
app/        the web app (Vite root): index.html, src/ (map, ui, styles/tokens.css), public/fonts
pipeline/   Python build steps, config (all pinned versions in config.py), tests
shared/     JS modules used by the app and the tests (no dependencies)
data/       hand-maintained override tables (documented rows only)
tests/      Node unit tests; tests/e2e/ real-browser checks
build/      intermediate files + reports (git-ignored, rebuilt)
dist/       publishable output (git-ignored, rebuilt)
```
