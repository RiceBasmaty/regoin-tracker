# Region Tracker

A web app where a user logs the cities they've visited. Each city fills in its region (and country) on a world map that can be viewed flat or as a globe.

## Working with Dmitry (read first)

- Dmitry is the product owner, **not a developer**. You make all technical decisions.
- Explain each decision in 1–2 plain-language sentences (what you chose, why, what it costs). No jargon without a short explanation.
- Record every significant decision in `DECISIONS.md` (date, decision, reason, alternatives considered).
- Ask Dmitry only about product and design questions: what the user sees, says, or clicks. Ask before anything hard to undo (data model changes after launch, licences, paid services).
- He is very particular about design and wants the product **built to last**: durable, scalable to high traffic, resistant to abuse and DDoS, easy to customise and troubleshoot. That matters more than shipping fast.
- After each phase, give him a short demo checklist he can click through himself.

## Core user flow (must match exactly)

1. User types a city name in the search bar.
2. **From the 2nd character** (decided 2026-11-14 so short names like `東京` work), suggestions appear, formatted `City, Region, CC`, for example `Paris, Île-de-France, FR`. Territories without an ISO country code show their name instead of a code (`Gaza, Gaza Governorate, Gaza Strip`).
3. User clicks a suggestion. The app:
   - saves the city to the user's **visited cities** list,
   - marks the city with a dot on the map,
   - fills in its region (and country) as visited,
   - flies the camera to it.
4. User repeats this to add every city they've visited.
5. Clicking any region on the map shows its name and country, whether it's visited, and the visited cities inside it.

Search requirements:
- Ignore accents and case: `ile` finds `Île-de-France`, `goteborg` finds `Göteborg`.
- Match alternate and English names (e.g. `Moskva` and `Moscow`).
- Rank by population, so `Paris, Île-de-France, FR` comes before `Paris, Texas, US`.
- Same-name cities must be distinguishable by the region and country shown.
- Keyboard: arrow keys, Enter to select, Esc to close.
- Adding a city that's already saved does nothing except fly to it; never create duplicates.

Visited cities:
- Kept as a list with search, sort and delete.
- Deleting the last city in a region un-highlights that region (regions are derived; see rules below).

## Non-negotiable data rules

1. **The city is the source of truth.** Store visits as cities (`cityId, name, lat, lon, countryIso, regionId, addedAt`). Visited regions and countries are always **derived** from the stored cities, never stored as independent truth.
2. **Regions are OSM `admin_level = 4`**, sourced from Overture Maps *divisions*. If a country has no level-4 units, fall back to the nearest available level (3, then 5, then 6). Keep a small override table (`data/region-overrides.*`) for exceptions, and document each one. Some countries use a different level by decision (`data/region-levels.csv`, DECISIONS D36): UK ceremonial counties / council areas, Slovenia, North Macedonia and Malta statistical regions, Serbia districts.
3. **Region keys are ISO 3166-2 codes** (e.g. `FR-IDF`, `SE-AB`). Use a documented fallback ID only where ISO has no code.
4. **A city's region is precomputed at build time** with a spatial join (point-in-polygon) and shipped inside the city index. The browser does no geometry lookups for indexed cities. A runtime point-in-polygon fallback is fine for places that aren't in the index.
5. **Data pipeline is reproducible.** Scripts in `/pipeline`, pinned to an Overture release (e.g. `2026-10-21.0`), re-runnable from scratch. Generated files are versioned (e.g. `regions.v2026-10.pmtiles`) so caches never serve mismatched data.
6. **Licences and attribution.** Overture/OSM data is ODbL: show visible attribution in the map; keep the derived boundary data separate from user data. City data source licence (e.g. GeoNames CC BY 4.0) must also be attributed. Do not use GADM (non-commercial licence).
7. **Disputed borders:** use Overture's neutral default view (decided by Dmitry 2026-11-14, DECISIONS D8): disputed areas are their own territories (Kosovo, Gaza Strip, West Bank, Golan, Kuril islands…) and Crimea is shown inside Ukraine. Keep it switchable later if Overture ships perspectives. Only the 193 UN member states count as "countries" (D16).

## Architecture direction (you may change with a recorded reason)

- **Static-first.** The MVP has no backend: app, map tiles, and city index are static files on a CDN. User data is stored locally (IndexedDB), with JSON export and import.
- **Map:** MapLibre GL JS (v6) with a flat map/globe toggle; region fills via `feature-state`; boundaries served as PMTiles.
- **Basemap:** a minimal custom style (land, water, borders, few labels), not a busy street map. Optional OpenFreeMap or Protomaps for labels, with a fallback.
- **City index:** built from GeoNames `cities1000` (or Overture localities if you have a good reason), sharded by name prefix so each search loads only a small file.
- **Hosting:** Cloudflare Pages (app) and R2 (tiles and index), with long cache headers on versioned files.
- **Later (post-MVP):** Supabase for accounts and sync (auth, row-level security on every table, PostGIS for re-tagging cities when boundaries change). The local-first store stays primary on the device.
- **Frontend framework, build tool, libraries:** your call. Optimise for small bundle size, long-term maintainability, and easy theming.

## Design and quality bar

- Modern, light, calm 2026 web style. All colours, type, spacing and radii live in **one design-tokens file** so the look can be changed in one place. Light theme first, with dark theme supported by the tokens.
- Performance budget: first map frame under 2 s on a mid-range phone on 4G; search suggestions under 100 ms after a keystroke.
- Accessibility: WCAG 2.1 AA contrast, full keyboard use, screen-reader labels on search, list and popups.
- Responsive: works on a phone and a desktop.
- Errors are handled visibly and politely (offline, tiles failed to load, empty search).
- Tests: data-pipeline checks (e.g. Paris → `FR-IDF`, Stockholm → `SE-AB`, New York → `US-NY`, Tokyo → `JP-13`) plus unit tests for search ranking and the derived-region logic.

## Phases

0. **Data pipeline:** region and country PMTiles, a city index with precomputed regions, and validation tests. No UI yet. ✅
1. **Map shell:** map/globe toggle, borders, hover, click popup. ✅
2. **Add a city (search):** the search flow above, saving visits, region highlighting, city dots. ✅
3. **Map-first adding + better regions:** cities on the map (dots, names when zoomed in, show/hide control), tap a city → popup with Add/Remove, quick-add chips and scoped search in the region card, per-country region levels (D35, D36). Never a region without a city.
4. **Progress and polish:** visited-cities list, small counter (cities · countries · regions), export/import, flags, accessibility, attribution.
5. **Deploy and harden:** Cloudflare (free tier), caching, edge-served tiles, security headers (CSP), error logging, performance check.
6. **Post-MVP:** accounts and sync (Supabase).

Definition of done for each phase: it works, it's tested, `DECISIONS.md` is updated, `README.md` explains how to run it, and Dmitry has a click-through checklist.
