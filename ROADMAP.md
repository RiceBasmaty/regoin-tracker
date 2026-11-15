# Roadmap

The plan approved by Dmitry on 2026-11-14. The details of each finished phase live in `DECISIONS.md`.

| Phase | Status |
|---|---|
| 0. Data pipeline | ✅ done |
| 1. Map shell | ✅ done |
| 2. Add a city (search) | ✅ done |
| 3. Map-first adding + better regions | ✅ done |
| 3.1 Map readability (text hierarchy, lakes, France) | ✅ done |
| 4. Progress and polish | next (Dmitry has feedback first, 2026-11-16) |
| 5. Deploy and harden | planned |
| 6. Accounts and sync | later |

## Phase 2: Add a city (search) ✅
Search bar, saving on the device, dots, visited regions and countries, fly-to, "Added · Undo". See DECISIONS D31–D34.

## Phase 3: Map-first adding + better regions ✅ (agreed 2026-11-14, done 2026-11-15; see D37–D39)
Feedback: the map, not the search bar, should be the main way to add cities, and some countries' regions are the wrong size.

**Region level per country** (new table `data/region-levels.csv`, every row with a reason):
- **United Kingdom:** one level deeper, using the counties people actually say:
  - England: 48 ceremonial counties (Oxfordshire, Kent, Greater London, Greater Manchester, West Yorkshire…);
  - Scotland: 32 council areas;
  - Wales: 22 principal areas;
  - Northern Ireland: 11 districts.

  London is one region ("Greater London"), not 33 boroughs.
- **Slovenia:** one level up, from 212 municipalities to 12 statistical regions.
- **North Macedonia:** 71 municipalities → 8 statistical regions.
- **Malta:** 68 local councils → 6 statistical regions.
- **Serbia:** 2 regions → 29 districts + Belgrade.
- **Everything else stays as it is,** including Azerbaijan's 80.
- **Saved cities move to their new regions automatically,** with nothing lost. The map data gets a new version number.

**Cities on the map:**
- Dots for places: big cities when zoomed out, smaller towns as you zoom in. Names appear as you zoom in; zoomed out, only dots.
- Visited cities' dots stand out in the accent colour.
- A **map control to show or hide the dots** (agreed).
- **Tapping a city** opens a small popup: name, region, and **Add**, or ✓ Visited and **Remove** (agreed; no instant add, to avoid accidental taps).

**Region card:**
- **"Add a city here":** one-tap chips for the region's largest cities, plus a search box limited to that region.
- **Remove (✕)** next to each visited city.

**Not doing:** marking a region visited without a city (strong no from both of us). The city stays the only stored truth.

## Phase 3.1: Map readability ✅ (2026-11-15; D41–D44)
Text hierarchy by size and weight; fewer dots (big cities and your visited cities when zoomed out, villages only at the closest zoom); lakes and major rivers; France's 22 historical regions; "Map display" panel with City dots and Names switches.

## Phase 4: Progress and polish
- **"My cities" panel:** search, sort, and delete with undo. It's mainly for reviewing now that adding happens on the map.
- **A very small counter** on the map, e.g. "42 cities · 12 countries · 57 regions" (approved). A dedicated stats page comes after launch: timeline, single-country view, trips. Per-country counters come with accounts.
- **Export and import** of your list as a file. Imported cities are added to the list, and duplicates are skipped.
- **Flags in the region card:**
  - country flags from an MIT-licensed SVG set;
  - region flags from Wikidata/Wikimedia Commons where the licence allows, with the region's country flag as fallback;
  - the pipeline records each flag's licence and cleans the files.
- **Accessibility pass** (keyboard, screen readers) and an "About & credits" panel.

## Phase 5: Deploy and harden (free tier, no domain yet)
- **Hosting on free Cloudflare plans:** Pages for the app, R2 for the data, and a Worker serving tiles as plain cached URLs. The site uses Cloudflare's free `*.pages.dev` address until a domain is bought.
- **Error logging** with our own tiny endpoint on that Worker (decided in D29: free, private, no third party).
- **Security:** security headers (CSP), rate limits, and DDoS protection from the CDN.
- **Upkeep:** automated tests on every change (GitHub Actions), a one-command data upload, and a final performance check.
- **Costs:** anything that would cost money gets asked about first.

## Phase 6: Accounts and sync (later)
- Supabase sign-in and sync, per-country counters, "download my data" and "delete my account". Details to be discussed.
