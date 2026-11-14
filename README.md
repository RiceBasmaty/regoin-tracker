# Region Tracker

Log the cities you've visited; each one fills in its region and country on a world map (flat or globe).
Product brief and rules: [`CLAUDE.md`](CLAUDE.md). Why things are built the way they are: [`DECISIONS.md`](DECISIONS.md).

**Status:**
- Phase 0 (data pipeline): done.
- Phase 1 (map shell): done. You can open the map, switch between flat and globe, hover over and click regions, and see dark mode, the phone layout and error messages.

## What Phase 0 produces

Running the pipeline creates `dist/data/v2026-10/`. That folder gets uploaded to the CDN as-is:

| File | What it is | Size |
|---|---|---|
| `regions.v2026-10.pmtiles` | Map tiles for ~4,000 regions (French régions, Swedish län, US states…); each shape carries only its key (`FR-IDF`) and country | ~61 MB (a phone loads only the few tiles it shows) |
| `countries.v2026-10.pmtiles` | Map tiles for 272 countries/territories | ~12 MB |
| `regions.v2026-10.json` | For every region: name, local name, country, bounding box, label point | ~0.5 MB |
| `countries.v2026-10.json` | For every country: name, number of regions (for "% of regions visited") | small |
| `search/*.json` | City search index: ~162,000 cities split into ~21,000 small files by their first letters; one search loads one file (median 0.2 KB, max ~66 KB) | ~41 MB total |
| `manifest.json` | Sizes, checksums, input files, licences | |

The shared browser/Node code lives in `shared/`:
- `normalize.js` strips accents and folds case, so `goteborg` = `Göteborg`. It's identical to `pipeline/textnorm.py`, and a test enforces that.
- `search.js` turns a typed query into ranked suggestions such as `Paris, Île-de-France, FR`.
- `visits.js` handles the visited-cities list and derives visited regions and countries from it, plus stats.

## Run the app (Phase 1)

The app needs the pipeline output in `dist/data/` (build it once with `pipeline/run_all.sh`, below).

```bash
npm install          # once
npm run dev          # http://localhost:5173 , live reload while editing
npm run build        # production build into dist/app/
npm run preview      # serve the production build at http://localhost:4173
npm run test:e2e     # real-browser checks + speed budget; screenshots in tests/e2e/screenshots/
```

In the browser console, `regionTracker.map` and `regionTracker.state` help with troubleshooting. Load timing appears as `rt:map-loaded` and `rt:map-ready` in DevTools → Performance.

Where things are:
- **Look and feel:** every colour, size and spacing value lives in `app/src/styles/tokens.css`. The map reads its colours from there too.
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
- **A city is in the wrong region:** if the city's GeoNames point is wrong, add a row to `data/city-overrides.csv`. If the boundary is wrong, add a row to `data/region-overrides.csv`. Every row needs a reason. Then re-run.
- **Updating to a new Overture release:** change `OVERTURE_RELEASE` and `DATA_VERSION` in `pipeline/config.py`, then run `pipeline/run_all.sh --clean`. Every output file name changes, so old and new data never mix in a cache. The region-count test will flag it if a country's regions changed.
- **A download fails halfway:** just re-run. Files are resumed and checked against the server's size.

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
