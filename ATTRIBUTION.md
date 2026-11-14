# Data sources and licences

| Data | Source | Licence | Required notice |
|---|---|---|---|
| Region and country boundaries | [Overture Maps Foundation](https://overturemaps.org), *divisions* theme, release `2026-10-21.0` (built largely from OpenStreetMap) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | © OpenStreetMap contributors, Overture Maps Foundation |
| Cities, populations, alternate names | [GeoNames](https://www.geonames.org) `cities1000`, `alternateNamesV2` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | City data © GeoNames |

Rules we follow (CLAUDE.md, data rule 6):

- The map must show both notices visibly (Phase 1). The PMTiles files also carry the OSM/Overture notice in their metadata.
- The derived boundary files (`regions.*`, `countries.*`) are published separately from any user data. Under ODbL they are a "derivative database"; if we ever distribute them outside the app, they stay under ODbL.
- GADM is **not** used (non-commercial licence).

The same list is machine-readable in `dist/data/v<version>/manifest.json` → `attribution`.
